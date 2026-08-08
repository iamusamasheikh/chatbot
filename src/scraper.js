'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config');

function normalizeUrl(url) {
  try {
    const u = new URL(url, config.training.startUrl || 'http://localhost');
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function fetchPage(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, {
      headers: {
        'User-Agent': config.training.userAgent,
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: config.training.requestTimeoutMs
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = normalizeUrl(new URL(res.headers.location, url).href);
        if (next) return resolve(fetchPage(next, redirectsLeft - 1));
        return resolve({ url, status: 404, html: '', error: 'bad redirect' });
      }
      if (status !== 200) {
        res.resume();
        return resolve({ url, status, html: '', error: 'HTTP ' + status });
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        resolve({ url, status, html });
      });
      res.on('error', () => resolve({ url, status: 0, html: '', error: 'stream error' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, html: '', error: 'timeout' }); });
    req.on('error', () => resolve({ url, status: 0, html: '', error: 'request error' }));
  });
}

function stripTags(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function collapse(s) {
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractText(html) {
  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? collapse(stripTags(titleMatch[1])) : '';

  // Meta description
  let description = '';
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
  if (metaMatch) description = collapse(metaMatch[1]);
  const metaMatch2 = html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  if (!metaMatch && metaMatch2) description = collapse(metaMatch2[1]);

  // Extract contacts (tel links, whatsapp links) before processing body
  const contacts = [];
  html.replace(/href=["'](tel:[^"']+|https?:\/\/(wa\.me|api\.whatsapp\.com)[^"']+)["']/gi, (m, link) => {
    contacts.push(`Contact / WhatsApp Link: ${link}`);
    return m;
  });

  // Preserve header, footer, nav (where contact info & WhatsApp buttons live)
  let body = html;

  // Headings
  const headings = [];
  body.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (m, inner) => {
    const t = collapse(stripTags(inner));
    if (t) headings.push(t);
    return m;
  });

  // Paragraphs, list items, table cells, address, footer, header, span
  const blocks = [];
  body.replace(/<(p|li|td|th|blockquote|figcaption|address|footer|header|span)[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    const t = collapse(stripTags(inner));
    if (t && t.length > 5) blocks.push(t);
    return m;
  });

  // Whole-body fallback text (for pages with few tags)
  const bodyText = collapse(stripTags(body));
  const parts = [title, description, ...contacts].filter(Boolean);
  parts.push(...headings, ...blocks);

  let text = parts.filter(Boolean).join('\n\n');
  if (text.split(' ').length < 60 && bodyText.split(' ').length > 80) {
    text = [title, description, ...contacts, bodyText].filter(Boolean).join('\n\n');
  }
  return { title, text };
}

function extractLinks(html, baseUrl) {
  const links = [];
  const base = new URL(baseUrl);
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      u.hash = '';
      if (u.protocol === 'http:' || u.protocol === 'https:') links.push(u.href);
    } catch { /* skip */ }
  }
  return links;
}

function inScope(url) {
  const start = config.training.startUrl;
  if (!start) return true;
  const su = new URL(start);
  const u = new URL(url);
  if (!config.training.allowExternal) return u.origin === su.origin;
  return true;
}

/* ---------- SPA (JavaScript-rendered) crawling, OPTIONAL ---------------
   Enable with env:  SPA_CRAWLER=true   (and `npm install puppeteer` first).
   Lazy-loads Puppeteer. If it isn't installed, seamlessly falls back to the
   fast HTTP parser. Handles React/Next.js/Vue/Angular sites whose text is
   generated by JavaScript in the browser. */
let spaBrowser = null;
let spaCrawlEnabled = false;
let spaWarned = false;

async function getSpaBrowser() {
  if (spaBrowser) return spaBrowser;
  try {
    const puppeteer = require('puppeteer');
    spaBrowser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return spaBrowser;
  } catch (e) {
    if (!spaWarned) {
      console.warn('[scraper] SPA_CRAWLER=true but puppeteer is not installed. Falling back to HTTP parser.');
      console.warn('  -> To enable SPA crawling:  npm install puppeteer');
      spaWarned = true;
    }
    return null;
  }
}

async function fetchPageSpa(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(config.training.userAgent);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: config.training.requestTimeoutMs });
    await new Promise((r) => setTimeout(r, 500)); // let async render settle
    const html = await page.content();
    return { url, status: 200, html };
  } catch (e) {
    return { url, status: 0, html: '', error: 'spa error: ' + e.message };
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchAny(url) {
  if (process.env.SPA_CRAWLER === 'true') {
    const browser = await getSpaBrowser();
    if (browser) return fetchPageSpa(browser, url);
  }
  return fetchPage(url);
}

async function crawl(startUrl, onProgress) {
  const maxPages = config.training.maxPages;
  const visited = new Map(); // url -> page info
  const queue = [normalizeUrl(startUrl)].filter(Boolean);
  const badExtensions = /\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|woff2?|mp4|mp3|xml|json)$/i;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url) || !inScope(url) || badExtensions.test(url)) continue;

    const { url: finalUrl, status, html, error } = await fetchAny(url);
    if (typeof onProgress === 'function') onProgress(visited.size);
    if (error || status !== 200 || !html) {
      if (finalUrl) visited.set(finalUrl, { url: finalUrl, error });
      continue;
    }

    const { title, text } = extractText(html);
    visited.set(finalUrl, { url: finalUrl, title, text, length: text.length, fetchedAt: new Date().toISOString() });
    console.log(`  crawled: ${finalUrl} (${text.length} chars)`);

    const links = extractLinks(html, finalUrl);
    for (const l of links) {
      if (!visited.has(l) && inScope(l) && !badExtensions.test(l) && queue.length + visited.size < maxPages) {
        queue.push(l);
      }
    }
  }
  return visited;
}

module.exports = { crawl, extractText, extractLinks, normalizeUrl };
