FROM node:24-bookworm-slim AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client ripgrep bash \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=30141 \
  PI_WEB_BIND_HOST=0.0.0.0 \
  HOME=/home/piweb \
  PI_CODING_AGENT_DIR=/home/piweb/.pi/agent \
  PI_WEB_HOME=/workspace \
  PI_WEB_DEFAULT_CWD=/workspace \
  PI_WEB_ALLOWED_ROOTS=/workspace:/home/piweb

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client ripgrep bash \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1000 piweb \
  && useradd --system --uid 1000 --gid piweb --create-home --home-dir /home/piweb piweb \
  && mkdir -p /home/piweb/.pi/agent /workspace \
  && chown -R piweb:piweb /home/piweb /workspace /app

COPY --from=builder --chown=piweb:piweb /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=piweb:piweb /app/node_modules ./node_modules
COPY --from=builder --chown=piweb:piweb /app/.next ./.next
COPY --from=builder --chown=piweb:piweb /app/public ./public
COPY --from=builder --chown=piweb:piweb /app/next.config.ts ./next.config.ts

USER piweb
EXPOSE 30141

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||30141)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p ${PORT:-30141} -H ${PI_WEB_BIND_HOST:-0.0.0.0}"]
