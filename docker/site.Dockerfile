# Site public fourmy.org (apps/site) — docs/deploiement.md.
# Construit avec l'historique Git : version et nouveautés en sont calculées
# (packages/release). D'où un fichier d'exclusions propre à cette image
# (site.Dockerfile.dockerignore) qui garde `.git`. Historique superficiel →
# la construction échoue (message explicite) plutôt que de publier une
# version fausse.
FROM node:22.23.3-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY . .
RUN git config --global --add safe.directory /repo
ARG PUBLIC_APP_URL=https://dev.fourmy.org
ARG PUBLIC_SITE_URL=https://fourmy.org
ENV PUBLIC_APP_URL=$PUBLIC_APP_URL PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN pnpm install --frozen-lockfile --filter "@fourmy/site..."
RUN pnpm turbo run build --filter=@fourmy/site

FROM nginx:1.31.2-alpine AS site
COPY docker/site.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/site/dist /usr/share/nginx/html
EXPOSE 80
