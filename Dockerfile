FROM node:24-alpine AS base

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json turbo.json tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/stt/package.json services/stt/package.json
COPY services/tts/package.json services/tts/package.json
COPY services/llm/package.json services/llm/package.json
COPY services/telephony/package.json services/telephony/package.json
COPY services/rag/package.json services/rag/package.json

RUN npm ci

COPY apps/api apps/api
COPY packages packages
COPY services services

RUN npm run db:generate -w @altrion/api
RUN npm run build -w @altrion/shared
RUN npm run build -w @altrion/stt
RUN npm run build -w @altrion/tts
RUN npm run build -w @altrion/llm
RUN npm run build -w @altrion/telephony
RUN npm run build -w @altrion/rag
RUN npm run build -w @altrion/api

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || process.env.PORT || '4000') + '/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run db:deploy -w @altrion/api && npm run start -w @altrion/api"]
