(function () {
  var currentSite = null;
  var sitesCache = [];
  var live = {};
  var ws = null;
  var wsToken = '';

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  function req(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (opts.body) {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); }
      var contentType = r.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return r.text().then(function () {
          throw new Error('Server returned an invalid response (HTTP ' + r.status + ')');
        });
      }
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || 'HTTP error ' + r.status);
        return d;
      });
    });
  }

  /* ---- auth ---- */
  req('/api/auth/me').then(function (d) {
    var adminBtn = d.user.role === 'admin' ? ' <a href="/admin" class="btn small green" style="margin-left:8px;text-decoration:none;display:inline-flex;align-items:center;gap:4px">👑 Super Admin Panel</a>' : '';
    document.getElementById('uname').innerHTML = esc(d.user.name) + ' (' + esc(d.user.email) + ')' + adminBtn;
  });

  document.getElementById('logout').addEventListener('click', function () {
    req('/api/auth/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
  });

  /* ---- load user sites ---- */
  function loadSites() {
    return req('/api/my/sites').then(function (list) {
      sitesCache = list || [];
      var box = document.getElementById('siteList');
      if (!sitesCache.length) {
        box.innerHTML = '<div class="empty">No websites registered yet.</div>';
        currentSite = null;
        document.getElementById('noSite').style.display = 'block';
        document.getElementById('workspace').style.display = 'none';
        return;
      }
      document.getElementById('noSite').style.display = 'none';
      document.getElementById('workspace').style.display = 'block';
      if (!currentSite || !sitesCache.some(function (s) { return s.id === currentSite; })) {
        currentSite = sitesCache[0].id;
      }
      box.innerHTML = sitesCache.map(function (s) {
        var cls = s.id === currentSite ? 'site-item active' : 'site-item';
        return '<div class="' + cls + '" data-id="' + esc(s.id) + '">' +
                 '<div class="sname">' + esc(s.name || s.id) + '</div>' +
                 '<div class="sid">' + esc(s.siteUrl || s.id) + '</div>' +
               '</div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.site-item'), function (el) {
        el.addEventListener('click', function () {
          currentSite = el.getAttribute('data-id');
          loadSites();
        });
      });
      loadAll();
    }).catch(function () {
      document.getElementById('noSite').style.display = 'block';
      document.getElementById('workspace').style.display = 'none';
    });
  }

  document.getElementById('createSite').addEventListener('click', function () {
    var b = document.getElementById('newSiteBox');
    b.style.display = (b.style.display === 'none' || !b.style.display) ? 'flex' : 'none';
  });
  document.getElementById('nsSave').addEventListener('click', function () {
    var name = document.getElementById('nsName').value.trim();
    var url = document.getElementById('nsUrl').value.trim();
    if (!name) { alert('Enter a site name'); return; }
    req('/api/my/sites', { method: 'POST', body: { name: name, siteUrl: url } }).then(function (d) {
      if (d.error) { alert(d.error); return; }
      document.getElementById('nsName').value = ''; document.getElementById('nsUrl').value = '';
      document.getElementById('newSiteBox').style.display = 'none';
      currentSite = d.siteId; loadSites(); loadAll();
    }).catch(function (e) {
      alert('Could not save site: ' + e.message);
    });
  });

  /* ---- tabs ---- */
  var tabBtns = document.querySelectorAll('#tabs .nav-item');
  Array.prototype.forEach.call(tabBtns, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(tabBtns, function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var tabName = b.getAttribute('data-tab');
      var id = 'tab-' + tabName;
      document.getElementById('pageTitle').textContent = b.textContent.trim();
      Array.prototype.forEach.call(document.querySelectorAll('.tabcontent'), function (x) { x.classList.remove('active'); });
      document.getElementById(id).classList.add('active');
      if (tabName === 'live') connectAgent();
    });
  });

  /* ---- load per-site data ---- */
  function loadAll() {
    if (!currentSite) return;
    req('/api/my/sites/' + currentSite + '/summary').then(function (d) {
      document.getElementById('ovCards').innerHTML =
        '<div class="card-metric"><div class="num">' + d.analytics.sessions + '</div><div class="lbl">Sessions</div></div>' +
        '<div class="card-metric"><div class="num">' + d.analytics.messages + '</div><div class="lbl">Messages</div></div>' +
        '<div class="card-metric"><div class="num">' + d.analytics.liveChats + '</div><div class="lbl">Live chats</div></div>' +
        '<div class="card-metric"><div class="num">' + d.leads + '</div><div class="lbl">Leads</div></div>' +
        '<div class="card-metric"><div class="num">' + d.kb.chunks + '</div><div class="lbl">Knowledge chunks</div></div>';
      var st = document.getElementById('ovKbState');
      if (d.kb.indexed) st.innerHTML = ' <span class="badge ok">✓ Trained</span> ' + d.kb.chunks + ' chunks';
      else st.innerHTML = ' <span class="badge no">Not trained</span>';
      document.getElementById('ovKbInfo').textContent = d.kb.siteUrl ? (d.kb.siteName + ' — ' + d.kb.siteUrl) : 'Train the bot so it can answer about your site.';

      var scriptOrigin = location.origin;
      var code = '<script>window.AIChatConfig={siteId:"' + d.siteId + '",server:"' + scriptOrigin + '"};</script>\n' +
                 '<script src="' + scriptOrigin + '/widget.js" defer></script>';
      document.getElementById('embedCode').textContent = code;

      document.getElementById('trainUrl').value = d.siteUrl || '';
      document.getElementById('stName').value = d.siteName || '';
      document.getElementById('stUrl').value = d.siteUrl || '';
      document.getElementById('stGreeting').value = d.greeting || '';
      document.getElementById('stColor').value = d.themeColor || '#2563eb';
      document.getElementById('stWebhook').value = d.webhookUrl || '';
    });

    req('/api/my/sites/' + currentSite + '/conversations').then(function (d) {
      var box = document.getElementById('convBox');
      var keys = Object.keys(d.conversations || {});
      if (!keys.length) { box.innerHTML = '<div class="empty">No conversations yet.</div>'; return; }
      box.innerHTML = keys.map(function (k) {
        var c = d.conversations[k];
        var msgs = (c.messages || []).map(function (m) {
          var cls = m.sender === 'user' ? 'user' : m.sender === 'agent' ? 'agent' : '';
          return '<div class="msg ' + cls + '"><div class="meta">' + esc(m.sender) + ' · ' + esc(new Date(m.at).toLocaleString()) + '</div>' + esc(m.text) + '</div>';
        }).join('');
        return '<div style="margin-bottom:16px;padding:12px;border:1px solid #e2e8f0;border-radius:10px"><b>Session ' + esc(k) + '</b> <span class="empty">(' + esc(new Date(c.startedAt).toLocaleString()) + ')</span>' + msgs + '</div>';
      }).join('');
    }).catch(function () {
      var box = document.getElementById('convBox');
      if (box) box.innerHTML = '<div class="empty">No conversations yet.</div>';
    });

    req('/api/my/sites/' + currentSite + '/leads').then(function (d) {
      var box = document.getElementById('leadsBox');
      if (!d.leads || !d.leads.length) { box.innerHTML = '<div class="empty">No leads captured yet.</div>'; return; }
      box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th style="padding:8px">Name</th><th>Email</th><th>Phone</th><th>Message</th><th>Date</th></tr>' +
        d.leads.map(function (l) {
          return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px"><b>' + esc(l.name) + '</b></td><td><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a></td><td>' + esc(l.phone) + '</td><td>' + esc(l.message) + '</td><td>' + esc(new Date(l.at).toLocaleString()) + '</td></tr>';
        }).join('') + '</table>';
    }).catch(function () {
      var box = document.getElementById('leadsBox');
      if (box) box.innerHTML = '<div class="empty">No leads captured yet.</div>';
    });

    document.getElementById('exportCsv').href = '/api/my/sites/' + currentSite + '/leads/export';
  }

  /* ---- verify embed ---- */
  document.getElementById('btnVerifyEmbed').addEventListener('click', function () {
    var st = document.getElementById('embedVerifyStatus');
    st.innerHTML = 'Verifying live site HTML…';
    req('/api/my/sites/' + currentSite + '/verify-embed').then(function (d) {
      st.innerHTML = d.active ? '<span class="badge ok">' + esc(d.message) + '</span>' : '<span class="badge no">' + esc(d.message) + '</span>';
    }).catch(function (e) {
      st.innerHTML = '<span class="badge no">' + esc(e.message) + '</span>';
    });
  });

  /* ---- train ---- */
  document.getElementById('btnTrain').addEventListener('click', function () {
    var url = document.getElementById('trainUrl').value.trim();
    if (!url) { alert('Enter a site URL to crawl'); return; }
    var b = this; var info = document.getElementById('trainInfo');
    b.disabled = true; info.textContent = 'Starting training job…';
    req('/api/train?siteId=' + encodeURIComponent(currentSite), { method: 'POST', body: { url: url } }).then(function (d) {
      if (d.error) { alert(d.error); b.disabled = false; return; }
      pollTrain(b, info);
    }).catch(function (e) {
      alert('Training failed: ' + e.message); b.disabled = false;
    });
  });

  function pollTrain(b, info) {
    var timer = setInterval(function () {
      req('/api/my/sites/' + currentSite + '/train-status').then(function (j) {
        if (!j.running) {
          clearInterval(timer); b.disabled = false; b.textContent = '⚡ Start Training';
          if (j.error) { info.textContent = 'Training failed: ' + j.error; }
          else { loadAll(); info.textContent = 'Training done ✓ ' + j.total + ' pages indexed.'; }
        } else {
          info.textContent = 'Crawling… ' + j.done + ' pages fetched';
        }
      });
    }, 1500);
  }

  document.getElementById('stSave').addEventListener('click', function () {
    var body = {
      name: document.getElementById('stName').value.trim(),
      siteUrl: document.getElementById('stUrl').value.trim(),
      greeting: document.getElementById('stGreeting').value.trim(),
      themeColor: document.getElementById('stColor').value,
      webhookUrl: document.getElementById('stWebhook').value.trim()
    };
    req('/api/my/sites/' + currentSite, { method: 'POST', body: body }).then(function (d) {
      if (d.ok) { loadSites(); loadAll(); alert('Settings saved successfully!'); }
    });
  });

  document.getElementById('stTestEmail').addEventListener('click', function () {
    var btn = this; var status = document.getElementById('stEmailStatus');
    btn.disabled = true; status.textContent = 'Dispatched test email...';
    req('/api/my/sites/' + currentSite + '/test-email', { method: 'POST' }).then(function (d) {
      btn.disabled = false;
      if (d.ok) { status.style.color = '#059669'; status.textContent = d.message; }
      else { status.style.color = '#dc2626'; status.textContent = d.error || 'Failed to send'; }
    }).catch(function (e) {
      btn.disabled = false; status.style.color = '#dc2626'; status.textContent = e.message;
    });
  });

  /* ---- live chat agent ---- */
  function connectAgent() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) ws.close();
    req('/api/auth/token').then(function (d) {
      wsToken = d.token;
      var wu = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + wsToken;
      ws = new WebSocket(wu);
      ws.onopen = function () {
        var agentId = document.getElementById('agentId').value.trim() || document.getElementById('uname').textContent.split(' (')[0];
        ws.send(JSON.stringify({ type: 'agent-hello', siteId: currentSite, agentId: agentId }));
        document.getElementById('agentStatus').innerHTML = '<span class="badge ok">● Online</span>';
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'error') { document.getElementById('agentStatus').innerHTML = '<span class="badge no">' + esc(m.message) + '</span>'; }
        else if (m.type === 'initial-messages' && m.siteId === currentSite) {
          (m.conversations || []).forEach(function (c) {
            (c.messages || []).forEach(function (msg) {
              var who = msg.sender === 'user' ? 'user' : msg.sender === 'agent' ? 'author' : 'sys';
              addLive(c.sessionId, c.name, msg.text, who);
            });
          });
        }
      };
    });
  }

  function addLive(sid, name, text, who) {
    var box = document.getElementById('liveBox');
    var d = document.createElement('div');
    d.className = 'msg ' + who;
    d.innerHTML = '<div class="meta">[' + esc(sid) + '] ' + esc(name || 'Visitor') + '</div>' + esc(text);
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    var sel = document.getElementById('liveSession');
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === sid; })) {
      var opt = document.createElement('option'); opt.value = sid; opt.textContent = (name || sid); sel.appendChild(opt);
    }
  }

  document.getElementById('goOnline').addEventListener('click', connectAgent);
  document.getElementById('sendReply').addEventListener('click', function () {
    var sid = document.getElementById('liveSession').value;
    var text = document.getElementById('agentReply').value.trim();
    if (!sid || !text) return;
    if (!ws || ws.readyState !== 1) { alert('Not connected. Click "Go online" first.'); return; }
    ws.send(JSON.stringify({ type: 'agent-reply', sessionId: sid, text: text }));
    addLive(sid, 'Agent', text, 'agent');
    document.getElementById('agentReply').value = '';
  });

  loadSites();
})();
