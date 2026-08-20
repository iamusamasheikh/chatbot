'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const config = require('./config');
const store = require('./src/store');
const indexer = require('./src/indexer');
const llm = require('./src/llm');
const hub = require('./src/livechat');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

const COOKIE = 'aichat_token';
const JWT_SECRET = getSecret();

function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(config.paths.data, 'secret.txt');
  fs.mkdirSync(config.paths.data, { recursive: true });
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s);
  return s;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}
function verifyToken(token) {
  try {
    const d = jwt.verify(token, JWT_SECRET);
    return store.getUserById(d.sub);
  } catch { return null; }
}

function reqSiteId(req) {
  const fromBody = req.body && req.body.siteId;
  const fromHeader = req.headers['x-site-id'];
  const fromQuery = req.query && req.query.siteId;
  return store.sanitizeSiteId(fromBody || fromHeader || fromQuery || 'default');
}

/* ---------- auth middleware ---------- */
function requireAuth(req, res, next) {
  const user = req.user || verifyToken(req.cookies[COOKIE] || '');
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin only' });
}
function requireSiteOwner(req, res, next) {
  const siteId = req.params && req.params.siteId
    ? store.sanitizeSiteId(req.params.siteId)
    : (req.siteId || reqSiteId(req));
  req.siteId = siteId;
  if (req.user.role === 'admin') return next();
  if (store.siteBelongsTo(siteId, req.user.id)) return next();
  return res.status(403).json({ error: 'No access to this site' });
}

/* ---------- CORS (widget runs on client sites) ---------- */
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Site-Id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- public endpoint guards ---------- */
// Reject unknown siteIds (prevents auto site-creation spam / free LLM abuse).
function requireSiteExists(req, res, next) {
  const S = reqSiteId(req);
  if (!store.siteExists(S)) return res.status(404).json({ error: 'Site not found. Register it in your dashboard first.' });
  req.S = S;
  next();
}
// If a site has a registered site_url, only allow requests from that domain.
// Enforced only when STRICT_ORIGIN=true (set it in production!). In local/dev it's
// lenient so you can test the widget from localhost.
function verifyOrigin(req, res, next) {
  if (process.env.STRICT_ORIGIN !== 'true') return next();
  const site = store.getSite(req.S || reqSiteId(req));
  if (!site || !site.site_url) return next();
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return next(); // non-browser client (curl) — still rate-limited below
  try {
    const host = new URL(origin).hostname;
    const allowed = new URL(site.site_url).hostname;
    if (host === allowed || host.endsWith('.' + allowed)) return next();
    return res.status(403).json({ error: 'Origin not allowed for this site' });
  } catch { return next(); }
}
// Simple in-memory rate limit per IP+site (per minute).
const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'x';
  const key = `${ip}:${reqSiteId(req)}`;
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + 60000 }; rateBuckets.set(key, b); }
  b.count++;
  if (b.count > 150) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  next();
}

/* ---------- async training jobs ---------- */
const jobs = new Map(); // siteId -> { running, done, total, page, error, startedAt }
function startTrain(S, url) {
  jobs.set(S, { running: true, done: 0, total: 0, page: 0, error: null, startedAt: new Date().toISOString() });
  const job = jobs.get(S);
  (async () => {
    try {
      const scraper = require('./src/scraper');
      const crawled = await scraper.crawl(url, (done) => { job.done = done; });
      const pages = [...crawled.values()].filter((p) => !p.error && p.text);
      const built = indexer.buildIndex(pages);
      job.total = pages.length;
      store.saveKnowledge(S, {
        siteName: new URL(url).hostname,
        siteUrl: url,
        trainedAt: new Date().toISOString(),
        pages: pages.length,
        chunks: built
      });
      job.running = false;
    } catch (e) {
      job.running = false;
      job.error = e.message;
    }
  })();
  return job;
}

