# Two stages, and the split is the whole point: the build needs Node and 373
# packages, the result is 15 MB of static files. Only the second stage ships.
#
# This is built by CI and pulled by the server, never built on the server. The
# host that runs it has two cores and ~2 GB free while Chromium is minting
# identities next door; an npm install there is how you OOM PostgreSQL.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a documentation change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

# `vendor/upstream` is the submodule holding the documentation. CI must check
# out with submodules or this directory is empty - `sync-docs.mjs` fails loudly
# in that case rather than publishing a site with no pages in it.
COPY . .
RUN npm run build


FROM nginx:1.29-alpine AS runtime

# `nginx:alpine` ships a default site on port 80; ours replaces it wholesale.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/site.conf
COPY --from=build /app/dist /usr/share/nginx/html

# The image carries no state and writes nothing outside /var/cache/nginx and
# /var/run, so it can run read-only. Declared here as documentation; the compose
# file is what enforces it.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/robots.txt || exit 1
