FROM oven/bun:alpine AS deps

WORKDIR /app

COPY bun.lock package.json ./

RUN bun install --frozen-lockfile --production && \
    rm -rf /root/.bun/install/cache/*

FROM oven/bun:alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 bunuser && \
    adduser -D -u 1001 -G bunuser bunuser && \
    apk add --no-cache curl

COPY --from=deps --chown=bunuser:bunuser /app/node_modules ./node_modules
COPY --chown=bunuser:bunuser src ./src
COPY --chown=bunuser:bunuser prisma ./prisma
COPY --chown=bunuser:bunuser package.json ./
COPY --chown=bunuser:bunuser tsconfig.json ./
COPY --chown=bunuser:bunuser .env ./

RUN bunx prisma generate

RUN rm -rf /tmp/* /var/cache/apk/* /usr/share/man/* /usr/share/doc/* && \
    find /app/node_modules -name "*.md" -delete && \
    find /app/node_modules -name "*.txt" -delete && \
    find /app/node_modules -name "README*" -delete && \
    find /app/node_modules -name "CHANGELOG*" -delete && \
    find /app/node_modules -name "LICENSE*" -delete && \
    find /app/node_modules -name "test" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /app/node_modules -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find /app/node_modules -name "*.test.js" -delete && \
    find /app/node_modules -name "*.spec.js" -delete && \
    find /app/node_modules -name "*.d.ts" -delete && \
    find /app/node_modules -name "*.map" -delete && \
    mkdir -p logs && \
    chown bunuser:bunuser logs

USER bunuser

EXPOSE 8080

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
CMD ["bun", "run", "src/index.ts"]