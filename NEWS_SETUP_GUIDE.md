# Environment Configuration for Real-Time News Fetching

To enable real-time news fetching in the News tab, you need to set up API keys from news providers.

## Required API Keys

### Option 1: NewsAPI (Recommended - Easy Setup)
1. Go to https://newsapi.org/
2. Sign up for a free account
3. Copy your API key
4. Add to `.env.local`:
   ```
   VITE_NEWSAPI_KEY=your_newsapi_key_here
   ```

### Option 2: Finnhub (Financial News)
1. Go to https://finnhub.io/
2. Sign up for a free account
3. Copy your API key
4. Add to `.env.local`:
   ```
   VITE_FINNHUB_KEY=your_finnhub_key_here
   ```

### Option 3: NewsData.io
1. Go to https://newsdata.io/
2. Sign up for a free account
3. Copy your API key
4. Add to `.env.local`:
   ```
   VITE_NEWSDATA_KEY=your_newsdata_key_here
   ```

### Option 4: Combined (Recommended for Complete Coverage)
Add multiple keys for comprehensive news coverage:
```
VITE_NEWSAPI_KEY=your_newsapi_key_here
VITE_FINNHUB_KEY=your_finnhub_key_here
```

## Setup Steps

1. Create a `.env.local` file in the root of your project (next to package.json)

2. Add your API keys:
   ```
   VITE_NEWSAPI_KEY=sk_test_xxxxx
   VITE_FINNHUB_KEY=c123456
   ```

3. Restart your dev server:
   ```
   npm run dev
   # or
   pnpm dev
   ```

4. Navigate to the News tab - you should now see real-time news articles

## Features

- **Real-time News**: Fetches latest news from multiple sources
- **Sentiment Analysis**: Automatically analyzes article sentiment (positive/negative/neutral)
- **Stock Filtering**: Identifies related stocks mentioned in articles
- **Multiple Categories**: 
  - All News: Shows all available news
  - NSE Specific: Focuses on Nairobi Securities Exchange news
  - Global Markets: International financial news
  - Trending: Trending positive sentiment articles
- **Refresh Button**: Manually refresh news at any time
- **Last Updated**: Shows when news was last fetched

## API Coverage

### NewsAPI
- General financial and stock market news
- Global coverage
- 10,000 requests/month (free tier)
- Multiple languages supported

### Finnhub
- Specialized financial news
- Market data and insights
- 60 API calls per minute (free tier)
- Focus on public companies

## Troubleshooting

**News not appearing?**
- Check that API keys are correctly added to `.env.local`
- Verify the file is in the root directory (not in src/)
- Restart the dev server after adding .env.local
- Check browser console for error messages

**Limited results?**
- Free tier API rates are limited. Consider upgrading or combining multiple APIs.
- Some news sources may have rate limits based on geographical region

**Performance issues?**
- News fetches happen on component mount and on refresh
- Consider adding caching if fetching too frequently

## Cost

- **NewsAPI**: Free tier available (10,000 requests/month)
- **Finnhub**: Free tier available (60 API calls/minute)
- Both offer paid tiers for higher limits

## Code Location

- News Service: `src/app/services/newsService.ts`
- News Page: `src/app/pages/NewsPage.tsx`
