#!/usr/bin/env bash
# One-time setup of an Ubuntu 24.04 EC2 server for the Wholesale backend. Safe to run again.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/setup-ec2.sh -o setup-ec2.sh
#   DOMAIN=erp-wholesale.duckdns.org EMAIL=you@example.com bash setup-ec2.sh
#
# Installs Node 22, pm2, nginx (+ free HTTPS from Let's Encrypt), the Postgres 17 client tools (for copying the
# database), 2 GB of swap, clones the repository to ~/app and creates the key GitHub Actions uses to deploy.
# Optional: REPO (default below), BRANCH (default main), DUCKDNS_TOKEN (keeps the DuckDNS name pointed at this
# server if its address changes; not needed with an Elastic IP).
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, e.g. DOMAIN=erp-wholesale.duckdns.org}"
EMAIL="${EMAIL:?Set EMAIL, where Lets Encrypt sends certificate expiry warnings}"
REPO="${REPO:-AliNaseem123456789/ERP-Wholesale-Management-System}"
BRANCH="${BRANCH:-main}"
APP_DIR="$HOME/app"
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

say "System packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v pg_dump >/dev/null || [ "$(pg_dump --version | grep -oE '[0-9]+' | head -1)" -lt 17 ]; then
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y postgresql-client-17
fi
sudo npm install -g pm2@latest

say "Swap (npm install and two Node processes on a 1 GB server)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Code: $REPO ($BRANCH) -> $APP_DIR"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts
if [ ! -d "$APP_DIR/.git" ]; then
  if git ls-remote "https://github.com/$REPO.git" >/dev/null 2>&1; then
    git clone --branch "$BRANCH" "https://github.com/$REPO.git" "$APP_DIR"
  else
    # private repository: a read-only deploy key for this server
    [ -f ~/.ssh/github_repo ] || ssh-keygen -t ed25519 -N "" -C "ec2-read-only" -f ~/.ssh/github_repo >/dev/null
    printf 'Host github.com\n  IdentityFile ~/.ssh/github_repo\n  IdentitiesOnly yes\n' > ~/.ssh/config; chmod 600 ~/.ssh/config
    echo; echo "The repository is private. In GitHub: $REPO -> Settings -> Deploy keys -> Add deploy key"
    echo "(title: ec2, leave 'Allow write access' OFF) and paste this:"; echo; cat ~/.ssh/github_repo.pub; echo
    read -rp "Press Enter once it's added... "
    git clone --branch "$BRANCH" "git@github.com:$REPO.git" "$APP_DIR"
  fi
fi
chmod +x "$APP_DIR/deploy/"*.sh

say "Backend settings"
if [ ! -f "$APP_DIR/Backend/.env" ]; then
  cp "$APP_DIR/deploy/env.production.example" "$APP_DIR/Backend/.env"
  chmod 600 "$APP_DIR/Backend/.env"
  echo "Created $APP_DIR/Backend/.env from the example: fill it in (nano $APP_DIR/Backend/.env) before the first deploy."
else
  echo "$APP_DIR/Backend/.env already exists; left as it is."
fi

say "nginx for $DOMAIN"
sudo tee /etc/nginx/sites-available/wholesale >/dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 10m;

    gzip on;
    gzip_proxied any;
    gzip_min_length 1024;
    gzip_types application/json application/xml text/xml text/plain text/csv application/pdf;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/wholesale /etc/nginx/sites-enabled/wholesale
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

say "HTTPS certificate (Let's Encrypt, renews by itself)"
if sudo certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m "$EMAIL" --non-interactive; then
  echo "HTTPS is on for https://$DOMAIN"
else
  echo "Certificate failed: check that $DOMAIN points at this server's public address and that ports 80 and 443 are open in the security group, then run:"
  echo "  sudo certbot --nginx -d $DOMAIN --redirect --agree-tos -m $EMAIL"
fi

if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  say "DuckDNS updater (every 5 minutes)"
  sub="${DOMAIN%%.duckdns.org}"
  ( crontab -l 2>/dev/null | grep -v duckdns.org/update; echo "*/5 * * * * curl -fsS 'https://www.duckdns.org/update?domains=$sub&token=$DUCKDNS_TOKEN&ip=' >/dev/null" ) | crontab -
fi

say "pm2 starts the app after a reboot"
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null
pm2 install pm2-logrotate >/dev/null 2>&1 || true

say "Key for GitHub Actions (can only run the deploy, nothing else)"
if [ ! -f ~/.ssh/github_actions ]; then
  ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f ~/.ssh/github_actions >/dev/null
  echo "command=\"$APP_DIR/deploy/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat ~/.ssh/github_actions.pub)" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
fi
echo
echo "In GitHub: $REPO -> Settings -> Secrets and variables -> Actions -> New repository secret:"
echo "  EC2_HOST = $DOMAIN"
echo "  EC2_USER = $USER"
echo "  EC2_SSH_KEY = everything between and including the BEGIN/END lines below:"
echo; cat ~/.ssh/github_actions; echo
echo "Done. Next: fill in Backend/.env, copy the database (deploy/README.md step 5), then run: $APP_DIR/deploy/deploy.sh"