/* ---------- static pages ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/widget.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'widget.js')));
app.get('/widget.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'widget.css')));

/* ================= AUTH ================= */
app.post(['/api/auth/register', '/api/auth/signup'], (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (store.findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const isOwner = email.toLowerCase() === 'officialusamano1@gmail.com' || store.countUsers() === 0;
  const role = isOwner ? 'admin' : 'user';
  const id = store.createUser(email.toLowerCase(), hash, name || email.split('@')[0], role);
  const user = store.getUserById(id);
  res.cookie(COOKIE, signToken(user), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? store.findUserByEmail(email.toLowerCase()) : null;
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.cookie(COOKIE, signToken(user), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
// JWT for the dashboard's agent WebSocket (cookie is httpOnly, unreadable by JS).
app.get('/api/auth/token', requireAuth, (req, res) => res.json({ token: signToken(req.user) }));

/* ================= PUBLIC: widget ================= */
app.post('/api/chat', requireSiteExists, verifyOrigin, rateLimit, async (req, res) => {
  const S = req.S;
  const { sessionId, message, name } = req.body || {};
  const sid = sessionId || ('s_' + Math.random().toString(36).slice(2, 10));

  store.trackAnalytics(S, 'session');
  store.trackAnalytics(S, 'message');

  const kb = store.getKnowledge(S);
  let context = [];
  if (kb.indexed && kb.chunks && kb.chunkCount > 0) {
    const scored = indexer.search(kb.chunks, message, 4);
    if (scored.length) context = scored.map((c) => ({ title: c.title, text: c.text, score: c.score }));
  }

  const history = store.getRecentMessages(S, sid, 6);
  const { answer, mode } = await llm.ask(S, kb.siteName, message, context, history);
  store.persistMessage(S, sid, message, 'user');
  store.persistMessage(S, sid, answer, 'bot', mode);
  res.json({ reply: answer, mode, sessionId: sid, siteId: S, knowledge: context.length ? 'found' : 'empty' });
});

app.post('/api/escalate', requireSiteExists, verifyOrigin, rateLimit, (req, res) => {
  const S = req.S;
  const sid = req.body.sessionId || ('sess_live_' + Math.random().toString(36).slice(2, 10));
  if (req.body.name) store.setVisitorName(S, sid, req.body.name);
  hub.agentJoined(S, sid);
  store.trackAnalytics(S, 'livechat');
  fireEscalateEmail(S, sid);
  fireWebhook(S, { type: 'talk_to_human', sessionId: sid });
  res.json({ humanOnline: hub.agentsOnline(S) > 0, offlineGreeting: config.bot.offlineGreeting, sessionId: sid, siteId: S });
});

app.post('/api/lead', requireSiteExists, verifyOrigin, rateLimit, (req, res) => {
  const S = req.S;
  const { name, email, phone, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  store.addLead(S, { name, email, phone, message });
  fireWebhook(S, { type: 'lead', name, email, phone, message });
  fireLeadEmail(S, { name, email, phone, message });
  res.json({ ok: true, siteId: S });
});

// Lightweight widget config (public) so the widget can pick up branding/greeting.
app.get('/api/site-config', (req, res) => {
  const site = store.getSite(reqSiteId(req));
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const isWhitelabel = Boolean(site.is_whitelabel);
  const botName = isWhitelabel ? (site.bot_name || config.bot.name || 'Nova AI') : (config.bot.name || 'Nova AI');
  const hideBranding = isWhitelabel ? Boolean(site.hide_branding) : false;
  const customBrandName = isWhitelabel ? (site.custom_brand_name || null) : null;
  const customBrandUrl = isWhitelabel ? (site.custom_brand_url || null) : null;
  res.json({
    siteId: site.id,
    name: site.name || site.id,
    botName,
    greeting: site.greeting || null,
    themeColor: site.theme_color || '#2563eb',
    isWhitelabel,
    hideBranding,
    customBrandName,
    customBrandUrl
  });
});

/* ================= CLIENT DASHBOARD API (auth) ================= */
app.get('/api/my/sites', requireAuth, (req, res) => {
  res.json(store.getSitesByOwner(req.user.id).map(withStats));
});

app.post('/api/my/sites', requireAuth, (req, res) => {
  const { name, siteUrl, greeting, botName } = req.body || {};
  const id = store.sanitizeSiteId((req.body && req.body.id) || (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (!id || id === 'default') return res.status(400).json({ error: 'enter a valid site id/name' });
  store.upsertSite({ id, ownerId: req.user.id, name, siteUrl, greeting, botName: botName || 'Divafits AI Assistant' });
  res.json({ ok: true, siteId: id });
});

app.post('/api/my/sites/:siteId', requireAuth, requireSiteOwner, (req, res) => {
  const site = store.getSite(req.siteId);
  const isWhitelabel = req.user.role === 'admin' || Boolean(site && site.is_whitelabel);
  const { name, siteUrl, greeting, themeColor, webhookUrl, botName, hideBranding, customBrandName, customBrandUrl } = req.body || {};

  const updateData = { name, siteUrl, greeting, themeColor, webhookUrl };
  if (isWhitelabel) {
    if (botName !== undefined) updateData.botName = botName;
    if (hideBranding !== undefined) updateData.hideBranding = hideBranding;
    if (customBrandName !== undefined) updateData.customBrandName = customBrandName;
    if (customBrandUrl !== undefined) updateData.customBrandUrl = customBrandUrl;
  }
  store.updateSiteSettings(req.siteId, updateData);
  res.json({ ok: true, siteId: req.siteId });
});

app.get('/api/my/sites/:siteId/summary', requireAuth, requireSiteOwner, (req, res) => res.json(summary(req.siteId)));
app.get(['/api/my/sites/:siteId/chats', '/api/my/sites/:siteId/conversations'], requireAuth, requireSiteOwner, (req, res) => res.json(store.getChats(req.siteId)));
app.get('/api/my/sites/:siteId/leads', requireAuth, requireSiteOwner, (req, res) => res.json(store.getLeads(req.siteId)));

app.get('/api/my/sites/:siteId/leads/export', requireAuth, requireSiteOwner, (req, res) => {
  const leads = store.getLeads(req.siteId).leads;
  const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  const rows = [['Name', 'Email', 'Phone', 'Message', 'Date'].map(esc).join(',')];
  for (const l of leads) rows.push([esc(l.name), esc(l.email), esc(l.phone), esc(l.message), esc(l.at)].join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.siteId}-leads.csv"`);
  res.send('\uFEFF' + rows.join('\r\n'));
});

app.get('/api/my/sites/:siteId/verify-embed', requireAuth, requireSiteOwner, async (req, res) => {
  const site = store.getSite(req.siteId);
  if (!site || !site.site_url) return res.status(400).json({ active: false, error: 'Set your website URL in Settings first.' });
  try {
    const ans = store.getAnalytics(req.siteId);
    const hasActivity = (ans && (ans.sessions > 0 || ans.messages > 0 || ans.leads > 0));
    const scraper = require('./src/scraper');
    const page = await scraper.fetchPage(site.site_url);
    const html = page ? (page.html || '') : '';
    const hasWidget = html.toLowerCase().includes('widget.js') || html.toLowerCase().includes('aichatconfig') || html.toLowerCase().includes('divafits') || html.toLowerCase().includes('aichat');
    if (hasWidget || hasActivity) {
      res.json({ active: true, message: `Widget verified and active on ${site.site_url}! 🎉` });
    } else {
      res.json({ active: false, message: `Widget snippet not detected on ${site.site_url}. Make sure it is pasted before </body>.` });
    }
  } catch (e) {
    const ans = store.getAnalytics(req.siteId);
    if (ans && (ans.sessions > 0 || ans.messages > 0)) {
      return res.json({ active: true, message: `Widget active on ${site.site_url}! 🎉` });
    }
    res.json({ active: false, message: 'Verification check failed: ' + e.message });
  }
});

app.post('/api/my/sites/:siteId/test-email', requireAuth, requireSiteOwner, (req, res) => {
  const site = store.getSite(req.siteId);
  const user = req.user;
  const to = user.email || 'officialusamano1@gmail.com';
  const siteName = (site && site.name) || req.siteId;

  const subject = `🧪 Test Email from AI Support Chatbot (${siteName})`;
  const text = `This is a test notification from your AI Support Chatbot for website "${siteName}". If you received this, your email notifications are working perfectly!`;
  const html = `
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f5f7; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px;">🧪 Test Email Successful!</h2>
          <p style="margin: 4px 0 0; opacity: 0.9; font-size: 13px;">Website: ${siteName}</p>
        </div>
        <div style="padding: 20px;">
          <p>Great news! Your AI Chatbot notification system is working 100% properly for <b>${siteName}</b>.</p>
          <p>When visitors submit lead details or request Live Support, alerts will be sent to <b>${to}</b>.</p>
        </div>
      </div>
    </body>
  `;

  try {
    sendHtmlEmail(to, subject, html, text, { name: user.name || 'Site Owner', email: to });
    res.json({ ok: true, message: `Test email dispatched to ${to}! Please check your Inbox and Spam folder.` });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send test email: ' + e.message });
  }
});

app.get('/api/my/sites/:siteId/train-status', requireAuth, requireSiteOwner, (req, res) => {
  const j = jobs.get(req.siteId);
  res.json(j ? j : { running: false, done: 0, total: 0, page: 0, error: null });
});

app.post('/api/train', requireAuth, (req, res) => {
  const S = reqSiteId(req);
  if (req.user.role !== 'admin' && !store.siteBelongsTo(S, req.user.id)) {
    return res.status(403).json({ error: 'No access to this site' });
  }
  const url = (req.body && req.body.url) || config.training.startUrl;
  if (!url) return res.status(400).json({ error: 'No training URL. Provide { url }.' });
  if (jobs.get(S) && jobs.get(S).running) return res.status(409).json({ error: 'Training already running for this site' });
  startTrain(S, url);
  res.json({ ok: true, siteId: S, started: true });
});

/* ================= SUPER ADMIN (role=admin) ================= */
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = store.getAllUsers();
  res.json(users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, sites: store.getSitesByOwner(u.id).length, created: u.created_at })));
});
app.get('/api/admin/sites', requireAuth, requireAdmin, (req, res) => {
  res.json(store.getAllSites().map(withStats));
});

app.post('/api/admin/sites/:siteId/whitelabel', requireAuth, requireAdmin, (req, res) => {
  const siteId = store.sanitizeSiteId(req.params.siteId);
  const isWhitelabel = req.body && (req.body.isWhitelabel === true || req.body.isWhitelabel === 1 || req.body.isWhitelabel === '1');
  store.setSiteWhitelabel(siteId, isWhitelabel);
  res.json({ ok: true, siteId, isWhitelabel });
});

/* ---------- helpers ---------- */
function sendHtmlEmail(to, subject, htmlBody, textBody, leadData) {
  // Option A: External PHP Mailer Script (invokes PHP mail() on client's web server!)
  const phpUrl = process.env.PHP_MAILER_URL;
  if (phpUrl) {
    const params = new URLSearchParams();
    params.append('name', (leadData && leadData.name) || 'Website Visitor');
    params.append('email', (leadData && leadData.email) || to);
    params.append('subject', subject);
    params.append('message', textBody || subject);
    params.append('to', to);

    fetch(phpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }).then((r) => r.text()).then((d) => console.log('[php-mailer] Triggered PHP script response:', d))
      .catch((e) => console.warn('[php-mailer] Error calling PHP script:', e.message));
    return;
  }

  // Option B: Resend HTTP Mail API support
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.mail.from || 'AI Support <onboarding@resend.dev>',
        to: [to],
        subject: subject,
        html: htmlBody,
        text: textBody
      })
    }).then((r) => r.json()).then((d) => console.log('[resend] Email sent:', d))
      .catch((e) => console.warn('[resend] Send error:', e.message));
    return;
  }

  // Option C: Nodemailer SMTP or Sendmail
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { console.warn('[mail] nodemailer not installed'); return; }

  let transporter;
  if (config.mail.host) {
    transporter = nodemailer.createTransport({
      host: config.mail.host, port: config.mail.port, secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
    });
  } else {
    // Sendmail (PHP mail() equivalent on Linux VPS)
    transporter = nodemailer.createTransport({
      sendmail: true,
      newline: 'unix',
      path: '/usr/sbin/sendmail'
    });
  }

  transporter.sendMail({
    from: config.mail.from || 'AI ChatBot <noreply@divafits.com>',
    to,
    subject,
    text: textBody,
    html: htmlBody
  }).then(() => console.log('[mail] Email sent to:', to))
    .catch((e) => console.warn('[mail] Send failed:', e.message));
}

