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
  const system = config.bot.systemPrompt.replace(/\{site_name\}/g, siteName || 'this website');
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

// Intelligent local fallback: answers directly from knowledge base pages & smart Tidio-style fallbacks.
function localAnswer(question, siteId) {
  const qLower = (question || '').toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'salam', 'halo', 'good morning', 'good evening', 'namaste', 'help', 'who are you', 'what can you do'];
  if (greetings.includes(qLower) || qLower === 'hi!' || qLower === 'hello!') {
    return 'Hello! 👋 How can I help you today? Feel free to ask me any question about our services or business!';
  }

  if (qLower.includes('weather') || qLower.includes('recipe') || qLower.includes('sports score') || qLower.includes('cricket')) {
    return "I'm sorry, I'm only able to assist with questions related to our services and business. 😊 Is there anything else I can help you with regarding our services?";
  }

  if (qLower.includes('owner') || qLower.includes('founder') || qLower.includes('who owns')) {
    return "I don't have specific details about the owner's name available right now. Feel free to leave your contact details or click 'Talk to a human' to connect with our team directly!";
  }

  const kb = store.getKnowledge(siteId);
  const pages = kb.pages || [];
  
  // Look for service/about pages if asking about services
  if (qLower.includes('service') || qLower.includes('what do you do') || qLower.includes('offer') || qLower.includes('help me with')) {
    const servicePage = pages.find((p) => p.text && (p.url.includes('service') || p.url.includes('about') || p.title.toLowerCase().includes('service')));
    if (servicePage && servicePage.text.length > 30) {
      return servicePage.text.slice(0, 600) + '...\n\nWould you like to know more about any specific service?';
    }
  }

  if (kb.chunks && (kb.chunkCount || (kb.chunks.docs && kb.chunks.docs.length))) {
    const hits = indexer.search(kb.chunks, question, 2);
    if (hits.length) {
      return hits.map((h) => h.text).join('\n\n');
    }
  }

  // Fallback using any available page content
  if (pages.length && pages[0].text) {
    return pages[0].text.slice(0, 500) + '...\n\nIs there anything specific you would like to know more about?';
  }

  return "We offer complete digital and web services! Feel free to leave your contact info or click 'Talk to a human' so our team can help you directly!";
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
