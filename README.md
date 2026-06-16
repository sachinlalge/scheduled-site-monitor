# Website Monitoring Automation

Production-ready Node.js and TypeScript service that monitors websites twice per day and sends email alerts when a site is down, unreachable, slow, or returning an error status.

## What It Monitors

Default websites:

- `https://edgelearning.co/`
- `https://sircletech.in/`
- `https://finawiz.com/`

Schedule:

- `09:00 AM IST`
- `03:00 PM IST`

The default cron expression is:

```bash
0 9,15 * * *
```

with timezone:

```bash
Asia/Kolkata
```

## Health Rules

A website is marked `DOWN` when any of these happen:

- HTTP status is outside `200-299`
- Request takes longer than `15` seconds
- DNS resolution fails
- SSL certificate validation fails
- Connection is refused or unreachable

The monitor uses HTTP `GET` requests.

## Retry And Alert Behavior

- Each website gets one initial check plus `3` retries.
- Retries wait `30` seconds between attempts.
- A DOWN email is sent only after all retries fail.
- Duplicate DOWN alerts are suppressed for the same outage.
- A recovery email is sent when the site becomes healthy again.
- Outage state is persisted in `state/outages.json`, so duplicate suppression survives process restarts.

## Logs And Reports

Check logs are written to:

```bash
logs/checks.jsonl
```

Summary reports are written to:

```bash
logs/summaries.jsonl
```

Each check log includes:

- Website URL
- Timestamp
- Response status
- Response time in milliseconds
- Health status, `UP` or `DOWN`
- Attempt count
- Error message, when applicable

## Project Structure

```text
src/
  monitor.ts
  scheduler.ts
  notifier.ts
  logger.ts
  config.ts
.env.example
Dockerfile
README.md
package.json
tsconfig.json
```

## Environment Variables

Copy the example file:

```bash
cp .env.example .env
```

Then update `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBSITES` | Provided website list | Comma-separated URLs to monitor |
| `SCHEDULE_CRON` | `0 9,15 * * *` | Daily schedule at 09:00 and 15:00 |
| `SCHEDULE_TIMEZONE` | `Asia/Kolkata` | Scheduler timezone |
| `REQUEST_TIMEOUT_MS` | `15000` | HTTP request timeout |
| `RETRY_COUNT` | `3` | Retries after the first failed attempt |
| `RETRY_INTERVAL_MS` | `30000` | Delay between retries |
| `RUN_ON_START` | `false` | Run one check immediately when the scheduler starts |
| `LOG_FILE` | `logs/checks.jsonl` | Per-site check log file |
| `SUMMARY_FILE` | `logs/summaries.jsonl` | Per-run summary report file |
| `STATE_FILE` | `state/outages.json` | Persistent outage state file |
| `ALERTS_ENABLED` | `true` | Enable or disable email notifications |
| `SMTP_HOST` | Required when alerts are enabled | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS immediately, usually true for port 465 |
| `SMTP_USER` | Required when alerts are enabled | SMTP username |
| `SMTP_PASS` | Required when alerts are enabled | SMTP password or app password |
| `EMAIL_FROM` | Required when alerts are enabled | Sender address |
| `EMAIL_TO` | Required when alerts are enabled | Comma-separated recipients |

For Gmail, use an app password and settings similar to:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM="Website Monitor <your-account@gmail.com>"
EMAIL_TO=your-alerts@example.com
```

## Local Execution

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

For a local dry run without email:

```env
ALERTS_ENABLED=false
RUN_ON_START=true
```

Run the scheduler in development mode:

```bash
npm run dev
```

Run one check immediately:

```bash
npm run check:once
```

Build and run production JavaScript:

```bash
npm run build
npm start
```

## Free Deployment With GitHub Actions

For this monitor, the easiest free deployment is GitHub Actions. It does not keep a server running all day. Instead, GitHub starts a temporary runner at the scheduled times, runs the monitor, uploads the logs as artifacts, and commits `state/outages.json` so duplicate outage alerts and recovery alerts still work across runs.

This project includes:

```text
.github/workflows/website-monitor.yml
```

It runs at:

- `03:30 UTC`, which is `09:00 IST`
- `09:30 UTC`, which is `15:00 IST`

It also uses `workflow_dispatch`, so you can run it manually from the GitHub Actions tab.

### 1. Push The Project To GitHub

Create a GitHub repository and push this folder:

```bash
git init
git add .
git commit -m "Add website monitor"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Add GitHub Secrets

