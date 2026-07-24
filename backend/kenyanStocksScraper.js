const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://kenyanstocks.com/events';
const SCRAPE_TIMEOUT = 20000;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MONTHS = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11,
};

let eventsCache = [];
let eventsCacheTime = 0;

async function scrapeEvents() {
  const now = Date.now();
  if (eventsCache.length > 0 && (now - eventsCacheTime) < CACHE_TTL) {
    return eventsCache;
  }

  try {
    const response = await axios.get(BASE_URL, {
      timeout: SCRAPE_TIMEOUT,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(response.data);
    const events = [];

    // Extract year from the period header (e.g., "July 2026")
    let currentYear = new Date().getFullYear();
    const periodText = $('.current-period span').first().text().trim();
    const yearMatch = periodText.match(/\d{4}/);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[0], 10);
    }

    // Parse each date group
    $('.date-group').each((_, dateGroup) => {
      const $group = $(dateGroup);
      const dayText = $group.find('.date-header .day').text().trim();
      // dayText is like "Jul 23"
      const dayParts = dayText.split(' ');
      if (dayParts.length < 2) return;
      const monthName = dayParts[0];
      const dayNum = parseInt(dayParts[1], 10);
      const monthIndex = MONTHS[monthName];
      if (monthIndex === undefined || isNaN(dayNum)) return;

      const eventDate = new Date(currentYear, monthIndex, dayNum);
      const dateStr = `${currentYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

      // Parse each event card in this date group
      $group.find('.event-card').each((_, card) => {
        const $card = $(card);
        const symbol = $card.find('.symbol').text().trim().toUpperCase();
        const companyName = $card.find('.company-name').text().trim();
        const message = $card.find('.event-message').text().trim();
        const typeBadge = $card.find('.event-type-badge').text().trim().toLowerCase();
        const exchange = $card.find('.exchange').text().trim().toUpperCase();

        if (!symbol || !dateStr) return;

        // Map event type
        let eventType = 'other';
        if (typeBadge === 'earnings') eventType = 'earnings';
        else if (typeBadge === 'dividend') eventType = 'dividend';
        else if (typeBadge === 'filings') eventType = 'filings';

        events.push({
          symbol,
          companyName,
          date: dateStr,
          eventType,
          message,
          exchange,
          source: 'kenyanstocks',
        });
      });
    });

    // Also try to parse the sidebar "Today's Events" widget for additional data
    $('.overlay.events-widget .event-item').each((_, item) => {
      const $item = $(item);
      const symbol = $item.find('.event-symbol').text().trim().toUpperCase();
      const message = $item.find('.event-message').text().trim();
      const typeBadge = $item.find('.event-type-badge').text().trim().toLowerCase();
      if (!symbol) return;

      const today = new Date().toISOString().slice(0, 10);
      const exists = events.some(e => e.symbol === symbol && e.date === today && e.message === message);
      if (!exists) {
        let eventType = 'other';
        if (typeBadge === 'earnings') eventType = 'earnings';
        else if (typeBadge === 'dividend') eventType = 'dividend';

        events.push({
          symbol,
          companyName: '',
          date: today,
          eventType,
          message,
          exchange: 'NSE',
          source: 'kenyanstocks',
        });
      }
    });

    if (events.length > 0) {
      eventsCache = events;
      eventsCacheTime = now;
      console.log(`[KenyanStocks] Scraped ${events.length} events from kenyanstocks.com`);
    } else {
      console.log('[KenyanStocks] No events found in HTML, keeping previous cache');
    }

    return eventsCache;
  } catch (e) {
    console.error('[KenyanStocks] Scrape failed:', e.message);
    return eventsCache;
  }
}

function getEvents() {
  return eventsCache;
}

module.exports = { scrapeEvents, getEvents };
