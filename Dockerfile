FROM node:22-bookworm-slim AS api

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json turbo.json tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/stt/package.json services/stt/package.json
COPY services/tts/package.json services/tts/package.json
COPY services/llm/package.json services/llm/package.json
COPY services/telephony/package.json services/telephony/package.json
COPY services/rag/package.json services/rag/package.json

RUN NODE_ENV=development npm ci --include=dev
# The lockfile is generated on Windows, so install Linux native CSS build packages explicitly.
RUN NODE_ENV=development npm install --no-save --no-package-lock @tailwindcss/oxide-linux-x64-gnu@4.3.0 lightningcss-linux-x64-gnu@1.32.0
RUN node -e "import('argon2').then(async (argon2) => { await argon2.hash('railway-build-check'); console.log('argon2 ok'); })"

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages packages
COPY services services
COPY scripts scripts

RUN NODE_ENV=production npm run db:generate -w @voxlink/api
RUN NODE_ENV=production npm run build -w @voxlink/shared
RUN NODE_ENV=production npm run build -w @voxlink/stt
RUN NODE_ENV=production npm run build -w @voxlink/tts
RUN NODE_ENV=production npm run build -w @voxlink/llm
RUN NODE_ENV=production npm run build -w @voxlink/telephony
RUN NODE_ENV=production npm run build -w @voxlink/rag
RUN NODE_ENV=production npm run build -w @voxlink/api
RUN NODE_ENV=production npm run build -w @voxlink/web

ENV NODE_ENV=production

EXPOSE 3000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || process.env.API_PORT || '4000') + '/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/railway-start.mjs"]
