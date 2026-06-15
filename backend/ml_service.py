"""XGBoost ML service with per-sector models.
Communicates with Node.js via JSON-over-stdin/stdout IPC.

Protocol (line-delimited JSON):
  Request:  {"type":"predict","symbol":"AAPL","sector":"Technology","prices":[...],"volumes":[...],"fundamentals":{...},"market_prices":[...]}
  Response: {"type":"predict_result","win_prob":0.72,"model_used":"Technology","features_used":52}

  Request:  {"type":"train"}
  Response: {"type":"train_result","status":"ok","samples":500,"models":["Technology","Healthcare","Global"],"feature_importance":{...}}

  Request:  {"type":"status"}
  Response: {"type":"status_result","models_loaded":5,"total_samples":1200,"last_training":"2026-06-14T..."}
"""

import sys
import json
import os
import time
import logging
import pickle
import threading
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

from feature_engineering import compute_all_features, feature_list

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')

logging.basicConfig(level=logging.INFO, format='[MLService] %(message)s')
logger = logging.getLogger('ml_service')

DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': int(os.environ.get('DB_PORT', 5432)),
    'dbname': os.environ.get('DB_NAME', 'stockintel'),
    'user': os.environ.get('DB_USER', 'stockintel'),
    'password': os.environ.get('DB_PASSWORD', 'stockintel'),
}

FEATURES = feature_list()
NUM_FEATURES = len(FEATURES)
TOP_FEATURES_COUNT = 20

# Global model + per-sector models
_models: Dict[str, xgb.XGBClassifier] = {}
_model_info: Dict[str, Dict] = {}
_total_samples = 0
_last_training = 0
_MIN_SAMPLES = 30
_MIN_SECTOR_SAMPLES = 15
_active_feature_indices: Optional[List[int]] = None


def _ensure_models_dir():
    os.makedirs(MODELS_DIR, exist_ok=True)


def _save_models():
    """Persist all models, model_info, and metadata to disk."""
    _ensure_models_dir()
    selected = [FEATURES[i] for i in (_active_feature_indices or range(NUM_FEATURES))]
    meta = {
        'total_samples': _total_samples,
        'last_training': _last_training,
        'model_info': _model_info,
        'active_feature_indices': _active_feature_indices,
        'selected_features': selected,
    }
    with open(os.path.join(MODELS_DIR, 'metadata.pkl'), 'wb') as f:
        pickle.dump(meta, f)
    for name, model in _models.items():
        safe_name = name.replace(' ', '_').replace('/', '_')
        with open(os.path.join(MODELS_DIR, f'model_{safe_name}.pkl'), 'wb') as f:
            pickle.dump(model, f)
    logger.info(f"Saved {len(_models)} models ({len(selected)} features) to {MODELS_DIR}")


def _load_models() -> bool:
    """Load persisted models from disk. Returns True if at least one loaded."""
    _ensure_models_dir()
    meta_path = os.path.join(MODELS_DIR, 'metadata.pkl')
    model_files = [f for f in os.listdir(MODELS_DIR) if f.startswith('model_') and f.endswith('.pkl')]
    if not model_files or not os.path.exists(meta_path):
        logger.info("No saved models found on disk")
        return False

    global _models, _model_info, _total_samples, _last_training, _active_feature_indices
    try:
        with open(meta_path, 'rb') as f:
            meta = pickle.load(f)
        _total_samples = meta.get('total_samples', 0)
        _last_training = meta.get('last_training', 0)
        _model_info = meta.get('model_info', {})
        _active_feature_indices = meta.get('active_feature_indices')

        loaded = 0
        for mf in model_files:
            try:
                name = mf.replace('model_', '').replace('.pkl', '').replace('_', ' ')
                with open(os.path.join(MODELS_DIR, mf), 'rb') as f:
                    model = pickle.load(f)
                _models[name] = model
                loaded += 1
            except Exception as e:
                logger.warning(f"Failed to load {mf}: {e}")

        logger.info(f"Loaded {loaded}/{len(model_files)} models from disk ({_total_samples} samples)")
        return loaded > 0
    except Exception as e:
        logger.error(f"Failed to load models: {e}")
        return False


def _get_db_connection():
    """Create a PostgreSQL connection."""
    import psycopg2
    return psycopg2.connect(**DB_CONFIG)


