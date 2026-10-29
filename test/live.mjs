import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { createHash, randomBytes } from 'node:crypto';
const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
const sk = generateSecretKey(); const now = Math.floor(Date.now()/1000);
const tag = randomBytes(16).toString('hex');
const msg = finalizeEvent({ kind: 4333, created_at: now, tags: [['t', tag], ['expiration', String(now + 86400)]], content: randomBytes(300).toString('base64') }, sk);
const big = finalizeEvent({ kind: 4333, created_at: now, tags: [['t', tag], ['expiration', String(now + 86400)]], content: randomBytes(37000).toString('base64') }, sk);
const meta = finalizeEvent({ kind: 34333, created_at: now, tags: [['d', tag], ['expiration', String(now + 86400)]], content: randomBytes(80).toString('base64') }, sk);
async function relay(url) {
  return new Promise(res => {
    const out = {}; const ws = new WebSocket(url, { agent }); const t = setTimeout(() => { ws.terminate(); res({ ...out, timeout: true }); }, 12000);
    ws.on('open', () => { for (const e of [msg, big, meta]) ws.send(JSON.stringify(['EVENT', e])); });
    ws.on('message', d => { const m = JSON.parse(d);
      if (m[0] === 'OK') { out[m[1] === msg.id ? 'msg' : m[1] === big.id ? 'big(50KB)' : 'meta'] = m[2] ? 'ok' : 'REJECTED: ' + m[3];
        if (Object.keys(out).length === 3) ws.send(JSON.stringify(['REQ', 's', { kinds: [4333], '#t': [tag] }, { kinds: [34333], authors: [getPublicKey(sk)], '#d': [tag] }])); }
      if (m[0] === 'EVENT') out.readback = (out.readback || 0) + 1;
      if (m[0] === 'EOSE') { clearTimeout(t); ws.close(); res(out); } });
    ws.on('error', e => { clearTimeout(t); res({ error: e.message }); });
  });
}
for (const u of ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://relay.nostr.band', 'wss://nostr.wine', 'wss://offchain.pub', 'wss://relay.nos.social'])
  console.log(u.padEnd(28), JSON.stringify(await relay(u)));

const blob = randomBytes(200000); const x = createHash('sha256').update(blob).digest('hex');
const auth = finalizeEvent({ kind: 24242, created_at: now, content: 'Upload photo', tags: [['t', 'upload'], ['x', x], ['expiration', String(now + 600)]] }, sk);
for (const s of ['https://blossom.primal.net', 'https://nostr.download', 'https://blossom.band', 'https://cdn.nostrcheck.me', 'https://blossom.nostr.build', 'https://24242.io']) {
  try {
    const pre = await fetch(s + '/upload', { method: 'OPTIONS', headers: { Origin: 'https://stub.example', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    const r = await fetch(s + '/upload', { method: 'PUT', headers: { Authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'), 'Content-Type': 'application/octet-stream', Origin: 'https://stub.example' }, body: blob });
    const txt = await r.text(); let url; try { url = JSON.parse(txt).url; } catch {}
    let back = '';
    if (url) { const g = await fetch(url, { headers: { Origin: 'https://stub.example' } }); const b = Buffer.from(await g.arrayBuffer()); back = `get=${g.status} match=${createHash('sha256').update(b).digest('hex') === x} acao=${g.headers.get('access-control-allow-origin')}`; }
    console.log(s.padEnd(28), `preflight=${pre.status} acao=${pre.headers.get('access-control-allow-origin')} put=${r.status} ${url ? url : txt.slice(0, 120).replace(/\s+/g, ' ')} ${back}`);
  } catch (e) { console.log(s.padEnd(28), 'error', e.cause?.code || e.message); }
}
process.exit();
