# Server Setup Spec — AWS EC2 Ashera Backend

## Server details

- **IP:** 3.120.15.106
- **User:** ubuntu
- **Key file:** ~/Downloads/ashera-key.pem (or wherever it was saved)
- **OS:** Ubuntu 22.04

---

## Your job

Connect to the server, install everything needed, and deploy the Ashera backend using Docker Compose. Follow each step in order.

---

## Step 1 — Fix key permissions and connect

```bash
chmod 400 ~/Downloads/ashera-key.pem
ssh -i ~/Downloads/ashera-key.pem ubuntu@3.120.15.106
```

If the key file is not at `~/Downloads/ashera-key.pem`, find it first with:
```bash
find ~ -name "ashera-key.pem" 2>/dev/null
```

Once connected, you will see a prompt like `ubuntu@ip-...:~$`. All following commands run on the remote server.

---

## Step 2 — Update system

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Step 3 — Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
newgrp docker
```

Verify:
```bash
docker --version
```

---

## Step 4 — Install Docker Compose

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

Verify:
```bash
docker-compose --version
```

---

## Step 5 — Install Git

```bash
sudo apt install git -y
```

---

## Step 6 — Clone the Ashera repository

```bash
cd ~
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git ashera
cd ashera
```

**Important:** Replace `YOUR_GITHUB_USERNAME` and `YOUR_REPO_NAME` with the actual GitHub repo where the Ashera backend lives (the folder containing `docker-compose.yml`, `vexa/` directory etc.).

If the repo is private, you will need to authenticate. Use a GitHub Personal Access Token:
```bash
git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/YOUR_REPO_NAME.git ashera
```

---

## Step 7 — Create the .env file on the server

```bash
cd ~/ashera
nano .env
```

Paste in the following — fill in the real values:

```env
# Slack
SLACK_CLIENT_ID=10363620637376.10328967232499
SLACK_CLIENT_SECRET=ff7d9cee276eb20539587894e1d1d1f3
SLACK_SIGNING_SECRET=e095637aab9646b15fd452da9bedf496
SLACK_BOT_TOKEN=your_slack_bot_token_here
SLACK_REDIRECT_URI=https://3.120.15.106/slack/oauth/callback

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key_here

# Google Calendar
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://3.120.15.106/calendar/oauth/callback

# Credentials encryption
CREDENTIALS_ENCRYPTION_KEY=ashera_encryption_key_32chars_here

# Database
DATABASE_URL=postgresql://vexa:secret@postgres:5433/vexa
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

---

## Step 8 — Open required ports on the server firewall

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 8056
sudo ufw allow 8070
sudo ufw allow 8075
sudo ufw allow 8076
sudo ufw enable
```

Confirm with `y` when asked.

---

## Step 9 — Start all services

```bash
cd ~/ashera
docker-compose up -d --build
```

This will take 5-10 minutes on first run as it builds all images.

Monitor progress:
```bash
docker-compose logs -f
```

Press `Ctrl+C` to stop watching logs (services keep running).

---

## Step 10 — Verify all services are running

```bash
docker-compose ps
```

All services should show `Up`. Then test each one:

```bash
curl http://localhost:8056/health
curl http://localhost:8070/health
curl http://localhost:8075/health
curl http://localhost:8076/health
```

Each should return `{"status":"ok"}` or similar.

---

## Step 11 — Install Cloudflare Tunnel

Cloudflare Tunnel gives the server a permanent public HTTPS URL for free. This is needed for Slack webhooks and OAuth callbacks.

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

Then run the tunnel (this will open a browser link — copy it and open on your local machine to authenticate):

```bash
cloudflared tunnel login
```

After authenticating, create the tunnel:

```bash
cloudflared tunnel create ashera
```

Copy the tunnel ID from the output (looks like: `a1b2c3d4-...`).

Create the config file:

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Paste this (replace `YOUR_TUNNEL_ID` with the actual ID):

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/ubuntu/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.ashera.net
    service: http://localhost:8076
  - service: http_status:404
```

**Note:** `api.ashera.net` must be a domain you own and have pointed to Cloudflare. If you don't have a domain yet, use the free `trycloudflare.com` tunnel instead:

```bash
cloudflared tunnel --url http://localhost:8076
```

This gives a temporary URL like `https://xxxx.trycloudflare.com` — use this for Slack webhook URLs for now.

---

## Step 12 — Update Slack app settings with the new URL

After getting the Cloudflare URL (either permanent or trycloudflare), go to https://api.slack.com/apps and update:

1. **Slash Commands** → `/ashera` → Request URL: `https://YOUR_URL/slack/commands`
2. **OAuth & Permissions** → Redirect URLs: `https://YOUR_URL/slack/oauth/callback`

Also update `.env` on the server:
```bash
nano ~/ashera/.env
# Change SLACK_REDIRECT_URI to the new URL
```

Then restart:
```bash
cd ~/ashera
docker-compose restart slack-bot
```

---

## Step 13 — Set up auto-restart on reboot

```bash
sudo systemctl enable docker
```

Add a crontab entry to start docker-compose on reboot:

```bash
crontab -e
```

Add this line at the bottom:
```
@reboot cd /home/ubuntu/ashera && docker-compose up -d
```

Save and exit.

---

## Definition of Done

1. `docker-compose ps` shows all services as `Up`
2. `curl http://localhost:8076/health` returns ok
3. Cloudflare Tunnel is running and the public URL is accessible from the internet
4. Slack app settings updated with the new URL
5. `/ashera yardım` command in Slack returns the help message

## Important notes

- The server IP `3.120.15.106` is a public IP. Do not share it publicly.
- The `.env` file contains secrets — never commit it to git. Add `.env` to `.gitignore` if not already there.
- If `docker-compose up` fails, run `docker-compose logs <service-name>` to see what went wrong.
