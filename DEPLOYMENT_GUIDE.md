# Separate Frontend & Backend Deployment Guide

## Overview
This project is configured for separate deployments:
- **Frontend**: Vercel (static hosting)
- **Backend**: Render (Docker-based Node.js + PostgreSQL + Redis)

---

## Frontend Deployment (Vercel)

### Configuration Files
- **`vercel.json`**: Root-level config that tells Vercel to build the frontend directory
- **`frontend/package.json`**: Frontend build scripts and dependencies

### Deploy Frontend

1. **Connect GitHub Repository**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New" → "Project"
   - Select your GitHub repository (`sadiq-hue/StocksIntels`)

2. **Configure Project**
   - **Root Directory**: Set to `frontend/` (Vercel should auto-detect from vercel.json)
   - **Build Command**: `npm run build` (auto-filled from frontend/package.json)
   - **Output Directory**: `dist` (auto-filled from frontend/package.json)

3. **Environment Variables** (if needed in frontend):
   - Add any API endpoints or config as needed

4. **Deploy**
   - Click "Deploy"
   - Vercel builds and deploys automatically on every `main` branch push

5. **Update Backend CORS**
   - After frontend deploys, note your Vercel URL (e.g., `https://stockintels.vercel.app`)
   - Update backend's `CORS_ORIGIN` environment variable in Render dashboard

---

## Backend Deployment (Render)

### Configuration Files
- **`render.yaml`**: Infrastructure as Code (databases, Redis, web service)
- **`backend/Dockerfile`**: Containerized Node.js + Python environment
- **`backend/package.json`**: Backend dependencies and start script

### Deploy Backend

1. **Push render.yaml to GitHub**
   - Ensure `render.yaml` is in the repository root

2. **Create Render Blueprint**
   - Go to [render.com](https://render.com)
   - Click "Create New" → "Blueprint"
   - Connect your GitHub repository
   - Select branch: `main`
   - Render auto-detects `render.yaml`

3. **Configure Services**
   - Render will create:
     - Web service (backend container)
     - PostgreSQL database (`stockintel-db`)
     - Redis cache (`stockintel-redis`)

4. **Set Environment Variables**
   In Render dashboard, add these secrets (marked `sync: false` in render.yaml):
   - `RAPIDAPI_KEY` (Yahoo Finance API)
   - `TWELVE_DATA_API_KEY` (optional)
   - `FMP_API_KEY` (optional)
   - `POLYGON_API_KEY`
   - `JWT_SECRET` (generate a strong random string)
   - `BROKER_ENCRYPTION_KEY` (generate a strong random string)
   - `ENSEND_PROJECT_SECRET` (email service)
   - `PAYHERO_*` (payments, optional)
   - `PAYD_*` (payments, optional)

5. **Update CORS**
   - Set `CORS_ORIGIN` to your Vercel frontend URL
   - Example: `https://stockintels.vercel.app`

6. **Deploy**
   - Click "Create Blueprint"
   - Render deploys all services automatically

---

## After Deployment

### Update API Endpoints in Frontend
1. Update frontend code to call backend from the new Render URL
2. Example: `https://stockintels.onrender.com` or your custom domain
3. Redeploy frontend on Vercel (auto on push to main)

### Monitor & Scale
- **Vercel**: Monitor deployments in Vercel dashboard
- **Render**: Monitor services, databases, and logs in Render dashboard

### Custom Domains (Optional)
- **Frontend**: Add custom domain in Vercel project settings
- **Backend**: Add custom domain in Render service settings

---

## Troubleshooting

### Frontend build fails: "vite: command not found"
- Ensure `vercel.json` points to frontend directory
- Check frontend/package.json has vite in devDependencies

### Backend won't start
- Check Docker build logs in Render dashboard
- Verify all environment variables are set
- Check database and Redis are healthy

### CORS errors
- Frontend and backend URLs must match exactly
- Update backend's `CORS_ORIGIN` environment variable
- Include protocol (https://) and full domain

---

## Local Development

```bash
# Install dependencies for both
npm install
cd backend && npm install && cd ..

# Frontend only
npm run dev

# Backend only
cd backend && npm run dev

# Load testing (after backend running)
npm run load-test:setup
npm run load-test
```

---

## Files Modified for Separation

- **`vercel.json`** (created) - Vercel configuration
- **`render.yaml`** (existing) - Render backend infrastructure
- **`package.json`** (updated) - Root dev scripts now point to frontend
