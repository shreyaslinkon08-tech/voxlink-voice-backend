# VoxLink Voice Platform

Production-style, lean Phase 1 foundation for a multi-tenant AI voice assistant SaaS.

This checkpoint implements the monorepo, infrastructure, database schema, Fastify
bootstrap, auth/tenant foundation, provider contracts, Groq provider adapters, and
dashboard shell, and realtime voice stream boundary while keeping one backend runtime
with modular internal packages.

## Local Shape

- `apps/web` - Next.js dashboard shell
- `apps/api` - single Fastify backend runtime
- `services/*` - internal provider/domain packages, not deployed services
- `packages/shared` - shared schemas, RBAC, tenant, call-state, and provider contracts
- `infrastructure/docker` - local Docker Compose and container build files

## Provider Configuration

Set `GROQ_API_KEYS` in `.env` as a comma-separated list of fresh Groq keys. The API
registers Groq LLM, STT, and TTS providers only when keys are present. Mixtral is
kept as an opt-in model profile via `GROQ_LLM_MODEL_MIXTRAL` because availability can
vary by Groq project.

For Google sign-in, create an OAuth web client in Google Cloud and set
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
`GOOGLE_OAUTH_REDIRECT_URL`. The local callback URL is
`http://localhost:4000/auth/google/callback`.

For paid subscriptions, set `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and Stripe Price IDs for `STRIPE_PRICE_ID_STARTER` and
`STRIPE_PRICE_ID_GROWTH`. Stripe webhooks should post to
`https://your-api-domain.com/webhooks/stripe`.

## Implemented Product Modules

- Tenant-scoped AI agents, phone number mappings, call logs, transcript chunks, and
  text knowledge sources
- First-class call recording metadata with Twilio recording status extraction,
  dashboard visibility, and export-friendly call detail payloads
- Twilio voice/status webhook verification, idempotency keys, phone-number routing,
  and call-state updates
- Twilio Media Streams WebSocket endpoint with signed short-lived stream URLs,
  Redis-backed session state, audio frame buffering, and call state transitions
- Voice turn pipeline for buffered Twilio audio: Groq STT, tenant transcript chunks,
  lexical knowledge retrieval, Groq LLM response generation, Groq TTS synthesis, and
  WAV-to-Twilio-mu-law outbound media frames
- Voice reliability hardening: retry/backoff around provider calls, Twilio `clear`
  messages for caller barge-in, assistant-speaking session state, and system transcript
  records when turns fail
- Provider health registry for Twilio and Groq adapters
- Dashboard pages backed by real tenant-scoped API data with setup forms for agents,
  numbers, and text knowledge sources
- Super-admin company controls, tenant subscription/usage operations, automatic audit
  logging for mutating API requests, and an audit log dashboard
- Company team management: invite operators/company admins, accept invitations during
  signup, update roles, remove members, and enforce at least one remaining admin
- Google sign-in and signup with signed OAuth state cookies, account linking,
  invitation-aware signup, verified-email enforcement, and refresh-session creation
- Stripe Checkout, customer portal, signed webhook verification, webhook idempotency,
  and subscription synchronization for paid launch billing
- Idempotent bootstrap seed for creating the first verified super-admin account

## First Commands

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run db:seed
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Set `BOOTSTRAP_SUPER_ADMIN_EMAIL` and `BOOTSTRAP_SUPER_ADMIN_PASSWORD` before running
`db:seed`. Existing super-admin users are not password-reset unless
`BOOTSTRAP_SUPER_ADMIN_RESET_PASSWORD=true`.

```powershell
copy .env.example .env
npm.cmd run docker:up
```

## Production Hardening Checkpoint

- Production API config now fails fast when placeholder secrets, shared JWT/cookie
  secrets, missing provider keys, or non-HTTPS public/provider URLs are detected.
- The root `Dockerfile` and `railway.json` are configured for an API-only Railway
  deployment. Railway's `PORT` variable is mapped to `API_PORT` automatically.
- Fastify request logging redacts authorization, cookie, Twilio signature,
  idempotency, password, and token fields.
- `/ready` checks Postgres, Redis, and required provider registration. In
  production it requires Twilio plus Groq LLM/STT/TTS providers to be configured.
- API and web Docker images include health checks. Docker Compose mirrors those
  health checks for local parity.
- Deployment helpers:
  - `npm.cmd run db:deploy` runs Prisma migration deploy for release environments.
  - `npm.cmd run db:seed` creates or repairs the first active platform company and
    verified `super_admin` membership.
  - `npm.cmd run smoke:api -- https://api.example.com` checks `/health` and `/ready`.
  - `npm.cmd run backup:postgres` writes a custom-format Postgres dump from the local
    Docker Postgres container into `backups/`.

Before any real launch, rotate any provider keys that were pasted into chat or logs,
set fresh secrets in the runtime environment, and apply the Prisma schema through a
proper migration workflow rather than `db:push`.

## Launch Validation Runbook

Use this sequence against the production environment after DNS, TLS, Postgres, Redis,
Twilio, Google OAuth, Groq, and Stripe secrets are configured:

```powershell
npm.cmd run launch:migrate
npm.cmd run db:seed
npm.cmd run launch:validate
npm.cmd run smoke:api -- https://api.example.com
npm.cmd run launch:twilio-test
```

`launch:twilio-test` places a real outbound call through Twilio. Set
`TWILIO_TEST_FROM_NUMBER` to a Twilio number routed to this app and
`TWILIO_TEST_TO_NUMBER` to the verified destination phone before running it. Use
`npm.cmd run launch:twilio-test -- --dry-run` to inspect the call target without
placing a call.

Real launch blockers that cannot be completed inside this repository are account-side
operations: revoke and regenerate any Groq keys shared in chat, create Google OAuth
credentials, configure Twilio phone-number webhooks to the HTTPS API domain, create
Stripe products/prices and webhook endpoint secrets, and point production DNS at the
deployed web/API runtimes.

## Railway Backend Deploy

Create a Railway service from this GitHub repository and use the root `Dockerfile`.
Add Railway Postgres and Redis plugins, then set these API variables in Railway:
`NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`,
`WEB_ORIGIN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL`,
`GROQ_API_KEYS`, and Stripe/Google variables if those features are enabled.

The container runs `prisma migrate deploy` before starting the Fastify API. After the
first successful deploy, run `npm.cmd run smoke:api -- https://your-railway-domain`
locally and point Twilio webhooks at that same HTTPS API domain.
