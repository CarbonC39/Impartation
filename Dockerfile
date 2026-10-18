FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app
ARG REPOSITORY_URL=https://github.com/CarbonC39/VirtualWorkspace
LABEL org.opencontainers.image.source=$REPOSITORY_URL
ENV NODE_ENV=production \
    PORT=2567 \
    DATABASE_PATH=/app/data/world.sqlite \
    FRONTEND_DIST_PATH=/app/apps/frontend/dist
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/build ./apps/backend/build
COPY --from=build /app/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/assets ./assets
RUN mkdir /app/data && chown -R node:node /app/data
USER node
EXPOSE 2567
VOLUME /app/data
CMD ["node", "apps/backend/build/index.js"]
