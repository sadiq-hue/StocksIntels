const axios = require('axios');
const cheerio = require('cheerio');
const { pool } = require('./db');
const { fetchMarketIntel } = require('./mystocksAfricaApi');

const NEWS_API = process.env.NEWS_API_URL || 'http://localhost:3001';
const BLOG_INGEST_INTERVAL_MS = parseInt(process.env.BLOG_INGEST_INTERVAL_MS || '3600000', 10); // 1 hour default

function slugify(text) {
  return (text || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

async function dedupCheck(sourceUrl, sourceId) {
  const { rows } = await pool.query(
    'SELECT id FROM blog_posts WHERE source_url = $1 OR source_id = $2 LIMIT 1',
    [sourceUrl, sourceId]
  );
  return rows.length > 0;
}

async function insertPost({ title, slug, excerpt, body, source, sourceUrl, sourceId, category, author, publishedAt, featuredImage, status }) {
  const finalSlug = slug + '-' + Date.now().toString(36);
  const { rows } = await pool.query(
    `INSERT INTO blog_posts (title, slug, excerpt, body, source, source_url, source_id, category, author, published_at, featured_image, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [title, finalSlug, excerpt, body, source, sourceUrl, sourceId, category || 'Market Analysis', author || 'StocksIntels Team', publishedAt || new Date(), featuredImage || null, status || 'published']
  );
  return rows[0]?.id;
}

async function fetchArticleBody(url) {
  if (!url) return null;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      maxRedirects: 5,
    });
    const $ = cheerio.load(resp.data);
    $('script, style, nav, header, footer, .sidebar, .ad, .advertisement, .social-share').remove();
    const article = $('article').length ? $('article') : $('main').length ? $('main') : $('body');
    const text = article.text().replace(/\s+/g, ' ').trim();
    return text.length > 200 ? text.slice(0, 5000) : null;
  } catch {
    return null;
  }
}

// ─── Source: MyStocks Africa Market Intel (highest quality) ──────────────────

async function ingestMyStocksIntel() {
  let ingested = 0;
  try {
    const articles = await fetchMarketIntel(null, 20);
    if (!articles || !Array.isArray(articles)) return 0;

    for (const a of articles) {
      const sourceUrl = a.url || (a.slug ? `https://mystocks.africa/market-intel/${a.slug}` : null);
      const sourceId = `mystocks-intel-${a.id || a.slug}`;
      if (await dedupCheck(sourceUrl, sourceId)) continue;

      let body = a.body || a.content || null;
      if (!body && sourceUrl) body = await fetchArticleBody(sourceUrl);

      const id = await insertPost({
        title: a.title,
        slug: slugify(a.title),
        excerpt: a.summary || a.description || (body ? body.slice(0, 300) : ''),
        body,
        source: a.source || 'MyStocks Africa',
        sourceUrl,
        sourceId,
        category: a.category || 'Market Intel',
        author: a.author || 'MyStocks Africa',
        publishedAt: a.publishedAt || a.createdAt || new Date(),
        featuredImage: a.imageUrl || null,
        status: 'published',
      });
      if (id) ingested++;
    }
  } catch (e) {
    console.error('[blogIngest] MyStocks intel error:', e.message);
  }
  return ingested;
}

// ─── Source: MyStocks Africa Company News ────────────────────────────────────

async function ingestMyStocksCompanyNews() {
  let ingested = 0;
  const tracked = ['SCOM.KE', 'EQTY.KE', 'KCB.KE', 'ABSA.NSE', 'COOP.NSE', 'KUKZ.NSE', 'NCBA.NSE', 'EABL.NSE', 'DTK.NSE'];
  try {
    const { getQuoteForSymbol } = require('./mystocksAfricaApi');
    for (const sym of tracked) {
      try {
        const resp = await axios.get(`https://mystocks.africa/api/v1/partner/companies/${sym}/news`, {
          timeout: 8000,
          headers: {
            Authorization: `Bearer ${process.env.MYSTOCKS_AFRICA_API_KEY}`,
            Accept: 'application/json',
          },
          params: { limit: 5 },
        });
        const items = resp.data?.items || resp.data?.data || resp.data || [];
        if (!Array.isArray(items)) continue;

        for (const a of items) {
          const sourceUrl = a.url || a.sourceUrl || null;
          const sourceId = `mystocks-company-${sym}-${a.id || slugify(a.title)}`;
          if (await dedupCheck(sourceUrl, sourceId)) continue;

          let body = a.body || a.content || null;
          if (!body && sourceUrl) body = await fetchArticleBody(sourceUrl);

          const id = await insertPost({
            title: a.title || `${sym} Update`,
            slug: slugify(a.title || sym),
            excerpt: a.summary || a.description || (body ? body.slice(0, 300) : ''),
            body,
            source: 'MyStocks Africa',
            sourceUrl,
            sourceId,
            category: a.type === 'CORPORATE_ACTION' ? 'Corporate Action' : 'Company News',
            author: 'MyStocks Africa',
            publishedAt: a.publishedAt || a.createdAt || new Date(),
            featuredImage: a.imageUrl || null,
            status: 'published',
          });
          if (id) ingested++;
        }
      } catch {}
    }
  } catch (e) {
    console.error('[blogIngest] MyStocks company news error:', e.message);
  }
  return ingested;
}

// ─── Source: NewsService aggregated sources (Benzinga, RSS, Kenyan WS, etc.) ─

async function ingestNewsService() {
  let ingested = 0;
  try {
    const newsService = require('./newsService');
    const articles = await newsService.getAllNews(50);
    if (!articles || !Array.isArray(articles)) return 0;

    for (const a of articles) {
      const sourceUrl = a.url || null;
      const sourceId = `news-${a.source}-${slugify(a.headline)}`;
      if (await dedupCheck(sourceUrl, sourceId)) continue;

      const id = await insertPost({
        title: a.headline,
        slug: slugify(a.headline),
        excerpt: a.excerpt || '',
        body: a.excerpt || null,
        source: a.source || 'Financial News',
        sourceUrl,
        sourceId,
        category: a.category || 'Financial News',
        author: a.source || 'Financial News',
        publishedAt: a.publishedAt || a.timestamp || new Date(),
        featuredImage: a.imageUrl || null,
        status: 'published',
      });
      if (id) ingested++;
    }
  } catch (e) {
    console.error('[blogIngest] NewsService error:', e.message);
  }
  return ingested;
}

// ─── Source: NSE Announcements ───────────────────────────────────────────────

async function ingestNSEAnnouncements() {
  let ingested = 0;
  try {
    const resp = await axios.get('https://www.nse.co.ke/listed-company-announcements/', {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      maxRedirects: 5,
    });
    const $ = cheerio.load(resp.data);

    const announcements = [];
    $('table tbody tr, .announcement-item, .entry-content tr').each((_, el) => {
      const tds = $(el).find('td');
      if (tds.length >= 3) {
        const title = $(tds[0]).text().trim() || $(tds[1]).text().trim();
        const company = $(tds[1]).text().trim() || $(tds[0]).text().trim();
        const date = $(tds[2]).text().trim();
        const link = $(tds[0]).find('a').attr('href') || $(tds[1]).find('a').attr('href') || null;
        if (title && title.length > 3) {
          announcements.push({ title, company, date, link: link ? (link.startsWith('http') ? link : `https://www.nse.co.ke${link}`) : null });
        }
      }
    });

    for (const a of announcements.slice(0, 20)) {
      const sourceUrl = a.link || 'https://www.nse.co.ke/listed-company-announcements/';
      const sourceId = `nse-announce-${slugify(a.title)}-${a.date}`;
      if (await dedupCheck(sourceUrl, sourceId)) continue;

      const id = await insertPost({
        title: a.company ? `${a.company}: ${a.title}` : a.title,
        slug: slugify(a.title),
        excerpt: `${a.company || ''} — ${a.title} (${a.date})`.trim(),
        body: null,
        source: 'NSE Kenya',
        sourceUrl,
        sourceId,
        category: 'Corporate Announcement',
        author: 'NSE Kenya',
        publishedAt: a.date ? new Date(a.date) : new Date(),
        featuredImage: null,
        status: 'published',
      });
      if (id) ingested++;
    }
  } catch (e) {
    console.error('[blogIngest] NSE announcements error:', e.message);
  }
  return ingested;
}

// ─── Main ingestion pipeline ─────────────────────────────────────────────────

async function runBlogIngestion() {
  console.log('[blogIngest] Starting ingestion cycle...');
  const start = Date.now();

  const [mStocksIntel, mStocksCompany, newsSvc, nse] = await Promise.allSettled([
    ingestMyStocksIntel(),
    ingestMyStocksCompanyNews(),
    ingestNewsService(),
    ingestNSEAnnouncements(),
  ]);

  const extract = r => r.status === 'fulfilled' ? r.value : 0;
  const totals = {
    mystocks_intel: extract(mStocksIntel),
    mystocks_company: extract(mStocksCompany),
    news_service: extract(newsSvc),
    nse_announcements: extract(nse),
  };
  const total = Object.values(totals).reduce((a, b) => a + b, 0);

  console.log(`[blogIngest] Done in ${((Date.now() - start) / 1000).toFixed(1)}s — ${total} new posts:`, totals);
  return { total, totals, durationMs: Date.now() - start };
}

let blogIngestTimer = null;

function startBlogIngestion(intervalMs = BLOG_INGEST_INTERVAL_MS) {
  if (blogIngestTimer) return;
  console.log(`[blogIngest] Scheduling ingestion every ${intervalMs / 60000} min`);
  runBlogIngestion().catch(e => console.error('[blogIngest] Initial run error:', e.message));
  blogIngestTimer = setInterval(() => {
    runBlogIngestion().catch(e => console.error('[blogIngest] Scheduled run error:', e.message));
  }, intervalMs);
}

function stopBlogIngestion() {
  if (blogIngestTimer) { clearInterval(blogIngestTimer); blogIngestTimer = null; }
}

module.exports = { runBlogIngestion, startBlogIngestion, stopBlogIngestion };