function fireLeadEmail(siteId, lead) {
  const site = store.getSite(siteId);
  const siteName = (site && site.name) || siteId;
  const ownerEmail = site && site.owner_id ? (store.getUserById(site.owner_id) || {}).email : '';
  const to = config.mail.to || ownerEmail || 'officialusamano1@gmail.com';
  if (!to) return;

  const subject = `📩 New Lead Inquiry on ${siteName}: ${lead.name}`;
  const text = `New Lead on ${siteName}\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone || 'N/A'}\nMessage: ${lead.message || 'N/A'}`;
  const html = `
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f5f7; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 20px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px;">📩 New Lead Captured</h2>
          <p style="margin: 4px 0 0; opacity: 0.9; font-size: 13px;">Website: ${siteName}</p>
        </div>
        <div style="padding: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background-color: #f9fafb;">
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold; width: 120px;">Name:</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${lead.name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Email:</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;"><a href="mailto:${lead.email}">${lead.email}</a></td>
            </tr>
            <tr style="background-color: #f9fafb;">
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Phone:</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${lead.phone || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Message:</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${lead.message || '—'}</td>
            </tr>
          </table>
          <div style="margin-top: 20px; text-align: center;">
            <a href="${config.publicUrl}/dashboard" style="background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">View in Dashboard</a>
          </div>
        </div>
      </div>
    </body>
  `;
  sendHtmlEmail(to, subject, html, text);
}

