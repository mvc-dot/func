// Local test rig: a minimal Nostr relay (ws://localhost:7777), a Blossom mock (http://localhost:7778),
// and a static server for dist/ (http://localhost:7779).
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyEvent } from 'nostr-tools/pure';

const events = []; const subs = new Set(); export const log = { events, uploads: 0, rejected: 0 };
const match = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) &&
  Object.entries(f).filter(([k]) => k[0] === '#').every(([k, v]) => e.tags.some(t => t[0] === k.slice(1) && v.includes(t[1])));
const wss = new WebSocketServer({ port: 7777 });
wss.on('connection', ws => {
  const mine = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m[0] === 'EVENT') {
      const e = m[1]; const ok = verifyEvent(e);
      if (!ok) { log.rejected++; return ws.send(JSON.stringify(['OK', e.id, false, 'invalid: bad sig'])); }
      if (e.kind >= 30000 && e.kind < 40000) { const d = e.tags.find(t => t[0] === 'd')?.[1];
        const i = events.findIndex(x => x.kind === e.kind && x.pubkey === e.pubkey && x.tags.find(t => t[0] === 'd')?.[1] === d);
        if (i >= 0) events.splice(i, 1); }
      events.push(e); ws.send(JSON.stringify(['OK', e.id, true, '']));
      for (const s of subs) for (const [id, fs] of s.mine) if (fs.some(f => match(f, e))) s.ws.send(JSON.stringify(['EVENT', id, e]));
    } else if (m[0] === 'REQ') {
      const [, id, ...fs] = m; mine.set(id, fs);
      for (const e of events) if (fs.some(f => match(f, e))) ws.send(JSON.stringify(['EVENT', id, e]));
      ws.send(JSON.stringify(['EOSE', id]));
    } else if (m[0] === 'CLOSE') mine.delete(m[1]);
  });
  const s = { ws, mine }; subs.add(s); ws.on('close', () => subs.delete(s));
});
const blobs = new Map();
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method === 'PUT' && req.url === '/upload') {
    const auth = JSON.parse(Buffer.from((req.headers.authorization || '').replace('Nostr ', ''), 'base64').toString());
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks); const x = createHash('sha256').update(body).digest('hex');
      if (!verifyEvent(auth) || auth.kind !== 24242 || !auth.tags.some(t => t[0] === 'x' && t[1] === x)) { res.statusCode = 401; return res.end('bad auth'); }
      blobs.set(x, body); log.uploads++;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: `http://localhost:7778/${x}`, sha256: x, size: body.length }));
    }); return;
  }
  const b = blobs.get(req.url.slice(1)); if (b) return res.end(b);
  res.statusCode = 404; res.end();
}).listen(7778);
http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync(new URL('../dist/index.html', import.meta.url))); }).listen(7779);
console.log('rig up');
