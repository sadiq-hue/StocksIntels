FROM node:22-bookworm

WORKDIR /app

# Install Python + build deps for XGBoost + Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv build-essential cmake \
    libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libdbus-1-3 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir xgboost numpy pandas scikit-learn

# Install pnpm (workspace lockfile is used for deterministic installs)
RUN npm install -g pnpm@10

# Copy workspace files and backend manifest
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install backend production dependencies using the workspace lockfile
RUN pnpm install --filter backend --prod --no-frozen-lockfile

# Install Playwright Chromium browsers (both full chromium and headless-shell)
RUN npx playwright install --with-deps chromium chromium-headless-shell

# Copy backend source
COPY backend/ ./backend/

ENV NODE_ENV=production \
    PORT=3001 \
    PATH="/app/venv/bin:$PATH"

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/healthz',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "backend/index.js"]
