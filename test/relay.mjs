// Smoke test for the Func relay (strfry + relay/policy.mjs). Needs a running relay.
//   node test/relay.mjs                      → ws://127.0.0.1:7790 (local strfry)
//   RELAY=wss://relay.func.rsvp node test/relay.mjs
import WebSocket from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { randomBytes } from 'node:crypto';

const RELAY = process.env.RELAY || 'ws://127.0.0.1:7790';
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const sk = generateSecretKey(), pk = getPublicKey(sk);
const now = Math.floor(Date.now() / 1000), tag = randomBytes(16).toString('hex');
const ev = (kind, tags, content = 'x') => finalizeEvent({ kind, created_at: now, tags, content }, sk);
const cases = {
  msg: ev(4333, [['t', tag], ['expiration', String(now + 86400)]], randomBytes(300).toString('base64')),
  inlinePhoto: ev(4333, [['t', tag], ['expiration', String(now + 86400)]], randomBytes(37000).toString('base64')),
  meta: ev(34333, [['d', tag], ['expiration', String(now + 86400)]]),
  noExpiration: ev(4333, [['t', tag]]),
  farFuture: ev(4333, [['t', tag], ['expiration', String(now + 400 * 86400)]]),
  noRoomTag: ev(4333, [['expiration', String(now + 86400)]]),
  kind1: ev(1, [['expiration', String(now + 86400)]], 'hello world'),
};
const byId = new Map(Object.entries(cases).map(([n, e]) => [e.id, n]));
const results = {}; let readback = 0;
const info = await fetch(RELAY.replace(/^ws/, 'http'), { headers: { Accept: 'application/nostr+json' } }).then(r => r.json()).catch(() => null);
ok(info?.name === 'Func relay' && info?.supported_nips?.includes(40), 'NIP-11 document names the relay and lists NIP-40 expiration');

await new Promise((resolve, reject) => {
  const ws = new WebSocket(RELAY); const t = setTimeout(() => reject(new Error('timeout talking to ' + RELAY)), 15000);
  ws.on('open', () => { for (const e of Object.values(cases)) ws.send(JSON.stringify(['EVENT', e])); });
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'OK') { results[byId.get(m[1])] = m[2] ? 'ok' : m[3];
      if (Object.keys(results).length === Object.keys(cases).length) ws.send(JSON.stringify(['REQ', 's', { kinds: [4333], '#t': [tag] }, { kinds: [34333], authors: [pk], '#d': [tag] }])); }
    if (m[0] === 'EVENT') readback++;
    if (m[0] === 'EOSE') { clearTimeout(t); ws.close(); resolve(); }
  });
  ws.on('error', e => { clearTimeout(t); reject(e); });
});
ok(results.msg === 'ok', 'kind 4333 room event accepted');
ok(results.inlinePhoto === 'ok', '50 KB inline-photo event accepted');
ok(results.meta === 'ok', 'kind 34333 room meta accepted');
ok(/expiration/.test(results.noExpiration), 'event without expiration rejected: ' + results.noExpiration);
ok(/too far/.test(results.farFuture), 'expiration over 45 days rejected: ' + results.farFuture);
ok(/room tag/.test(results.noRoomTag), 'event without room tag rejected: ' + results.noRoomTag);
ok(/only stores Func/.test(results.kind1), 'kind 1 rejected: ' + results.kind1);
ok(readback === 3, 'the three accepted events read back by room tag');
console.log(process.exitCode ? 'relay tests FAILED' : `relay tests passed against ${RELAY}`);
process.exit();
