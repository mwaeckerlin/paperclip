# Paperclip of the upstream image, served below an optional base path.
#
# The upstream image carries the whole source tree with its installed
# dependencies, the built interface and the compiled server. This build patches
# the interface source and two compiled server modules (bin/patch-upstream.mjs),
# builds the interface again, and starts the server with app/serve.mjs, which
# serves every request below PAPERCLIP_BASE_PATH. The upstream image is not
# headless and cannot be: the agents Paperclip runs start the shells and the
# command line tools it ships.
FROM ghcr.io/paperclipai/paperclip
USER node
WORKDIR /app
COPY bin/patch-upstream.mjs /opt/paperclip-base-path/patch-upstream.mjs
RUN node /opt/paperclip-base-path/patch-upstream.mjs patch /app
WORKDIR /app/ui
RUN ./node_modules/.bin/vite build
WORKDIR /app
COPY app/configuration.mjs app/serve.mjs app/health.mjs /opt/paperclip-base-path/
COPY app/paperclip-base-path.js /app/ui/dist/paperclip-base-path.js
RUN node /opt/paperclip-base-path/patch-upstream.mjs verify /app
ENV CONTAINERNAME="paperclip" \
    PAPERCLIP_BASE_PATH="" \
    BETTER_AUTH_SECRET_FILE=""
EXPOSE 3100
VOLUME ["/paperclip"]
# The first start creates the embedded PostgreSQL and runs every migration.
HEALTHCHECK --interval=10s --timeout=15s --start-period=600s --retries=3 \
    CMD ["node", "/opt/paperclip-base-path/health.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "--import", "/opt/paperclip-base-path/serve.mjs", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
