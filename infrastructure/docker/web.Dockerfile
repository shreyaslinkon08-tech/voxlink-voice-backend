FROM node:24-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/stt/package.json services/stt/package.json
COPY services/tts/package.json services/tts/package.json
COPY services/llm/package.json services/llm/package.json
COPY services/telephony/package.json services/telephony/package.json
COPY services/rag/package.json services/rag/package.json

RUN npm install

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "dev", "-w", "@altrion/web"]
