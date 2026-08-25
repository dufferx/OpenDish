FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY services/video-import/package.json ./package.json
COPY services/video-import/tsconfig.json ./tsconfig.json
COPY services/video-import/src ./src

RUN npm install
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp==2026.08.19

COPY services/video-import/package.json ./package.json
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/src/index.js"]
