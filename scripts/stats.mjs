// Usage stats from our own relay, with no tracking in the app. Rooms expire, so run this daily to keep history.
//   node scripts/stats.mjs            → prints today's numbers
//   node scripts/stats.mjs --append   → also appends a row to ~/Library/Application Support/func-relay/stats.csv
// A room = one kind 34333 meta. A guest = a distinct pubkey that posted a kind 4333 event in that room (hosts included).
import WebSocket from 'ws';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const RELAY = process.env.RELAY || 'ws://127.0.0.1:7790';
const CSV = `${homedir()}/Library/Application Support/func-relay/stats.csv`;
const events = await new Promise((res, rej) => {
  const out = []; const ws = new WebSocket(RELAY);
  const t = setTimeout(() => rej(new Error('timeout')), 15000);
  ws.on('open', () => ws.send(JSON.stringify(['REQ', 's', { kinds: [34333], limit: 1000 }, { kinds: [4333], limit: 1000 }])));
  ws.on('message', d => { const m = JSON.parse(d); if (m[0] === 'EVENT') out.push(m[2]); if (m[0] === 'EOSE') { clearTimeout(t); ws.close(); res(out); } });
  ws.on('error', e => { clearTimeout(t); rej(e); });
});
const dayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
const rooms = new Map();
for (const e of events) {
  const tag = e.tags.find(t => t[0] === (e.kind === 34333 ? 'd' : 't'))?.[1]; if (!tag) continue;
  const r = rooms.get(tag) || { meta: null, posters: new Set(), events: 0 };
  if (e.kind === 34333) r.meta = e; else { r.posters.add(e.pubkey); r.events++; }
  rooms.set(tag, r);
}
const live = [...rooms.values()];
const withMeta = live.filter(r => r.meta);
const row = {
  date: new Date().toISOString().slice(0, 10),
  rooms_live: withMeta.length,
  rooms_created_today: withMeta.filter(r => r.meta.created_at >= dayStart).length,
  rooms_with_posts: live.filter(r => r.events > 0).length,
  guests_live: new Set(live.flatMap(r => [...r.posters])).size,
  events_live: live.reduce((n, r) => n + r.events, 0),
};
console.table(row);
if (process.argv.includes('--append')) {
  mkdirSync(CSV.replace(/\/[^/]+$/, ''), { recursive: true });
  if (!existsSync(CSV)) appendFileSync(CSV, Object.keys(row).join(',') + '\n');
  appendFileSync(CSV, Object.values(row).join(',') + '\n');
  console.log('appended to', CSV);
}
process.exit();
