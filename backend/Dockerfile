FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install Python for PDF parsing, poppler-utils for pdftotext, tesseract-ocr for scanning
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip poppler-utils tesseract-ocr && rm -rf /var/lib/apt/lists/*

# Install pnpm (workspace lockfile is used for deterministic installs)
RUN npm install -g pnpm@10

# Copy workspace files and manifests
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN mkdir -p frontend/src frontend/public

# Install backend production dependencies using the workspace lockfile
RUN pnpm install --filter backend --prod --no-frozen-lockfile

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN cd frontend && npm install && npm run build

# Copy backend source
COPY backend/ ./backend/

# Install Python PDF parser dependencies
RUN pip3 install --no-cache-dir -r /app/backend/requirements.txt 2>/dev/null || true

# Ensure upload directories exist
RUN mkdir -p /app/backend/uploads/stocks /app/backend/uploads/knowledge

ENV NODE_ENV=production \
    PORT=3001 \
    PYTHON_PATH=python3

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/healthz',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "backend/index.js"]
