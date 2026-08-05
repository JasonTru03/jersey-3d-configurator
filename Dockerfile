FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:showcase

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/workers ./workers
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/index.js"]
