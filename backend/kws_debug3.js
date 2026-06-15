const cheerio = require('cheerio');
const axios = require('axios');
(async()=>{
  // Try to find dates from KWS article pages or sitemap
  try {
    const r = await axios.get('https://kenyanwallstreet.com/', {timeout:15000, headers:{'User-Agent':'Mozilla/5.0'}});
    const $ = cheerio.load(r.data);
    // Check for structured data / JSON-LD
    var scripts = $('script[type="application/ld+json"]');
    console.log('JSON-LD scripts:', scripts.length);
    scripts.each(function() {
      try {
        var json = JSON.parse($(this).html());
        console.log('  json:', JSON.stringify(json).substring(0,200));
      } catch(e) {}
    });
    // Check for meta tags with date
    $('meta[property*="date"], meta[name*="date"], meta[itemprop*="date"]').each(function() {
      console.log('  date meta:', $(this).attr('property') || $(this).attr('name') || $(this).attr('itemprop'), '=', $(this).attr('content'));
    });
    // Check for sitemap link
    $('link[rel="sitemap"], a[href*="sitemap"]').each(function() {
      console.log('  sitemap:', $(this).attr('href'));
    });
    // See if there's article:published_time meta
    $('meta[property="article:published_time"]').each(function() {
      console.log('  article:published_time:', $(this).attr('content'));
    });
    // Check for schema.org/Article
    $('[itemscope][itemtype*="Article"]').each(function() {
      var dateEl = $(this).find('[itemprop="datePublished"]').first();
      if (dateEl.length) console.log('  itemprop datePublished:', dateEl.text().trim(), dateEl.attr('content') || '');
      var dateEl2 = $(this).find('[itemprop="dateModified"]').first();
      if (dateEl2.length) console.log('  itemprop dateModified:', dateEl2.text().trim(), dateEl2.attr('content') || '');
    });
    // RSS/feed links
    $('link[type="application/rss+xml"]').each(function() {
      console.log('  RSS feed:', $(this).attr('title'), '=', $(this).attr('href'));
    });
    console.log('  done');
  } catch(e) { console.error(e.message); }
})();
