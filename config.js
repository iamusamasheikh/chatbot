'use strict';

const path = require('path');

const config = {
  // Server
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',

  // Public URL of this server. Used by the widget to reach the API.
  // For local testing: http://localhost:3000
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',

  // How to enable AI (free, no money needed):
  llm: {
    //   1. Set OPENROUTER_API_KEY to your free key (https://openrouter.ai/keys)
    //   2. Set LLM_MODEL to any available (free) model.
    // Free `:free` models change over time — if a model 404s, pick a new one
    // from https://openrouter.ai/models?q=free .
    //   poolside/laguna-s-2.1:free                  (good, concise — default)
    //   openrouter/free                             (auto-picks an available free model)
    //   openai/gpt-oss-20b:free
    //   google/gemma-4-31b-it:free
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
    // OpenRouter (free models) — change to your own provider if needed.
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '700', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.4'),
    // Optional custom HTTP headers for OpenRouter (proxied/referral, etc.)
    extraHeaders: {},
    timeoutMs: 30000
  },

  // Lead email notifications (optional). Requires SMTP credentials (e.g. Gmail app password,
  // SendGrid, etc.). If SMTP_HOST is empty, email alerts are disabled (webhooks still work).
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost',
    // Where lead notifications go (default: the site owner's account email).
    to: process.env.LEAD_NOTIFY_TO || '',
    subject: process.env.LEAD_NOTIFY_SUBJECT || 'New lead captured'
  },

  // Chatbot personality & system prompt.
  bot: {
    name: process.env.BOT_NAME || 'Site Assistant',
    greeting: process.env.BOT_GREETING || 'Hi there! 👋 How can I help you today?',
    offlineGreeting: process.env.BOT_OFFLINE_GREETING || 'Hi! 👋 Our AI assistant can answer instantly. Need a human? We will reply as soon as possible.',
    systemPrompt: process.env.SYSTEM_PROMPT ||
      'You are the official AI representative and customer support assistant for "{site_name}".\n' +
      'COMMUNICATION TONE & PERSPECTIVE RULES:\n' +
      '1. ALWAYS speak in the FIRST-PERSON perspective using "We", "Our team", or "I" (e.g., "We offer WordPress development", "Our team can help you build your website", "I would be happy to assist you"). NEVER refer to {site_name} or the owner in the third person (do NOT say "{site_name} offers..." or "Usama Sheikh is..."). Speak naturally as part of the team!\n' +
      '2. If a visitor asks off-topic or unrelated questions (such as weather reports, recipes, sports, or random trivia), politely DECLINE by stating: "We are dedicated to helping you with our services at {site_name}. I can\'t answer off-topic questions like weather, but feel free to ask me anything about our business!"\n' +
      '3. For relevant inquiries, provide warm, natural, and helpful answers using the website knowledge context provided below.\n' +
      '4. For greetings ("hi", "hello", "salam"), welcome the visitor warmly on behalf of our team and ask how we can help them today.'
  },

  // Training / crawl target. siteId namespaces data per website (multi-site).
  training: {
    siteId: process.env.TRAIN_SITE_ID || 'default',
    startUrl: process.env.TRAIN_URL || '',
    maxPages: parseInt(process.env.TRAIN_MAX_PAGES || '30', 10),
    // Only URLs matching these are followed (keep your site scope).
    allowExternal: false,
    chunkSize: 900,
    chunkOverlap: 120,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    requestTimeoutMs: 15000
  },

  // Data storage
  paths: {
    root: __dirname,
    data: path.join(__dirname, 'data'),
    knowledgeFile: path.join(__dirname, 'data', 'knowledge.json'),
    chatsFile: path.join(__dirname, 'data', 'chats.json'),
    leadsFile: path.join(__dirname, 'data', 'leads.json'),
    analyticsFile: path.join(__dirname, 'data', 'analytics.json')
  }
};

module.exports = config;
