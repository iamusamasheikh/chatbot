'use strict';

const STOPWORDS = new Set(('the a an and or but if then else for of to in on at by with from is are was were be been being this that these those it its as not no yes do does did have has had will would can could should may might must about into over under again further once here there when where why how all any both each few more most other some such only own same so than too very s t just dont now also your you our their them they he she we us him her his hers its theirs your yours who whom which what whose while up down out off above below after before between during through via against nor per until upon').split(' '));

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, ' ')
    .split(/[\s\-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function countTerms(tokens) {
  const map = new Map();
  for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
  return map;
}

function chunkText(text, size, overlap) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + ' ' + p).length <= size) {
      current = current ? current + '\n\n' + p : p;
    } else {
      if (current) chunks.push(current);
      if (p.length > size) {
        // Break long paragraph into pieces
        let rest = p;
        while (rest.length > size) {
          let cut = rest.lastIndexOf(' ', size);
          if (cut < size * 0.6) cut = size;
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(Math.max(0, cut - overlap)).trim();
        }
        current = rest;
      } else {
        current = p;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length > 40);
}

function buildIndex(pages) {
  const chunks = [];
  for (const page of pages) {
    if (!page.text) continue;
    const parts = chunkText(page.text, 900, 120);
    parts.forEach((text, i) => {
      chunks.push({
        id: `${page.url}#${i}`,
        url: page.url,
        title: page.title || page.url,
        text
      });
    });
  }

  // Document frequency
  const docFreq = new Map();
  for (const c of chunks) {
    const terms = new Set(tokenize(c.text));
    for (const t of terms) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const N = chunks.length;
  const index = {
    builtAt: new Date().toISOString(),
    chunkCount: N,
    docs: chunks,
    docFreq: Object.fromEntries(docFreq),
    idf: {}
  };
  for (const [term, df] of docFreq) {
    index.idf[term] = Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }
  return index;
}

// BM25-style scoring with TF-IDF fallback. All local, free.
function search(index, query, topK = 5) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scores = [];
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];
    const terms = countTerms(tokenize(doc.text));
    let score = 0;
    for (const q of qTokens) {
      const idf = index.idf[q] || 0;
      if (!idf) continue;
      const tf = terms.get(q) || 0;
      if (!tf) continue;
      const k1 = 1.5, b = 0.75;
      const dl = tokenize(doc.text).length || 1;
      const avgdl = (index.avgdl) || dl;
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl))));
    }
    // Boost title matches
    const titleTerms = countTerms(tokenize(doc.title || ''));
    for (const q of qTokens) {
      if (titleTerms.has(q)) score += index.idf[q] * 1.5 || 0;
    }
    if (score > 0) scores.push({ doc, score });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map((s) => ({ ...s.doc, score: Math.round(s.score * 100) / 100 }));
}

module.exports = { buildIndex, search, tokenize, chunkText };