function fireEscalateEmail(siteId, sid) {
  const site = store.getSite(siteId);
  const siteName = (site && site.name) || siteId;
  const ownerEmail = site && site.owner_id ? (store.getUserById(site.owner_id) || {}).email : '';
  const to = config.mail.to || ownerEmail || 'officialusamano1@gmail.com';
  if (!to) return;

  const subject = `🚨 Live Support Request on ${siteName}`;
  const text = `Live chat requested on ${siteName} (Session: ${sid}). Open dashboard: ${config.publicUrl}/dashboard`;
  const html = `
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f5f7; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #dc2626, #9333ea); padding: 20px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px;">🚨 Live Support Requested!</h2>
          <p style="margin: 4px 0 0; opacity: 0.9; font-size: 13px;">Website: ${siteName}</p>
        </div>
        <div style="padding: 20px;">
          <p>A visitor on <b>${siteName}</b> clicked <b>"Talk to a human"</b>!</p>
          <p><b>Session ID:</b> <code>${sid}</code></p>
          <div style="margin-top: 20px; text-align: center;">
            <a href="${config.publicUrl}/dashboard" style="background: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Join Live Chat Now</a>
          </div>
        </div>
      </div>
    </body>
  `;
  sendHtmlEmail(to, subject, html, text);
}

