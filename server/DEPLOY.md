# C3 Quiz Backend - Deployment Guide

## Features

```
Mobile / Desktop Browser
        │ HTTPS
        ▼
┌────────────────────────────────────┐
│  Node.js Backend (single container) │
│  ├─ web/            Static site    │  ← Mobile-optimized UI + PWA
│  │                   admin.html    │  ← Admin dashboard
│  ├─ /api/sets       Bank index     │  ← 2KB, first screen
│  ├─ /api/questions  Paged questions│  ← Save traffic
│  ├─ /api/progress   Progress sync  │  ← Per-user isolation
│  ├─ /api/auth/*     Register/login │  ← scrypt + token
│  ├─ /api/admin/*    Admin API      │  ← View colleagues' progress
│  └─ data/           9.8MB question bank │
└────────────────────────────────────┘
```

### Optimization points
- First screen downloads only **2.1KB index**, not the 9.8MB bank
- Fetches only 50 questions per batch
- Question fields abbreviated (`q`/`o`/`a`/`t`), response size down 60%
- In-memory question cache (zero disk I/O on repeat requests)
- 60s index cache TTL
- Atomic writes (write .tmp → rename), won't corrupt on power loss
- Directory traversal protection (uid filtering + path normalize + prefix check)
- Full CORS (frontend/backend can be deployed separately)
- ETag support (304s for static resources)
- Offline fallback (auto-switch to local bank if backend dies)

### Security
- Passwords: **scrypt(N=16384)** + 32-byte random salt, constant-time comparison
- Tokens: 32-byte random hex, only **sha256 hash** stored (DB leak can't recover tokens)
- Sessions: 30-day expiry, hourly cleanup
- Progress isolation: uid forced to authenticated username (no forgery)
- Admin APIs: role check on every request

---

## Deployment A: Render (recommended, free tier)

1. Sign up at https://render.com (GitHub login is fastest)
2. **New → Web Service**
3. Connect your repo (or use Manual Deploy)
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `echo ok`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/api/health`
5. Environment variables:
   - `PORT` = `8787`
   - `HOST` = `0.0.0.0`
   - `ADMIN_USER` = `your_admin_name`
   - `ADMIN_PASS` = `your_strong_password`
6. Deploy → get `https://xxx.onrender.com`

`render.yaml` is included, Render will auto-detect it.

> ⚠️ **Free tier sleeps after 15 min idle** — first request may take ~30s to wake up.
> For always-on, use a paid tier or another platform.

---

## Deployment B: Docker (any cloud host)

```bash
cd server
docker build -t c3-quiz .
docker run -d -p 8787:8787 \
  -v c3-progress:/app/data/_progress \
  -e ADMIN_USER=admin \
  -e ADMIN_PASS='your-strong-password' \
  --name c3-quiz c3-quiz
```

Open `http://<server-ip>:8787`

---

## Deployment C: LAN (local testing, no cloud)

```bash
cd server
node server.js
# Open http://localhost:8787
# Phone on same WiFi → http://<your-ip>:8787
```

Get your IP:
```bash
ipconfig    # find IPv4
```

Or just double-click `启动局域网服务.bat` — it prints the LAN URL for you.

> ⚠️ Windows Firewall may block. Allow Node.js on private networks when prompted.

---

## Deployment D: Cloudflare Workers / Vercel

Workers has no `fs` — the storage layer needs rewriting. Vercel needs serverless adaptation.
**Currently optimized for traditional Node hosts.** Tell me if you need a Workers version.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 8787 | Listen port |
| `HOST` | 0.0.0.0 | Listen address (0.0.0.0 = allow external) |
| `ADMIN_USER` | admin | Admin username (created on first boot) |
| `ADMIN_PASS` | admin123 | Admin password (created on first boot) |
| `NODE_ENV` | - | production |

> 🔐 **Change ADMIN_PASS before first deploy.** The default `admin/admin123` is public knowledge.
> To change later: use the admin panel's "Reset Password" on your own account.

---

## Data Storage

```
data/_db/users.json       User table (usernames, password hashes, roles)
data/_db/sessions.json    Sessions (token hashes → user, expiry)
data/_progress/<user>.json Per-user quiz progress
```

### Swapping in a real database

For multi-instance deployment, replace the file store with shared storage:
- **Redis**: rewrite `saveProgress`/`loadProgress` in `server.js`, and the JSON helpers in `auth.js`
- **Postgres / SQLite**: same
- **Object storage (S3/R2)**: also works

Single-instance (Render free tier) is fine with files.

---

## Operations

### Health check
```bash
curl https://your-domain.com/api/health
# {"ok":true,"ts":...,"banks":18}
```

### Create a colleague's account
Two options:
1. **Self-registration** — they open the site, tap "Login / Register", create an account
2. **Admin creates it** — admin panel → User Management → Reset Password

### View colleagues' progress
Open `/admin.html`, log in with the admin account.
**Progress tab** shows every user: questions answered, accuracy, sessions, wrong-answer count, last login.
Click "Details" for per-question-bank breakdown and their wrong-answer list.

### Back up
```bash
tar czf backup-$(date +%Y%m%d).tar.gz data/ sets_c3_2025.json
```

### Clean up
```bash
rm data/_progress/<username>.json   # reset one user's progress
rm data/_db/sessions.json           # force everyone to log in again
```

---

## FAQ

**Q: Phone can't open the site?**
A: Check platform health check passes; make sure port isn't localhost-only

**Q: Question bank fails to load?**
A: Check `data/` has all 19 files

**Q: Progress sync not working?**
A: Browser may block localStorage; check Network tab for `/api/progress` requests

**Q: Add new questions?**
A: Drop JSON into `data/`, add an entry to `sets_c3_2025.json`, restart

**Q: Can colleagues see each other's wrong answers?**
A: No — only admins can view individual user progress. Colleagues only see their own.
