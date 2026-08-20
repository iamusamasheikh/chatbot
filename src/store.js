'use strict';

const db = require('./db');

function sanitizeSiteId(id) {
  return String(id || 'default').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 60) || 'default';
}

const orNull = (v) => (v === undefined ? null : v);

const store = {
  sanitizeSiteId,

  /* ================= USERS / AUTH ================= */
  createUser(email, passwordHash, name, role) {
    const r = db.prepare('INSERT INTO users (email,password_hash,name,role,created_at) VALUES (?,?,?,?,?)')
      .run(email, passwordHash, orNull(name), role || 'user', new Date().toISOString());
    return Number(r.lastInsertRowid);
  },
  findUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
  },
  getUserById(id) {
    return db.prepare('SELECT id,email,name,role,created_at FROM users WHERE id = ?').get(id) || null;
  },
  countUsers() {
    return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  },

  /* ================= SITES ================= */
  addSite(siteId, name, ownerId) {
    const id = sanitizeSiteId(siteId);
    const exists = db.prepare('SELECT id FROM sites WHERE id = ?').get(id);
    if (!exists) {
      db.prepare('INSERT INTO sites (id, owner_id, name, created_at) VALUES (?,?,?,?)')
        .run(id, orNull(ownerId), orNull(name), new Date().toISOString());
    } else if (name && !this.getSite(id).name) {
      db.prepare('UPDATE sites SET name = ? WHERE id = ?').run(name, id);
    }
    return id;
  },
  getSite(siteId) {
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(sanitizeSiteId(siteId)) || null;
  },
  siteExists(siteId) {
    return !!db.prepare('SELECT id FROM sites WHERE id = ?').get(sanitizeSiteId(siteId));
  },
  siteBelongsTo(siteId, ownerId) {
    const s = this.getSite(siteId);
    return !!s && s.owner_id === ownerId;
  },
  getRecentMessages(siteId, sessionId, n) {
    const rows = db.prepare('SELECT sender, text FROM messages WHERE site_id = ? AND session_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(siteId, sessionId, n)
      .reverse();
    return rows.map((r) => ({ sender: r.sender, text: r.text }));
  },
  getSitesByOwner(ownerId) {
    return db.prepare('SELECT * FROM sites WHERE owner_id = ? ORDER BY created_at ASC').all(ownerId);
  },
  getAllSites() {
    return db.prepare('SELECT * FROM sites ORDER BY created_at ASC').all();
  },
  updateSite(siteId, fields) {
    const s = this.getSite(siteId);
    if (!s) return;
    const next = Object.assign({}, s, fields);
    db.prepare('UPDATE sites SET name=?, site_url=?, greeting=?, knowledge=?, trained_at=?, theme_color=?, webhook_url=?, is_whitelabel=?, bot_name=?, hide_branding=?, custom_brand_name=?, custom_brand_url=? WHERE id=?')
      .run(orNull(next.name), orNull(next.site_url), orNull(next.greeting),
        next.knowledge == null ? null : JSON.stringify(next.knowledge),
        orNull(next.trained_at), orNull(next.theme_color), orNull(next.webhook_url),
        next.is_whitelabel ? 1 : 0, orNull(next.bot_name), next.hide_branding ? 1 : 0,
        orNull(next.custom_brand_name), orNull(next.custom_brand_url), s.id);
  },
  upsertSite(site) {
    const id = sanitizeSiteId(site.id);
    const existing = this.getSite(id);
    if (existing) {
      db.prepare('UPDATE sites SET name = COALESCE(?, name), site_url = COALESCE(?, site_url), greeting = COALESCE(?, greeting), bot_name = COALESCE(?, bot_name) WHERE id = ?')
        .run(orNull(site.name), orNull(site.siteUrl), orNull(site.greeting), orNull(site.botName), id);
    } else {
      db.prepare('INSERT INTO sites (id, owner_id, name, site_url, greeting, bot_name, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, orNull(site.ownerId), orNull(site.name), orNull(site.siteUrl), orNull(site.greeting), orNull(site.botName || 'Nova AI'), new Date().toISOString());
    }
    return id;
  },
  updateSiteSettings(siteId, settings) {
    const s = this.getSite(siteId);
    if (!s) return;
    db.prepare('UPDATE sites SET name=?, site_url=?, greeting=?, theme_color=?, webhook_url=?, bot_name=?, hide_branding=?, custom_brand_name=?, custom_brand_url=? WHERE id=?')
      .run(
        orNull(settings.name !== undefined ? settings.name : s.name),
        orNull(settings.siteUrl !== undefined ? settings.siteUrl : s.site_url),
        orNull(settings.greeting !== undefined ? settings.greeting : s.greeting),
        orNull(settings.themeColor !== undefined ? settings.themeColor : s.theme_color),
        orNull(settings.webhookUrl !== undefined ? settings.webhookUrl : s.webhook_url),
        orNull(settings.botName !== undefined ? settings.botName : s.bot_name),
        settings.hideBranding !== undefined ? (settings.hideBranding ? 1 : 0) : (s.hide_branding ? 1 : 0),
        orNull(settings.customBrandName !== undefined ? settings.customBrandName : s.custom_brand_name),
        orNull(settings.customBrandUrl !== undefined ? settings.customBrandUrl : s.custom_brand_url),
        s.id
      );
  },
  setSiteWhitelabel(siteId, isWhitelabel) {
    const s = this.getSite(siteId);
    if (!s) return;
    db.prepare('UPDATE sites SET is_whitelabel = ? WHERE id = ?').run(isWhitelabel ? 1 : 0, s.id);
  },
  pingSite(siteId) {
    const id = sanitizeSiteId(siteId);
    if (!id) return;
    try {
      db.prepare('UPDATE sites SET last_ping_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    } catch (e) {}
  },


  /* ================= KNOWLEDGE ================= */
  getKnowledge(siteId) {
    const s = this.getSite(siteId);
    if (!s || !s.knowledge) return { siteName: '', siteUrl: '', trainedAt: null, pages: [], chunks: [], chunkCount: 0, indexed: false };
    try {
      const k = JSON.parse(s.knowledge);
      k.indexed = true;
      // chunks is the built index object ({docs, idf, ...}); normalize a count field.
      if (k.chunks) {
        k.chunkCount = k.chunks.chunkCount || (Array.isArray(k.chunks) ? k.chunks.length : (k.chunks.docs ? k.chunks.docs.length : 0));
      } else {
        k.chunkCount = 0;
        k.chunks = [];
      }
      return k;
    } catch {
      return { siteName: '', siteUrl: '', trainedAt: null, pages: [], chunks: [], chunkCount: 0, indexed: false };
    }
  },
  saveKnowledge(siteId, kb) {
    this.updateSite(siteId, {
      site_url: kb.siteUrl,
      trained_at: kb.trainedAt,
      knowledge: kb
    });
  },

  /* ================= CHATS ================= */
  getChats(siteId) {
    const sessions = db.prepare('SELECT * FROM chat_sessions WHERE site_id = ? ORDER BY started_at ASC').all(siteId);
    const msgs = db.prepare('SELECT * FROM messages WHERE site_id = ? ORDER BY at ASC, id ASC').all(siteId);
    const conversations = {};
    for (const s of sessions) conversations[s.id] = { startedAt: s.started_at, visitorName: s.visitor_name, messages: [] };
    for (const m of msgs) {
      if (!conversations[m.session_id]) conversations[m.session_id] = { startedAt: m.at, messages: [] };
      conversations[m.session_id].messages.push({ sender: m.sender, text: m.text, mode: m.mode, at: m.at });
    }
    return { conversations };
  },
  persistMessage(siteId, sessionId, text, sender, mode) {
    siteId = sanitizeSiteId(siteId);
    db.prepare('INSERT OR IGNORE INTO chat_sessions (id, site_id, started_at) VALUES (?,?,?)')
      .run(sessionId, siteId, new Date().toISOString());
    db.prepare('INSERT INTO messages (site_id, session_id, sender, text, mode, at) VALUES (?,?,?,?,?,?)')
      .run(siteId, sessionId, sender, text, mode || null, new Date().toISOString());
  },
  setVisitorName(siteId, sessionId, name) {
    db.prepare('UPDATE chat_sessions SET visitor_name = ? WHERE id = ? AND site_id = ?').run(orNull(name), sessionId, siteId);
  },
  clearChats(siteId) {
    db.prepare('DELETE FROM messages WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM chat_sessions WHERE site_id = ?').run(siteId);
  },

  /* ================= LEADS ================= */
  getLeads(siteId) {
    const rows = db.prepare('SELECT * FROM leads WHERE site_id = ? ORDER BY id DESC').all(siteId);
    return { leads: rows.map((r) => ({ name: r.name, email: r.email, phone: r.phone || '', message: r.message || '', at: r.at })) };
  },
  addLead(siteId, lead) {
    db.prepare('INSERT INTO leads (site_id, name, email, phone, message, at) VALUES (?,?,?,?,?,?)')
      .run(siteId, lead.name, lead.email, orNull(lead.phone), orNull(lead.message), lead.at || new Date().toISOString());
  },
  clearLeads(siteId) {
    db.prepare('DELETE FROM leads WHERE site_id = ?').run(siteId);
  },

  /* ================= ANALYTICS ================= */
  getAnalytics(siteId) {
    const day = new Date().toISOString().slice(0, 10);
    const rows = db.prepare('SELECT * FROM analytics WHERE site_id = ?').all(siteId);
    const byDate = {};
    let sessions = 0, messages = 0, liveChats = 0;
    for (const r of rows) {
      byDate[r.date] = { sessions: r.sessions, messages: r.messages, liveChats: r.live_chats };
      sessions += r.sessions; messages += r.messages; liveChats += r.live_chats;
    }
    if (!byDate[day]) byDate[day] = { sessions: 0, messages: 0, liveChats: 0 };
    return { sessions, messages, liveChats, byDate };
  },
  trackAnalytics(siteId, event) {
    const date = new Date().toISOString().slice(0, 10);
    const col = event === 'session' ? 'sessions' : event === 'livechat' ? 'live_chats' : 'messages';
    db.prepare(`INSERT INTO analytics (site_id, date, sessions, messages, live_chats)
                VALUES (?,?,?,?,?)
                ON CONFLICT(site_id,date) DO UPDATE SET ${col} = ${col} + 1`)
      .run(siteId, date, 0, 0, 0);
  },
  clearAnalytics(siteId) {
    db.prepare('DELETE FROM analytics WHERE site_id = ?').run(siteId);
  }
};

module.exports = store;