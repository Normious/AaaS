import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  REFRESH_SECRET: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ---------- CORS ----------
app.use('/*', cors());

// ---------- HEALTH ----------
app.get('/', (c) => c.json({ service: 'auth-service', status: 'ok', version: '1.0.0' }));
app.get('/health', (c) => c.json({ ok: true }));

// ---------- HELPERS ----------

// ponytail: PBKDF2 100k SHA-256 — Web Crypto, no deps. Keep iterations as knob for calibration.
async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const bytes = new Uint8Array(bits);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const derived = await hashPassword(password, salt);
  return derived === hash;
}

// ponytail: SHA-256 hex for refresh tokens — O(1) lookup vs spec's O(N) scan. Add pepper via REFRESH_SECRET.
async function hashRefreshToken(raw: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${raw}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  // hex encode — cheap, readable, indexable
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- 4.1 REGISTER ----------
app.post('/auth/register', async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password || !isValidEmail(email) || password.length < 8) {
    return c.json({ error: 'Valid email and password (min 8 chars) required' }, 400);
  }

  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const salt = crypto.randomUUID().slice(0, 16);
  const password_hash = await hashPassword(password, salt);
  const userId = crypto.randomUUID();
  const now = Date.now();

  await db
    .prepare('INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, email, password_hash, salt, now)
    .run();

  return c.json({ message: 'User registered successfully', user_id: userId }, 201);
});

// ---------- 4.2 LOGIN ----------
app.post('/auth/login', async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return c.json({ error: 'Invalid credentials' }, 401);

  const db = c.env.DB;
  const user = await db
    .prepare('SELECT id, email, password_hash, salt FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();

  if (!user) return c.json({ error: 'Invalid credentials' }, 401);
  if (!(await verifyPassword(password, user.salt, user.password_hash))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const accessToken = await sign(
    { sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 15 },
    c.env.JWT_SECRET,
  );

  const refreshTokenRaw = crypto.randomUUID();
  const refreshTokenId = crypto.randomUUID();
  const tokenHash = await hashRefreshToken(refreshTokenRaw, c.env.REFRESH_SECRET);

  await db
    .prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked) VALUES (?, ?, ?, ?, 0)')
    .bind(refreshTokenId, user.id, tokenHash, Date.now() + 7 * 24 * 60 * 60 * 1000)
    .run();

  return c.json({
    access_token: accessToken,
    refresh_token: refreshTokenRaw,
    token_type: 'Bearer',
    expires_in: 900,
  });
});

// ---------- 4.3 REFRESH ----------
app.post('/auth/refresh', async (c) => {
  let body: { refresh_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const raw = body.refresh_token;
  if (!raw) return c.json({ error: 'Refresh token required' }, 400);

  const db = c.env.DB;
  const tokenHash = await hashRefreshToken(raw, c.env.REFRESH_SECRET);

  const row = await db
    .prepare(
      'SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
    )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: number; revoked: number }>();

  if (!row || row.revoked === 1 || row.expires_at <= Date.now()) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  const user = await db
    .prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ id: string; email: string }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  // ponytail: rotation skipped — issues new access token only. Add rotation (delete old + issue new refresh) when theft detection needed.
  const newAccessToken = await sign(
    { sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 15 },
    c.env.JWT_SECRET,
  );

  return c.json({ access_token: newAccessToken, token_type: 'Bearer', expires_in: 900 });
});

// ---------- 4.4 VERIFY (most-used by other services) ----------
app.get('/auth/verify', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const token = auth.slice(7).trim();
  if (!token) return c.json({ error: 'Missing or invalid Authorization header' }, 401);

  try {
    const payload = (await verify(token, c.env.JWT_SECRET, 'HS256')) as {
      sub: string;
      email: string;
      exp: number;
    };

    // Defense in depth: ensure user still exists
    const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(payload.sub)
      .first();
    if (!user) return c.json({ error: 'User no longer exists' }, 401);

    return c.json({ valid: true, user_id: payload.sub, email: payload.email, exp: payload.exp });
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});

// ---------- 4.5 LOGOUT ----------
app.post('/auth/logout', async (c) => {
  let body: { refresh_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const raw = body.refresh_token;
  if (!raw) return c.json({ error: 'Refresh token required' }, 400);

  const db = c.env.DB;
  const tokenHash = await hashRefreshToken(raw, c.env.REFRESH_SECRET);

  const row = await db
    .prepare('SELECT id FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 LIMIT 1')
    .bind(tokenHash)
    .first<{ id: string }>();

  if (!row) return c.json({ error: 'Token not found or already revoked' }, 404);

  await db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').bind(row.id).run();
  return c.json({ message: 'Logged out successfully' });
});

// ---------- 404 ----------
app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
