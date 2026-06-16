FROM node:20-alpine

WORKDIR /app

# Install Python + build deps for XGBoost
RUN apk add --no-cache python3 py3-pip build-base cmake linux-headers && \
    python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir xgboost numpy pandas scikit-learn

# Install pnpm (workspace lockfile is used for deterministic installs)
RUN npm install -g pnpm@9

# Copy workspace files and backend manifest
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install backend production dependencies using the workspace lockfile
RUN pnpm install --filter backend --prod --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

ENV NODE_ENV=production \
    PORT=3001 \
    PATH="/app/venv/bin:$PATH"

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/healthz',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "backend/index.js"]
