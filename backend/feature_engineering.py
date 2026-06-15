"""Feature engineering: 60+ technical, fundamental, and market-relative features.
Pure numpy — no pandas dependency for raw computation."""

import numpy as np
from typing import List, Dict, Optional


def compute_rsi(prices: np.ndarray, period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = np.diff(prices[-period - 1:])
    gains = deltas[deltas > 0].sum()
    losses = -deltas[deltas < 0].sum()
    if losses == 0:
        return 100.0
    rs = gains / losses
    return float(100 - 100 / (1 + rs))


def compute_sma(prices: np.ndarray, period: int) -> float:
    if len(prices) < period:
        return float(prices[-1])
    return float(prices[-period:].mean())


def compute_ema(prices: np.ndarray, period: int) -> float:
    if len(prices) < period:
        return float(prices[-1])
    multiplier = 2 / (period + 1)
    ema = float(prices[:period].mean())
    for p in prices[period:]:
        ema = (p - ema) * multiplier + ema
    return ema


def compute_macd(prices: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> Dict:
    if len(prices) < slow:
        return {'macd': 0.0, 'signal': 0.0, 'histogram': 0.0}
    fast_ema = compute_ema(prices, fast)
    slow_ema = compute_ema(prices, slow)
    macd_line = fast_ema - slow_ema

    macd_series = np.array([
        compute_ema(prices[:i + 1], fast) - compute_ema(prices[:i + 1], slow)
        for i in range(slow - 1, len(prices))
    ])
    signal_line = float(np.mean(macd_series[-signal:])) if len(macd_series) >= signal else 0.0
    if len(macd_series) >= signal:
        sig = compute_ema(macd_series, signal)
    else:
        sig = 0.0
    histogram = macd_line - sig
    return {'macd': macd_line, 'signal': sig, 'histogram': histogram}


def compute_bollinger(prices: np.ndarray, period: int = 20, std_dev: float = 2.0) -> Dict:
    if len(prices) < period:
        mid = float(prices[-1])
        return {'upper': mid * 1.02, 'middle': mid, 'lower': mid * 0.98, 'width': 0.04, 'pct_b': 0.5}
    window = prices[-period:]
    middle = float(window.mean())
    std = float(window.std(ddof=0))
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    width = (upper - lower) / middle if middle != 0 else 0
    pct_b = (prices[-1] - lower) / (upper - lower) if upper != lower else 0.5
    return {'upper': upper, 'middle': middle, 'lower': lower, 'width': width, 'pct_b': max(0, min(1, pct_b))}


def compute_atr(prices: np.ndarray, period: int = 14) -> float:
    if len(prices) < period + 1:
        return float(np.std(np.diff(prices)) / np.mean(prices)) if len(prices) > 1 and np.mean(prices) > 0 else 0.02
    ranges = np.abs(np.diff(prices[-(period + 1):]))
    return float(ranges.mean() / prices[-1])


def compute_returns(prices: np.ndarray, periods: List[int]) -> Dict:
    result = {}
    curr = prices[-1]
    for p in periods:
        if len(prices) > p:
            result[f'return_{p}d'] = float((curr - prices[-p - 1]) / prices[-p - 1] * 100)
        else:
            result[f'return_{p}d'] = 0.0
    return result


def compute_volatility(prices: np.ndarray, periods: List[int]) -> Dict:
    result = {}
    for p in periods:
        if len(prices) > p + 1:
            result[f'volatility_{p}d'] = float(np.std(np.diff(prices[-(p + 1):])))
        else:
            result[f'volatility_{p}d'] = 0.0
    return result


def compute_price_position(prices: np.ndarray, period: int = 20) -> float:
    if len(prices) < period:
        return 0.5
    window = prices[-period:]
    low, high = window.min(), window.max()
    if high == low:
        return 0.5
    return float((prices[-1] - low) / (high - low))


def compute_all_features(
    prices: Optional[np.ndarray] = None,
    volumes: Optional[np.ndarray] = None,
    fundamentals: Optional[Dict] = None,
    sector_prices: Optional[np.ndarray] = None,
    market_prices: Optional[np.ndarray] = None,
) -> Dict:
    """Compute 60+ features from price, volume, and fundamental data."""
    features = {}

    if prices is None or len(prices) < 2:
        # Return default/neutral features when insufficient data
        for p in [1, 5, 10, 20, 50]:
            features[f'return_{p}d'] = 0.0
        for p in [5, 20]:
            features[f'volatility_{p}d'] = 0.0
        features['rsi_7'] = features['rsi_14'] = features['rsi_21'] = 50.0
        features['macd_12_26'] = features['macd_hist_12_26'] = 0.0
        features['macd_8_17'] = features['macd_hist_8_17'] = 0.0
        features['bb_pct_b_20_2'] = features['bb_pct_b_50_2_5'] = 0.5
        features['bb_width_20_2'] = 0.04
        features['atr_14'] = 0.02
        features['atr_ratio_14'] = 0.02
        features['sma_10'] = features['sma_50'] = features['sma_200'] = 0.0
        features['sma_ratio_10_50'] = 1.0
        features['price_position_20d'] = features['price_position_50d'] = 0.5
        features['max_10d'] = features['min_10d'] = 0.0
        features['range_10d'] = 0.0
        features['high_close_ratio_10d'] = features['low_close_ratio_10d'] = 1.0
        features['gap_from_high_50d'] = 0.0
        features['max_drawdown_20d'] = 0.0
        features['historical_var_95'] = 0.0
        features['volume_ratio_5'] = features['volume_ratio_20'] = 1.0
        features['volume_trend_5'] = 0.0
        features['dollar_volume'] = 0.0
        features['relative_return_1d'] = features['relative_return_5d'] = 0.0
        features['relative_volatility'] = 1.0
    else:
        p = np.array(prices, dtype=float)
        curr = p[-1]

        # --- Price returns ---
        features.update(compute_returns(p, [1, 5, 10, 20, 50]))

        # --- Volatility ---
        features.update(compute_volatility(p, [5, 20]))

        # --- Price extremes ---
        window_10 = p[-10:] if len(p) >= 10 else p
        window_50 = p[-50:] if len(p) >= 50 else p
        features['max_10d'] = float(window_10.max())
        features['min_10d'] = float(window_10.min())
        features['range_10d'] = float((window_10.max() - window_10.min()) / window_10.mean()) if window_10.mean() > 0 else 0
        features['high_close_ratio_10d'] = float(window_10.max() / curr) if curr > 0 else 1
        features['low_close_ratio_10d'] = float(window_10.min() / curr) if curr > 0 else 1
        features['gap_from_high_50d'] = float((window_50.max() - curr) / window_50.max()) if window_50.max() > 0 else 0

        # --- Price position ---
        features['price_position_20d'] = compute_price_position(p, 20)
        features['price_position_50d'] = compute_price_position(p, 50)

        # --- RSI ---
        features['rsi_7'] = compute_rsi(p, 7)
        features['rsi_14'] = compute_rsi(p, 14)
        features['rsi_21'] = compute_rsi(p, 21)

        # --- MACD ---
        macd_12_26 = compute_macd(p, 12, 26, 9)
        features['macd_12_26'] = macd_12_26['macd']
        features['macd_hist_12_26'] = macd_12_26['histogram']
        macd_8_17 = compute_macd(p, 8, 17, 9)
        features['macd_8_17'] = macd_8_17['macd']
        features['macd_hist_8_17'] = macd_8_17['histogram']

        # --- Bollinger Bands ---
        bb_20 = compute_bollinger(p, 20, 2.0)
        features['bb_pct_b_20_2'] = bb_20['pct_b']
        features['bb_width_20_2'] = bb_20['width']
        bb_50 = compute_bollinger(p, 50, 2.5)
        features['bb_pct_b_50_2_5'] = bb_50['pct_b']

        # --- Moving Averages ---
        features['sma_10'] = compute_sma(p, 10)
        features['sma_50'] = compute_sma(p, 50)
        features['sma_200'] = compute_sma(p, 200)
        sma_10 = features['sma_10']
        sma_50 = features['sma_50']
        features['sma_ratio_10_50'] = float(sma_10 / sma_50) if sma_50 > 0 else 1.0

        # --- ATR ---
        features['atr_14'] = compute_atr(p, 14)
        features['atr_ratio_14'] = features['atr_14'] / curr if curr > 0 else 0.02

        # --- Max drawdown ---
        if len(p) >= 20:
            rolling_max = np.maximum.accumulate(p[-20:])
            drawdowns = (rolling_max - p[-20:]) / rolling_max
            features['max_drawdown_20d'] = float(drawdowns.max())
        else:
            features['max_drawdown_20d'] = 0.0

        # --- Historical VaR ---
        if len(p) >= 21:
            daily_returns = np.diff(p[-21:]) / p[-21:-1]
            features['historical_var_95'] = float(np.percentile(daily_returns, 5))
        else:
            features['historical_var_95'] = 0.0

        # --- Volume features ---
        if volumes is not None and len(volumes) > 0:
            v = np.array(volumes, dtype=float)
            features['volume_1d'] = float(v[-1]) if len(v) > 0 else 0
            vol_ma_5 = float(v[-5:].mean()) if len(v) >= 5 else float(v.mean())
            vol_ma_20 = float(v[-20:].mean()) if len(v) >= 20 else float(v.mean())
            features['volume_ma_5'] = vol_ma_5
            features['volume_ma_20'] = vol_ma_20
            features['volume_ratio_5'] = float(v[-1] / vol_ma_5) if vol_ma_5 > 0 else 1.0
            features['volume_ratio_20'] = float(v[-1] / vol_ma_20) if vol_ma_20 > 0 else 1.0
            if len(v) >= 10:
                features['volume_trend_5'] = float((v[-5:].mean() - v[-10:-5].mean()) / (v[-10:-5].mean() + 1e-8))
            else:
                features['volume_trend_5'] = 0.0
            features['dollar_volume'] = float(v[-1] * curr) if curr > 0 else 0
        else:
            features['volume_1d'] = 0
            features['volume_ma_5'] = 0
            features['volume_ma_20'] = 0
            features['volume_ratio_5'] = 1.0
            features['volume_ratio_20'] = 1.0
            features['volume_trend_5'] = 0.0
            features['dollar_volume'] = 0.0

        # --- Market-relative features ---
        if market_prices is not None and len(market_prices) >= 2:
            mp = np.array(market_prices, dtype=float)
            stock_ret_1d = features.get('return_1d', 0) / 100
            market_ret_1d = float((mp[-1] - mp[-2]) / mp[-2]) if len(mp) >= 2 else 0
            features['relative_return_1d'] = float(stock_ret_1d - market_ret_1d) * 100
            if len(p) >= 5 and len(mp) >= 5:
                stock_ret_5d = (p[-1] - p[-6]) / p[-6] if len(p) >= 6 else 0
                market_ret_5d = (mp[-1] - mp[-6]) / mp[-6] if len(mp) >= 6 else 0
                features['relative_return_5d'] = float(stock_ret_5d - market_ret_5d) * 100
            else:
                features['relative_return_5d'] = 0.0
            stock_vol = np.std(np.diff(p[-20:])) / np.mean(p[-20:]) if len(p) >= 21 and np.mean(p[-20:]) > 0 else 0.02
            market_vol = np.std(np.diff(mp[-20:])) / np.mean(mp[-20:]) if len(mp) >= 21 and np.mean(mp[-20:]) > 0 else 0.02
            features['relative_volatility'] = float(stock_vol / market_vol) if market_vol > 0 else 1.0
        else:
            features['relative_return_1d'] = 0.0
            features['relative_return_5d'] = 0.0
            features['relative_volatility'] = 1.0

    # --- Fundamental features ---
    if fundamentals:
        features['pe_ratio'] = float(fundamentals.get('peRatio', 18) or 18)
        features['pb_ratio'] = float(fundamentals.get('pbRatio', 2) or 2)
        features['debt_to_equity'] = float(fundamentals.get('debtToEquity', 0.5) or 0.5)
        features['current_ratio'] = float(fundamentals.get('currentRatio', 1.5) or 1.5)
        features['roe'] = float(fundamentals.get('roe', 10) or 10)
        features['revenue_growth'] = float(fundamentals.get('revenueGrowth', 0) or 0)
        features['eps_growth'] = float(fundamentals.get('epsGrowth', 0) or 0)
        features['dividend_yield'] = float(fundamentals.get('dividendYield', 0) or 0)
        features['fcf_yield'] = float(fundamentals.get('fcfYield', 0) or 0)
        features['market_cap'] = float(np.log1p(fundamentals.get('marketCap', 1e9) or 1e9))
    else:
        features.update({
            'pe_ratio': 18, 'pb_ratio': 2, 'debt_to_equity': 0.5,
            'current_ratio': 1.5, 'roe': 10, 'revenue_growth': 0,
            'eps_growth': 0, 'dividend_yield': 0, 'fcf_yield': 0,
            'market_cap': float(np.log1p(1e9)),
        })

    # --- Sector features ---
    if sector_prices is not None and len(sector_prices) >= 2:
        sp = np.array(sector_prices, dtype=float)
        features['sector_momentum'] = float((sp[-1] - sp[0]) / sp[0] * 100) if sp[0] > 0 else 0
    else:
        features['sector_momentum'] = 0.0

    return features


def feature_list() -> List[str]:
    """Return canonical ordered list of all feature names."""
    return [
        'return_1d', 'return_5d', 'return_10d', 'return_20d', 'return_50d',
        'volatility_5d', 'volatility_20d',
        'rsi_7', 'rsi_14', 'rsi_21',
        'macd_12_26', 'macd_hist_12_26', 'macd_8_17', 'macd_hist_8_17',
        'bb_pct_b_20_2', 'bb_width_20_2', 'bb_pct_b_50_2_5',
        'sma_10', 'sma_50', 'sma_200', 'sma_ratio_10_50',
        'atr_14', 'atr_ratio_14',
        'price_position_20d', 'price_position_50d',
        'max_10d', 'min_10d', 'range_10d',
        'high_close_ratio_10d', 'low_close_ratio_10d', 'gap_from_high_50d',
        'max_drawdown_20d', 'historical_var_95',
        'volume_ratio_5', 'volume_ratio_20', 'volume_trend_5', 'dollar_volume',
        'pe_ratio', 'pb_ratio', 'debt_to_equity', 'current_ratio',
        'roe', 'revenue_growth', 'eps_growth', 'dividend_yield', 'fcf_yield', 'market_cap',
        'relative_return_1d', 'relative_return_5d', 'relative_volatility', 'sector_momentum',
    ]
