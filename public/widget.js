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

  var fontLink = document.getElementById('aichat-font');
  if (!fontLink) {
    fontLink = document.createElement('link');
    fontLink.id = 'aichat-font';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(fontLink);
  }

  var css = [
    '.aichat-widget, .aichat-widget *, .aichat-btn, .aichat-btn *{box-sizing:border-box !important;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif !important;letter-spacing:normal !important;text-transform:none !important;text-shadow:none !important}',
    '.aichat-btn{position:fixed !important;right:20px !important;bottom:20px !important;width:60px !important;min-width:60px !important;max-width:60px !important;height:60px !important;min-height:60px !important;max-height:60px !important;border-radius:50% !important;background:linear-gradient(135deg,#2563eb,#7c3aed) !important;color:#fff !important;border:none !important;outline:none !important;padding:0 !important;margin:0 !important;cursor:pointer !important;display:flex !important;align-items:center !important;justify-content:center !important;box-shadow:0 8px 25px rgba(37,99,235,.45) !important;z-index:2147483647 !important;transition:transform .2s ease,box-shadow .2s ease !important;line-height:1 !important}',
    '.aichat-btn:hover{transform:scale(1.08) rotate(-3deg) !important;box-shadow:0 12px 30px rgba(37,99,235,.6) !important}',
    '.aichat-btn svg{width:28px !important;height:28px !important;display:block !important;margin:auto !important;stroke:#ffffff !important}',
    '.aichat-widget{position:fixed !important;right:20px !important;bottom:90px !important;width:360px !important;max-width:calc(100vw - 30px) !important;height:530px !important;max-height:calc(100vh - 110px) !important;background:#ffffff !important;border-radius:16px !important;overflow:hidden !important;display:none;flex-direction:column !important;box-shadow:0 12px 40px rgba(0,0,0,.25) !important;z-index:2147483647 !important;color:#0f172a !important;line-height:1.5 !important}',
    '.aichat-widget.open{display:flex !important}',
    '.aichat-header{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff !important;padding:14px 16px !important;display:flex !important;align-items:center !important;gap:10px !important;flex:0 0 auto !important}',
    '.aichat-avatar{width:36px !important;min-width:36px !important;height:36px !important;border-radius:50% !important;background:rgba(255,255,255,.25) !important;display:flex !important;align-items:center !important;justify-content:center !important;font-size:18px !important;line-height:1 !important}',
    '.aichat-header-info{flex:1 !important;min-width:0 !important}',
    '.aichat-name{font-weight:700 !important;font-size:15px !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;color:#ffffff !important;line-height:1.3 !important}',
    '.aichat-status{font-size:12px !important;opacity:.9 !important;color:#ffffff !important;line-height:1.2 !important;margin-top:2px !important}',
    '.aichat-close{background:none !important;border:none !important;outline:none !important;padding:0 !important;margin:0 !important;color:#ffffff !important;font-size:22px !important;cursor:pointer !important;line-height:1 !important;display:flex !important;align-items:center !important;justify-content:center !important;width:28px !important;height:28px !important}',
    '.aichat-body{flex:1 !important;overflow-y:auto !important;background:#f8fafc !important;padding:14px !important;display:flex !important;flex-direction:column !important;gap:10px !important;min-height:0 !important}',
    '.aichat-msg{max-width:85% !important;padding:10px 14px !important;border-radius:14px !important;font-size:14px !important;line-height:1.5 !important;white-space:pre-wrap !important;word-wrap:break-word !important;margin:0 !important}',
    '.aichat-bot{background:#ffffff !important;color:#0f172a !important;border:1px solid #e2e8f0 !important;border-bottom-left-radius:4px !important;align-self:flex-start !important;box-shadow:0 1px 3px rgba(0,0,0,0.04) !important}',
    '.aichat-bot *{color:#0f172a !important}',
    '.aichat-bot a{color:#2563eb !important;text-decoration:underline !important}',
    '.aichat-user{background:#2563eb !important;color:#ffffff !important;border-bottom-right-radius:4px !important;align-self:flex-end !important;box-shadow:0 1px 3px rgba(37,99,235,0.2) !important}',
    '.aichat-user *{color:#ffffff !important}',
    '.aichat-agent{background:#065f46 !important;color:#ffffff !important;border-bottom-left-radius:4px !important;align-self:flex-start !important}',
    '.aichat-agent *{color:#ffffff !important}',
    '.aichat-typing{color:#64748b !important;font-style:italic !important}',
    '.aichat-src{font-size:11px !important;color:#64748b !important;margin-top:4px !important}',
    '.aichat-actions{display:flex !important;gap:8px !important;justify-content:center !important;flex-wrap:wrap !important;padding:4px !important;flex:0 0 auto !important}',
    '.aichat-actions button{background:#eef2ff !important;border:1px solid #c7d2fe !important;color:#4338ca !important;border-radius:20px !important;padding:6px 14px !important;font-size:12.5px !important;cursor:pointer !important;font-weight:600 !important;line-height:1.4 !important;margin:0 !important;outline:none !important}',
    '.aichat-actions button:hover{background:#e0e7ff !important}',
    '.aichat-input{display:flex !important;align-items:center !important;border-top:1px solid #e2e8f0 !important;padding:10px 12px !important;gap:8px !important;background:#ffffff !important;flex:0 0 auto !important}',
    '.aichat-input input{flex:1 !important;border:1px solid #cbd5e1 !important;border-radius:20px !important;padding:9px 14px !important;font-size:14px !important;outline:none !important;min-width:0 !important;height:38px !important;background:#ffffff !important;color:#0f172a !important;line-height:1.4 !important;margin:0 !important;box-shadow:none !important}',
    '.aichat-input input:focus{border-color:#2563eb !important}',
    '.aichat-send{background:#2563eb !important;color:#ffffff !important;border:none !important;outline:none !important;border-radius:50% !important;width:38px !important;min-width:38px !important;max-width:38px !important;height:38px !important;min-height:38px !important;max-height:38px !important;cursor:pointer !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:0 !important;margin:0 !important;flex:0 0 38px !important;box-shadow:0 2px 8px rgba(37,99,235,0.3) !important;transition:all .15s ease !important}',
    '.aichat-send:hover{opacity:.92 !important;transform:scale(1.05) !important}',
    '.aichat-send svg{width:16px !important;height:16px !important;stroke:#ffffff !important;fill:none !important;stroke-width:2.5 !important;display:block !important;margin:0 auto !important;transform:translateX(1px) !important}',
    '.aichat-send:disabled{background:#9ca3af !important;cursor:not-allowed !important;transform:none !important;box-shadow:none !important}',
    '.aichat-lead{padding:12px !important;display:none;flex-direction:column !important;gap:8px !important;background:#ffffff !important;border-top:1px solid #e2e8f0 !important;flex:0 0 auto !important}',
    '.aichat-lead input{border:1px solid #cbd5e1 !important;border-radius:10px !important;padding:9px 12px !important;font-size:14px !important;outline:none !important;background:#ffffff !important;color:#0f172a !important;height:38px !important;line-height:1.4 !important;margin:0 !important}',
    '.aichat-lead input:focus{border-color:#2563eb !important}',
    '.aichat-lead button{background:#10b981 !important;color:#ffffff !important;border:none !important;border-radius:10px !important;padding:10px !important;font-size:14px !important;cursor:pointer !important;font-weight:600 !important;outline:none !important;line-height:1.4 !important;margin:0 !important}',
    '.aichat-powered{text-align:center !important;font-size:11px !important;color:#64748b !important;padding:6px 10px !important;background:#f8fafc !important;border-top:1px solid #f1f5f9 !important;font-weight:500 !important;letter-spacing:0.5px !important;flex:0 0 auto !important}',
    '.aichat-powered a{color:#334155 !important;text-decoration:none !important;font-weight:700 !important}',
    '.aichat-sender-tag{font-size:11px !important;font-weight:700 !important;color:#4f46e5 !important;margin-bottom:4px !important;display:flex !important;align-items:center !important;gap:4px !important;letter-spacing:0.2px !important;line-height:1.2 !important}',
    '.aichat-sender-tag.agent{color:#059669 !important}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var iconChat = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><circle cx="9" cy="10" r="1" fill="currentColor"></circle><circle cx="12" cy="10" r="1" fill="currentColor"></circle><circle cx="15" cy="10" r="1" fill="currentColor"></circle></svg>';
  var iconClose = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  var iconSend = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

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
      '<button class="aichat-send" aria-label="Send">' + iconSend + '</button>' +
    '</div>' +
    '<div class="aichat-lead" style="display:none">' +
      '<input type="text" class="lead-name" placeholder="Your name *">' +
      '<input type="email" class="lead-email" placeholder="Your email *">' +
      '<button class="lead-save">Get in touch</button>' +
    '</div>' +
    '<div class="aichat-powered">POWERED BY <a href="https://divafits.com" target="_blank" style="color:#4b5563;text-decoration:none;font-weight:700">⚡ Divafits AI</a></div>';

  function mount() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
      } else {
        setTimeout(mount, 50);
      }
      return;
    }
    if (!document.getElementById('aichat-btn-root')) {
      btn.id = 'aichat-btn-root';
      document.body.appendChild(btn);
      document.body.appendChild(widget);
    }
  }
  mount();
  setInterval(mount, 3000);

  var msgsEl = widget.querySelector('.aichat-messages');
  var actionsEl = widget.querySelector('.aichat-actions');
  var inputEl = widget.querySelector('.aichat-input input');
  var sendBtn = widget.querySelector('.aichat-send');
  var leadEl = widget.querySelector('.aichat-lead');
  var statusEl = widget.querySelector('.aichat-status');
  var poweredEl = widget.querySelector('.aichat-powered');
  var currentBotName = cfg.botName || cfg.title || 'Nova AI';
  widget.querySelector('.aichat-name').textContent = currentBotName;
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
    ty.textContent = '.aichat-user{background:' + themeColor + ' !important}.aichat-input input:focus{border-color:' + themeColor + ' !important}.aichat-send{background:' + themeColor + ' !important}.aichat-right b{color:' + themeColor + ' !important}';
  }

  function initConfig() {
    if (!server) return;
    fetch(server + '/api/site-config?siteId=' + encodeURIComponent(siteId))
      .then(function (r) { return r.json(); })
      .then(function (c) {
        if (c.themeColor) applyTheme(c.themeColor);
        if (c.greeting && !cfg.greeting) remoteGreeting = c.greeting;
        if (c.botName) {
          currentBotName = c.botName;
          if (!cfg.botName && !cfg.title) {
            widget.querySelector('.aichat-name').textContent = currentBotName;
          }
        }
        if (c.isWhitelabel) {
          if (c.hideBranding) {
            poweredEl.style.display = 'none';
          } else if (c.customBrandName) {
            var brandUrl = c.customBrandUrl || '#';
            poweredEl.innerHTML = 'POWERED BY <a href="' + escapeHtml(brandUrl) + '" target="_blank" style="color:#4b5563;text-decoration:none;font-weight:700">' + escapeHtml(c.customBrandName) + '</a>';
            poweredEl.style.display = 'block';
          }
        }
      }).catch(function () {});
  }
  if (cfg.color) applyTheme(cfg.color);
  initConfig();

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

  function addMsg(text, who, senderName) {
    var d = document.createElement('div');
    d.className = 'aichat-msg aichat-' + who;
    var contentHtml = render(text);
    if (who === 'bot') {
      var bName = senderName || currentBotName || 'Nova AI';
      d.innerHTML = '<div class="aichat-sender-tag">⚡ ' + escapeHtml(bName) + '</div>' + contentHtml;
    } else if (who === 'agent') {
      var aName = senderName || 'Support Agent';
      d.innerHTML = '<div class="aichat-sender-tag agent">🧑‍💼 ' + escapeHtml(aName) + '</div>' + contentHtml;
    } else {
      d.innerHTML = contentHtml;
    }
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
    card.style.background = '#ffffff';
    card.style.border = '1px solid #e5e7eb';
    card.style.borderRadius = '12px';
    card.style.padding = '14px';
    card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
    card.innerHTML =
      '<div style="font-weight:700;margin-bottom:6px;color:#111827;font-size:14px">Please introduce yourself:</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">' +
        '<input type="email" class="tidio-email" placeholder="Enter your email..." style="padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13.5px;outline:none;width:100%">' +
        '<div style="display:flex;gap:8px;margin-top:4px;align-items:center">' +
          '<button class="tidio-submit" style="flex:1;background:' + themeColor + ';color:#fff;border:none;border-radius:8px;padding:9px;font-size:13px;cursor:pointer;font-weight:600">Send</button>' +
          '<button class="tidio-skip" style="background:none;border:none;color:#6b7280;font-size:12px;cursor:pointer;padding:0 6px">Skip</button>' +
        '</div>' +
      '</div>';
    msgsEl.appendChild(card);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var emailIn = card.querySelector('.tidio-email');
    var submitBtn = card.querySelector('.tidio-submit');
    var skipBtn = card.querySelector('.tidio-skip');

    submitBtn.onclick = function () {
      var em = emailIn.value.trim();
      if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        emailIn.style.borderColor = '#ef4444';
        return;
      }
      card.innerHTML = '<i>✓ Thanks! Connecting you now...</i>';
      leadDone = true;
      try { localStorage.setItem('aichat_lead_done', '1'); } catch (e) {}
      fetch(server + '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Site-Id': siteId },
        body: JSON.stringify({ sessionId: sessionId, siteId: siteId, name: em.split('@')[0], email: em })
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
    }).then(function (r) {
      if (!r.ok) throw new Error('status_' + r.status);
      return r.json();
    }).then(function (data) {
      typing.remove();
      sendBtn.disabled = false;
      if (data.reply) addMsg(data.reply, 'bot');
      else addMsg('We offer full digital & web services! How can we help you with your project today?', 'bot');
    }).catch(function () {
      typing.remove();
      sendBtn.disabled = false;
      addMsg('We offer complete web design, development, and SEO services! Feel free to leave your email or click "Talk to a human" to connect with our team.', 'bot');
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
      if (msg.type === 'agent-joined') {
        humanOnline = true;
        statusEl.textContent = 'Agent connected';
        addMsg('A live support agent has joined the conversation.', 'agent');
      } else if (msg.type === 'agent-message') {
        if (msg.text && msg.text !== lastBotText) {
          lastBotText = msg.text;
          addMsg(msg.text, 'agent');
        }
      } else if (msg.type === 'bot-reply') {
        if (msg.text && msg.text !== lastBotText) {
          lastBotText = msg.text;
          addMsg(msg.text, 'bot');
        }
      }
    };
  }

  function toggle() {
    var isOpen = widget.classList.contains('open');
    if (isOpen) {
      widget.classList.remove('open');
      btn.innerHTML = iconChat;
    } else {
      widget.classList.add('open');
      btn.innerHTML = iconClose;
      if (!ws) openWs();
      if (!msgsEl.children.length) {
        addBot(remoteGreeting || cfg.greeting || 'Hi there 👋 We are currently offline, but if you need any assistance, feel free to ask. We will reply as soon as possible.');
        quickReplies();
      }
    }
  }

  btn.onclick = toggle;
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
      addBot(d.humanOnline ? 'A human agent has joined the chat. 👨‍💼' : "Currently, the team is unavailable, so I can't connect you. 😔 I've passed along your message to our team, and they will contact you as soon as possible.");
    }).catch(function () {
      addBot("Currently, the team is unavailable, so I can't connect you. 😔 I've passed along your message to our team, and they will contact you as soon as possible.");
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