# Isolated headless-browser renderer for JS-only fund provider pages.
# Kept separate from the backend image so Chromium can never OOM the app.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /srv

# The image already ships the matching browsers under /ms-playwright.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production \
    PORT=3000

COPY renderer/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY renderer/server.js ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "server.js"]
