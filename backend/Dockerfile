FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# ML is offloaded to Modal serverless — no Python/ML deps needed
# Install pnpm (workspace lockfile is used for deterministic installs)
RUN npm install -g pnpm@10

# Copy workspace files and backend manifest
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install backend production dependencies using the workspace lockfile
RUN pnpm install --filter backend --prod --no-frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/healthz',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "backend/index.js"]
