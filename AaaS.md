Here is the **complete, formal Technical Design Specification (TDS)** for the **Auth-as-a-Service** microservice. 

You can save this as `SPEC-Day-01-Auth-Service.md` in your project repo, share it with Blessings, or pin it in the WhatsApp group so participants know exactly what this service does and how to integrate it into their own projects.

---

# 📄 Technical Design Specification
## Auth-as-a-Service (Day 01)

**Project:** 30 Days, 30 Services Challenge (September 2026)  
**Author:** Emmanuel Phiri  
**Version:** 1.0.0  
**Date:** September 1, 2026  
**Status:** ✅ Production Ready / Deployable

---

## 1. Overview & Purpose

**Auth-as-a-Service** is a lightweight, edge-deployed authentication microservice built to serve as the central identity provider (IdP) for all other projects in the 30-day challenge and future applications (e.g., Gig4Gig, Emerge Fund).

**Core Philosophy:** 
Instead of implementing login/registration logic in every new app (Day 3, Day 15, Day 28), all services will delegate authentication to this single source of truth. This centralizes security updates, password policies, and session management.

**Primary Responsibilities:**
- User registration and secure password storage.
- JWT Access Token issuance (short-lived).
- Refresh Token management (long-lived, one-time use via rotation).
- Token verification endpoint (for API gateway and microservices).
- Secure logout (refresh token revocation).

---

## 2. Technology Stack

| Component | Technology | Justification |
| :--- | :--- | :--- |
| **Runtime** | Cloudflare Workers | Global low-latency, serverless, scales to zero, free tier available. |
| **Framework** | Hono | Ultra-fast, lightweight, built-in JWT support, TypeScript-first. |
| **Database** | Cloudflare D1 (SQLite) | Serverless relational DB; perfect for small-to-medium user bases; native Workers integration. |
| **Auth Protocol** | JWT (RFC 7519) | Stateless access tokens; no database lookup required for standard verification. |
| **Hashing** | PBKDF2 (Web Crypto) | NIST-approved; implemented natively in Workers without external dependencies. |
| **Encryption** | HS256 (Symmetric) | Fastest for edge computing; secrets are stored as Cloudflare encrypted environment variables. |

---

## 3. Database Schema (D1 / SQLite)

The schema consists of two tables to separate identity from session data.

### Table: `users`
Stores core account details.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY, UUID v4 | Unique user identifier (immutable). |
| `email` | TEXT | UNIQUE, NOT NULL | User's login identifier. |
| `password_hash` | TEXT | NOT NULL | PBKDF2 derived key (Base64 encoded). |
| `salt` | TEXT | NOT NULL | Unique per-user salt (16 chars). |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (milliseconds) of account creation. |

### Table: `refresh_tokens`
Manages active device/application sessions.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY, UUID v4 | Unique token identifier. |
| `user_id` | TEXT | FOREIGN KEY (`users.id`) | Owner of the token. |
| `token_hash` | TEXT | NOT NULL | Hashed refresh token (defense in depth). |
| `expires_at` | INTEGER | NOT NULL | Unix timestamp (milliseconds) for auto-expiry. |
| `revoked` | BOOLEAN | DEFAULT FALSE | Soft delete; used for logout and token theft detection. |

**Indexes:**
- `idx_users_email` (for fast login lookups).
- `idx_refresh_tokens_user_id` (for cascading revocations).

---

## 4. API Endpoints Specification

All endpoints return `application/json`. 
Base URL: `https://auth-service.[your-subdomain].workers.dev`

---

