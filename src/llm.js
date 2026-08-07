'use strict';

const https = require('https');
const http = require('http');
const config = require('../config');
const indexer = require('./indexer');
const store = require('./store');

function postJson(url, payload, headers = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const req = lib.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ ok: false, status: res.statusCode, data: raw });
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

function buildMessages(siteName, question, context, history) {
  const system = config.bot.systemPrompt.replace('{site_name}', siteName || 'this website');
  const contextBlock = context && context.length
    ? context.map((c, i) => `[${i + 1}] Source: ${c.title}\n${c.text}`).join('\n\n---\n\n')
    : '(no knowledge available)';
  const messages = [
    { role: 'system', content: `${system}\n\nWebsite knowledge:\n\n${contextBlock}` }
  ];
  if (Array.isArray(history) && history.length) {
    for (const m of history.slice(-6)) {
      if (!m.text) continue;
      messages.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text });
    }
  }
  messages.push({ role: 'user', content: question });
  return messages;
}

async function callCloud(messages) {
  if (!config.llm.apiKey) {
    throw new Error('No API key configured (set OPENROUTER_API_KEY).');
  }
  const url = `${config.llm.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await postJson(url, {
    model: config.llm.model,
    messages,
    max_tokens: config.llm.maxTokens,
    temperature: config.llm.temperature
  }, {
    Authorization: `Bearer ${config.llm.apiKey}`,
    ...config.llm.extraHeaders
  }, config.llm.timeoutMs);

  if (!res.ok) {
    const err = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    throw new Error(`LLM API error (${res.status}): ${err.slice(0, 400)}`);
  }
  const text = res.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM returned empty response');
  return text.trim();
}

// Zero-cost local fallback: answer straight from the knowledge base.
function localAnswer(question, siteId) {
  const qLower = (question || '').toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'salam', 'halo', 'good morning', 'good evening', 'namaste', 'help', 'who are you', 'what can you do'];
  if (greetings.includes(qLower) || qLower === 'hi!' || qLower === 'hello!') {
    return 'Hi there! 👋 How can I help you today? Feel free to ask me any question about our website or services!';
  }

  if (qLower.includes('owner') || qLower.includes('founder') || qLower.includes('who owns')) {
    return 'Our team would be glad to connect you directly with management! You can leave your contact details here or click "Talk to a human" to chat live.';
  }

  if (qLower.includes('email') || qLower.includes('contact') || qLower.includes('phone') || qLower.includes('reach')) {
    return 'You can leave your contact info right here in the chat, and our support team will get in touch with you shortly!';
  }

  const kb = store.getKnowledge(siteId);
  if (!kb.indexed || !kb.chunks || !(kb.chunkCount || (kb.chunks.docs && kb.chunks.docs.length))) {
    return 'Hi! 👋 I am currently learning about this website. How can I help you today?';
  }
  const hits = indexer.search(kb.chunks, question, 1);
  if (!hits.length) {
    return 'I would love to help with that! Feel free to leave your contact info or click "Talk to a human" to connect with our support team!';
  }
  const top = hits[0];
  return top.text;
}

async function ask(siteId, siteName, question, context, history, preferLocal = false) {
  const messages = buildMessages(siteName, question, context, history);
  if (preferLocal) return { answer: localAnswer(question, siteId), mode: 'local' };

  try {
    const answer = await callCloud(messages);
    return { answer, mode: 'ai' };
  } catch (e) {
    console.warn('[llm] cloud failed, using local fallback:', e.message);
    return { answer: localAnswer(question, siteId), mode: 'local' };
  }
}

module.exports = { ask, callCloud, localAnswer, buildMessages };
