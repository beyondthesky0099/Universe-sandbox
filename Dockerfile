# Astrarium: web app + companion server (gallery, multiplayer, Claude scene builder) in one image.
#   docker build -t astrarium .
#   docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... -v astrarium-data:/data astrarium

FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /app/dist /srv/dist
ENV PORT=8787 DATA_DIR=/data STATIC_DIR=/srv/dist NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
EXPOSE 8787
VOLUME ["/data"]
USER node
CMD ["node", "src/index.ts"]
