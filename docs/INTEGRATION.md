# Integration Guide — Using AAAS as Gatekeeper

Your other 29 services don't write login code. They call `GET /auth/verify`.

Live verifier: `https://aaas.emmanueljin101.workers.dev/auth/verify`

## Flow

```
Client → [Your Service] → (extract Bearer) → GET https://aaas.../auth/verify → 200? use user_id : 401
```

1. Client sends `Authorization: Bearer <JWT>` (from `/auth/login`).
2. Your service extracts header, forwards to AAAS.
3. `200` → `user_id` is trusted → run business logic (e.g., PayChangu payment with `user_id`).
4. `401` → return `401` immediately, no business logic.

## Minimal Example (Hono service)

```ts
import { Hono } from 'hono';

const AUTH_VERIFY = 'https://aaas.emmanueljin101.workers.dev/auth/verify';

async function requireAuth(c: any, next: any) {
  const auth = c.req.header('Authorization');
  if (!auth) return c.json({ error: 'Missing Authorization' }, 401);

  const res = await fetch(AUTH_VERIFY, { headers: { Authorization: auth } });
  if (!res.ok) return c.json({ error: 'Unauthorized' }, 401);

  const { user_id, email } = await res.json(); // { valid, user_id, email, exp }
  c.set('user_id', user_id);
  c.set('email', email);
  await next();
}

const app = new Hono();
app.get('/api/me', requireAuth, (c) => {
  return c.json({ user_id: c.get('user_id'), email: c.get('email') });
});
```

## Node/Express variant

```ts
async function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const r = await fetch('https://aaas.emmanueljin101.workers.dev/auth/verify', {
    headers: { Authorization: auth ?? '' }
  });
  if (!r.ok) return res.status(401).json({ error: 'Unauthorized' });
  req.user = await r.json(); // { valid, user_id, email, exp }
  next();
}
```

## Caching (60s per TDS §7)

Avoid hitting AAAS on every request in high traffic.

**Workers KV example:**

```ts
// KV binding: AUTH_CACHE
const cacheKey = `verify:${token.slice(-16)}`; // never cache full token as key if logged
let cached = await c.env.AUTH_CACHE.get(cacheKey, 'json');
if (!cached) {
  const res = await fetch(AUTH_VERIFY, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return c.json({ error: 'Unauthorized' }, 401);
  cached = await res.json();
  await c.env.AUTH_CACHE.put(cacheKey, JSON.stringify(cached), { expirationTtl: 60 });
}
const user_id = cached.user_id;
```

If no KV, use in-memory `Map` with 60s TTL per worker instance (single-isolate cache).

## Error Handling

| AAAS returns | Your service should |
|--------------|---------------------|
| `200` `{ valid, user_id }` | Continue, use `user_id` |
| `401` missing Bearer | `401` to client |
| `401` invalid/expired | `401` — client must `POST /auth/refresh` then retry |
| `401` user deleted | `401` — force re-login |

## Refresh on Client Side

```ts
// client: on 401 from your service, try refresh
const refresh = localStorage.getItem('refresh_token');
const r = await fetch('https://aaas.emmanueljin101.workers.dev/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: refresh })
});
if (!r.ok) { /* force login */ }
const { access_token } = await r.json();
localStorage.setItem('access_token', access_token);
// retry original request with new Bearer
```

## Day 03 PayChangu Example

```ts
app.post('/pay', requireAuth, async (c) => {
  const user_id = c.get('user_id');
  // user_id came from AAAS verify — trusted
  const { amount, phone } = await c.req.json();
  // ... call PayChangu with user_id as payer reference
  return c.json({ status: 'initiated', user_id });
});
```

## Day 05 Rate Limiter

Use `user_id` from verify as rate-limit key instead of IP:

```ts
const key = `rl:${user_id}:${new Date().toISOString().slice(0,13)}`; // per-hour bucket
```

## Testing Integration Locally

```bash
BASE="https://aaas.emmanueljin101.workers.dev"
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}' | jq -r .access_token)

# your service should accept this token
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/me
```

See [API.md](./API.md#GET-/auth/verify) for full verify spec and [SECURITY.md](./SECURITY.md) for TTL rationale (15m access, 7d refresh).
