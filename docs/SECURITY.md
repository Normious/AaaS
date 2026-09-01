# Security — AAAS

## Passwords: PBKDF2 100k SHA-256

- `hashPassword(password, salt)` → `crypto.subtle.deriveBits(PBKDF2, 100k, SHA-256, 256)` → `btoa` Base64.
- Per-user salt: `crypto.randomUUID().slice(0,16)` (16 chars), stored in `users.salt`.
- Iterations `100000` = OWASP 2026 minimum. Calibrate upward if `wrangler dev` latency allows (keep as knob, see `src/index.ts:30`).
- Why not bcrypt? Web Crypto in Workers has no bcrypt; PBKDF2 is hardware-accelerated, equally strong at 100k.

**Flow:**
```
register: salt=uuid16 → hash=PBKDF2(pw,salt) → INSERT users
login:    SELECT salt,hash → PBKDF2(pw,salt) === stored? → JWT
```

## Refresh Tokens: Peppered SHA-256, O(1)

- Raw refresh: `crypto.randomUUID()` (128-bit entropy) sent to client.
- Stored: `token_hash = SHA-256(raw:REFRESH_SECRET)` hex (64 chars), indexed `idx_refresh_tokens_token_hash`.
- Pepper `REFRESH_SECRET` (32+ chars, `wrangler secret put`) means DB leak alone doesn't reveal tokens.
- Lookup: `SELECT ... WHERE token_hash=?` single `digest` — vs spec's O(N)×100k PBKDF2 scan (fixed).
- 7-day expiry (`expires_at = now + 7d`), `revoked` flag for logout.

```
// ponytail: SHA-256 hex for refresh — O(1) lookup vs spec's O(N) scan. Add pepper via REFRESH_SECRET.
async function hashRefreshToken(raw, secret) {
  const d = new TextEncoder().encode(`${raw}:${secret}`);
  return hex(await crypto.subtle.digest('SHA-256', d));
}
```

## JWT: HS256, 15m

- `sign({ sub: user.id, email, exp: now/1000 + 900 }, JWT_SECRET)` — default HS256.
- `verify(token, JWT_SECRET, 'HS256')` then `SELECT id FROM users WHERE id=sub` (defense in depth — token invalid if user deleted).
- Secrets 32+ chars, different values, via `wrangler secret put` (encrypted at rest in Cloudflare).
- Never in `wrangler.toml` or `.dev.vars` committed.

## Defense in Depth

| Layer | Mitigates |
|-------|-----------|
| PBKDF2 + salt | Rainbow tables, brute force |
| Peppered refresh hash | DB dump → no token reuse |
| 15m JWT TTL | Stolen access window |
| Verify checks user existence | Deleted user → instant invalid |
| `revoked` + `expires_at` | Logout + auto-expiry |
| FK `refresh_tokens.user_id → users.id ON DELETE CASCADE` | Orphan sessions cleaned |
| CORS `*` → tighten to `https://your-frontend.com` when known | Origin abuse |

## Secrets Handling

```bash
# prod (encrypted)
npx wrangler secret put JWT_SECRET
npx wrangler secret put REFRESH_SECRET

# local (gitignored)
cp .dev.vars.example .dev.vars
# .dev.vars:
# JWT_SECRET="local-32-plus-random..."
# REFRESH_SECRET="another-local-32-plus..."
```

- Rotate: `wrangler secret put JWT_SECRET` again + `wrangler deploy` — old JWTs expire in ≤15m.
- Generate: `openssl rand -base64 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

## Transport

- Always HTTPS (Workers enforce TLS). Never send tokens over HTTP.
- Client stores `access_token` in memory / `refresh_token` in httpOnly secure cookie if possible (JS `localStorage` is XSS-readable — mitigate with short TTL).

## Future (vNext)

- Refresh rotation: on `/auth/refresh`, delete old `token_hash` + issue new refresh (detect reuse → revoke family).
- RBAC: `/auth/roles` + `role` claim in JWT.
- OAuth: Google/GitHub code → JWT exchange.
- Multi-tenant: `app_id` column to isolate Gig4Gig vs Emerge Fund.

## Ponytail Decisions (skipped → when to add)

- No bcrypt — Web Crypto PBKDF2 is shorter, add bcrypt WASM if audit requires.
- No token rotation — add when theft detection matters.
- No rate limiting on `/auth/*` — add Day 05 limiter (key by `email`/`IP`) when brute-force observed.
- No argon2 — add when Workers support it natively.
