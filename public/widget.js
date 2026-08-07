/* AI Chat Widget — embed this file on any website (WordPress, custom, etc.)
   Usage:
     <script>window.AIChatConfig={server:"https://your-server.com", title:"Company"};</script>
     <script src="https://your-server.com/widget.js" defer></script>
   Works standalone. Zero dependencies.
*/
(function () {
  if (window.__AIChatWidgetLoaded) return;
  window.__AIChatWidgetLoaded = true;

  var cfg = window.AIChatConfig || {};
  var server = (cfg.url || '').replace(/\/$/, '');
  var siteId = cfg.siteId || 'default';
  var ENABLE_LEAD = cfg.enableLead !== false;
  var themeColor = cfg.color || '#2563eb';
  var hasHeading = false;

  var SESSION_KEY = 'aichat_session';
  var sessionId = (function () {
    try { var s = window.localStorage.getItem(SESSION_KEY); if (s) return s; } catch (e) {}
    var id = 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { window.localStorage.setItem(SESSION_KEY, id); } catch (e) {}
    return id;
  })();

  var ws = null;
  var humanOnline = false;
  var leadDone = false;

  var css = [
    '.aichat *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}',
    '.aichat-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:#2563eb;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(37,99,235,.4);z-index:2147483000;transition:transform .15s}',
    '.aichat-btn:hover{transform:scale(1.06)}',
    '.aichat-widget{position:fixed;right:20px;bottom:90px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483000}',
    '.aichat-widget.open{display:flex}',
    '.aichat-header{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}',
    '.aichat-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:18px}',
    '.aichat-header-info{flex:1;min-width:0}.aichat-name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aichat-status{font-size:12px;opacity:.9}',
    '.aichat-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1}',
    '.aichat-body{flex:1;overflow-y:auto;background:#f7f8fa;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}',
    '.aichat-msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.aichat-bot{background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px;align-self:flex-start}',
    '.aichat-user{background:#2563eb;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}',
    '.aichat-agent{background:#065f46;color:#fff;border-bottom-left-radius:4px;align-self:flex-start}',
    '.aichat-typing{color:#999;font-style:italic}',
    '.aichat-src{font-size:11px;color:#6b7280;margin-top:4px}',
    '.aichat-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:2px}',
    '.aichat-actions button{background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer}',
    '.aichat-actions button:hover{background:#e0e7ff}',
    '.aichat-input{display:flex;border-top:1px solid #ececec;padding:10px;gap:8px;background:#fff}',
    '.aichat-input input{flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:9px 14px;font-size:14px;outline:none;min-width:0}',
    '.aichat-input input:focus{border-color:#2563eb}',
    '.aichat-input button{background:#2563eb;color:#fff;border:none;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:18px;flex:0 0 auto}',
    '.aichat-input button:disabled{background:#9ca3af;cursor:not-allowed}',
    '.aichat-lead{padding:10px;display:none;flex-direction:column;gap:8px;background:#fff;border-top:1px solid #ececec}',
    '.aichat-lead input{border:1px solid #d1d7e0;border-radius:10px;padding:9px 12px;font-size:14px;outline:none}',
    '.aichat-lead input:focus{border-color:#2563eb}',
    '.aichat-lead button{background:#10b981;color:#fff;border:none;border-radius:10px;padding:10px;font-size:14px;cursor:pointer;font-weight:600}',
    '.aichat-powered{text-align:center;font-size:10px;color:#9ca3af;padding:4px;background:#fff}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  var btn = document.createElement('button');
  btn.className = 'aichat-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.2 1 4.2 2.7 5.7L4 21l3.7-1.6c1.3.4 2.7.6 4.3.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>';
  document.body.appendChild(btn);

  var widget = document.createElement('div');
  widget.className = 'aichat-widget';
  widget.innerHTML =
    '<div class="aichat-header">' +
      '<div class="aichat-avatar">💬</div>' +
      '<div class="aichat-header-info"><div class="aichat-name"></div><div class="aichat-status">Online</div></div>' +
      '<button class="aichat-close" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="aichat-body">' +
      '<div class="aichat-messages"></div>' +
    '</div>' +
    '<div class="aichat-actions"></div>' +
    '<div class="aichat-input">' +
      '<input type="text" placeholder="Type a message..." autocomplete="off">' +
      '<button class="aichat-send" aria-label="Send">➤</button>' +
    '</div>' +
    '<div class="aichat-lead">' +
      '<input type="text" class="lead-name" placeholder="Your name *">' +
      '<input type="email" class="lead-email" placeholder="Your email *">' +
      '<button class="lead-save">Get in touch</button>' +
    '</div>' +
    '<div class="aichat-powered">AI ChatBot</div>';
  document.body.appendChild(widget);

  var msgsEl = widget.querySelector('.aichat-messages');
  var actionsEl = widget.querySelector('.aichat-actions');
  var inputEl = widget.querySelector('.aichat-input input');
  var sendBtn = widget.querySelector('.aichat-send');
  var leadEl = widget.querySelector('.aichat-lead');
  var statusEl = widget.querySelector('.aichat-status');
  widget.querySelector('.aichat-name').textContent = cfg.title || 'AI Chat';
  var remoteGreeting = null;

  function applyTheme(color) {
    themeColor = color || themeColor;
    var el = widget.querySelector('.aichat-btn') || btn;
    btn.style.background = themeColor;
    btn.style.boxShadow = '0 6px 20px ' + themeColor + '66';
    widget.querySelector('.aichat-header').style.background = 'linear-gradient(135deg,' + themeColor + ',#7c3aed)';
    sendBtn.style.background = themeColor;
    var ty = document.getElementById('aichat-theme');
    if (!ty) { ty = document.createElement('style'); ty.id = 'aichat-theme'; document.head.appendChild(ty); }
    ty.textContent = '.aichat-user{background:' + themeColor + '}.aichat-input input:focus{border-color:' + themeColor + '}.aichat-right b{color:' + themeColor + '}';
  }

  function initTheme() {
    if (!server) return;
    fetch(server + '/api/site-config?siteId=' + encodeURIComponent(siteId))
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (c.themeColor) applyTheme(c.themeColor);
        if (c.greeting && !cfg.greeting) remoteGreeting = c.greeting;
      }).catch(function () { applyTheme(cfg.color); });
  }
  applyTheme(cfg.color);
  initTheme();

  /* ---------- helpers ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Minimal, safe markdown -> HTML renderer (no innerHTML injection risk).
  function render(text) {
    var esc = escapeHtml(text);
    esc = esc.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    var lines = esc.split('\n');
    var out = [];
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*[-*+]\s+/.test(line)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + line.replace(/^\s*[-*+]\s+/, '') + '</li>');
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(line === '' ? '' : line);
      }
    }
    if (inList) out.push('</ul>');
    return out.join('<br>');
  }

  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'aichat-msg aichat-' + who;
    d.innerHTML = render(text);
    d.querySelectorAll('a').forEach(function (a) { a.style.color = themeColor; });
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return d;
  }

  function addTyping() {
    var t = document.createElement('div');
    t.className = 'aichat-msg aichat-bot aichat-typing';
    t.textContent = 'typing...';
    msgsEl.appendChild(t);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return t;
  }

  function quickReplies() {
    actionsEl.innerHTML = '';
    if (!leadDone && ENABLE_LEAD) {
      var b = document.createElement('button');
      b.textContent = '📧 Leave contact info';
      b.onclick = function () {
        leadEl.style.display = 'flex';
        actionsEl.innerHTML = '';
      };
      actionsEl.appendChild(b);
    }
    var h = document.createElement('button');
    h.textContent = '🧑‍💼 Talk to a human';
    h.onclick = escalate;
    actionsEl.appendChild(h);
  }

  function addBot(text) {
    addMsg(text, 'bot');
    quickReplies();
  }

  /* ---------- AI chat ---------- */
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addMsg(text, 'user');
    var typing = addTyping();
    sendBtn.disabled = true;
    fetch(server + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
      body: JSON.stringify({ sessionId: sessionId, siteId: siteId, message: text })
    }).then(function (r) { return r.json(); }).then(function (data) {
      typing.remove();
      sendBtn.disabled = false;
      if (data.reply) addMsg(data.reply.replace(/\n/g, '\n'), 'bot');
    }).catch(function () {
      typing.remove();
      sendBtn.disabled = false;
      addMsg('Sorry, I could not connect. Please try again later.', 'bot');
    });
  }

  /* ---------- WebSocket / live chat ---------- */
  function openWs() {
    var url = (server + '/ws').replace('http://', 'ws://').replace('https://', 'wss://');
    try { ws = new WebSocket(url); } catch (e) { return; }
    ws.onopen = function () {
      ws.send(JSON.stringify({ type: 'client-hello', sessionId: sessionId, siteId: siteId }));
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'bot-msg') addMsg(msg.text, 'bot');
      else if (msg.type === 'agent-msg') {
        if (!humanOnline) { humanOnline = true; setHumanStatus(); }
        addMsg(msg.text, 'agent');
      }
    };
  }

  function setHumanStatus() {
    statusEl.textContent = humanOnline ? 'Live: agent online' : 'Online';
  }

  btn.addEventListener('click', function () {
    var has = widget.classList.toggle('open');
    if (has) {
      openWs();
      if (!msgsEl.querySelector('.aichat-msg')) {
        addBot(remoteGreeting || cfg.greeting || 'Hi there! 👋 How can I help you today?');
        quickReplies();
      }
    }
  });
  widget.querySelector('.aichat-close').onclick = function () { widget.classList.remove('open'); };
  sendBtn.onclick = sendMessage;
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  function escalate() {
    fetch(server + '/api/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
      body: JSON.stringify({ sessionId: sessionId, siteId: siteId })
    }).then(function (r) { return r.json(); }).then(function (d) {
      addBot(d.humanOnline ? 'A human agent has joined. 👨‍💼' : 'Our team has been notified! They will reply as soon as possible.');
    }).catch(function () {
      addBot('Our team has been notified! They will reply as soon as possible.');
    });
  }

  leadEl.querySelector('.lead-save').onclick = function () {
    var name = leadEl.querySelector('.lead-name').value.trim();
    var email = leadEl.querySelector('.lead-email').value.trim();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      alert('Please enter your name and a valid email.');
      return;
    }
    fetch(server + '/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
      body: JSON.stringify({ sessionId: sessionId, siteId: siteId, name: name, email: email })
    }).then(function (r) { return r.json(); }).then(function () {
      leadDone = true;
      leadEl.style.display = 'none';
      addBot('Thanks ' + name.split(' ')[0] + '! We will contact you shortly. 🚀');
    }).catch(function () {
      alert('Could not save your info. Please try again.');
    });
  };
})();