### 4.1. `POST /auth/register`
Creates a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "YourSecurePass123!"
}
```

**Success Response (201 Created):**
```json
{
  "message": "User registered successfully",
  "user_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses:**
- `400` - Missing email/password or password < 8 chars.
- `409` - Email already exists in the database.

---

### 4.2. `POST /auth/login`
Authenticates a user and issues token pair.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "YourSecurePass123!"
}
```

**Success Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "a1b2c3d4-1234-5678-9012-abcdef123456",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Error Responses:**
- `401` - Invalid credentials (email or password mismatch).

---

### 4.3. `POST /auth/refresh`
Obtain a new access token using a valid refresh token.

**Request Body:**
```json
{
  "refresh_token": "a1b2c3d4-1234-5678-9012-abcdef123456"
}
```

**Success Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...NEW...",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Error Responses:**
- `401` - Invalid, expired, or revoked refresh token.

---

### 4.4. `GET /auth/verify` ⭐ **(Most Used by Other Services)**
Middleware endpoint to validate access tokens for downstream services.

**Request Headers:**
```
Authorization: Bearer [access_token]
```

**Success Response (200 OK):**
```json
{
  "valid": true,
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "exp": 1725220000
}
```

**Error Responses:**
- `401` - Missing Authorization header, malformed header, invalid signature, or expired token.

---

### 4.5. `POST /auth/logout`
Revokes the provided refresh token (destroys the session).

**Request Body:**
```json
{
  "refresh_token": "a1b2c3d4-1234-5678-9012-abcdef123456"
}
```

**Success Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses:**
- `404` - Token not found or already revoked.

---

## 5. Security Architecture

1. **Password Handling (PBKDF2)**
   - Iterations: `100,000` (OWASP recommended minimum for 2026).
   - Hash: `SHA-256`.
   - Salt: 16-character UUID v4 fragment (unique per user).
   - *Why not bcrypt?* Web Crypto API in Cloudflare Workers doesn't support bcrypt natively; PBKDF2 is hardware-accelerated and equally secure with sufficient iterations.

2. **Refresh Token Strategy (Rotation)**
   - Refresh tokens are **one-time-use by principle**, though this implementation checks expiry/revocation before issuing new access tokens.
   - Stored as a hash (`PBKDF2`) to protect against database leaks.

3. **Access Token (JWT)**
   - Short lifespan: **15 minutes** (minimizes window of exploitation).
   - Signed with HS256 using a 32+ character secret stored securely (`wrangler secret put`).

4. **Defense in Depth**
   - Logout revokes the refresh token, rendering the access token invalid only after its 15-minute TTL unless manually verified.
   - Verification endpoint explicitly checks if the `sub` (user_id) still exists in the database.

---

## 6. Environment Variables (Secrets)

Set these using `npx wrangler secret put <KEY>`.

| Variable | Example Value | Requirement |
| :--- | :--- | :--- |
| `JWT_SECRET` | `sd98fj29sjf92jf29sjf29sjf29sjf2` | Minimum 32 characters. |
| `REFRESH_SECRET` | `h3i2h3i2h3i2h3i2h3i2h3i2h3i2h3i2` | Minimum 32 characters (must differ from JWT_SECRET). |

---

## 7. Integration Guide (For Day 03, Day 15, etc.)

When a microservice (e.g., the PayChangu Payment Service) receives an incoming request, it must verify the user's identity by calling this Auth Service.

**Standard Integration Flow:**
1. Extract the `Authorization: Bearer <token>` header from the incoming HTTP request.
2. Make an internal HTTP call to `GET /auth/verify` with that header.
3. If the response is `200 OK`, extract the `user_id` from the JSON payload.
4. Execute the business logic (e.g., process payment) using that `user_id`.
5. If the response is `401`, return an `401 Unauthorized` response to the client immediately.

**Caching Recommendation:** 
Cache the verification result for **60 seconds** in a worker KV store to avoid hitting the Auth service on every single request in high-traffic scenarios.

---

## 8. Deployment Checklist (For Admins)

- [ ] Cloudflare account created and `wrangler` installed.
- [ ] D1 Database created (`wrangler d1 create auth-db`).
- [ ] Database migrations applied.
- [ ] `wrangler.toml` configured with the correct `database_id`.
- [ ] `JWT_SECRET` and `REFRESH_SECRET` pushed as encrypted secrets.
- [ ] Service deployed (`wrangler deploy`).
- [ ] Base URL shared in the WhatsApp group for other participants to test.

---

## 9. Future Improvements (vNext / Post-Challenge)

1. **OAuth2 / Social Login Hooks** - Add endpoints to exchange Google/Github OAuth codes for JWTs.
2. **Multi-tenant Support** - Introduce an `app_id` field to separate users across different projects (e.g., Gig4Gig users vs. Emerge Fund users).
3. **User Metadata** - Add a JSON field for storing user preferences/profiles without creating a new service.
4. **Admin Role Management** - Add `/auth/roles` endpoints to support RBAC (Role-Based Access Control) across services.

---

## 10. Daily Submission Reminder (For WhatsApp)

> **📸 Day 01 — Auth-as-a-Service**  
> *Secure JWT authentication microservice deployed on Cloudflare Workers.*  
> *(Attach screenshot of `src/index.ts` showing the `/auth/login` handler or the database migration schema).*

---

**Specification Complete.** Go build it, Emmanuel! Let me know if you want the matching OpenAPI 3.0 YAML spec for Postman/Swagger to accompany this document. 💡