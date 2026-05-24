FROM node:24-alpine AS api

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

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
