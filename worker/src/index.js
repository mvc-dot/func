// Func media: a minimal Blossom server (BUD-01, BUD-02) on a Cloudflare Worker + R2.
// PUT /upload with a kind 24242 Nostr auth event stores a blob under its sha256.
// GET /<sha256> serves it. DELETE /<sha256> lets the uploader remove it.
// Blobs expire after RETENTION_DAYS via an R2 lifecycle rule on the bucket. Uploads are rate limited per IP and per key.
import { verifyEvent } from 'nostr-tools/pure';

export const MAX_BYTES = 10 * 1024 * 1024;
export const RETENTION_DAYS = 30;
const AUTH_KIND = 24242;
const SKEW = 60; // seconds of clock drift we tolerate on created_at

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Length, Range, X-SHA-256, X-Content-Length, X-Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Content-Range, Accept-Ranges, ETag, X-Reason, Retry-After',
  'Access-Control-Max-Age': '86400',
};
const now = () => Math.floor(Date.now() / 1000);
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const BLOB_PATH = /^\/([0-9a-f]{64})(\.[a-z0-9]{1,8})?$/i;

const fail = (status, reason) =>
  new Response(reason, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'X-Reason': reason } });
const tooMany = reason =>
  new Response(reason, { status: 429, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'X-Reason': reason, 'Retry-After': '60' } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Parses and validates the BUD-01 "Nostr <base64 event>" Authorization header for a given verb.
function checkAuth(request, verb) {
  const header = request.headers.get('authorization') || '';
  if (!/^Nostr /i.test(header)) return { error: 'missing Nostr authorization' };
  let ev;
  try { ev = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), c => c.charCodeAt(0)))); }
  catch { return { error: 'malformed authorization event' }; }
  if (!ev || typeof ev !== 'object' || !Array.isArray(ev.tags)) return { error: 'malformed authorization event' };
  if (ev.kind !== AUTH_KIND) return { error: `authorization event must be kind ${AUTH_KIND}` };
  let valid = false;
  try { valid = verifyEvent(ev); } catch {}
  if (!valid) return { error: 'invalid authorization signature' };
  const t = now();
  if (typeof ev.created_at !== 'number' || ev.created_at > t + SKEW) return { error: 'authorization event is from the future' };
  const exp = Number(ev.tags.find(x => x[0] === 'expiration')?.[1]);
  if (!exp || exp <= t) return { error: 'authorization event has expired' };
  if (!ev.tags.some(x => x[0] === 't' && x[1] === verb)) return { error: `authorization event is not for ${verb}` };
  return { ev, hashes: ev.tags.filter(x => x[0] === 'x').map(x => String(x[1]).toLowerCase()) };
}

// Reads a request body up to `limit` bytes. Returns null if the body is larger.
async function readLimited(request, limit) {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.byteLength; }
  return out.buffer;
}

const descriptor = (base, sha256, size, type, uploaded) => ({ url: `${base}/${sha256}`, sha256, size, type, uploaded });
const publicBase = (env, url) => (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
// Rate limiting bindings (see wrangler.jsonc). A missing binding means no limit, so local runs still work.
async function overLimit(binding, key) {
  if (!binding || !key) return false;
  try { return !(await binding.limit({ key })).success; } catch { return false; }
}

async function upload(request, env, url) {
  const auth = checkAuth(request, 'upload');
  if (auth.error) return fail(401, auth.error);
  if (await overLimit(env.IP_LIMIT, request.headers.get('cf-connecting-ip'))) return tooMany('too many uploads from this address');
  if (await overLimit(env.KEY_LIMIT, auth.ev.pubkey)) return tooMany('too many uploads from this key');
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BYTES) return fail(413, `blob exceeds ${MAX_BYTES} bytes`);
  const body = await readLimited(request, MAX_BYTES);
  if (body === null) return fail(413, `blob exceeds ${MAX_BYTES} bytes`);
  if (body.byteLength === 0) return fail(400, 'empty blob');
  const sha256 = hex(await crypto.subtle.digest('SHA-256', body));
  if (!auth.hashes.includes(sha256)) return fail(401, 'x tag does not match blob sha256');
  const type = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const existing = await env.BLOBS.head(sha256);
  let uploaded = now();
  if (existing) uploaded = Number(existing.customMetadata?.uploaded) || Math.floor(existing.uploaded.getTime() / 1000);
  else await env.BLOBS.put(sha256, body, { httpMetadata: { contentType: type }, customMetadata: { pubkey: auth.ev.pubkey, uploaded: String(uploaded) } });
  return json(descriptor(publicBase(env, url), sha256, body.byteLength, existing?.httpMetadata?.contentType || type, uploaded));
}

// BUD-06: HEAD /upload lets a client ask whether an upload would be accepted before sending it.
function uploadCheck(request) {
  const len = Number(request.headers.get('x-content-length'));
  if (len > MAX_BYTES) return fail(413, `blob exceeds ${MAX_BYTES} bytes`);
  const sha = request.headers.get('x-sha-256');
  if (sha && !/^[0-9a-f]{64}$/i.test(sha)) return fail(400, 'X-SHA-256 is not a sha256 hex string');
  return new Response(null, { status: 200, headers: CORS });
}

async function getBlob(request, env, sha256, head) {
  const ranged = request.headers.has('range'); // R2 reports a range whenever the option is passed, so only pass it when asked
  const obj = head ? await env.BLOBS.head(sha256) : await env.BLOBS.get(sha256, { range: ranged ? request.headers : undefined, onlyIf: request.headers });
  if (!obj) return fail(404, 'blob not found');
  const headers = new Headers(CORS);
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Accept-Ranges', 'bytes');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  if (head) { headers.set('Content-Length', String(obj.size)); return new Response(null, { status: 200, headers }); }
  if (obj.body === undefined) return new Response(null, { status: 304, headers }); // precondition (If-None-Match) matched
  let status = 200;
  if (ranged && obj.range) {
    const r = obj.range;
    const start = r.suffix != null ? obj.size - r.suffix : (r.offset ?? 0);
    const end = r.suffix != null ? obj.size - 1 : (r.length != null ? start + r.length - 1 : obj.size - 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
    headers.set('Content-Length', String(end - start + 1));
    status = 206;
  } else headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status, headers });
}

async function deleteBlob(request, env, sha256) {
  const auth = checkAuth(request, 'delete');
  if (auth.error) return fail(401, auth.error);
  if (!auth.hashes.includes(sha256)) return fail(401, 'x tag does not match blob sha256');
  const obj = await env.BLOBS.head(sha256);
  if (!obj) return fail(404, 'blob not found');
  if (obj.customMetadata?.pubkey !== auth.ev.pubkey) return fail(403, 'only the uploader can delete this blob');
  await env.BLOBS.delete(sha256);
  return json({ deleted: sha256 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/upload') {
      if (method === 'PUT') return upload(request, env, url);
      if (method === 'HEAD') return uploadCheck(request);
      return fail(405, 'use PUT /upload');
    }
    if (url.pathname === '/') return json({ name: 'Func media', blossom: ['BUD-01', 'BUD-02'], max_bytes: MAX_BYTES, retention_days: RETENTION_DAYS });
    const m = url.pathname.match(BLOB_PATH);
    if (!m) return fail(404, 'not found');
    const sha256 = m[1].toLowerCase();
    if (method === 'GET' || method === 'HEAD') return getBlob(request, env, sha256, method === 'HEAD');
    if (method === 'DELETE') return deleteBlob(request, env, sha256);
    return fail(405, 'method not allowed');
  },
};
