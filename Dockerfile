FROM node:22-slim

WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json .npmrc* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps --no-audit --no-fund; else npm install --legacy-peer-deps --no-audit --no-fund; fi

# Copy application source and build frontend assets
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
