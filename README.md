# ⚡ StreamSnatcher

**Lightning-fast P2P file transfer powered by WebRTC — no uploads, no storage, no limits.**

StreamSnatcher enables direct browser-to-browser file transfers using WebRTC data channels. Files never touch a server — they go straight from sender to receiver, encrypted in transit via DTLS.

> 🌐 **Live:** [streamsnatcher.com](https://streamsnatcher.com)

---

## ✨ Features

- **Zero storage** — Files transfer directly between browsers, never stored on a server
- **No file size limits** — Streaming-to-disk support for files of any size
- **End-to-end encrypted** — WebRTC DTLS encryption by default
- **No account required** — Create a session, share the link or QR code, done
- **Cross-device** — Works on desktop and mobile browsers
- **PWA support** — Installable as a progressive web app
- **Real-time progress** — Live transfer speed, progress bar, and ETA

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.10+, FastAPI, Uvicorn |
| **Frontend** | Vanilla HTML/CSS/JS |
| **Signaling** | WebSocket (FastAPI) |
| **File Transfer** | WebRTC Data Channels |
| **NAT Traversal** | STUN + TURN (coturn) |
| **Rate Limiting** | slowapi |
| **QR Codes** | qrcode (server-side) |
| **Templating** | Jinja2 |

---

## 📁 Project Structure

```
streamsnatcher-windows/
├── app/
│   ├── main.py              # FastAPI server (routes, WebSocket signaling, API)
│   ├── static/
│   │   ├── js/app.js        # WebRTC logic, file transfer, UI
│   │   ├── css/             # style.css, marketing.css, cookie-consent.css
│   │   ├── images/          # Logo, favicon, assets
│   │   ├── ads.txt          # AdSense verification (placeholder)
│   │   ├── manifest.json    # PWA manifest
│   │   └── service-worker.js
│   └── templates/           # Jinja2 HTML templates
│       ├── base.html        # Layout with SEO, Schema.org, cookie consent
│       ├── index.html       # Main app + file transfer UI
│       ├── about.html
│       ├── how-it-works.html
│       ├── faq.html
│       ├── contact.html
│       ├── blog.html        # Blog index
│       ├── blog-*.html      # Blog posts
│       ├── use-cases.html
│       ├── privacy-policy.html
│       ├── terms-of-service.html
│       └── disclaimer.html
├── .env.production          # Production config (DO NOT commit secrets)
├── .env.development         # Local dev config
├── .gitignore
├── requirements.txt
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- pip

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/streamsnatcher.git
cd streamsnatcher

# Create virtual environment
python -m venv venv
venv\Scripts\activate    # Windows
# source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt
```

### Local Development

1. **Create `.env.development`:**
   ```
   ENVIRONMENT=development
   BASE_URL=http://<YOUR_LAN_IP>:8000
   HOST=127.0.0.1
   PORT=8000
   WORKERS=1
   ```

   > Use your LAN IP (e.g., `192.168.1.x`) instead of `localhost` if testing with a mobile device on the same network.

2. **Run the server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

3. **Open:** [http://localhost:8000](http://localhost:8000)

---

## 🔧 Production Deployment

### Environment Variables

Create `.env.production` with:

```
ENVIRONMENT=production
BASE_URL=https://yourdomain.com
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
SECRET_KEY=<generate with: python -c "import secrets; print(secrets.token_hex(32))">
HOST=127.0.0.1
PORT=8000
WORKERS=4
TURN_SERVER=yourdomain.com
TURN_SECRET=<must match static-auth-secret in turnserver.conf>
```

> ⚠️ **Never commit `.env.production` to version control.** It's in `.gitignore`.

### Run in Production

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
```

Use a reverse proxy (Nginx/Caddy) in front for HTTPS termination.

### TURN Server (coturn)

A TURN server is required for users behind restrictive NATs/firewalls. StreamSnatcher uses [coturn](https://github.com/coturn/coturn) with ephemeral credentials (`use-auth-secret`).

```bash
# Install on Ubuntu/Debian
sudo apt install coturn

# Enable service
sudo systemctl enable coturn

# Edit config
sudo nano /etc/turnserver.conf
```

Set `static-auth-secret` in `turnserver.conf` to match `TURN_SECRET` in `.env.production`.

---

## 🔒 Security

- **XSS protection** — All user-controlled content (file names) sanitized via `escapeHtml()`
- **CSP headers** — Content Security Policy enforced in production
- **Security headers** — X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy, Permissions-Policy
- **Input validation** — Contact form fields validated for length and format
- **Rate limiting** — API endpoints protected via slowapi
- **Session expiry** — Stale sessions auto-cleaned after 1 hour
- **HTTPS enforced** — Automatic HTTP → HTTPS redirect in production
- **WebRTC encryption** — DTLS encrypted data channels (built into WebRTC)
- **TURN auth** — Ephemeral credentials via HMAC (no static passwords)

---

## 📄 Pages & SEO

| Route | Page |
|---|---|
| `/` | Home — main file transfer app |
| `/about` | About page |
| `/how-it-works` | Technical explainer |
| `/use-cases` | Use case showcase |
| `/faq` | Frequently asked questions |
| `/contact` | Contact form |
| `/blog` | Blog index |
| `/blog/webrtc-file-transfer-guide` | Blog: WebRTC guide |
| `/blog/privacy-first-file-sharing` | Blog: Privacy & P2P |
| `/blog/p2p-vs-cloud-storage` | Blog: P2P vs Cloud |
| `/privacy-policy` | Privacy policy |
| `/terms-of-service` | Terms of service |
| `/disclaimer` | Disclaimer |
| `/robots.txt` | Search engine directives |
| `/sitemap.xml` | XML sitemap |
| `/ads.txt` | AdSense verification |

---

## 📡 API Endpoints

| Method | Endpoint | Description | Rate Limit |
|---|---|---|---|
| `POST` | `/api/create-session` | Create a new transfer session | 5/min |
| `POST` | `/api/generate-qr` | Generate QR code for a session URL | 20/min |
| `POST` | `/api/contact` | Submit contact form | 3/min |
| `GET` | `/api/stats` | Server stats (dev only) | — |
| `GET` | `/health` | Health check | — |
| `WS` | `/ws/{session_id}` | WebSocket signaling | — |

---

## 📝 License

All rights reserved © StreamSnatcher