def _fetch_training_data() -> Tuple[List[Dict], List[int], List[str]]:
    """Fetch signal_outcomes + signal_history + price data for training."""
    conn = _get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT s.ticker, s.signal, sh.confidence, s.entry_price, s.exit_price, s.result,
                   sh.sector, sh.market, sh.generated_at
            FROM signal_outcomes s
            JOIN signal_history sh ON sh.id = s.signal_history_id
            WHERE s.result IS NOT NULL
                AND s.entry_price > 0
            ORDER BY s.recorded_at DESC
            LIMIT 8000
        """)
        rows = cur.fetchall()
        if not rows:
            return [], [], []

        records = []
        labels = []
        sectors = []
        for r in rows:
            labels.append(1 if r[5] == 'win' else 0)
            sectors.append(r[6] or 'Unknown')
            records.append({
                'ticker': r[0],
                'signal': r[1],
                'confidence': r[2],
                'entry_price': float(r[3]) if r[3] else 0,
                'exit_price': float(r[4]) if r[4] else 0,
                'result': r[5],
                'sector': r[6] or 'Unknown',
                'market': r[7] or 'Global',
                'generated_at': r[8],
            })
        return records, labels, sectors
    finally:
        conn.close()


_price_cache: Dict = {}
_fundamentals_cache: Dict = {}

def _fetch_price_history(ticker: str, max_date: Optional[str] = None) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """Fetch closing prices and volumes, cached per ticker.
    If max_date is provided, only prices BEFORE that date are returned (data leakage prevention)."""
    cache_key = ticker
    all_prices, all_volumes, all_dates = None, None, None

    if cache_key in _price_cache:
        all_prices, all_volumes, all_dates = _price_cache[cache_key]
    else:
        conn = _get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT md.price, md.volume, md.timestamp FROM market_data md
                JOIN stocks s ON s.id = md.stock_id
                WHERE s.ticker = %s
                ORDER BY md.timestamp ASC
                LIMIT 500
            """, (ticker,))
            rows = cur.fetchall()
            if len(rows) < 5:
                _price_cache[cache_key] = (None, None, None)
                return None, None
            all_prices = np.array([float(r[0]) for r in rows], dtype=float)
            all_volumes = np.array([float(r[1] or 0) for r in rows], dtype=float)
            all_dates = np.array([str(r[2]) for r in rows])
            _price_cache[cache_key] = (all_prices, all_volumes, all_dates)
        except Exception:
            _price_cache[cache_key] = (None, None, None)
            return None, None
        finally:
            conn.close()

    if all_prices is None:
        return None, None

    if max_date is not None:
        mask = all_dates <= max_date
        if mask.sum() < 5:
            return None, None
        return all_prices[mask], all_volumes[mask]

    return all_prices, all_volumes


def _fetch_fundamentals(ticker: str) -> Optional[Dict]:
    """Fetch fundamentals, cached per ticker."""
    if ticker in _fundamentals_cache:
        return _fundamentals_cache[ticker]
    try:
        conn = _get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT pe_ratio, pb_ratio, debt_to_equity, current_ratio,
                   roe, revenue_growth, eps_growth, dividend_yield, fcf_yield, market_cap
            FROM stock_fundamentals WHERE symbol = %s LIMIT 1
        """, (ticker,))
        row = cur.fetchone()
        conn.close()
        if row:
            keys = ['peRatio', 'pbRatio', 'debtToEquity', 'currentRatio',
                    'roe', 'revenueGrowth', 'epsGrowth', 'dividendYield', 'fcfYield', 'marketCap']
            result = {k: float(v) if v else 0 for k, v in zip(keys, row)}
            _fundamentals_cache[ticker] = result
            return result
    except Exception:
        pass
    _fundamentals_cache[ticker] = None
    return None


def _build_feature_vectors(
    records: List[Dict], labels: List[int], sectors: List[str]
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Build feature matrix from training records with 60+ features each."""
    X_list = []
    y_list = []
    sector_list = []

    total = len(records)
    for i, rec in enumerate(records):
        if i > 0 and i % 1000 == 0:
            logger.info(f"Feature engineering: {i}/{total} records processed")
        ticker = rec['ticker']
        signal_date = str(rec.get('generated_at', ''))[:10] if rec.get('generated_at') else None
        prices, volumes = _fetch_price_history(ticker, max_date=signal_date)
        fundamentals = _fetch_fundamentals(ticker)

        feats = compute_all_features(
            prices=prices,
            volumes=volumes,
            fundamentals=fundamentals,
            sector_prices=None,
            market_prices=None,
        )
        vec = np.array([feats.get(f, 0.0) for f in FEATURES], dtype=float)
        X_list.append(vec)
        y_list.append(labels[i])
        sector_list.append(sectors[i])

    if not X_list:
        return np.array([]), np.array([]), []

    X = np.array(X_list)
    y = np.array(y_list)
    return X, y, sector_list


