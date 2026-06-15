# StocksIntels Deployment Guide

This project is split so the **frontend** and **backend** can be deployed independently:

| Part | Platform | Folder | Why |
|------|----------|--------|-----|
| Frontend | Vercel | `frontend/` | Static Vite + React app |
| Backend | Render | `backend/` | Dockerized Node.js + Python/ML API |

---

## 1. Backend on Render

### What gets deployed
- `backend/Dockerfile` builds a Node.js 20 + Python container.
- `render.yaml` provisions:
  - Web service (`stockintel-backend`)
  - PostgreSQL database (`stockintel-db`)
  - Redis cache (`stockintel-redis`)

### Steps

1. Push this repo to GitHub (ensure `render.yaml` is at the repo root).
2. Go to [render.com](https://render.com) → **Create New** → **Blueprint**.
3. Connect your GitHub repo and select the `main` branch.
4. Render detects `render.yaml` and shows the services it will create.
5. Click **Create Blueprint**.
6. While the backend builds, go to the Render dashboard for `stockintel-backend` and add the required secrets under **Environment**:
   - `JWT_SECRET` — generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
   - `BROKER_ENCRYPTION_KEY` — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `RAPIDAPI_KEY`
   - `TWELVE_DATA_API_KEY` (optional)
   - `FMP_API_KEY` (optional)
   - `POLYGON_API_KEY`
   - `SEC_EDGAR_API_KEY` (optional)
   - `SIMFIN_API_KEY` (optional)
   - `ENSEND_PROJECT_SECRET` (optional, for email)
   - `ENSEND_SENDER_ADDRESS` (optional)
   - `PAYHERO_AUTH_TOKEN`, `PAYHERO_CHANNEL_ID`, `PAYHERO_CALLBACK_URL` (optional)
   - `PAYD_*` credentials (optional)
7. Wait for the service status to show **Live**.
8. Note the backend URL, e.g. `https://stockintel-backend.onrender.com`.

### Update CORS after frontend deploys

After you deploy the frontend, edit the `CORS_ORIGIN` environment variable in Render:

```
CORS_ORIGIN=https://stockintels.vercel.app
```

To allow multiple origins, use a comma-separated list:

```
CORS_ORIGIN=https://stockintels.vercel.app,https://stockintels-git-main.vercel.app
```

Then redeploy the backend service so the change takes effect.

---

## 2. Frontend on Vercel

### What gets deployed
- `frontend/vercel.json` configures the Vite build and SPA routing.
- `frontend/package.json` provides the build scripts.

### Steps

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Import the same GitHub repo.
3. In the project configuration screen:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend` (this is required)
   - **Build Command**: `npm run build` (auto-filled)
   - **Output Directory**: `dist` (auto-filled)
4. Add environment variables under **Environment Variables**:
   - `VITE_API_URL` — set to your Render backend URL + `/api`
     - Example: `https://stockintel-backend.onrender.com/api`
   - `VITE_GOOGLE_CLIENT_ID` — your Google OAuth client ID
   - `VITE_NEWSAPI_KEY` (optional)
   - `VITE_FINNHUB_KEY` (optional)
   - `VITE_POLYGON_API_KEY` (optional)
   - `VITE_BENZINGA_API_KEY` (optional)
5. Click **Deploy**.
6. Vercel will build `frontend/` and deploy it.
7. Note the production URL (e.g. `https://stockintels.vercel.app`).

> **Important:** The `frontend/vercel.json` file must live inside the `frontend/` folder, and the Vercel project **Root Directory** must be set to `frontend`. If you import the repo without setting the root directory, Vercel will look for the app at the repo root and the build will fail.

---

## 3. Final Wiring

1. Copy the Vercel production URL.
2. Paste it into Render → `stockintel-backend` → Environment → `CORS_ORIGIN`.
3. Redeploy the backend on Render.
4. Open the Vercel URL and verify the app loads and talks to the backend.

---

## 4. Local Development

```bash
# Backend
cd backend
cp .env.example .env   # fill in your values
npm install
npm run dev            # http://localhost:3001

# Frontend (new terminal)
cd frontend
cp .env.example .env   # fill in your values
npm install
npm run dev            # http://localhost:5173
```

The frontend `.env` should contain:

```env
VITE_API_URL=http://localhost:3001/api
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
```

---

## 5. Project Layout for Deployment

```text
StocksIntels/
├── frontend/                 # Vercel root directory
│   ├── package.json          # Frontend deps + build scripts
│   ├── vite.config.ts
│   ├── vercel.json           # Vercel build config
│   └── .env.example          # Frontend env vars
├── backend/                  # Render service
│   ├── Dockerfile            # Container build
│   ├── package.json          # Backend deps + start script
│   ├── index.js              # API server entry
│   └── .env.example          # Backend env vars
└── render.yaml               # Render Blueprint (repo root)
```

---

## Troubleshooting

### `vite: command not found` on Vercel
- Make sure the Vercel project **Root Directory** is set to `frontend`.
- Confirm `vite` is in `frontend/package.json` `devDependencies`.

### Backend returns 500 or CORS errors
- Check that `CORS_ORIGIN` on Render exactly matches your Vercel URL (including `https://`).
- Remember to redeploy the backend after changing `CORS_ORIGIN`.

### Backend health check fails on Render
- Check the Render logs for database connection errors.
- Verify all required secrets (`JWT_SECRET`, `DATABASE_URL`, etc.) are set.

### Frontend routes show 404 on refresh
- Confirm `frontend/vercel.json` has the SPA rewrite: `{"source": "/(.*)", "destination": "/index.html"}`.
