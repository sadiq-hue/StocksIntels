# StocksIntels — Hetzner Migration & Deploy Runbook

Migrate from Railway (per-second metered billing, ~$54/mo) to a single Hetzner
CX22 VPS (flat ~$5-7/mo) running the same Docker image, self-hosted Postgres and
Nginx with free Let's Encrypt TLS.

**Time: ~1 hour.** No app code changes — only deployment files in `deploy/`.

---

## 1. Create the Hetzner VPS

1. Sign up / log in at https://console.hetzner.cloud
2. Create a project, then **Create Server**:
   - Location: **Helsinki (FSN1)** or Ashburn (ASH) — both fine for NSE data.
   - Image: **Ubuntu 24.04** (or Debian 12), SSH key added.
   - Type: **CX22** (2 vCPU / 4 GB / 40 GB NVMe) — more than enough for this
     stack (DB is ~400 MB, app is one Node container).
   - Volume: none needed; CX22's 40 GB disk is plenty.
   - Enable **Backups** in the server settings (Hetzner snapshots ~€1.5/mo).
3. Note the server's **IP** and its **root/SSH access**.

That's the whole infra. Nothing to scale, metrics to size, or regions to think about.

---

## 2. One-time server setup (SSH)

```bash
ssh root@<VPS_IP>
```

```bash
# System deps: docker, compose plugin, git
apt-get update && apt-get install -y ca-certificates curl gnupg git \
  | { echo "ok"; }
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow a non-root deploy user to run docker
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /root/app /root/backups
```

Add your SSH key to `deploy`:
```bash
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh
```

---

## 3. Clone + first boot

```bash
su - deploy
cd /root/app
git clone https://github.com/sadiq-hue/StocksIntels.git .  \
  # or this repo's URL
cd /root/app
```

Create `/root/app/.env` from `deploy/.env.example`:
```bash
cp deploy/.env.example .env
nano .env    # set POSTGRES_PASSWORD + JWT_SECRET + API keys (mirror Railway values)
```

> The compose file reads `.env` from `/root/app/.env` automatically.

---

## 4. One-time TLS issuance (certbot)

The Nginx container listens on 80/443, but certbot issues certs BEFORE nginx sees
them. First boot nginx without the SSL server block, issue, then reload:

```bash
docker compose -f deploy/docker-compose.yml up -d db backend reverse_proxy
```

Wait for backend healthy (`docker compose -f deploy/docker-compose.yml ps`), then:

```bash
docker compose -f deploy/docker-compose.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d admin.stocksintels.com \
  --email you@example.com --agree-tos --no-eff-email
```

This cert lands in the `letsencrypt` volume. The `certbot` service in the compose
file keeps it renewed automatically (renews every 12h).

> First-boot gotcha: if nginx loads a config referencing a cert that doesn't exit
> yet it fails to start — that's why the SSL block activation happens after
> issuance. If you already issued, it just works from boot.

---

## 5. Migrate data from Railway

On your local machine (with Railway CLI + psql):
```bash
railway link
railway variables            # copy DATABASE_URL
# Export:
/path/to/repo/deploy/export-from-railway.sh
# produces stockintel-railway-export.sql
```

Ship it to the VPS and restore (after `docker compose up -d --build` brought up `db`):
```bash
docker cp "$PWD/stockintel-railway-export.sql" stack_db_1:/tmp/db.sql
docker exec -i stack_db_1 psql -U stockintel -d stockintel -f /tmp/db.sql
```

---

## 6. Switch DNS

- Railway custom domain → **remove** `admin.stocksintels.com` CNAME from Railway.
- Add a DNS A record: `admin.stocksintels.com → <VPS_IP>`.
- Wait for propagation (TLS will still work because certbot can re-issue).

---

## 7. GitHub Actions auto-deploy (replaces Railway push-to-deploy)

Add repo secrets in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `HETZNER_HOST` | VPS IP |
| `HETZNER_USER` | `deploy` |
| `HETZNER_SSH_KEY` | private key that logs into `deploy@<IP>` |
| `HETZNER_ENV_FILE` | full contents of `/root/app/.env` (so the workflow can refresh it) |

Then every push to `main` rebuilds and redeploys the stack via
`.github/workflows/deploy-hetzner.yml`.

---

## 8. Nightly backups

Install the cron for the DB backup script (as root):
```bash
chmod +x /root/app/deploy/backup.sh
echo "30 2 * * * /root/app/deploy/backup.sh >> /var/log/stockintel-backup.log 2>&1" | crontab -  # root crontab
```

Optionally add Hetzner **Server Backups** in the console for full-disk snapshots
(~€1.5/mo) — belt and suspenders.

---

## 9. Smoke test

```bash
curl -sS https://admin.stocksintels.com/api/health        # expect {"status":"ok"...}
curl -sS https://admin.stocksintels.com                   # expect the admin/SPA
docker compose -f deploy/docker-compose.yml ps            # all services Up
```

---

## 10. Decommission Railway

- Delete the two Railway services (`stockintel-backend`, `stockintel-db` + volume).
- Keep the Railway Postgres for 1-2 weeks until you're confident the restored data
  matches, then delete.

---

## Costs

| Item | Monthly |
|---|---|
| Hetzner CX22 | ~$5 (€4.50) |
| Hetzner Backups (optional but recommended) | ~$1.50 |
| Let's Encrypt TLS | $0 |
| Postgres | included on the box |
| **Total** | **~$6.50/mo** (vs $54 Railway) |

## Troubleshooting

- **Nginx won't start (cert missing)**: you ran `up -d` before issuing the cert.
  See step 4 — issue cert then `docker compose restart reverse_proxy`.
- **App can't connect to DB**: check `DATABASE_URL` uses host `db`, not `localhost`,
  and that `db` service is healthy (`docker compose ps`).
- **Uploads missing**: the `uploads` volume persists them; recreated on first boot.
- **Socket.IO / realtime not working**: websocket proxies in `nginx.conf` handle it;
  confirm port 443 not firewalled.