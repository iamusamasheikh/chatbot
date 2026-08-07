'use strict';

const { WebSocketServer } = require('ws');
const store = require('./store');

// Real-time hub (WebSocket). Visitors connect unauthenticated (role: client),
// dashboard agents connect with ?token=<JWT> and are verified (role: agent).
// Everything is scoped by siteId.
//
// Protocol:
//   Client -> { type:'client-hello', sessionId, siteId, name }
//   Agent  -> { type:'agent-hello', siteId, agentId }
//   Client -> { type:'user-msg', text, sessionId, siteId }
//   Agent  -> { type:'agent-msg', text, sessionId, siteId }
//   Server -> { type:'bot-msg', text, mode }
//   Server -> { type:'agent-msg', text, agentId }
//   Server -> { type:'user-msg', text, sessionId, name, siteId }
//   Server -> { type:'agent-joined', sessionId, siteId }
class LiveChatHub {
  constructor() {
    this.clients = new Map(); // sessionId -> { ws, name, siteId }
    this.agents = new Map();  // siteId -> Map<ws, name>
    this.verifyToken = null;
  }

  attach(server, { verifyToken } = {}) {
    this.verifyToken = verifyToken || null;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      let role = null;
      const token = this.parseToken(req.url);
      const tokenUser = (token && this.verifyToken) ? this.verifyToken(token) : null;
      ws.tokenUser = tokenUser;

      ws.on('message', (buf) => {
        let msg;
        try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
        const r = this.handleMessage(ws, msg);
        if (r) role = r;
      });
      ws.on('close', () => this.drop(ws, role));
    });
  }

  parseToken(url) {
    try {
      const q = new URL(url, 'http://x').searchParams;
      return q.get('token') || '';
    } catch { return ''; }
  }

  handleMessage(ws, msg) {
    switch (msg.type) {
      case 'client-hello':
        this.clients.set(msg.sessionId, { ws, name: msg.name || 'Visitor', siteId: store.sanitizeSiteId(msg.siteId) });
        return 'client';
      case 'agent-hello': {
        const u = ws.tokenUser;
        if (!u) { ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' })); return null; }
        const siteId = store.sanitizeSiteId(msg.siteId);
        if (u.role !== 'admin' && !store.siteBelongsTo(siteId, u.id)) {
          ws.send(JSON.stringify({ type: 'error', message: 'No access to this site' })); return null;
        }
        if (!this.agents.has(siteId)) this.agents.set(siteId, new Map());
        this.agents.get(siteId).set(ws, msg.agentId || u.name || 'Agent');
        ws.siteId = siteId;
        ws.send(JSON.stringify({ type: 'agents-ready', siteId }));
        // Send the agent existing conversations so they see history right away.
        const chats = store.getChats(siteId);
        const convs = Object.keys(chats.conversations).map((sid) => ({
          sessionId: sid,
          name: chats.conversations[sid].visitorName || 'Visitor',
          messages: chats.conversations[sid].messages || []
        }));
        ws.send(JSON.stringify({ type: 'initial-messages', siteId, conversations: convs }));
        return 'agent';
      }
      case 'user-msg':
        this.broadcastToAgents(msg.siteId, {
          type: 'user-msg', text: msg.text, sessionId: msg.sessionId,
          name: this.clients.get(msg.sessionId)?.name || 'Visitor', siteId: msg.siteId
        });
        break;
      case 'agent-msg': {
        const u = ws.tokenUser;
        if (!u) return null;
        const c = this.clients.get(msg.sessionId);
        if (c && c.siteId === store.sanitizeSiteId(msg.siteId)) {
          c.ws.send(JSON.stringify({ type: 'agent-msg', text: msg.text }));
          store.persistMessage(c.siteId, msg.sessionId, msg.text, 'agent');
        }
        break;
      }
      default:
        break;
    }
    return null;
  }

  broadcastToAgents(siteId, payload) {
    const agents = this.agents.get(store.sanitizeSiteId(siteId));
    if (agents) for (const [a] of agents) a.send(JSON.stringify(payload));
  }

  agentJoined(siteId, sessionId) {
    this.broadcastToAgents(siteId, { type: 'agent-joined', sessionId, siteId: store.sanitizeSiteId(siteId) });
  }

  agentsOnline(siteId) {
    const agents = this.agents.get(store.sanitizeSiteId(siteId));
    return agents ? agents.size : 0;
  }

  postBotReply(siteId, sessionId, text, mode) {
    const c = this.clients.get(sessionId);
    if (c && c.siteId === store.sanitizeSiteId(siteId)) {
      c.ws.send(JSON.stringify({ type: 'bot-msg', text, mode }));
    }
  }

  drop(ws, role) {
    if (role === 'agent') {
      for (const [siteId, map] of this.agents) if (map.delete(ws) && map.size === 0) this.agents.delete(siteId);
    }
    if (role === 'client') {
      for (const [id, c] of this.clients) if (c.ws === ws) this.clients.delete(id);
    }
  }
}

module.exports = new LiveChatHub();