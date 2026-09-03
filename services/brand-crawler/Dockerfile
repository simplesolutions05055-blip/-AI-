FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium PORT=8080
USER node
CMD ["npm", "start"]
