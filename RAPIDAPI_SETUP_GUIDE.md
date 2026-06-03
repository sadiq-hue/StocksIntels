# RapidAPI Setup Guide for StocksIntels

This guide will help you configure RapidAPI to fetch real-time stock prices for the Nairobi Securities Exchange (NSE).

## Why RapidAPI?

RapidAPI provides reliable access to Yahoo Finance data through their unified API, offering better coverage and stability for NSE stocks compared to direct API calls.

## Step-by-Step Setup

### 1. Create a RapidAPI Account

1. Go to [RapidAPI](https://rapidapi.com/)
2. Click "Sign Up" and create an account (you can use Google, GitHub, or email)
3. Verify your email address

### 2. Subscribe to Yahoo Finance API

1. Search for "Yahoo Finance" in the RapidAPI marketplace
2. Select the **"Yahoo Finance15"** API (this is what we're using)
3. Choose a pricing plan:
   - **Basic**: Free tier with 100 requests/month (good for testing)
   - **Pro**: $29.99/month for 10,000 requests/month (recommended for development)
   - **Ultra**: $99.99/month for 50,000 requests/month (for production)

4. Click "Subscribe to Test" or "Subscribe" to get your API key

### 3. Get Your API Key

1. After subscribing, go to your RapidAPI dashboard
2. Navigate to "My Apps" or "APIs I'm Using"
3. Find "Yahoo Finance15" and copy your **X-RapidAPI-Key**

### 4. Configure StocksIntels Backend

1. Open `backend/.env` (or create it from `backend/.env.example`)
2. Set the following environment variables:

```env
MARKET_DATA_PROVIDER=rapidapi
RAPIDAPI_KEY=your_copied_api_key_here
RAPIDAPI_HOST=yahoo-finance15.p.rapidapi.com
```

3. Save the file

### 5. Restart Your Backend

```bash
cd backend
pnpm run dev
```

### 6. Verify Configuration

1. Start your backend server
2. Visit: `http://localhost:3001/api/market/provider-status`
3. You should see:

```json
{
  "provider": "rapidapi",
  "rapidapiConfigured": true,
  "twelvedataConfigured": false,
  "health": {
    "twelvedata": { "ok": false, "lastSuccessAt": null, "lastError": "Not configured" },
    "rapidapi": { "ok": true, "lastSuccessAt": "2026-04-26T...", "lastError": null }
  }
}
```

## Testing the Integration

### Test Individual Stock

Visit: `http://localhost:3001/api/stock/SCOM`

Expected response:
```json
{
  "symbol": "NSE:SCOM",
  "price": 28.5,
  "change": 0.4,
  "changePercent": 1.42,
  "volume": 15200000,
  "dayHigh": 28.7,
  "dayLow": 28.2,
  "previousClose": 28.1,
  "timestamp": 1714132800
}
```

### Test Market Snapshot

Visit: `http://localhost:3001/api/market/indices`

This should return all NSE indices with real-time data.

## NSE Stock Symbols Supported

The following NSE stocks are configured for RapidAPI:

### Individual Stocks
- **SCOM** - Safaricom PLC
- **EQTY** - Equity Group Holdings
- **KCB** - KCB Group PLC
- **EABL** - East African Breweries
- **ABSA** - Absa Bank Kenya
- **SBIC** - Stanbic Holdings
- **KLG** - Kenya Airways
- **OLYM** - Olympia Capital
- **CRAY** - Crown Paints Kenya
- **BAMB** - Bamburi Cement
- **UMEM** - Umeme Ltd
- **KPLC** - Kenya Power
- **NMG** - Nation Media Group
- **TOTL** - TotalEnergies Kenya
- **BRDR** - Bird's Broilers

### Market Indices
- **NSE20** - NSE 20 Share Index
- **NSEASI** - NSE All Share Index
- **NSE25** - NSE 25 Share Index
- **NSE15** - NSE 15 Index

## Troubleshooting

### Issue: "Missing RAPIDAPI_KEY"

**Solution**: Make sure you've set the `RAPIDAPI_KEY` environment variable in `backend/.env` and restarted your backend server.

### Issue: "Invalid numeric quote data"

**Possible causes**:
1. The stock symbol might not be available on Yahoo Finance
2. The API might be returning an error response
3. Your RapidAPI subscription might have expired

**Solution**: Check the RapidAPI dashboard for any API errors or subscription issues.

### Issue: "Provider unavailable" warnings

**Solution**: The system will automatically fall back to direct Yahoo Finance or synthetic data. Check your RapidAPI key and subscription status.

### Issue: Rate Limit Exceeded

**Solution**: If you're on the free tier, you may have exceeded your monthly quota. Consider upgrading to a paid plan or reducing the frequency of API calls.

## Alternative: Twelve Data API

If RapidAPI doesn't meet your needs, you can switch to Twelve Data:

1. Get an API key from [Twelve Data](https://twelvedata.com/)
2. Update `backend/.env`:

```env
MARKET_DATA_PROVIDER=twelvedata
TWELVE_DATA_API_KEY=your_twelve_data_key_here
```

3. Restart your backend

## Best Practices

1. **Keep your API key secure**: Never commit your `.env` file to version control
2. **Monitor usage**: Check your RapidAPI dashboard regularly to avoid unexpected charges
3. **Use caching**: The application already implements quote caching to minimize API calls
4. **Handle errors gracefully**: The system falls back to synthetic data if RapidAPI fails

## Cost Considerations

- **Free Tier**: 100 requests/month (sufficient for development/testing)
- **Pro Tier**: $29.99/month for 10,000 requests (recommended for active development)
- **Ultra Tier**: $99.99/month for 50,000 requests (for production with many users)

Each market data request (stock price, indices, etc.) counts as one API call. The application makes batch requests to minimize usage.

## Support

If you encounter issues:
1. Check the RapidAPI documentation for Yahoo Finance
2. Review the StocksIntels logs for error messages
3. Visit the RapidAPI community forum
4. Check the StocksIntels GitHub issues

## Additional Resources

- [RapidAPI Documentation](https://docs.rapidapi.com/docs)
- [Yahoo Finance API on RapidAPI](https://rapidapi.com/community/api/yahoo-finance15)
- [StocksIntels README](./README.md)

---

**Note**: This integration uses the Yahoo Finance API through RapidAPI. The availability and accuracy of NSE data depends on Yahoo Finance's coverage of the Nairobi Securities Exchange.