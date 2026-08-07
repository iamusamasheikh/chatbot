# AI ChatBot — Tidio-style multi-client SaaS

A self-hosted, Tidio-like platform: **sign up → create websites → train each chatbot on its
own website content → embed a widget → answer live with human handoff → capture leads →
track analytics**. One server serves unlimited client websites. AI costs $0 (OpenRouter
free models, with a local knowledge-base fallback).

## How it works

```
client website  ──<script>──▶  widget.js (chat bubble, sends siteId)
                                   │  HTTP + WebSocket
                                   ▼
                          your server (Node.js + SQLite)
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
             OpenRouter AI    per-site knowledge   live chat hub
             (free models)    (local TF-IDF)       (authenticated agents)
                                   ▼
                         data/sites.db (SQLite)
```

- **Multi-tenant**: every website has its own `siteId`. Data is isolated per site.
- **Auth**: users sign up / log in (hashed passwords, JWT httpOnly cookie). Each user only
  sees their own sites.
- **SQLite**: Node's built-in `node:sqlite` — zero native dependencies, no install.
  (Schema is plain SQL; migrating to PostgreSQL later is straightforward.)

## Quick start

```bash
npm install
$env:OPENROUTER_API_KEY = "sk-or-..."     # free key from https://openrouter.ai/keys
$env:PUBLIC_URL = "http://localhost:3000" # your server's public URL
npm start
```

Then open http://localhost:3000/login and **create your account**.

To get the platform **super-admin** (view all users/sites):
```bash
node scripts/make-admin.js your@email.com
```

## Client flow (Tidio-like)

1. Client signs up at `/login` → lands on `/dashboard`.
2. **+ New site** (name + website URL) → appears in the sidebar.
3. **Train** tab → enter the website URL → bot indexes its pages/chunks.
4. **Embed** tab → copy the widget snippet into the client's website (`</body>` before).
5. **Live chat** tab → go online as agent → answer visitors in real time.
6. **Conversations / Leads** tabs → see chats and captured leads.

### Widget embed (on any site — WordPress or custom)

```html
<script>
  window.AIChatConfig = {
    url: "https://your-server.com",   // your server
    siteId: "my-shop",                // the site created in the dashboard
    title: "Support",
    greeting: "Hi! How can I help?"
  };
</script>
<script src="https://your-server.com/widget.js" defer></script>
```

WordPress: paste both blocks via a header/footer plugin or in `footer.php`.

## Configuration (env vars)

| Env | Default | Description |
|---|---|---|
| `PORT` | 3000 | Server port |
| `PUBLIC_URL` | http://localhost:3000 | Public URL (widget + redirects use it) |
| `OPENROUTER_API_KEY` | — | Free OpenRouter key (needed for cloud AI) |
| `LLM_BASE_URL` | https://openrouter.ai/api/v1 | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | poolside/laguna-s-2.1:free | Free model (see config.js for options) |
| `JWT_SECRET` | auto (data/secret.txt) | Signing secret for login tokens |
| `TRAIN_MAX_PAGES` | 30 | Max pages crawled per training run |

Free `:free` models change over time. If a model 404s, update `LLM_MODEL` to a current free
one from https://openrouter.ai/models?q=free (or use `openrouter/free`).

## Production deployment (VPS, e.g. EC2)

Node app needs WebSockets + HTTPS. Standard stack: **PM2** (keep it running) + **Nginx**
(reverse proxy with upgrade headers) + **certbot** (free SSL).

```nginx
server {
  listen 80;
  server_name divafits.com;
  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## API overview

Public (no auth, used by widget):
- `POST /api/chat` — `{ siteId, sessionId, message }` → `{ reply, mode }`
- `POST /api/escalate` — request a human
- `POST /api/lead` — capture lead

Auth (cookie):
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/token` (for agent WebSocket)
- `GET/POST /api/my/sites`, `GET /api/my/sites/:siteId/summary|chats|leads`, `POST /api/train`
- Super-admin: `GET /api/admin/users`, `GET /api/admin/sites`
