# Images de déploiement de Fourmy (docs/deploiement.md).
#   docker build --target api -t fourmy-api .
#   docker build --target web -t fourmy-web .
# Une seule construction du monorepo, deux images d'exécution.

FROM node:22.23.3-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- Construction --------------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Le site public (apps/site) a sa propre image : docker/site.Dockerfile.
RUN pnpm turbo run build --filter='!@fourmy/site'
# Dépendances d'exécution seulement pour l'image API.
RUN pnpm install --frozen-lockfile --prod --offline

# ---- API (Hono) : migrations au démarrage, puis serveur ------------------
FROM base AS api
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api ./apps/api
# Les sources TypeScript et les tests ne servent pas à l'exécution.
RUN find packages apps -type d \( -name src -o -name test \) -prune -exec rm -rf {} + \
 && chown -R node:node /repo
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node packages/db/dist/migrate.js && exec node apps/api/dist/server.js"]

# ---- Web (React) : fichiers statiques + relais /api ----------------------
FROM nginx:1.31.2-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
