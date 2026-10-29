// Tests the Blossom Worker (worker/src/index.js) in-process against a mock R2 bucket.
// Covers BUD-01 auth + CORS, BUD-02 upload/get/delete, the 10 MB cap, and per-IP / per-key rate limits.
import worker, { MAX_BYTES } from '../worker/src/index.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { createHash, randomBytes } from 'node:crypto';

const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

// ---- mock R2 (just enough of the binding surface the worker uses) ----
class MockR2 {
  constructor() { this.m = new Map(); }
  #obj(o) { return { key: o.key, size: o.data.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, uploaded: o.uploaded, httpEtag: `"${o.key.slice(0, 16)}"` }; }
  async head(k) { const o = this.m.get(k); return o ? this.#obj(o) : null; }
  async get(k, opts = {}) { const o = this.m.get(k); if (!o) return null; return { ...this.#obj(o), body: new Blob([o.data]).stream(), range: opts.range ? { offset: 0, length: o.data.byteLength } : undefined }; } // real R2 sets .range whenever the option is passed
  async put(k, data, opts = {}) { this.m.set(k, { key: k, data: new Uint8Array(data), httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {}, uploaded: new Date() }); }
  async delete(k) { for (const x of [].concat(k)) this.m.delete(x); }
  async list({ limit = 1000, cursor } = {}) {
    const keys = [...this.m.keys()].sort(); const start = cursor ? Number(cursor) : 0; const slice = keys.slice(start, start + limit);
    return { objects: slice.map(k => this.#obj(this.m.get(k))), truncated: start + limit < keys.length, cursor: String(start + limit) };
  }
}

const BASE = 'https://media.func.test';
const env = { BLOBS: new MockR2(), PUBLIC_URL: BASE };
const call = (path, init = {}) => worker.fetch(new Request(BASE + path, init), env);
const sha = b => createHash('sha256').update(b).digest('hex');
const sk = generateSecretKey(), pk = getPublicKey(sk);
const authFor = (verb, x, key = sk, extra = {}) => {
  const t = Math.floor(Date.now() / 1000);
  const ev = finalizeEvent({ kind: extra.kind ?? 24242, created_at: extra.created_at ?? t, content: verb,
    tags: [['t', verb], ['x', x], ['expiration', String(extra.expiration ?? t + 600)]] }, key);
  if (extra.tamper) ev.sig = ev.sig.replace(/^./, c => (c === 'a' ? 'b' : 'a'));
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
};
const put = (bytes, auth, headers = {}) => call('/upload', { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/octet-stream', ...headers }, body: bytes });

// ---- CORS ----
const pre = await call('/upload', { method: 'OPTIONS', headers: { Origin: 'https://func.rsvp', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /PUT/.test(pre.headers.get('access-control-allow-methods')) && /authorization/i.test(pre.headers.get('access-control-allow-headers')), 'preflight allows PUT with Authorization from any origin');

// ---- upload + get ----
const blob = randomBytes(300 * 1024); const x = sha(blob);
let r = await put(blob, authFor('upload', x));
let j = await r.json();
ok(r.status === 200 && j.sha256 === x && j.size === blob.length && j.url === `${BASE}/${x}` && j.type === 'application/octet-stream' && typeof j.uploaded === 'number', 'PUT /upload with kind 24242 auth returns a blob descriptor');
ok(r.headers.get('access-control-allow-origin') === '*', 'upload response carries CORS header');
r = await call('/' + x);
const back = Buffer.from(await r.arrayBuffer());
ok(r.status === 200 && back.equals(blob) && r.headers.get('content-type') === 'application/octet-stream' && r.headers.get('access-control-allow-origin') === '*', 'GET /<sha256> returns identical bytes as application/octet-stream with CORS');
ok(/immutable/.test(r.headers.get('cache-control')) && r.headers.get('content-length') === String(blob.length), 'GET sets immutable cache headers and content-length');
r = await call('/' + x, { headers: { Range: 'bytes=0-9' } });
ok(r.status === 206 && /^bytes 0-/.test(r.headers.get('content-range')), 'GET with a Range header answers 206 with Content-Range');
r = await call('/' + x, { method: 'HEAD' });
ok(r.status === 200 && r.headers.get('content-length') === String(blob.length), 'HEAD /<sha256> reports size');
r = await call('/' + x + '.bin');
ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(blob), 'GET /<sha256>.bin also serves the blob');
r = await put(blob, authFor('upload', x));
ok(r.status === 200 && (await r.json()).sha256 === x, 're-uploading the same blob is idempotent');
r = await call('/' + 'f'.repeat(64));
ok(r.status === 404 && r.headers.get('x-reason'), 'unknown sha256 is 404 with X-Reason');
r = await call('/upload', { method: 'HEAD', headers: { 'X-SHA-256': x, 'X-Content-Length': String(blob.length) } });
ok(r.status === 200, 'HEAD /upload accepts a normal upload check');
r = await call('/upload', { method: 'HEAD', headers: { 'X-SHA-256': x, 'X-Content-Length': String(MAX_BYTES + 1) } });
ok(r.status === 413, 'HEAD /upload rejects an oversize check with 413');

// ---- auth failures ----
const other = randomBytes(1000);
r = await put(other, authFor('upload', x));                                     ok(r.status === 401 && /x tag/.test(r.headers.get('x-reason')), 'x tag mismatch is rejected');
r = await put(other, authFor('upload', sha(other), sk, { tamper: true }));       ok(r.status === 401 && /signature/.test(r.headers.get('x-reason')), 'bad signature is rejected');
r = await put(other, authFor('upload', sha(other), sk, { kind: 1 }));            ok(r.status === 401 && /24242/.test(r.headers.get('x-reason')), 'wrong kind is rejected');
r = await put(other, authFor('upload', sha(other), sk, { expiration: Math.floor(Date.now() / 1000) - 5 })); ok(r.status === 401 && /expired/.test(r.headers.get('x-reason')), 'expired auth is rejected');
r = await put(other, authFor('delete', sha(other)));                             ok(r.status === 401 && /not for upload/.test(r.headers.get('x-reason')), 'auth for a different verb is rejected');
r = await call('/upload', { method: 'PUT', body: other });                        ok(r.status === 401, 'missing auth is rejected');
r = await call('/upload', { method: 'PUT', headers: { Authorization: 'Nostr !!!' }, body: other }); ok(r.status === 401, 'garbage auth is rejected');
ok(env.BLOBS.m.size === 1, 'rejected uploads stored nothing');

// ---- size cap ----
const big = Buffer.alloc(MAX_BYTES + 1, 7);
r = await put(big, authFor('upload', sha(big)));
ok(r.status === 413, '10 MB + 1 byte is rejected while streaming');
r = await put(big, authFor('upload', sha(big)), { 'Content-Length': String(big.length) });
ok(r.status === 413, '10 MB + 1 byte is rejected early from Content-Length');
const max = Buffer.alloc(MAX_BYTES, 9);
r = await put(max, authFor('upload', sha(max)));
ok(r.status === 200 && (await r.json()).size === MAX_BYTES, 'exactly 10 MB is accepted');
r = await put(Buffer.alloc(0), authFor('upload', sha(Buffer.alloc(0))));
ok(r.status === 400, 'empty blob is rejected');

// ---- delete ----
const stranger = generateSecretKey();
r = await call('/' + x, { method: 'DELETE', headers: { Authorization: authFor('delete', x, stranger) } });
ok(r.status === 403, 'a different key cannot delete the blob');
r = await call('/' + x, { method: 'DELETE', headers: { Authorization: authFor('upload', x) } });
ok(r.status === 401, 'upload auth cannot be reused for delete');
r = await call('/' + x, { method: 'DELETE', headers: { Authorization: authFor('delete', x) } });
ok(r.status === 200 && (await call('/' + x)).status === 404, 'the uploader can delete, and the blob is gone');

// ---- rate limits (mock of the Workers rate limiting binding) ----
class MockLimiter {
  constructor(limit) { this.limit_ = limit; this.counts = new Map(); }
  async limit({ key }) { const n = (this.counts.get(key) || 0) + 1; this.counts.set(key, n); return { success: n <= this.limit_ }; }
}
const rlEnv = { BLOBS: new MockR2(), PUBLIC_URL: BASE, IP_LIMIT: new MockLimiter(3), KEY_LIMIT: new MockLimiter(2) };
const rl = (bytes, key, ip) => worker.fetch(new Request(BASE + '/upload', { method: 'PUT', headers: { Authorization: authFor('upload', sha(bytes), key), 'Content-Type': 'application/octet-stream', 'CF-Connecting-IP': ip }, body: bytes }), rlEnv);
const k1 = generateSecretKey(), k2 = generateSecretKey(), k3 = generateSecretKey();
r = await rl(randomBytes(10), k1, '1.1.1.1'); ok(r.status === 200, 'first upload from a key is accepted');
r = await rl(randomBytes(10), k1, '1.1.1.1'); ok(r.status === 200, 'second upload from the same key is accepted');
r = await rl(randomBytes(10), k1, '1.1.1.1'); ok(r.status === 429 && /key/.test(r.headers.get('x-reason')) && r.headers.get('retry-after') === '60', 'third upload from the same key is rate limited with 429 and Retry-After');
r = await rl(randomBytes(10), k2, '2.2.2.2'); ok(r.status === 200, 'a different key from a different address is unaffected');
r = await rl(randomBytes(10), k3, '1.1.1.1'); ok(r.status === 429 && /address/.test(r.headers.get('x-reason')), 'a new key from an exhausted address is rate limited per IP');
ok(rlEnv.BLOBS.m.size === 3, 'rate-limited uploads stored nothing');
r = await worker.fetch(new Request(BASE + '/upload', { method: 'PUT', headers: { Authorization: 'Nostr nope', 'CF-Connecting-IP': '3.3.3.3' }, body: 'x' }), rlEnv);
ok(r.status === 401 && !rlEnv.IP_LIMIT.counts.has('3.3.3.3'), 'bad auth is rejected before it counts against the limit');
r = await worker.fetch(new Request(BASE + '/upload', { method: 'PUT', headers: { Authorization: authFor('upload', sha(Buffer.from('nolimit'))), 'Content-Type': 'application/octet-stream' }, body: Buffer.from('nolimit') }), { BLOBS: new MockR2(), PUBLIC_URL: BASE });
ok(r.status === 200, 'without rate limit bindings uploads still work (local dev)');

console.log(process.exitCode ? 'blossom tests FAILED' : 'blossom tests passed');