Open your repository in GitHub, then go to:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Add these secrets:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
EMAIL_FROM
EMAIL_TO
```

Example values for Gmail:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=Website Monitor <your-account@gmail.com>
EMAIL_TO=your-alerts@example.com
```

Use an app password for Gmail or any provider that requires one.

### 3. Enable Write Permission

The workflow commits `state/outages.json` after each run. This is needed to prevent duplicate alerts for the same outage.

In GitHub, go to:

```text
Settings -> Actions -> General -> Workflow permissions
```

Select:

```text
Read and write permissions
```

Then save.

### 4. Run It Manually Once

Go to:

```text
Actions -> Website Monitor -> Run workflow
```

If any website is down, the workflow will fail after sending the alert. That failure is intentional because it makes the problem visible in GitHub Actions.

### 5. View Logs

Each run uploads the generated `logs/` folder as a workflow artifact named like:

```text
website-monitor-logs-123456789
```

Open the workflow run and download the artifact to see:

- `checks.jsonl`
- `summaries.jsonl`

### GitHub Actions Notes

- Use a public repository for the simplest free setup.
- Scheduled workflows run from the default branch.
- GitHub scheduled workflows can sometimes be delayed. The included cron uses minute `30` instead of minute `0` to avoid the busiest top-of-hour window.
- Do not store SMTP passwords in `.env` in GitHub. Use repository secrets.

## PM2 Deployment

Install PM2:

```bash
npm install -g pm2
```

Install dependencies and build:

```bash
npm install
npm run build
```

Start the service:

```bash
pm2 start dist/scheduler.js --name website-monitor
pm2 save
```

Enable PM2 startup on reboot:

```bash
pm2 startup
```

Run the command PM2 prints, then save again:

```bash
pm2 save
```

Useful commands:

```bash
pm2 status
pm2 logs website-monitor
pm2 restart website-monitor
pm2 stop website-monitor
```

## Linux VPS Deployment

Install Node.js 20 or later:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Upload or clone the project onto the server, then:

```bash
cd website-monitoring-automation
cp .env.example .env
nano .env
npm install
npm run build
```

Run with PM2:

```bash
sudo npm install -g pm2
pm2 start dist/scheduler.js --name website-monitor
pm2 save
pm2 startup
```

Make sure the server can reach:

- The monitored websites over HTTPS
- Your SMTP server and port

Check logs:

```bash
tail -f logs/checks.jsonl
tail -f logs/summaries.jsonl
pm2 logs website-monitor
```

## Docker Deployment

Build the image:

```bash
docker build -t website-monitor .
```

Create `.env` from `.env.example`, then run:

```bash
docker run -d \
  --name website-monitor \
  --env-file .env \
  -v "$(pwd)/logs:/app/logs" \
  -v "$(pwd)/state:/app/state" \
  --restart unless-stopped \
  website-monitor
```

View logs:

```bash
docker logs -f website-monitor
```

Stop the container:

```bash
docker stop website-monitor
docker rm website-monitor
```

## Operational Notes

- Keep `state/outages.json` mounted or persisted in production. It prevents duplicate DOWN alerts and enables recovery alerts.
- Keep `logs/` mounted or backed up if monitoring history matters.
- Use `RUN_ON_START=true` only when you want the service to check immediately on startup.
- The scheduler stays on IST even if the server runs in another timezone.
- If email alerts are enabled and SMTP variables are missing, the service fails fast on startup.
