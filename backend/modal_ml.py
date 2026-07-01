"""Modal serverless ML service for StocksIntels.

Prerequisites:
  1. Install Modal CLI: pip install modal && modal setup
  2. Create a Modal Secret named 'railway-db' with keys:
       DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
     (Use Railway's public DB endpoint so Modal can reach it from outside Railway's VPC)
  3. Deploy: modal deploy backend.modal_ml
  4. Set MODAL_URL=https://<workspace>--stocksintels-ml.modal.run in Railway env

When MODAL_URL is unset, the app falls back to JS logistic regression (no cost).
"""

import os
import time
import pickle
import logging
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from pathlib import Path

import modal
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

from feature_engineering import compute_all_features, feature_list

logging.basicConfig(level=logging.INFO, format='[ModalML] %(message)s')
logger = logging.getLogger('modal_ml')

MODELS_DIR = Path("/models")
MODELS_DIR.mkdir(exist_ok=True)

image = (
    modal.Image.debian_slim()
    .pip_install("xgboost==2.1.4", "numpy", "scikit-learn", "psycopg2-binary", "fastapi", "pydantic", "uvicorn")
)

app = modal.App("stocksintels-ml")
models_vol = modal.Volume.from_name("ml-models", create_if_missing=True)

FEATURES = feature_list()
NUM_FEATURES = len(FEATURES)
TOP_FEATURES_COUNT = 20
MIN_SAMPLES = 30
MIN_SECTOR_SAMPLES = 15