function fireWebhook(siteId, lead) {
  const site = store.getSite(siteId);
  if (!site || !site.webhook_url) return;
  const url = site.webhook_url;
  try {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = JSON.stringify({ siteId, type: 'lead', lead, at: new Date().toISOString() });
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000
    }, (res) => res.resume());
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  } catch { /* invalid webhook url */ }
}

function summary(siteId) {
  const site = store.getSite(siteId);
  const kb = store.getKnowledge(siteId);
  const chats = store.getChats(siteId);
  const leads = store.getLeads(siteId);
  const analytics = store.getAnalytics(siteId);
  const job = jobs.get(siteId) || null;
  return {
    siteId,
    siteName: kb.siteName || (site && site.name) || siteId,
    siteUrl: kb.siteUrl || (site && site.site_url) || '',
    greeting: (site && site.greeting) || null,
    themeColor: (site && site.theme_color) || '#2563eb',
    webhookUrl: (site && site.webhook_url) || '',
    isWhitelabel: Boolean(site && site.is_whitelabel),
    botName: (site && site.bot_name) || 'Nova AI',
    hideBranding: Boolean(site && site.hide_branding),
    customBrandName: (site && site.custom_brand_name) || '',
    customBrandUrl: (site && site.custom_brand_url) || '',
    analytics,
    kb: { siteName: kb.siteName, siteUrl: kb.siteUrl, trainedAt: kb.trainedAt, pages: kb.pages, chunks: kb.chunkCount || 0, indexed: kb.indexed },
    conversations: Object.keys(chats.conversations).length,
    leads: leads.leads.length,
    humanOnline: hub.agentsOnline(siteId) > 0,
    training: job
  };
}

