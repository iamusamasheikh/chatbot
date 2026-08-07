'use strict';

const config = require('../config');
const store = require('../src/store');
const scraper = require('../src/scraper');
const indexer = require('../src/indexer');

function args(cli) {
  const out = {};
  for (let i = 2; i < cli.length; i++) {
    if (cli[i] === '--url') out.url = cli[i + 1];
    else if (cli[i] === '--site-id') out.siteId = cli[i + 1];
    else if (cli[i] === '--site-name') out.siteName = cli[i + 1];
    else if (cli[i] === '--max-pages') out.maxPages = parseInt(cli[i + 1], 10);
    else if (cli[i] === '--watch') out.watch = true;
  }
  return out;
}

async function run() {
  const a = args(process.argv);
  const url = a.url || config.training.startUrl;
  const siteId = store.addSite(a.siteId || config.training.siteId || 'default', a.siteName || a.siteId || 'default');
  if (a.maxPages) config.training.maxPages = a.maxPages;
  if (!url) {
    console.error('Provide a URL:  npm run train -- --url https://your-site.com --site-id mysite');
    process.exit(1);
  }

  console.log(`Crawling ${url} (site: ${siteId}) ...`);
  const crawled = await scraper.crawl(url);
  const pages = [...crawled.values()].filter((p) => !p.error && p.text);
  console.log(`\nFound ${crawled.size} pages, ${pages.length} with useful text.`);

  const built = indexer.buildIndex(pages);
  const kb = {
    siteName: a.siteName || new URL(url).hostname,
    siteUrl: url,
    trainedAt: new Date().toISOString(),
    pages: crawled.size,
    indexed: true,
    chunks: built
  };
  store.saveKnowledge(siteId, kb);
  console.log(`Trained ${built.chunkCount} text chunks for "${siteId}". Ready!`);
}

(async () => {
  const a = args(process.argv);
  await run();
  if (a.watch) {
    const interval = setInterval(async () => {
      console.log('\nRe-crawling...');
      await run();
    }, 6 * 60 * 60 * 1000); // every 6h
    process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });
  }
})();