def _train_model(X: np.ndarray, y: np.ndarray, model_key: str) -> Optional[xgb.XGBClassifier]:
    """Train an XGBoost classifier for a given model key."""
    if len(X) < _MIN_SAMPLES:
        logger.warning(f"Not enough samples for {model_key}: {len(X)} < {_MIN_SAMPLES}")
        return None

    params = {
        'n_estimators': 200,
        'max_depth': 6,
        'learning_rate': 0.05,
        'subsample': 0.8,
        'colsample_bytree': 0.7,
        'min_child_weight': 3,
        'reg_lambda': 1.0,
        'reg_alpha': 0.1,
        'eval_metric': 'logloss',
        'use_label_encoder': False,
        'random_state': 42,
        'verbosity': 0,
    }

    try:
        # Train/validation split
        if len(X) >= 100:
            X_train, X_val, y_train, y_val = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )
            model = xgb.XGBClassifier(**params)
            model.fit(
                X_train, y_train,
                eval_set=[(X_val, y_val)],
                verbose=False,
            )
            y_pred = (model.predict_proba(X_val)[:, 1] >= 0.5).astype(int)
            val_acc = accuracy_score(y_val, y_pred)
            try:
                val_auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])
            except Exception:
                val_auc = 0.0
        else:
            model = xgb.XGBClassifier(**params)
            model.fit(X, y)
            val_acc = 0.0
            val_auc = 0.0

        train_pred = (model.predict_proba(X)[:, 1] >= 0.5).astype(int)
        train_acc = accuracy_score(y, train_pred)

        _model_info[model_key] = {
            'samples': len(X),
            'train_accuracy': round(train_acc * 100, 1),
            'val_accuracy': round(val_acc * 100, 1) if val_acc > 0 else None,
            'val_auc': round(val_auc * 100, 1) if val_auc > 0 else None,
            'features': NUM_FEATURES,
            'trained_at': time.time(),
        }

        logger.info(f"Trained {model_key}: {len(X)} samples, train_acc={train_acc:.2%}")
        return model
    except Exception as e:
        logger.error(f"Failed to train {model_key}: {e}")
        return None


def train(req: Dict):
    """Fetch training data, engineer features, train per-sector models (sync)."""
    global _models, _model_info, _total_samples, _last_training

    logger.info("Starting training cycle...")
    _price_cache.clear()
    _fundamentals_cache.clear()
    try:
        records, labels, sectors = _fetch_training_data()
    except Exception as e:
        logger.error(f"Failed to fetch training data: {e}")
        _send({'type': 'train_result', 'status': 'error', 'message': str(e)}, req)
        return

    if not records:
        logger.warning("No training data available")
        _send({'type': 'train_result', 'status': 'no_data', 'samples': 0, 'models': []}, req)
        return

    try:
        X, y, sector_list = _build_feature_vectors(records, labels, sectors)
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        _send({'type': 'train_result', 'status': 'error', 'message': f'Feature engineering failed: {e}'}, req)
        return

    if X.shape[0] == 0:
        logger.warning("No feature vectors could be built")
        _send({'type': 'train_result', 'status': 'no_features', 'samples': 0, 'models': []}, req)
        return

    _total_samples = X.shape[0]
    _models = {}
    _model_info = {}

    # Phase 1: Train Global with all features to determine importance
    global_model = _train_model(X, y, 'Global')
    if global_model is None:
        _send({'type': 'train_result', 'status': 'error', 'message': 'Global model training failed'}, req)
        return

    importance = global_model.feature_importances_
    sorted_idx = np.argsort(importance)[::-1]
    top_n = min(TOP_FEATURES_COUNT, NUM_FEATURES)
    selected_idx = sorted_idx[:top_n]
    global _active_feature_indices
    _active_feature_indices = list(selected_idx)
    selected_features = [FEATURES[i] for i in selected_idx]

    logger.info(f"Selected top {top_n} features: {selected_features}")
    X_sub = X[:, selected_idx]

    # Phase 2: Re-train all models with only top features
    global_model_pruned = _train_model(X_sub, y, 'Global')
    if global_model_pruned:
        _models['Global'] = global_model_pruned

    sector_indices = defaultdict(list)
    for i, sec in enumerate(sector_list):
        sector_indices[sec].append(i)

    trained_models = ['Global'] if 'Global' in _models else []
    for sector, indices in sector_indices.items():
        if len(indices) < _MIN_SECTOR_SAMPLES:
            continue
        idx_arr = np.array(indices)
        X_sec = X_sub[idx_arr]
        y_sec = y[idx_arr]
        model = _train_model(X_sec, y_sec, sector)
        if model:
            _models[sector] = model
            trained_models.append(sector)

    fi = {}
    if 'Global' in _models:
        imp = _models['Global'].feature_importances_
        sorted_top = np.argsort(imp)[::-1][:20]
        for pos in sorted_top:
            if pos < len(selected_features):
                fi[selected_features[pos]] = round(float(imp[pos]), 4)

    _last_training = time.time()
    _save_models()
    result = {
        'type': 'train_result',
        'status': 'ok',
        'samples': _total_samples,
        'models': trained_models,
        'model_info': {k: {kk: vv for kk, vv in v.items() if kk != 'trained_at'}
                       for k, v in _model_info.items()},
        'feature_importance': fi,
        'features_count': NUM_FEATURES,
        'features': FEATURES[:10],
    }
    logger.info(f"Training complete: {len(trained_models)} models, {_total_samples} samples")
    _send(result, req)