class MLService:
    def __init__(self):
        self._models: Dict[str, xgb.XGBClassifier] = {}
        self._model_info: Dict[str, Dict] = {}
        self._total_samples = 0
        self._last_training = 0
        self._active_feature_indices: Optional[List[int]] = None
        self._price_cache: Dict = {}
        self._fundamentals_cache: Dict = {}
        self._loaded = self._load_models()

    def _db_conn(self):
        import psycopg2
        return psycopg2.connect(
            host=os.environ["DB_HOST"],
            port=int(os.environ.get("DB_PORT", 5432)),
            dbname=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
        )

    def _save_models(self):
        meta = {
            'total_samples': self._total_samples,
            'last_training': self._last_training,
            'model_info': self._model_info,
            'active_feature_indices': self._active_feature_indices,
            'selected_features': [FEATURES[i] for i in (self._active_feature_indices or range(NUM_FEATURES))],
        }
        with open(MODELS_DIR / 'metadata.pkl', 'wb') as f:
            pickle.dump(meta, f)
        for name, model in self._models.items():
            safe_name = name.replace(' ', '_').replace('/', '_')
            with open(MODELS_DIR / f'model_{safe_name}.pkl', 'wb') as f:
                pickle.dump(model, f)
        models_vol.commit()
        logger.info(f"Saved {len(self._models)} models to volume")

    def _load_models(self) -> bool:
        meta_path = MODELS_DIR / 'metadata.pkl'
        if not meta_path.exists():
            logger.info("No saved models found on volume")
            return False
        model_files = [f for f in os.listdir(MODELS_DIR) if f.startswith('model_') and f.endswith('.pkl')]
        if not model_files:
            return False
        try:
            with open(meta_path, 'rb') as f:
                meta = pickle.load(f)
            self._total_samples = meta.get('total_samples', 0)
            self._last_training = meta.get('last_training', 0)
            self._model_info = meta.get('model_info', {})
            self._active_feature_indices = meta.get('active_feature_indices')
            loaded = 0
            for mf in model_files:
                name = mf.replace('model_', '').replace('.pkl', '').replace('_', ' ')
                with open(MODELS_DIR / mf, 'rb') as f:
                    self._models[name] = pickle.load(f)
                loaded += 1
            logger.info(f"Loaded {loaded} models ({self._total_samples} samples)")
            return loaded > 0
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            return False

    def _fetch_training_data(self) -> Tuple[List[Dict], List[int], List[str]]:
        conn = self._db_conn()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT s.ticker, s.signal, sh.confidence, s.entry_price, s.exit_price, s.result,
                       sh.sector, sh.market, sh.generated_at
                FROM signal_outcomes s
                JOIN signal_history sh ON sh.id = s.signal_history_id
                WHERE s.result IS NOT NULL AND s.entry_price > 0
                ORDER BY s.recorded_at DESC LIMIT 8000
            """)
            rows = cur.fetchall()
            if not rows:
                return [], [], []
            records, labels, sectors = [], [], []
            for r in rows:
                labels.append(1 if r[5] == 'win' else 0)
                sectors.append(r[6] or 'Unknown')
                records.append({
                    'ticker': r[0], 'signal': r[1], 'confidence': r[2],
                    'entry_price': float(r[3]) if r[3] else 0,
                    'exit_price': float(r[4]) if r[4] else 0,
                    'result': r[5], 'sector': r[6] or 'Unknown',
                    'market': r[7] or 'Global', 'generated_at': r[8],
                })
            return records, labels, sectors
        finally:
            conn.close()

    def _fetch_price_history(self, ticker: str, max_date: Optional[str] = None):
        cache_key = ticker
        if cache_key in self._price_cache:
            all_prices, all_volumes, all_dates = self._price_cache[cache_key]
        else:
            conn = self._db_conn()
            try:
                cur = conn.cursor()
                cur.execute("""
                    SELECT md.price, md.volume, md.timestamp FROM market_data md
                    JOIN stocks s ON s.id = md.stock_id
                    WHERE s.ticker = %s ORDER BY md.timestamp ASC LIMIT 500
                """, (ticker,))
                rows = cur.fetchall()
                if len(rows) < 5:
                    self._price_cache[cache_key] = (None, None, None)
                    return None, None
                all_prices = np.array([float(r[0]) for r in rows], dtype=float)
                all_volumes = np.array([float(r[1] or 0) for r in rows], dtype=float)
                all_dates = np.array([str(r[2]) for r in rows])
                self._price_cache[cache_key] = (all_prices, all_volumes, all_dates)
            except Exception:
                self._price_cache[cache_key] = (None, None, None)
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

    def _fetch_fundamentals(self, ticker: str) -> Optional[Dict]:
        if ticker in self._fundamentals_cache:
            return self._fundamentals_cache[ticker]
        try:
            conn = self._db_conn()
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
                self._fundamentals_cache[ticker] = result
                return result
        except Exception:
            pass
        self._fundamentals_cache[ticker] = None
        return None

    def _build_feature_vectors(self, records, labels, sectors):
        X_list, y_list, sector_list = [], [], []
        for i, rec in enumerate(records):
            ticker = rec['ticker']
            signal_date = str(rec.get('generated_at', ''))[:10] if rec.get('generated_at') else None
            prices, volumes = self._fetch_price_history(ticker, max_date=signal_date)
            fundamentals = self._fetch_fundamentals(ticker)
            feats = compute_all_features(prices=prices, volumes=volumes, fundamentals=fundamentals)
            vec = np.array([feats.get(f, 0.0) for f in FEATURES], dtype=float)
            X_list.append(vec)
            y_list.append(labels[i])
            sector_list.append(sectors[i])
        if not X_list:
            return np.array([]), np.array([]), []
        return np.array(X_list), np.array(y_list), sector_list

    def _train_model(self, X, y, model_key):
        if len(X) < MIN_SAMPLES:
            logger.warning(f"Not enough samples for {model_key}: {len(X)} < {MIN_SAMPLES}")
            return None
        params = {
            'n_estimators': 200, 'max_depth': 6, 'learning_rate': 0.05,
            'subsample': 0.8, 'colsample_bytree': 0.7, 'min_child_weight': 3,
            'reg_lambda': 1.0, 'reg_alpha': 0.1, 'eval_metric': 'logloss',
            'use_label_encoder': False, 'random_state': 42, 'verbosity': 0,
        }
        if len(X) >= 100:
            X_tr, X_val, y_tr, y_val = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
            model = xgb.XGBClassifier(**params)
            model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
            y_pred = (model.predict_proba(X_val)[:, 1] >= 0.5).astype(int)
            val_acc = accuracy_score(y_val, y_pred)
            val_auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1]) if len(np.unique(y_val)) > 1 else 0.0
        else:
            model = xgb.XGBClassifier(**params)
            model.fit(X, y)
            val_acc, val_auc = 0.0, 0.0
        train_pred = (model.predict_proba(X)[:, 1] >= 0.5).astype(int)
        train_acc = accuracy_score(y, train_pred)
        self._model_info[model_key] = {
            'samples': len(X), 'train_accuracy': round(train_acc * 100, 1),
            'val_accuracy': round(val_acc * 100, 1) if val_acc > 0 else None,
            'val_auc': round(val_auc * 100, 1) if val_auc > 0 else None,
            'features': NUM_FEATURES, 'trained_at': time.time(),
        }
        logger.info(f"Trained {model_key}: {len(X)} samples, train_acc={train_acc:.2%}")
        return model

    def predict(self, symbol: str = "UNKNOWN", sector: str = "Unknown",
                prices: Optional[List[float]] = None, volumes: Optional[List[float]] = None,
                fundamentals: Optional[Dict] = None):
        if not self._loaded or not self._models:
            return {"win_prob": 0.5, "model_used": "none", "features_used": 0}
        prices_arr = np.array(prices, dtype=float) if prices else None
        volumes_arr = np.array(volumes, dtype=float) if volumes else None
        feats = compute_all_features(prices=prices_arr, volumes=volumes_arr, fundamentals=fundamentals)
        all_vec = np.array([feats.get(f, 0.0) for f in FEATURES], dtype=float)
        if self._active_feature_indices is not None and len(self._active_feature_indices) <= len(all_vec):
            vec = all_vec[self._active_feature_indices].reshape(1, -1)
        else:
            vec = all_vec.reshape(1, -1)
        model = self._models.get(sector) or self._models.get('Global')
        if model is None:
            return {"win_prob": 0.5, "model_used": "none", "features_used": len(self._active_feature_indices or range(NUM_FEATURES))}
        prob = float(model.predict_proba(vec)[0, 1])
        used = [FEATURES[i] for i in (self._active_feature_indices or range(NUM_FEATURES))]
        top = []
        if hasattr(model, 'feature_importances_'):
            sorted_idx = np.argsort(model.feature_importances_)[-5:]
            top = [(used[int(i)], float(model.feature_importances_[int(i)])) for i in sorted_idx]
        return {
            "win_prob": round(prob, 4), "model_used": sector if sector in self._models else "Global",
            "features_used": len(used), "top_features": top,
        }

    def train(self):
        logger.info("Starting training cycle...")
        self._price_cache.clear()
        self._fundamentals_cache.clear()
        try:
            records, labels, sectors = self._fetch_training_data()
        except Exception as e:
            logger.error(f"Failed to fetch training data: {e}")
            return {"status": "error", "message": str(e)}
        if not records:
            return {"status": "no_data", "samples": 0, "models": []}
        X, y, sector_list = self._build_feature_vectors(records, labels, sectors)
        if X.shape[0] == 0:
            return {"status": "no_features", "samples": 0, "models": []}
        self._total_samples = X.shape[0]
        self._models = {}
        self._model_info = {}
        global_model = self._train_model(X, y, 'Global')
        if global_model is None:
            return {"status": "error", "message": "Global model training failed"}
        importance = global_model.feature_importances_
        sorted_idx = np.argsort(importance)[::-1]
        top_n = min(TOP_FEATURES_COUNT, NUM_FEATURES)
        selected_idx = sorted_idx[:top_n]
        self._active_feature_indices = list(selected_idx)
        X_sub = X[:, selected_idx]
        global_pruned = self._train_model(X_sub, y, 'Global')
        if global_pruned:
            self._models['Global'] = global_pruned
        sector_indices = defaultdict(list)
        for i, sec in enumerate(sector_list):
            sector_indices[sec].append(i)
        trained = ['Global'] if 'Global' in self._models else []
        for sector, indices in sector_indices.items():
            if len(indices) < MIN_SECTOR_SAMPLES:
                continue
            idx_arr = np.array(indices)
            model = self._train_model(X_sub[idx_arr], y[idx_arr], sector)
            if model:
                self._models[sector] = model
                trained.append(sector)
        fi = {}
        if 'Global' in self._models:
            imp = self._models['Global'].feature_importances_
            for i in np.argsort(imp)[::-1][:20]:
                if i < len(self._active_feature_indices):
                    fi[FEATURES[self._active_feature_indices[i]]] = round(float(imp[i]), 4)
        self._last_training = time.time()
        self._save_models()
        self._loaded = True
        logger.info(f"Training complete: {len(trained)} models, {self._total_samples} samples")
        return {
            "status": "ok", "samples": self._total_samples, "models": trained,
            "model_info": {k: {kk: vv for kk, vv in v.items() if kk != 'trained_at'} for k, v in self._model_info.items()},
            "feature_importance": fi, "features_count": NUM_FEATURES,
        }

    def get_status(self):
        selected = [FEATURES[i] for i in (self._active_feature_indices or range(NUM_FEATURES))]
        return {
            "models_loaded": len(self._models),
            "model_names": list(self._models.keys()),
            "total_samples": self._total_samples,
            "last_training": self._last_training,
            "features_count": len(selected),
            "features_selected": selected[:10],
            "model_info": {k: {kk: vv for kk, vv in v.items() if kk != 'trained_at'} for k, v in self._model_info.items()},
        }

    def get_health(self):
        return {
            "status": "ok", "models_loaded": len(self._models),
            "total_samples": self._total_samples,
            "last_training": self._last_training,
        }


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("railway-db")],
    volumes={str(MODELS_DIR): models_vol},
    scaledown_window=300,
    timeout=600,
)
@modal.asgi_app(label="stocksintels-ml")
def fastapi_app_wrapper():
    from fastapi import FastAPI, Request
    from contextlib import asynccontextmanager

    svc = MLService()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield

    fapp = FastAPI(lifespan=lifespan)

    @fapp.post("/predict")
    async def predict(request: Request):
        data = await request.json()
        return svc.predict(
            symbol=data.get("symbol", "UNKNOWN"),
            sector=data.get("sector", "Unknown"),
            prices=data.get("prices"),
            volumes=data.get("volumes"),
            fundamentals=data.get("fundamentals"),
        )

    @fapp.post("/train")
    async def train():
        return svc.train()

    @fapp.get("/status")
    async def status():
        return svc.get_status()

    @fapp.get("/health")
    async def health():
        return svc.get_health()

    return fapp
