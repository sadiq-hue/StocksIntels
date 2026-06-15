FROM node:20-alpine

WORKDIR /app

# Install Python + build deps for XGBoost
RUN apk add --no-cache python3 py3-pip build-base && \
    python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir xgboost numpy pandas scikit-learn

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

ENV NODE_ENV=production \
    PORT=3001 \
    PATH="/app/venv/bin:$PATH"

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/healthz',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "index.js"]
