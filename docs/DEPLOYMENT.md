# Deployment — AAAS

Live URL: `https://aaas.emmanueljin101.workers.dev` &nbsp;|&nbsp; Worker name: `aaas` &nbsp;|&nbsp; D1: `auth-db` (`41e0f1fc-87a6-43ae-8141-e38115a22b7e`)

## Prereqs

- Node 20+ and `npm`
- Cloudflare account (free tier OK)
- `wrangler` (installed via `npm install`)

## 7-Step Deploy

### 1. Install

```bash
npm install --legacy-peer-deps
```

> `workers-types` peer wants `^5` but we pin `^4.20250821.0` via overrides — `--legacy-peer-deps` clears it. Or `npm install` with overrides works on Node 20.

### 2. Login

```bash
npx wrangler login
# opens browser → authorize
```

### 3. Create D1 (first time only)

```bash
npx wrangler d1 create auth-db
# copy database_id → wrangler.toml [[d1_databases]] database_id
```

Current deployed `database_id` = `41e0f1fc-87a6-43ae-8141-e38115a22b7e` (already in `wrangler.toml`).

### 4. Migrate

```bash
# local (for wrangler dev)
npx wrangler d1 execute auth-db --local --file=./migrations/0001_initial.sql

# remote (prod) — run once, idempotent (IF NOT EXISTS)
npx wrangler d1 execute auth-db --remote --file=./migrations/0001_initial.sql
```

Check:

```bash
npx wrangler d1 execute auth-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
# expect: users, refresh_tokens
```

### 5. Secrets

```bash
npx wrangler secret put JWT_SECRET
# paste 32+ random chars (e.g. openssl rand -base64 32)

npx wrangler secret put REFRESH_SECRET
# different 32+ chars
```

Local dev needs `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars:
# JWT_SECRET="local-32-plus..."
# REFRESH_SECRET="another-local-32-plus..."
```

Never commit `.dev.vars`.

### 6. Dev

```bash
npm run dev
# → http://localhost:8787
curl http://localhost:8787/health # {"ok":true}
curl http://localhost:8787/       # {"service":"auth-service","status":"ok","version":"1.0.0"}
```

### 7. Deploy

```bash
npx wrangler deploy --dry-run   # check: 89 KiB / 21 KiB gzip, binding DB
npm run deploy                  # or npx wrangler deploy
```

Verify prod:

```bash
BASE="https://aaas.emmanueljin101.workers.dev"
curl $BASE/health
curl $BASE/

# full auth flow (see API.md)
curl -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"email":"probe@example.com","password":"ProbePass123!"}'
```

## Scripts

| Script | Cmd |
|--------|-----|
| `npm run dev` | `wrangler dev` |
| `npm run deploy` | `wrangler deploy` |
| `npm run check` | `node check.mjs` — PBKDF2 + JWT smoke |
| `npm run cf:typegen` | `wrangler types` |
| `npm run db:migrate:local` | `wrangler d1 execute --local --file=./migrations/0001_initial.sql` |
| `npm run db:migrate:remote` | `wrangler d1 execute --remote --file=...` |

## Checklist (TDS §8)

- [ ] `wrangler.toml` `database_id` = `41e0f1fc-87a6-43ae-8141-e38115a22b7e`
- [ ] `[[d1_databases]] binding = "DB"` (must match `c.env.DB` in `src/index.ts`)
- [ ] Migration applied both `--local` and `--remote`
- [ ] `JWT_SECRET` + `REFRESH_SECRET` set via `wrangler secret put` (32+ chars, different)
- [ ] `wrangler deploy --dry-run` shows `env.DB (auth-db)` binding
- [ ] `curl /health` → `{"ok":true}` and full register→login→verify→refresh→logout flow passes
- [ ] Live URL shared: `https://aaas.emmanueljin101.workers.dev`

## Rollback

- `wrangler deploy` is atomic; previous version stays if new fails.
- D1 migrations are additive (`IF NOT EXISTS`) — safe to re-run.
- To rotate secrets: `wrangler secret put JWT_SECRET` again, then `wrangler deploy` (old JWTs invalidate after 15m).

## Troubleshooting

- `Expected 3 arguments, but got 2` on `verify` → ensure `verify(token, secret, 'HS256')` (see `src/index.ts:194`).
- `eresolve` on `npm install` → use `npm install --legacy-peer-deps` (workers-types peer).
- `401 Invalid or expired token` after deploy → secrets changed, re-login to get fresh JWT.
- `binding = "auth_db"` vs `c.env.DB` → mismatch causes `DB is undefined`; keep binding `DB`.
