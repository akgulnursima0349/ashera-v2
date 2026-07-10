FROM node:20-slim

# Install system Chromium (minimal deps only) + Xvfb
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
# Skip Playwright's own browser download — use system chromium instead
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

COPY . .

ENV DISPLAY=:99
ENV CHROMIUM_PATH=/usr/bin/chromium

CMD Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset & \
    sleep 1 && node main.js
