const cheerio = require('cheerio');
const axios = require('axios');
(async()=>{
  const r = await axios.get('https://kenyanwallstreet.com/', {timeout:15000, headers:{'User-Agent':'Mozilla/5.0'}});
  const $ = cheerio.load(r.data);
  // Look for article containers to find timestamp pattern
  var i = 0;
  $('article, .post, .entry, [class*=post], [class*=entry], div[class*=grid] > div, div[class*=row] > div').each(function() {
    var link = $(this).find('a').first();
    var href = link.attr('href');
    if (!href || !href.match(/^\/[a-z0-9-]+$/)) return;
    var img = $(this).find('img[alt]').first();
    var title = img.attr('alt');
    if (!title || title.length < 10) return;
    // Get ALL text classes and content
    var allClasses = $(this).find('*').map(function() { return $(this).attr('class'); }).get().filter(Boolean).join(', ');
    // Check for date patterns in all text
    var allText = $(this).text().trim();
    // Find anything that looks like a date or relative time
    var datePatterns = allText.match(/\d+\s+(minute|hour|day|week|month|second|h|m|d|s)\s+ago/gi) || [];
    var fullDatePatterns = allText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+[^,]*/gi) || [];
    var ts = $(this).find('span, time, small, div, p').filter(function() {
      var t = $(this).text().trim();
      return t && (t.match(/\d+\s+(minute|hour|day|week|month)\s+ago/i) || t.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)/i) || t.match(/^\d+\/\d+\/\d+/));
    }).first();
    console.log('Title:', title.substring(0,50));
    console.log('  href:', href);
    console.log('  datePatterns:', datePatterns);
    console.log('  fullDatePatterns:', fullDatePatterns);
    console.log('  matched ts element text:', JSON.stringify(ts.text().trim().substring(0,50)));
    console.log('  matched ts element class:', ts.attr('class') || 'N/A');
    console.log('  allClasses:', allClasses.substring(0,100));
    console.log('  ---');
    if (++i > 5) return false;
  });
})();
