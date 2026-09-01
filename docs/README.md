# AAAS — Auth-as-a-Service Docs

> **Live:** `https://aaas.emmanueljin101.workers.dev` &nbsp;|&nbsp; `GET /` → `{"service":"auth-service","status":"ok","version":"1.0.0"}` &nbsp;|&nbsp; `GET /health` → `{"ok":true}`

Central JWT identity provider for the 30 Services challenge. One auth service, 29 consumers. Hono + D1 + Workers, PBKDF2 100k, HS256 15m/7d.

## Architecture

```
[ Client / Frontend / Microservice ]
        │  Authorization: Bearer <JWT>
        ▼
[ Cloudflare Worker — Hono ] ──► [ D1 SQLite ]
  ├─ /auth/register, /login, /refresh, /logout
  └─ /auth/verify ◄── other services call this
        │
        └─ JWT HS256 (15m) + refresh SHA-256 (7d, revocable)
```

- **Stateless verify:** `hono/jwt` `verify(token, JWT_SECRET, 'HS256')` then `SELECT id FROM users WHERE id=?` (defense in depth).
- **Stateful sessions:** `refresh_tokens` table, `token_hash = SHA-256(raw:REFRESH_SECRET)`, O(1) indexed lookup, `revoked` flag.

## Quick Links

| Doc | Purpose |
|-----|---------|
| [API.md](./API.md) | Full endpoint spec + live cURL |
| [openapi.yaml](./openapi.yaml) | OpenAPI 3.0.3 — import to Postman/Swagger |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 7-step deploy + verify |
| [INTEGRATION.md](./INTEGRATION.md) | Day 03 PayChangu verify + KV cache |
| [SECURITY.md](./SECURITY.md) | PBKDF2, pepper, HS256, secrets |
| [SPEC](../AaaS.md) | TDS v1.0.0 (source of truth) |

## Live Check (copy-paste)

```bash
BASE="https://aaas.emmanueljin101.workers.dev"
curl $BASE/          # {"service":"auth-service","status":"ok","version":"1.0.0"}
curl $BASE/health    # {"ok":true}

# full flow
curl -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}'

curl -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}' | tee /tmp/login.json

ACCESS=$(jq -r .access_token /tmp/login.json)
REFRESH=$(jq -r .refresh_token /tmp/login.json)

curl $BASE/auth/verify -H "Authorization: Bearer $ACCESS"

curl -X POST $BASE/auth/refresh -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"

curl -X POST $BASE/auth/logout -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
```

## Project Structure

```
.
├── src/index.ts                 # Hono app — 5 auth endpoints + health
├── migrations/0001_initial.sql  # users + refresh_tokens + 4 indexes
├── wrangler.toml                # name aaas, binding DB, database_id
├── package.json                 # hono 4.7.5, wrangler 4.24, TS 5.7
├── .dev.vars.example            # → .dev.vars (local secrets)
├── check.mjs                    # ponytail: one runnable PBKDF2+JWT check
├── AaaS.md                      # TDS v1.0.0
├── README.md                    # operational README
└── docs/                        # ← you are here
```

## Deploy in 20 mins

See [DEPLOYMENT.md](./DEPLOYMENT.md) — `wrangler login → d1 create → migrate → secret put ×2 → dev → deploy → curl /health`.

---

MIT — reuse for all 30 services. Day 01 is the gatekeeper; get it right, others are easy.
