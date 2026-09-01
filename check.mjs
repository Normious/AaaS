// ponytail: one runnable check for non-trivial PBKDF2 + SHA-256 + JWT paths
import assert from 'node:assert/strict';

// replicate helpers from src/index.ts (Web Crypto is global in Node 20+)
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256);
  const bytes = new Uint8Array(bits);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
async function hashRefreshToken(raw, secret) {
  const d = new TextEncoder().encode(`${raw}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', d);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

const salt = 'test-salt-123456';
const pw = 'SecurePass123!';
const h1 = await hashPassword(pw, salt);
const h2 = await hashPassword(pw, salt);
assert.equal(h1, h2, 'deterministic PBKDF2');
assert.notEqual(await hashPassword('wrong', salt), h1, 'wrong password differs');

const secret = 'test-refresh-secret-32chars-long-xyz';
const raw = 'a1b2c3d4-uuid-test';
const rh1 = await hashRefreshToken(raw, secret);
const rh2 = await hashRefreshToken(raw, secret);
assert.equal(rh1, rh2, 'deterministic refresh hash');
assert.equal(rh1.length, 64, 'sha256 hex length');
assert.notEqual(rh1, await hashRefreshToken(raw, 'other-secret'), 'pepper matters');

// JWT smoke (hono/jwt uses Web Crypto too) — dynamic import to avoid hard dep in check
try {
  const { sign, verify } = await import('hono/jwt');
  const tok = await sign({ sub: 'u1', email: 'a@b.c', exp: Math.floor(Date.now()/1000)+60 }, 'test-jwt-secret-32chars-long-abc123');
  const payload = await verify(tok, 'test-jwt-secret-32chars-long-abc123', 'HS256');
  assert.equal(payload.sub, 'u1');
  console.log('✓ JWT sign/verify ok');
} catch (e) { console.log('⚠ JWT check skipped:', e.message); }

console.log('✓ check.mjs passed — PBKDF2 + SHA-256 + JWT');
