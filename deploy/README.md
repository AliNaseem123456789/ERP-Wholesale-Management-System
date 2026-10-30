# Deploying the backend to AWS (EC2 + RDS, Mumbai)

```
Browser ──► Vercel (frontend) ──/api rewrite──► https://erp-wholesale.duckdns.org
                                                   nginx (HTTPS, gzip)  on EC2
                                                   └► pm2: 2 × Node (cluster)  ──► RDS Postgres 17 (same region, private)
GitHub: push to main ──► Actions ──ssh──► deploy/deploy.sh on EC2 (pull, install if needed, db:migrate, reload, health check)
```

There are no tests or build steps: every push to `main` that touches `Backend/` or `deploy/` is live about a minute later.
Pushes to `experiments` (or any other branch) never deploy. Photos stay in Supabase Storage; only the database moves.

Everything below is done once. Region for everything: **Asia Pacific (Mumbai) ap-south-1**.

---

## 1. Security groups (EC2 → Security Groups → Create)

| Name | Inbound rules |
|---|---|
| `wholesale-web` | SSH 22 from **My IP** · HTTP 80 from Anywhere · HTTPS 443 from Anywhere |
| `wholesale-db` | PostgreSQL 5432 from **source: the `wholesale-web` security group** (not an IP) |

Port 22 must also allow GitHub Actions to connect. Their addresses change all the time, so the simplest option is
SSH 22 from Anywhere (0.0.0.0/0). That's acceptable here: password login is off on Ubuntu, and the
GitHub key can only run the deploy script.

## 2. Server (EC2 → Launch instance)

- Image: **Ubuntu Server 24.04 LTS** (x86_64)
- Type: **t3.small** (2 GB) is recommended. A t3.micro (1 GB, free tier) works too, because the setup adds 2 GB of swap.
- Key pair: create one and download the `.pem` file. You need it to SSH in.
- Network: default VPC; security group **wholesale-web**; storage 20 GB gp3.
- After it starts: **Elastic IPs → Allocate → Associate** it with the instance, so the address never changes.
  Point DuckDNS (`erp-wholesale`) at this Elastic IP.

## 3. Database (RDS → Create database)

- Standard create · **PostgreSQL 17** · template **Free tier**
- DB instance identifier `wholesale-db`, master username `postgres`, choose a password. Use letters and digits only;
  symbols such as `@ : / ?` break the connection string.
- Instance **db.t4g.micro**, storage 20 GB gp3 (turn off storage autoscaling if you want a fixed bill)
- Connectivity: same VPC as the EC2, **Public access: No**, security group **wholesale-db**
  (remove `default`)
- Additional configuration → **Initial database name: `wholesale`**, backups 7 days
- When it's Available, copy the **Endpoint** (`wholesale-db.xxxx.ap-south-1.rds.amazonaws.com`).

## 4. Set up the server

```bash
ssh -i wholesale.pem ubuntu@erp-wholesale.duckdns.org
curl -fsSL https://raw.githubusercontent.com/AliNaseem123456789/ERP-Wholesale-Management-System/main/deploy/setup-ec2.sh -o setup-ec2.sh
DOMAIN=erp-wholesale.duckdns.org EMAIL=you@gmail.com bash setup-ec2.sh
```

(If the repository is private, the raw URL won't download. Copy the file over instead:
`scp -i wholesale.pem deploy/setup-ec2.sh ubuntu@erp-wholesale.duckdns.org:`.) The script then shows a
read-only deploy key to add in GitHub and waits for you.)

It installs Node 22, pm2, nginx with a free Let's Encrypt certificate (renews by itself), and the Postgres 17
tools. It also clones the code into `~/app` and prints the three GitHub secrets for step 8. Running it again is safe.

## 5. Fill in the settings

```bash
nano ~/app/Backend/.env
```

Start from your current local `Backend/.env` and change only these:

- `DATABASE_URL`: the RDS endpoint and password, keeping
  `?sslmode=require&sslaccept=accept_invalid_certs&connection_limit=10`
- `NODE_ENV=production`, `PORT=5000`, `TRUST_PROXY=2`

Keep **the same `JWT_SECRET` / refresh secret** so nobody is logged out. Keep the same Supabase keys too, or the photos
stop uploading. Set `APP_URL` to the Vercel site and keep the SMTP settings.

## 6. Copy the database from Supabase to RDS

Do this while nobody is using the site, because anything written during the copy is lost. The simplest way is to do it right
before step 9.

```bash
cd ~/app/Backend && npm ci --omit=dev
COPY_FROM_DATABASE_URL='<your current Supabase DATABASE_URL, the direct/session one on port 5432>' \
COPY_TO_DATABASE_URL="$(grep ^DATABASE_URL= .env | cut -d= -f2-)" \
node scripts/db-copy.js
```

It only reads from Supabase. It refuses to write into a database that already has tables. When it finishes, it counts every table on both
sides and says `3/3 exact: … match`. If you see a difference, create a fresh database and copy again
(`psql "<rds url>" -c "CREATE DATABASE wholesale2"`, then point `.env` at it). Supabase stays as it is, so it is
your backup and your way back.

## 7. First start

```bash
~/app/deploy/deploy.sh
curl https://erp-wholesale.duckdns.org/api/health      # {"status":"ok"}
```

## 8. Turn on deploy-on-push

In GitHub, open **repo → Settings → Secrets and variables → Actions → New repository secret** and add the three that
`setup-ec2.sh` printed:

- `EC2_HOST`: `erp-wholesale.duckdns.org`
- `EC2_USER`: `ubuntu`
- `EC2_SSH_KEY`: the whole private key, including the BEGIN/END lines

Test it from **Actions → Deploy backend → Run workflow**. From now on, every push to `main` deploys by itself. Until the
secrets exist, the workflow passes without doing anything.

## 9. Point the frontend at the new backend (the cutover)

In `Frontend/vercel.json`, replace every `https://erp-wholesale-management-system.onrender.com` with
`https://erp-wholesale.duckdns.org`. Commit and push to `main`, and Vercel redeploys. Do this **after** step 7 works;
before then, the site would break. Once it's live, you can stop the Render service.

---

## Day to day

| | |
|---|---|
| Deploy | `git push` to `main` (or Actions → Run workflow, or `~/app/deploy/deploy.sh` on the server) |
| Logs | `pm2 logs wholesale-api` (each request with its time) · `pm2 monit` |
| Status / restart | `pm2 ls` · `pm2 reload wholesale-api` |
| More / fewer Node processes | `API_INSTANCES=1 pm2 reload ~/app/deploy/ecosystem.config.js --update-env && pm2 save` |
| Change a setting | edit `~/app/Backend/.env`, then `pm2 reload wholesale-api --update-env` |
| Database changes | add an SQL file the usual way (`npm run db:migrate` runs on every deploy, each file once) |
| Roll back | `git revert <commit>` and push, the same as any change |
| DB backup | RDS takes a daily snapshot (7 days). Manual: RDS → Actions → Take snapshot |

**What deploy.sh does:** it pulls `main` and runs `npm ci` only when `package-lock.json` / `package.json` / `schema.prisma`
changed. Then it runs `db:migrate`, reloads the processes one at a time (no dropped requests), and waits for `/api/health`.
If the new version doesn't answer within 30 s, the GitHub run turns red and shows the last log lines.

**Cost:** about $0 in the first 12 months on the free tier (t3.micro + db.t4g.micro + 20 GB). After that, roughly t3.small
$15 + db.t4g.micro $12 + Elastic IP $3.6 per month.
