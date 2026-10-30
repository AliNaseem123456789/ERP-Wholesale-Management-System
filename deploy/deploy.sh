#!/usr/bin/env bash
# Deploys the latest main to this server. Run by GitHub Actions on every push to main (through the
# key that can only run this script), or by hand: ~/app/deploy/deploy.sh
#
#   1. pulls the latest code (the server keeps no changes of its own; Backend/.env is not in git and stays)
#   2. installs packages (only when package-lock.json changed) and generates the Prisma client
#   3. applies new database updates (npm run db:migrate: additive SQL files, each once)
#   4. reloads the API with pm2, one instance at a time, so requests keep being served
#   5. checks /api/health; if the new version doesn't answer, it says so and prints the last log lines
set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${BRANCH:-main}"
PORT="$(grep -E '^PORT=' "$APP_DIR/Backend/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' || true)"
PORT="${PORT:-5000}"

# one deploy at a time (two quick pushes queue up instead of colliding)
exec 9>"/tmp/wholesale-deploy.lock"
flock 9

cd "$APP_DIR"
[ -f Backend/.env ] || { echo "Backend/.env is missing: create it from deploy/env.production.example first."; exit 1; }

before="$(git rev-parse HEAD)"
git fetch --quiet --prune origin "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
after="$(git rev-parse HEAD)"
echo "Deploying $(git log -1 --format='%h %s' "$after")"

cd Backend
if [ "$before" = "$after" ] && [ -d node_modules ]; then
  echo "Same commit as before; reloading only."
elif [ ! -d node_modules ] || ! git diff --quiet "$before" "$after" -- package-lock.json package.json prisma/schema.prisma; then
  echo "Installing packages..."
  npm ci --omit=dev --no-audit --no-fund
else
  echo "Packages unchanged."
fi

echo "Database updates..."
npm run --silent db:migrate

echo "Reloading the API..."
pm2 startOrReload "$APP_DIR/deploy/ecosystem.config.js" --update-env
pm2 save >/dev/null

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Live: $(git log -1 --format='%h %s')"
    exit 0
  fi
  sleep 1
done
echo "The API didn't answer on port $PORT within 30 s. Last log lines:"
pm2 logs wholesale-api --lines 40 --nostream || true
exit 1
