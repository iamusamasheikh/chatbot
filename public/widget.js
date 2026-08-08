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
  var scriptTag = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var autoServer = '';
  try { if (scriptTag && scriptTag.src) autoServer = new URL(scriptTag.src).origin; } catch (e) {}
  var server = (cfg.server || cfg.url || autoServer || 'https://divafits.com').replace(/\/$/, '');
  var siteId = cfg.siteId || (scriptTag && scriptTag.getAttribute('data-site-id')) || 'default';
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
    '.aichat-btn{position:fixed !important;right:20px !important;bottom:20px !important;width:60px !important;height:60px !important;border-radius:50% !important;background:linear-gradient(135deg,#2563eb,#7c3aed) !important;color:#fff !important;border:none !important;cursor:pointer !important;display:flex !important;align-items:center !important;justify-content:center !important;box-shadow:0 8px 25px rgba(37,99,235,.45) !important;z-index:2147483647 !important;transition:transform .2s ease,box-shadow .2s ease !important}',
    '.aichat-btn:hover{transform:scale(1.08) rotate(-3deg) !important;box-shadow:0 12px 30px rgba(37,99,235,.6) !important}',
    '.aichat-widget{position:fixed !important;right:20px !important;bottom:90px !important;width:360px !important;max-width:calc(100vw - 40px) !important;height:520px !important;max-height:calc(100vh - 120px) !important;background:#fff !important;border-radius:16px !important;overflow:hidden !important;display:none;flex-direction:column !important;box-shadow:0 12px 40px rgba(0,0,0,.25) !important;z-index:2147483647 !important}',
    '.aichat-widget.open{display:flex !important}',
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

  var iconChat = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><circle cx="9" cy="10" r="1" fill="currentColor"></circle><circle cx="12" cy="10" r="1" fill="currentColor"></circle><circle cx="15" cy="10" r="1" fill="currentColor"></circle></svg>';
  var iconClose = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  /* ---------- DOM ---------- */
  var btn = document.createElement('button');
  btn.className = 'aichat-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = iconChat;

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

  function mount() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
      } else {
        setTimeout(mount, 50);
      }
      return;
    }
    if (document.getElementById('aichat-btn-root')) return;
    btn.id = 'aichat-btn-root';
    document.body.appendChild(btn);
    document.body.appendChild(widget);
  }
  mount();

  var msgsEl = widget.querySelector('.aichat-messages');
  var actionsEl = widget.querySelector('.aichat-actions');
  var inputEl = widget.querySelector('.aichat-input input');
  var sendBtn = widget.querySelector('.aichat-send');
  var leadEl = widget.querySelector('.aichat-lead');
  var statusEl = widget.querySelector('.aichat-status');
  widget.querySelector('.aichat-name').textContent = cfg.title || 'AI Chat';
  var remoteGreeting = null;

  function applyTheme(color) {
    if (!color) return;
    themeColor = color;
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
      }).catch(function () {});
  }
  if (cfg.color) applyTheme(cfg.color);
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

  /* ---------- Tidio-style Lead Prompt ---------- */
  function showTidioLeadCard(onComplete) {
    if (leadDone) { if (onComplete) onComplete(); return; }
    var card = document.createElement('div');
    card.className = 'aichat-msg aichat-bot';
    card.style.background = '#eef2ff';
    card.style.borderColor = '#c7d2fe';
    card.style.padding = '12px';
    card.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;color:#1e1b4b;font-size:13px">📧 Leave your email to receive updates & connect:</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">' +
        '<input type="text" class="tidio-name" placeholder="Your name (optional)" style="padding:7px 10px;border:1px solid #c7d2fe;border-radius:6px;font-size:13px;outline:none">' +
        '<input type="email" class="tidio-email" placeholder="Your email *" style="padding:7px 10px;border:1px solid #c7d2fe;border-radius:6px;font-size:13px;outline:none">' +
        '<div style="display:flex;gap:6px;margin-top:2px;align-items:center">' +
          '<button class="tidio-submit" style="flex:1;background:' + themeColor + ';color:#fff;border:none;border-radius:6px;padding:7px;font-size:12px;cursor:pointer;font-weight:600">Submit</button>' +
          '<button class="tidio-skip" style="background:none;border:none;color:#6b7280;font-size:11px;cursor:pointer;padding:0 4px">Skip</button>' +
        '</div>' +
      '</div>';
    msgsEl.appendChild(card);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var nameIn = card.querySelector('.tidio-name');
    var emailIn = card.querySelector('.tidio-email');
    var submitBtn = card.querySelector('.tidio-submit');
    var skipBtn = card.querySelector('.tidio-skip');

    submitBtn.onclick = function () {
      var em = emailIn.value.trim();
      var nm = nameIn.value.trim() || 'Visitor';
      if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        emailIn.style.borderColor = '#ef4444';
        return;
      }
      card.innerHTML = '<i>✓ Email saved! Connecting you now...</i>';
      leadDone = true;
      try { localStorage.setItem('aichat_lead_done', '1'); } catch (e) {}
      fetch(server + '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
        body: JSON.stringify({ sessionId: sessionId, siteId: siteId, name: nm, email: em })
      }).catch(function () {});
      if (onComplete) onComplete();
    };

    skipBtn.onclick = function () {
      card.remove();
      leadDone = true;
      if (onComplete) onComplete();
    };
  }

  /* ---------- AI chat ---------- */
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addMsg(text, 'user');

    var alreadyDone = leadDone || (function(){ try { return localStorage.getItem('aichat_lead_done'); } catch(e){ return false; } })();
    if (!alreadyDone && ENABLE_LEAD) {
      showTidioLeadCard(function () {
        processAiReply(text);
      });
    } else {
      processAiReply(text);
    }
  }

  function processAiReply(text) {
    var typing = addTyping();
    sendBtn.disabled = true;
    fetch(server + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
      body: JSON.stringify({ sessionId: sessionId, siteId: siteId, message: text })
    }).then(function (r) { return r.json(); }).then(function (data) {
      typing.remove();
      sendBtn.disabled = false;
      if (data.reply) addMsg(data.reply, 'bot');
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
    var lastBotText = '';
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'bot-msg') {
        if (msg.text !== lastBotText) { lastBotText = msg.text; addMsg(msg.text, 'bot'); }
      } else if (msg.type === 'agent-msg') {
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
    btn.innerHTML = has ? iconClose : iconChat;
    if (has) {
      openWs();
      if (!msgsEl.querySelector('.aichat-msg')) {
        addBot(remoteGreeting || cfg.greeting || 'Hi there! 👋 How can I help you today?');
        quickReplies();
      }
    }
  });
  widget.querySelector('.aichat-close').onclick = function () {
    widget.classList.remove('open');
    btn.innerHTML = iconChat;
  };
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