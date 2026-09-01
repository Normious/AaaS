# API Reference — AAAS

Base URL: `https://aaas.emmanueljin101.workers.dev`

All endpoints return `application/json`. CORS enabled (`*`).

| Method | Path | Auth | Purpose | Success | Errors |
|--------|------|------|---------|---------|--------|
| `POST` | `/auth/register` | none | Create user | `201` | `400` `409` |
| `POST` | `/auth/login` | none | Issue token pair | `200` | `401` |
| `POST` | `/auth/refresh` | refresh token | New access token | `200` | `400` `401` |
| `GET` | `/auth/verify` | `Bearer <JWT>` | Validate token (for other services) | `200` | `401` |
| `POST` | `/auth/logout` | refresh token | Revoke session | `200` | `400` `404` |
| `GET` | `/` | none | Service info | `200` | — |
| `GET` | `/health` | none | Health check | `200` | — |

---

## POST /auth/register

Create account. Email is lowercased+trimmed, password ≥8.

**Request**
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```

**Success 201**
```json
{ "message": "User registered successfully", "user_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**Errors**
- `400` `{ "error": "Valid email and password (min 8 chars) required" }` — missing/invalid email or password <8
- `400` `{ "error": "Invalid JSON body" }`
- `409` `{ "error": "Email already registered" }`

**cURL (live)**
```bash
BASE="https://aaas.emmanueljin101.workers.dev"
curl -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}'
```

---

## POST /auth/login

Authenticate, issue tokens. Access 15m, refresh 7d.

**Request**
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```

**Success 200**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "a1b2c3d4-1234-5678-9012-abcdef123456",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Errors**
- `401` `{ "error": "Invalid credentials" }` — email not found or password mismatch
- `400` `{ "error": "Invalid JSON body" }`

**cURL**
```bash
curl -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}' | jq
```

---

## POST /auth/refresh

Get new access token via refresh token. Refresh itself stays valid until expiry/revocation.

**Request**
```json
{ "refresh_token": "a1b2c3d4-1234-5678-9012-abcdef123456" }
```

**Success 200**
```json
{ "access_token": "eyJhbGciOi...NEW...", "token_type": "Bearer", "expires_in": 900 }
```

**Errors**
- `400` `{ "error": "Refresh token required" }`
- `401` `{ "error": "Invalid or expired refresh token" }`
- `404` `{ "error": "User not found" }`

**cURL**
```bash
# after login, save REFRESH
curl -X POST $BASE/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}" | jq
```

---

## GET /auth/verify ⭐ Most-used

For downstream services. Validates HS256 signature + expiry + user existence.

**Request**
```
GET /auth/verify
Authorization: Bearer <access_token>
```

**Success 200**
```json
{ "valid": true, "user_id": "550e8400-...", "email": "user@example.com", "exp": 1725220000 }
```

**Errors**
- `401` `{ "error": "Missing or invalid Authorization header" }` — no Bearer
- `401` `{ "error": "Invalid or expired token" }` — bad signature / expired
- `401` `{ "error": "User no longer exists" }` — user deleted after token issued

**cURL**
```bash
curl -X GET $BASE/auth/verify \
  -H "Authorization: Bearer $ACCESS" | jq
```

**Integration snippet (Hono service)**
```ts
const res = await fetch("https://aaas.emmanueljin101.workers.dev/auth/verify", {
  headers: { Authorization: req.header("Authorization") ?? "" }
});
if (!res.ok) return c.json({ error: "Unauthorized" }, 401);
const { user_id } = await res.json();
```

---

## POST /auth/logout

Revoke refresh token (single device). Access token remains valid until its 15m expiry — verify will still pass until expiry (short TTL mitigates).

**Request**
```json
{ "refresh_token": "a1b2c3d4-..." }
```

**Success 200**
```json
{ "message": "Logged out successfully" }
```

**Errors**
- `400` `{ "error": "Refresh token required" }`
- `404` `{ "error": "Token not found or already revoked" }`

**cURL**
```bash
curl -X POST $BASE/auth/logout \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
```

---

## GET / & GET /health

**GET /**
```json
{ "service": "auth-service", "status": "ok", "version": "1.0.0" }
```

**GET /health**
```json
{ "ok": true }
```

**cURL**
```bash
curl https://aaas.emmanueljin101.workers.dev/
curl https://aaas.emmanueljin101.workers.dev/health
```

---

## Status Codes Summary

| Code | When |
|------|------|
| `200` | OK (login/verify/refresh/logout/health) |
| `201` | Created (register) |
| `400` | Invalid JSON / missing fields / bad email / short password |
| `401` | Bad credentials / bad/expired token / missing Bearer |
| `404` | Refresh token not found (logout) or user deleted (refresh) |
| `409` | Email exists |

## Headers

- `Content-Type: application/json` for all POST bodies
- `Authorization: Bearer <token>` for `/auth/verify`

See [openapi.yaml](./openapi.yaml) for machine-readable spec and [INTEGRATION.md](./INTEGRATION.md) for service-to-service flow.