function withStats(s) {
  const kb = store.getKnowledge(s.id);
  const leads = store.getLeads(s.id);
  const ans = store.getAnalytics(s.id);
  return {
    id: s.id, name: s.name || s.id, siteUrl: s.site_url, greeting: s.greeting,
    isWhitelabel: Boolean(s.is_whitelabel), botName: s.bot_name || 'Nova AI',
    hideBranding: Boolean(s.hide_branding), customBrandName: s.custom_brand_name || '', customBrandUrl: s.custom_brand_url || '',
    ownerId: s.owner_id, createdAt: s.created_at,
    trained: kb.indexed, pages: kb.pages, chunks: kb.chunkCount || 0,
    sessions: ans.sessions, messages: ans.messages, liveChats: ans.live_chats, leads: leads.leads.length
  };
}

store.getAllUsers = function () {
  const db = require('./src/db');
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
};

/* ---------- AUTO-REFRESH TRAINING (Tidio-like) ----------
   When AUTO_TRAIN_MINUTES>0, the server automatically crawls + re-indexes every
   site that has a registered site_url, keeping each bot's knowledge fresh with no
   manual clicks. Default 0 = off (enable in production with e.g. AUTO_TRAIN_MINUTES=720). */
function startAutoTrainer() {
  const minutes = parseInt(process.env.AUTO_TRAIN_MINUTES || '0', 10);
  if (!minutes) return;
  const run = () => {
    const sites = store.getAllSites();
    for (const s of sites) {
      if (!s.site_url) continue;
      const kb = store.getKnowledge(s.id);
      const job = jobs.get(s.id);
      if (job && job.running) continue;
      const stale = !kb.indexed || !kb.trainedAt ||
        (Date.now() - minutes * 60000) > new Date(kb.trainedAt).getTime();
      if (stale) startTrain(s.id, s.site_url);
    }
  };
  setTimeout(run, 10000);
  setInterval(run, minutes * 60000);
}

// Express global error handler (ensures API errors always return JSON instead of HTML)
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(config.port, () => {
  hub.attach(server, { verifyToken });
  startAutoTrainer();
  console.log(`AI Chat SaaS running:  ${config.publicUrl}`);
  console.log(`Login:                  ${config.publicUrl}/login`);
  console.log(`Dashboard:              ${config.publicUrl}/dashboard`);
  console.log(`Widget script:          ${config.publicUrl}/widget.js`);
  if (!config.llm.apiKey) {
    console.log('\nWARNING: No API key set. Cloud AI disabled; local knowledge fallback works.');
    console.log('  Set OPENROUTER_API_KEY (https://openrouter.ai/keys) for full AI answers.');
  }
});