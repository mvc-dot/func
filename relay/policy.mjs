#!/usr/bin/env node
// strfry write policy for the Func relay. Reads one JSON request per line on stdin and answers
// with accept/reject. Only Func's own event kinds are stored, and every event must expire within
// MAX_TTL so the relay never accumulates anything a room did not ask for.
// Protocol: https://github.com/hoytech/strfry/blob/master/docs/plugins.md
import { createInterface } from 'node:readline';

const KINDS = new Set([4333, 34333]);     // encrypted room event, host-signed room meta
const MAX_TTL = 45 * 86400;               // rooms last at most 7 days + 3 days grace; leave margin
const MAX_FUTURE = 15 * 60;               // created_at may lead our clock by this much

function decide(ev) {
  if (!KINDS.has(ev.kind)) return 'blocked: this relay only stores Func room events';
  const now = Math.floor(Date.now() / 1000);
  if (ev.created_at > now + MAX_FUTURE) return 'invalid: created_at is in the future';
  const exp = Number(ev.tags.find(t => t[0] === 'expiration')?.[1]);
  if (!exp) return 'invalid: Func events must carry an expiration tag';
  if (exp <= now) return 'invalid: event has already expired';
  if (exp - now > MAX_TTL) return 'blocked: expiration is too far in the future';
  if (!ev.tags.some(t => (t[0] === 't' || t[0] === 'd') && /^[0-9a-f]{32}$/.test(t[1]))) return 'invalid: missing room tag';
  return null;
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.type !== 'new') return;
  const why = decide(req.event);
  process.stdout.write(JSON.stringify(why ? { id: req.event.id, action: 'reject', msg: why } : { id: req.event.id, action: 'accept' }) + '\n');
});