def predict(request: Dict):
    """Predict win probability for a single stock using per-sector model."""
    global _models

    if not _models:
        _send({'type': 'predict_result', 'win_prob': 0.5, 'model_used': 'none', 'features_used': 0}, request)
        return

    sector = request.get('sector', 'Unknown')
    prices = request.get('prices')
    volumes = request.get('volumes')
    fundamentals = request.get('fundamentals')
    market_prices = request.get('market_prices')

    # Convert lists back to numpy arrays
    prices_arr = np.array(prices, dtype=float) if prices else None
    volumes_arr = np.array(volumes, dtype=float) if volumes else None
    mp_arr = np.array(market_prices, dtype=float) if market_prices else None

    feats = compute_all_features(
        prices=prices_arr,
        volumes=volumes_arr,
        fundamentals=fundamentals,
        sector_prices=None,
        market_prices=mp_arr,
    )

    all_vec = np.array([feats.get(f, 0.0) for f in FEATURES], dtype=float)
    if _active_feature_indices is not None and len(_active_feature_indices) <= len(all_vec):
        vec = all_vec[_active_feature_indices].reshape(1, -1)
    else:
        vec = all_vec.reshape(1, -1)

    # Choose model: sector-specific if available, else Global
    model = _models.get(sector) or _models.get('Global')
    if model is None:
        _send({'type': 'predict_result', 'win_prob': 0.5, 'model_used': 'none', 'features_used': len(_active_feature_indices) if _active_feature_indices else NUM_FEATURES}, request)
        return

    try:
        prob = float(model.predict_proba(vec)[0, 1])
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        prob = 0.5

    used_features = [FEATURES[i] for i in (_active_feature_indices or range(NUM_FEATURES))]
    _send({
        'type': 'predict_result',
        'win_prob': round(prob, 4),
        'model_used': sector if sector in _models else 'Global',
        'features_used': len(used_features),
        'top_features': sorted(
            [(used_features[i], float(model.feature_importances_[i]))
             for i in np.argsort(model.feature_importances_)[-5:]],
            key=lambda x: x[1], reverse=True
        ) if hasattr(model, 'feature_importances_') else [],
    }, request)


def status(req: Dict):
    """Return current model status."""
    trained_models = list(_models.keys())
    selected = [FEATURES[i] for i in (_active_feature_indices or range(NUM_FEATURES))]
    s = {
        'type': 'status_result',
        'models_loaded': len(trained_models),
        'model_names': trained_models,
        'total_samples': _total_samples,
        'last_training': _last_training,
        'features_count': len(selected),
        'features_selected': selected[:10],
        'model_info': {k: {kk: vv for kk, vv in v.items() if kk != 'trained_at'}
                       for k, v in _model_info.items()},
    }
    _send(s, req)


def _send(obj: Dict, req: Optional[Dict] = None):
    """Send JSON response to stdout (line-delimited). Echo back _id if present."""
    if req and '_id' in req:
        obj['_id'] = req['_id']
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def main():
    """Main IPC loop: read JSON commands from stdin, process, write to stdout."""
    logger.info("ML Service started, waiting for commands...")
    loaded = _load_models()
    if loaded:
        logger.info(f"Models loaded from disk ({_total_samples} samples)")
    _send({'type': 'ready', 'features_count': NUM_FEATURES, 'features': FEATURES})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _send({'type': 'error', 'message': f'Invalid JSON: {e}'})
            continue

        req_type = req.get('type', '')
        try:
            if req_type == 'train':
                train(req)
            elif req_type == 'predict':
                predict(req)
            elif req_type == 'status':
                status(req)
            elif req_type == 'shutdown':
                break
            else:
                _send({'type': 'error', 'message': f'Unknown type: {req_type}'}, req)
        except Exception as e:
            logger.error(f"Error processing {req_type}: {e}")
            _send({'type': 'error', 'message': str(e)}, req)


if __name__ == '__main__':
    main()
