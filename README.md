# Auth-as-a-Service — Day 01

[![Live](https://img.shields.io/badge/Live-https://aaas.emmanueljin101.workers.dev-brightgreen)](https://aaas.emmanueljin101.workers.dev) [![Hono](https://img.shields.io/badge/Hono-4.7.5-orange)](https://hono.dev) [![D1](https://img.shields.io/badge/D1-SQLite-blue)](https://developers.cloudflare.com/d1/) [![Workers](https://img.shields.io/badge/Workers-Cloudflare-f38020)](https://workers.cloudflare.com)

**Live:** `https://aaas.emmanueljin101.workers.dev` — `GET /` → `{"service":"auth-service","status":"ok","version":"1.0.0"}` | `GET /health` → `{"ok":true}`

Edge-deployed JWT auth microservice. **Hono + D1 + Workers**. Gatekeeper for the 30 Services challenge.

> **Docs:** [Interactive Architecture](docs/architecture.html) • [docs/README.md](docs/README.md) • [API](docs/API.md) • [OpenAPI](docs/openapi.yaml) • [Deployment](docs/DEPLOYMENT.md) • [Integration](docs/INTEGRATION.md) • [Security](docs/SECURITY.md) • [TDS](AaaS.md)

## Stack
- **Runtime:** Cloudflare Workers
- **Framework:** Hono 4 + `hono/jwt` (HS256)
- **DB:** Cloudflare D1 (SQLite)
- **Hash:** PBKDF2 100k SHA-256 (Web Crypto) + SHA-256 for refresh tokens

## Project Structure
```
.
├── src/index.ts                 # All 5 endpoints (register/login/refresh/verify/logout)
├── migrations/0001_initial.sql  # users + refresh_tokens + 4 indexes
├── wrangler.toml                # name aaas, binding DB → D1 41e0f1fc…, secrets via secret put
├── docs/
│   ├── README.md                # overview + live banner
│   ├── API.md                   # full endpoint spec
│   ├── openapi.yaml             # OpenAPI 3.0.3 (Postman/Swagger)
│   ├── DEPLOYMENT.md            # 7-step deploy
│   ├── INTEGRATION.md           # verify + KV cache for other services
│   └── SECURITY.md              # PBKDF2, pepper, HS256
├── .dev.vars.example            # → .dev.vars (local secrets)
├── check.mjs                    # PBKDF2 + JWT smoke test
├── AaaS.md                      # TDS v1.0.0
└── README.md
```

## Quick Start (20 mins)

```bash
# 1. Install
npm install --legacy-peer-deps

# 2. Cloudflare login
npx wrangler login

# 3. Create D1
npx wrangler d1 create auth-db
# → copy database_id into wrangler.toml

# 4. Migrate
npx wrangler d1 execute auth-db --remote --file=./migrations/0001_initial.sql
# local test:
npx wrangler d1 execute auth-db --local --file=./migrations/0001_initial.sql

# 5. Secrets (32+ chars, must differ)
npx wrangler secret put JWT_SECRET
npx wrangler secret put REFRESH_SECRET

# 6. Local dev
cp .dev.vars.example .dev.vars
# edit .dev.vars, then:
npm run dev

# 7. Deploy
npm run deploy
# → https://aaas.emmanueljin101.workers.dev
```

## API

All JSON. Base: `https://aaas.emmanueljin101.workers.dev` — full spec in [docs/API.md](docs/API.md) + [openapi.yaml](docs/openapi.yaml)

### POST /auth/register
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```
`201` → `{ message, user_id }` | `400` bad input | `409` email exists

### POST /auth/login
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```
`200` → `{ access_token, refresh_token, token_type: "Bearer", expires_in: 900 }` | `401` invalid

### POST /auth/refresh
```json
{ "refresh_token": "uuid" }
```
`200` → `{ access_token, token_type, expires_in }` | `401` invalid/expired/revoked

### GET /auth/verify ⭐ (for other services)
```
Authorization: Bearer <access_token>
```
`200` → `{ valid: true, user_id, email, exp }` | `401` missing/invalid/expired or user deleted

### POST /auth/logout
```json
{ "refresh_token": "uuid" }
```
`200` → `{ message: "Logged out successfully" }` | `404` not found/revoked

### GET / , GET /health
Health checks → `{ ok: true }`

## Testing (cURL) — Live

```bash
BASE="https://aaas.emmanueljin101.workers.dev"

# register
curl -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securepassword123"}'

# login (save tokens)
curl -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"securepassword123"}'

# verify (use access_token)
curl -X GET $BASE/auth/verify -H "Authorization: Bearer <ACCESS_TOKEN>"

# refresh
curl -X POST $BASE/auth/refresh -H "Content-Type: application/json" \
  -d '{"refresh_token":"<REFRESH_TOKEN>"}'

# logout
curl -X POST $BASE/auth/logout -H "Content-Type: application/json" \
  -d '{"refresh_token":"<REFRESH_TOKEN>"}'
```

## Integration (for Day 03 PayChangu etc.)

1. Extract `Authorization: Bearer <token>` from incoming request
2. `GET https://auth-service.../auth/verify` with same header
3. `200` → use `user_id` for business logic
4. `401` → return `401 Unauthorized` immediately
5. *Cache* verify result 60s in Workers KV for high traffic

## Security Notes

- Passwords: PBKDF2 100k SHA-256, per-user salt (16 chars), Base64
- Refresh: SHA-256 hex of `token:REFRESH_SECRET` — indexed O(1) lookup, peppered, revocable
- Access JWT: HS256, 15 min expiry, `sub` + `email` + `exp`
- Refresh: 7d expiry, `revoked` flag, FK cascade on user delete
- Verify checks user existence (defense in depth)
- No secrets in `wrangler.toml` — use `wrangler secret put` / `.dev.vars` locally

### Ponytail decisions (skipped → when to add)
- No bcrypt/zod/ORM — native Web Crypto + inline validation is shorter; add when complexity rises
- No refresh rotation — issues access only; add delete-old + issue-new when theft detection needed
- No per-request DB scan for refresh — fixed to O(1) hash lookup (spec was O(N)*100k)
- No KV cache for verify — add when other services hit >1k rpm

## Deploy Checklist

- [ ] `wrangler.toml` database_id set
- [ ] `migrations/0001_initial.sql` applied (--local and --remote)
- [ ] `JWT_SECRET` + `REFRESH_SECRET` set (32+ chars, different)
- [ ] `npm run deploy` succeeds (dry-run: `wrangler deploy --dry-run`)
- [ ] Test register→login→verify→refresh→logout flow
- [ ] Share base URL in WhatsApp

## License
MIT — reuse for all 30 services.
