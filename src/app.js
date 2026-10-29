// Func — a private, expiring room for an event, built on Nostr.
// Everything a guest sees is encrypted with a key that lives only in the invite link's #fragment,
// so relays and photo hosts store ciphertext they cannot read.
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import qrcode from 'qrcode-generator';

// ---------- config ----------
const KIND_MSG = 4333;      // regular event: encrypted chat message / photo / hide
const KIND_META = 34333;    // addressable event: encrypted room details, host-signed
const GRACE = 3 * 86400;    // events and photos stay readable this long after the room closes
const qp = new URLSearchParams(location.search);
const RELAYS = (qp.get('relays') || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://relay.snort.social').split(',');
const BLOSSOM = (qp.get('blossom') || 'https://nostr.download').split(',');

// ---------- small utils ----------
const $ = (s, el = document) => el.querySelector(s);
const te = new TextEncoder(), td = new TextDecoder();
const now = () => Math.floor(Date.now() / 1000);
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const b64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64u = b => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('func:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('func:' + k, JSON.stringify(v)); } catch {} },
};
const hue = pk => parseInt(pk.slice(0, 6), 16) % 360;
const initial = n => (n || '?').trim().charAt(0).toUpperCase() || '?';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
const icon = {
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

// ---------- room crypto ----------
async function roomKeys(secret) {
  const roomId = hex(await sha256(concat(te.encode('func:id:'), secret))).slice(0, 32);
  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('func-v1'), info: te.encode('func:enc') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { roomId, key };
}
async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return concat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)));
}
async function unseal(key, data) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)));
}
const sealJSON = async (key, obj) => b64(await seal(key, te.encode(JSON.stringify(obj))));
const unsealJSON = async (key, s) => JSON.parse(td.decode(await unseal(key, unb64(s))));

// ---------- relay pool ----------
class Pool {
  constructor(urls, onEvent, onChange) {
    this.subs = new Map(); this.waiting = new Map(); this.onEvent = onEvent; this.onChange = onChange;
    this.conns = urls.map(url => this.connect(url));
  }
  connect(url) {
    const c = { url, ws: null, open: false, queue: [], backoff: 1000 };
    const go = () => {
      let ws; try { ws = new WebSocket(url); } catch { return; }
      c.ws = ws;
      ws.onopen = () => {
        c.open = true; c.backoff = 1000;
        for (const [id, f] of this.subs) ws.send(JSON.stringify(['REQ', id, ...f]));
        for (const m of c.queue.splice(0)) ws.send(m);
        this.onChange();
      };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m[0] === 'EVENT') this.onEvent(m[2]);
        else if (m[0] === 'OK') this.waiting.get(m[1])?.(m[2], m[3], url);
      };
      ws.onclose = () => { const was = c.open; c.open = false; if (was) this.onChange(); setTimeout(go, c.backoff); c.backoff = Math.min(c.backoff * 2, 30000); };
      ws.onerror = () => {};
    };
    go(); return c;
  }
  get openCount() { return this.conns.filter(c => c.open).length; }
  sub(id, filters) {
    this.subs.set(id, filters);
    for (const c of this.conns) if (c.open) c.ws.send(JSON.stringify(['REQ', id, ...filters]));
  }
  // resolves true as soon as any relay accepts; false if none do within the timeout
  publish(ev, timeout = 9000) {
    return new Promise(resolve => {
      const msg = JSON.stringify(['EVENT', ev]); let answered = 0, done = false;
      const finish = ok => { if (done) return; done = true; this.waiting.delete(ev.id); resolve(ok); };
      this.waiting.set(ev.id, ok => { answered++; if (ok) finish(true); else if (answered >= this.conns.length) finish(false); });
      for (const c of this.conns) c.open ? c.ws.send(msg) : c.queue.push(msg);
      setTimeout(() => finish(false), timeout);
    });
  }
}

// ---------- images ----------
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function render(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', q));
}
const blobBytes = async b => new Uint8Array(await b.arrayBuffer());

async function uploadEncrypted(bytes, sk) {
  const x = hex(await sha256(bytes));
  const auth = finalizeEvent({ kind: 24242, created_at: now(), content: 'Upload photo',
    tags: [['t', 'upload'], ['x', x], ['expiration', String(now() + 600)]] }, sk);
  const header = 'Nostr ' + b64(te.encode(JSON.stringify(auth)));
  for (const server of BLOSSOM) {
    try {
      const r = await fetch(server.replace(/\/$/, '') + '/upload', {
        method: 'PUT', headers: { Authorization: header, 'Content-Type': 'application/octet-stream' }, body: bytes });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.url) return { url: j.url, x };
    } catch {}
  }
  return null;
}

// ---------- state ----------
const S = {
  secret: null, roomId: null, key: null, hostPk: null,
  me: null, meta: null, pool: null,
  items: new Map(),      // id -> {ev, p}
  order: [],             // ids sorted by created_at
  names: new Map(),      // pubkey -> name
  hidden: new Set(), pendingHides: [],
  seen: new Set(), failed: new Set(), sending: new Set(),
  photoCache: new Map(), // id -> objectURL
  tab: 'chat',
};
const isHost = () => S.me && S.me.pk === S.hostPk;
const closed = () => S.meta && now() >= S.meta.ends;

function parseHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const r = h.get('r'), host = h.get('h');
  if (!r || !host) return null;
  try { const s = unb64u(r), hp = unb64u(host); if (s.length !== 16 || hp.length !== 32) return null; return { secret: s, hostPk: hex(hp) }; }
  catch { return null; }
}
const inviteLink = () => `${location.origin}${location.pathname}${location.search}#r=${b64u(S.secret)}&h=${b64u(unhex(S.hostPk))}`;

// ---------- boot ----------
async function boot() {
  const parsed = parseHash();
  if (!parsed) return renderLanding();
  S.secret = parsed.secret; S.hostPk = parsed.hostPk;
  Object.assign(S, await roomKeys(S.secret));
  const saved = store.get('me:' + S.roomId);
  if (saved) S.me = { sk: unhex(saved.sk), pk: saved.pk, name: saved.name };
  const cachedMeta = store.get('meta:' + S.roomId);
  if (cachedMeta) S.meta = cachedMeta;
  connect();
  S.me ? renderRoom() : renderJoin();
}
window.addEventListener('hashchange', () => location.reload());

function connect() {
  S.pool = new Pool(RELAYS, ev => onEvent(ev), () => { renderStatus(); });
  S.pool.sub('meta', [{ kinds: [KIND_META], authors: [S.hostPk], '#d': [S.roomId] }]);
  S.pool.sub('room', [{ kinds: [KIND_MSG], '#t': [S.roomId], limit: 1000 }]);
}

async function onEvent(ev) {
  if (!ev || S.seen.has(ev.id)) return;
  S.seen.add(ev.id);
  if (!verifyEvent(ev)) return;
  if (ev.kind === KIND_META) {
    if (ev.pubkey !== S.hostPk) return;
    if (S.meta && S.meta.at >= ev.created_at) return;
    try { const m = await unsealJSON(S.key, ev.content); S.meta = { name: String(m.name).slice(0, 80), ends: +m.ends, at: ev.created_at }; } catch { return; }
    store.set('meta:' + S.roomId, S.meta);
    S.me ? (renderHeader(), renderComposer()) : renderJoin();
    return;
  }
  if (ev.kind !== KIND_MSG) return;
  let p; try { p = await unsealJSON(S.key, ev.content); } catch { return; }
  if (typeof p.name === 'string' && p.name.trim()) S.names.set(ev.pubkey, p.name.trim().slice(0, 40));
  if (p.t === 'hide') { S.pendingHides.push({ by: ev.pubkey, id: p.id }); applyHides(); return; }
  if (p.t !== 'msg' && p.t !== 'photo') return;
  if (p.t === 'msg' && (typeof p.text !== 'string' || !p.text.trim())) return;
  addItem(ev, p);
}

function applyHides() {
  let changed = false;
  S.pendingHides = S.pendingHides.filter(h => {
    const it = S.items.get(h.id);
    if (h.by === S.hostPk || (it && it.ev.pubkey === h.by)) { if (!S.hidden.has(h.id)) { S.hidden.add(h.id); changed = true; } return false; }
    return !it; // keep waiting until the target arrives, then decide
  });
  if (changed) renderBody();
}

function addItem(ev, p) {
  if (S.items.has(ev.id)) return;
  S.items.set(ev.id, { ev, p });
  let i = S.order.length;
  while (i > 0 && S.items.get(S.order[i - 1]).ev.created_at > ev.created_at) i--;
  S.order.splice(i, 0, ev.id);
  applyHides();
  scheduleRender();
}
let rq = 0;
function scheduleRender() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; renderBody(); }); }

// ---------- sending ----------
async function sendPayload(p) {
  const tags = [['t', S.roomId]];
  if (S.meta) tags.push(['expiration', String(S.meta.ends + GRACE)]);
  const ev = finalizeEvent({ kind: KIND_MSG, created_at: now(), tags, content: await sealJSON(S.key, { ...p, name: S.me.name }) }, S.me.sk);
  S.seen.add(ev.id);
  if (p.t === 'msg' || p.t === 'photo') { S.sending.add(ev.id); S.names.set(S.me.pk, S.me.name); addItem(ev, { ...p, name: S.me.name }); }
  await publishTracked(ev);
  return ev;
}
async function publishTracked(ev) {
  S.failed.delete(ev.id); S.sending.add(ev.id); scheduleRender();
  const ok = await S.pool.publish(ev);
  S.sending.delete(ev.id); if (!ok) S.failed.add(ev.id);
  scheduleRender();
  return ok;
}

async function sendPhotos(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    toast('Adding photo…');
    try {
      const img = await loadImage(file);
      const thumb = 'data:image/jpeg;base64,' + b64(await blobBytes(await render(img, 24, 0.5)));
      const w = img.naturalWidth, h = img.naturalHeight;
      const full = await blobBytes(await render(img, 1600, 0.82));
      const up = await uploadEncrypted(await seal(S.key, full), S.me.sk);
      if (up) { await sendPayload({ t: 'photo', url: up.url, x: up.x, thumb, w, h }); continue; }
      // No photo host accepted the upload: fall back to a small copy carried inside the message itself.
      let small = await blobBytes(await render(img, 720, 0.6));
      if (small.length > 40000) small = await blobBytes(await render(img, 520, 0.5));
      await sendPayload({ t: 'photo', inline: b64(small), thumb, w, h });
      toast('Photo shared at reduced size');
    } catch (e) { console.error(e); toast("That photo couldn't be added. Try another."); }
  }
}

async function photoURL(id) {
  if (S.photoCache.has(id)) return S.photoCache.get(id);
  const { p } = S.items.get(id);
  const job = (async () => {
    let bytes;
    if (p.inline) bytes = unb64(p.inline);
    else {
      const r = await fetch(p.url); if (!r.ok) throw new Error('fetch ' + r.status);
      const data = new Uint8Array(await r.arrayBuffer());
      if (p.x && hex(await sha256(data)) !== p.x) throw new Error('hash mismatch');
      bytes = await unseal(S.key, data);
    }
    return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  })();
  S.photoCache.set(id, job);
  job.catch(() => S.photoCache.delete(id));
  return job;
}

// ---------- rendering: landing ----------
function renderLanding() {
  document.title = 'Func — a private room for your event';
  $('#app').innerHTML = `
  <main class="landing">
    <h1>A private room for your event</h1>
    <p class="lede">Guests scan a code and they're in. Chat and photos in one place, no app or signup, and it closes when the night ends.</p>
    <form class="ticket flat" id="create">
      <div class="ticket-main form" style="grid-column: 1 / -1; padding: 20px 18px 22px">
        <div class="field"><label for="rname">Event name</label>
          <input class="input" id="rname" maxlength="80" required placeholder="Priya and Sam's wedding" autocomplete="off"></div>
        <div class="field"><label for="rends">Room closes</label>
          <select class="select" id="rends">
            <option value="midnight">Tonight at midnight</option>
            <option value="24h" selected>24 hours from now</option>
            <option value="3d">3 days from now</option>
            <option value="7d">1 week from now</option>
          </select>
          <div class="hint">Photos stay downloadable for 3 days after it closes.</div></div>
        <div class="field"><label for="hname">Your name</label>
          <input class="input" id="hname" maxlength="40" required placeholder="What guests will see" autocomplete="given-name"></div>
        <button class="btn block" type="submit">Create room</button>
      </div>
    </form>
    <ol class="how">
      <li>Create the room and put the code on a table, a screen or a printed card.</li>
      <li>Guests scan it, type their name and start posting. Nothing to install.</li>
      <li>Messages and photos are encrypted with a key that only exists in the invite link.</li>
    </ol>
  </main>`;
  $('#rname').focus();
  $('#create').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating…';
    const choice = $('#rends').value; const t = new Date();
    let ends;
    if (choice === 'midnight') { const m = new Date(t); m.setHours(24, 0, 0, 0); ends = Math.floor(m / 1000); }
    else ends = now() + ({ '24h': 86400, '3d': 3 * 86400, '7d': 7 * 86400 }[choice]);
    const sk = generateSecretKey(), pk = getPublicKey(sk);
    S.secret = crypto.getRandomValues(new Uint8Array(16)); S.hostPk = pk;
    Object.assign(S, await roomKeys(S.secret));
    S.me = { sk, pk, name: $('#hname').value.trim() };
    S.meta = { name: $('#rname').value.trim(), ends, at: now() };
    store.set('me:' + S.roomId, { sk: hex(sk), pk, name: S.me.name });
    store.set('meta:' + S.roomId, S.meta);
    history.replaceState(null, '', inviteLink());
    connect();
    const metaEv = finalizeEvent({ kind: KIND_META, created_at: now(), content: await sealJSON(S.key, { name: S.meta.name, ends }),
      tags: [['d', S.roomId], ['expiration', String(ends + GRACE)]] }, sk);
    S.seen.add(metaEv.id);
    renderRoom();
    openInvite(true);
    const ok = await S.pool.publish(metaEv);
    if (!ok) { toast("Couldn't reach the network. Retrying…"); retryMeta(metaEv); }
  });
}
async function retryMeta(ev) { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 5000)); if (await S.pool.publish(ev)) return toast('Room is live'); } }

// ---------- rendering: join ----------
function renderJoin() {
  const name = S.meta?.name;
  document.title = name ? `${name} — Func` : 'Func';
  $('#app').innerHTML = `
  <main class="join">
    ${ticketHTML()}
    <form class="form" id="joinf">
      <p>${name ? "You've been invited. Pick the name other guests will see." : 'Finding this room…'}</p>
      <div class="field"><label for="gname">Your name</label>
        <input class="input" id="gname" maxlength="40" required autocomplete="given-name" placeholder="First name is fine"></div>
      <button class="btn block" type="submit">Join room</button>
    </form>
  </main>`;
  $('#gname').focus();
  $('#joinf').addEventListener('submit', e => {
    e.preventDefault();
    const sk = generateSecretKey();
    S.me = { sk, pk: getPublicKey(sk), name: $('#gname').value.trim() };
    store.set('me:' + S.roomId, { sk: hex(sk), pk: S.me.pk, name: S.me.name });
    renderRoom();
  });
}

function countdown() {
  if (!S.meta) return { when: '…', what: 'loading' };
  const left = S.meta.ends - now();
  if (left <= 0) return { when: 'Closed', what: new Date(S.meta.ends * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), d = Math.floor(h / 24);
  return { when: d >= 2 ? `${d}d` : h >= 1 ? `${h}h ${m}m` : `${Math.max(1, m)}m`, what: 'until close' };
}
function ticketHTML() {
  const c = countdown(); const people = new Set([...S.items.values()].map(x => x.ev.pubkey)).size;
  const open = S.pool ? S.pool.openCount : 0;
  return `<header class="ticket">
    <div class="ticket-main">
      <h1 class="room-title">${esc(S.meta?.name || 'Private room')}</h1>
      <div class="room-sub"><span><span class="dot ${open ? '' : 'off'}"></span>${people ? `${people} ${people === 1 ? 'guest' : 'guests'} posting` : open ? 'Connected' : 'Connecting…'}</span></div>
    </div>
    <div class="ticket-stub" aria-label="Room closes"><span class="when">${esc(c.when)}</span><span class="what">${esc(c.what)}</span></div>
  </header>`;
}

// ---------- rendering: room ----------
function renderRoom() {
  document.title = S.meta ? `${S.meta.name} — Func` : 'Func';
  $('#app').innerHTML = `
  <div class="room">
    <div class="room-head" id="head"></div>
    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="chat" aria-selected="${S.tab === 'chat'}">Chat</button>
      <button class="tab" role="tab" data-tab="photos" aria-selected="${S.tab === 'photos'}">Photos</button>
      <span class="spacer"></span>
      <button class="icon-btn" id="invite" aria-label="Invite guests">${icon.qr}</button>
      <button class="icon-btn" id="menu" aria-label="Room options">${icon.menu}</button>
    </nav>
    <section class="pane" id="pane" role="tabpanel"></section>
    <div id="compose"></div>
  </div>`;
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    S.tab = b.dataset.tab; document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b)); renderBody(true);
  }));
  $('#invite').addEventListener('click', () => openInvite(false));
  $('#menu').addEventListener('click', openMenu);
  renderHeader(); renderComposer(); renderBody(true);
}
function renderHeader() {
  const head = $('#head'); if (!head) return;
  document.title = S.meta ? `${S.meta.name} — Func` : 'Func';
  head.innerHTML = ticketHTML() + (S.pool && S.pool.openCount === 0 && S.everConnected ? '<div class="banner">Offline. Your messages will send when the connection comes back.</div>' : '');
}
function renderStatus() { if (S.pool?.openCount) S.everConnected = true; S.me ? renderHeader() : null; }
setInterval(() => { if (S.me) { const wasClosed = renderComposer.closed; renderHeader(); if (closed() !== wasClosed) renderComposer(); } }, 30000);

function renderComposer() {
  const el = $('#compose'); if (!el) return;
  renderComposer.closed = closed();
  if (closed()) { el.innerHTML = `<div class="closed-bar">This room is closed. You can still view and save photos for 3 days.</div>`; return; }
  if (el.querySelector('textarea')) return;
  el.innerHTML = `
  <form class="composer" id="cf">
    <label class="cam" title="Add photos">${icon.cam}<span class="sr">Add photos</span>
      <input type="file" id="file" accept="image/*" multiple hidden></label>
    <textarea id="text" rows="1" maxlength="2000" placeholder="Message everyone" aria-label="Message"></textarea>
    <button class="send" id="sendb" type="submit" aria-label="Send" disabled>${icon.send}</button>
  </form>`;
  const ta = $('#text'), sb = $('#sendb');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 3, 140) + 'px'; sb.disabled = !ta.value.trim(); };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#cf').requestSubmit(); } });
  $('#cf').addEventListener('submit', e => {
    e.preventDefault(); const text = ta.value.trim(); if (!text) return;
    ta.value = ''; fit(); S.tab = 'chat'; stickBottom = true;
    sendPayload({ t: 'msg', text });
  });
  $('#file').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; stickBottom = true; sendPhotos(f); });
}

let stickBottom = true;
function visibleIds() { return S.order.filter(id => !S.hidden.has(id)); }
function renderBody(force) {
  const pane = $('#pane'); if (!pane) return;
  renderHeader();
  if (S.tab === 'photos') return renderPhotos(pane);
  const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
  const ids = visibleIds();
  if (!ids.length) {
    pane.innerHTML = `<div class="msgs"><div class="empty"><strong>${isHost() ? 'Your room is ready' : "You're in"}</strong>${isHost() ? 'Share the code with guests, then say hello so they know they’re in the right place.' : 'Say hello, or add a photo from the event.'}</div></div>`;
    return;
  }
  let html = '<div class="msgs">', prev = null;
  ids.forEach((id, i) => {
    const { ev, p } = S.items.get(id); const next = S.items.get(ids[i + 1]);
    const gap = !prev || ev.created_at - prev.ev.created_at > 900;
    if (gap) html += `<div class="sep">${fmtTime(ev.created_at)}</div>`;
    const first = gap || prev.ev.pubkey !== ev.pubkey;
    const last = !next || next.ev.pubkey !== ev.pubkey || next.ev.created_at - ev.created_at > 900;
    const mine = ev.pubkey === S.me.pk; const name = S.names.get(ev.pubkey) || 'Guest';
    const cls = ['msg', first && 'first', last && 'last', mine && 'mine', S.sending.has(id) && 'sending', S.failed.has(id) && 'failed'].filter(Boolean).join(' ');
    const canRemove = isHost() || mine;
    const content = p.t === 'photo'
      ? `<button class="photo" data-photo="${id}" style="aspect-ratio:${p.w}/${p.h}" aria-label="Photo from ${esc(name)}"><img class="blur" alt="" src="${esc(p.thumb || '')}"></button>`
      : `<div class="bubble">${linkify(esc(p.text))}</div>`;
    html += `<div class="${cls}" data-id="${id}">
      <div class="av" style="background:hsl(${hue(ev.pubkey)} 45% 42%)" aria-hidden="true">${esc(initial(name))}</div>
      <div><div class="who">${esc(name)}${ev.pubkey === S.hostPk ? ' · host' : ''}</div>${content}
      ${S.failed.has(id) ? `<div class="status"><button class="btn ghost small" data-retry="${id}">Not sent. Try again</button></div>` : ''}</div>
      ${canRemove ? `<div class="msg-actions"><button class="more" data-act="${id}" aria-label="Message options">${icon.menu}</button></div>` : ''}
    </div>`;
    prev = { ev };
  });
  pane.innerHTML = html + '</div>';
  pane.querySelectorAll('[data-photo]').forEach(b => { hydratePhoto(b); b.addEventListener('click', () => openLightbox(b.dataset.photo)); });
  pane.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => openMsgMenu(b.dataset.act)));
  pane.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => publishTracked(S.items.get(b.dataset.retry).ev)));
  if (force || stickBottom || nearBottom) pane.scrollTop = pane.scrollHeight;
  stickBottom = false;
}
function fmtTime(t) {
  const d = new Date(t * 1000), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ') + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
const linkify = s => s.replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

function hydratePhoto(el) {
  const id = el.dataset.photo || el.dataset.cell;
  photoURL(id).then(url => { const img = el.querySelector('img'); img.src = url; img.classList.remove('blur'); }).catch(() => {});
}

function photoIds() { return visibleIds().filter(id => S.items.get(id).p.t === 'photo'); }
function renderPhotos(pane) {
  const ids = photoIds().reverse();
  if (!ids.length) { pane.innerHTML = `<div class="msgs"><div class="empty"><strong>No photos yet</strong>Photos anyone shares in the chat collect here.</div></div>`; return; }
  pane.innerHTML = `<div class="grid-head"><span>${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}</span>
    <button class="btn ghost small" id="saveall">${icon.save.replace('<svg', '<svg width="18" height="18"')}Save all</button></div>
    <div class="grid">${ids.map(id => `<button class="cell" data-cell="${id}" aria-label="Open photo"><img class="blur" alt="" src="${esc(S.items.get(id).p.thumb || '')}"></button>`).join('')}</div>`;
  pane.querySelectorAll('[data-cell]').forEach(b => { hydratePhoto(b); b.addEventListener('click', () => openLightbox(b.dataset.cell)); });
  $('#saveall').addEventListener('click', saveAll);
  pane.scrollTop = 0;
}

async function saveAll() {
  const ids = photoIds(); const btn = $('#saveall'); btn.disabled = true;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip(); let n = 0;
    for (const id of ids) {
      btn.textContent = `Preparing ${++n} of ${ids.length}…`;
      try { const url = await photoURL(id); const b = await (await fetch(url)).blob(); const { ev } = S.items.get(id);
        const who = (S.names.get(ev.pubkey) || 'guest').replace(/[^\w-]+/g, '-');
        zip.file(`${new Date(ev.created_at * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '-')}_${who}_${id.slice(0, 6)}.jpg`, b); } catch {}
    }
    const out = await zip.generateAsync({ type: 'blob' });
    download(out, `${(S.meta?.name || 'func').replace(/[^\w-]+/g, '-')}-photos.zip`);
    toast(`Saved ${Object.keys(zip.files).length} photos`);
  } finally { renderBody(); }
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

// ---------- sheets ----------
function sheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const scrim = root.firstElementChild, close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  onMount?.(root.querySelector('.sheet'), close);
  root.querySelector('.sheet button, .sheet a')?.focus();
  return close;
}
function qrSVG(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }

function openInvite(fresh) {
  const link = inviteLink(), svg = qrSVG(link);
  sheet(`
    <h2>${fresh ? 'Your room is ready' : 'Invite guests'}</h2>
    <p>Anyone who scans this code or opens the link can read and post. Share it with your guests only.</p>
    <div class="qr" aria-label="QR code for the invite link">${svg}</div>
    <div class="linkbox">${esc(link)}</div>
    <div class="row">
      <button class="btn" id="copy">Copy link</button>
      ${navigator.share ? '<button class="btn ghost" id="share">Share</button>' : ''}
      <button class="btn ghost" id="print">Print table card</button>
      <button class="btn ghost" id="done">Done</button>
    </div>
    <div class="print-card"><h1>${esc(S.meta?.name || '')}</h1><p>Scan to join the chat and share your photos</p>${svg}<div class="foot">No app or signup needed</div></div>
  `, (el, close) => {
    $('#copy', el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Select the link above to copy it'); } });
    $('#share', el)?.addEventListener('click', () => navigator.share({ title: S.meta?.name, text: 'Join the room for ' + (S.meta?.name || 'the event'), url: link }).catch(() => {}));
    $('#print', el).addEventListener('click', () => window.print());
    $('#done', el).addEventListener('click', close);
  });
}

function openMenu() {
  const relays = S.pool.conns.map(c => `<div><span class="dot ${c.open ? '' : 'off'}"></span>${esc(c.url.replace(/^wss?:\/\//, ''))}</div>`).join('');
  sheet(`
    <h2>${esc(S.meta?.name || 'Room')}</h2>
    <p>You're posting as <strong>${esc(S.me.name)}</strong>${isHost() ? ', the host' : ''}.</p>
    <div class="menu-list">
      <button id="rename">Change my name</button>
      ${isHost() && !closed() ? '<button id="endnow" class="danger">Close room now</button>' : ''}
      <button id="theme">Switch to ${document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark'} mode</button>
    </div>
    <div class="relays"><div>Connected relays (${S.pool.openCount} of ${S.pool.conns.length})</div>${relays}</div>
  `, (el, close) => {
    $('#rename', el).addEventListener('click', () => {
      close();
      sheet(`<h2>Change my name</h2><form class="form" id="rn"><div class="field"><label for="nn">Your name</label><input class="input" id="nn" maxlength="40" required value="${esc(S.me.name)}"></div><button class="btn block">Save name</button></form>`, (el2, close2) => {
        $('#nn', el2).select();
        $('#rn', el2).addEventListener('submit', e => { e.preventDefault(); S.me.name = $('#nn', el2).value.trim(); S.names.set(S.me.pk, S.me.name);
          store.set('me:' + S.roomId, { sk: hex(S.me.sk), pk: S.me.pk, name: S.me.name }); close2(); renderBody(); toast('Name saved. New messages will use it.'); });
      });
    });
    $('#endnow', el)?.addEventListener('click', async () => {
      if (!confirmInline(el, 'Close the room for everyone? Nobody will be able to post. Photos stay viewable for 3 days.', async () => {
        const ends = now(); S.meta = { ...S.meta, ends, at: now() }; store.set('meta:' + S.roomId, S.meta);
        const ev = finalizeEvent({ kind: KIND_META, created_at: now(), content: await sealJSON(S.key, { name: S.meta.name, ends }),
          tags: [['d', S.roomId], ['expiration', String(ends + GRACE)]] }, S.me.sk);
        S.seen.add(ev.id); close(); renderHeader(); renderComposer(); toast((await S.pool.publish(ev)) ? 'Room closed' : 'Closed here. Will sync when online.');
      })) return;
    });
    $('#theme', el).addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', document.documentElement.dataset.theme); close();
    });
  });
}
function confirmInline(el, text, onYes) {
  el.innerHTML = `<h2>Are you sure?</h2><p>${esc(text)}</p><div class="row"><button class="btn" id="yes">Close room</button><button class="btn ghost" id="no">Cancel</button></div>`;
  $('#yes', el).addEventListener('click', onYes); $('#no', el).addEventListener('click', () => { $('#sheet-root').innerHTML = ''; });
  $('#yes', el).focus();
  return true;
}

function openMsgMenu(id) {
  const { ev, p } = S.items.get(id); const mine = ev.pubkey === S.me.pk;
  sheet(`
    <h2>${p.t === 'photo' ? 'Photo' : 'Message'}</h2>
    <p>${mine ? 'Remove this for everyone in the room.' : `Posted by ${esc(S.names.get(ev.pubkey) || 'a guest')}. As the host you can remove it for everyone.`}</p>
    <div class="menu-list"><button class="danger" id="rm">Remove for everyone</button><button id="cancel">Cancel</button></div>
  `, (el, close) => {
    $('#rm', el).addEventListener('click', async () => { close(); S.hidden.add(id); renderBody(); await sendPayload({ t: 'hide', id }); toast('Removed'); });
    $('#cancel', el).addEventListener('click', close);
  });
}

async function openLightbox(id) {
  const { ev, p } = S.items.get(id); const name = S.names.get(ev.pubkey) || 'Guest';
  const box = document.createElement('div'); box.className = 'lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = `<header><button class="icon-btn" id="lbx" aria-label="Close">${icon.close}</button>
    <span class="cap">${esc(name)}, ${esc(fmtTime(ev.created_at))}</span>
    <button class="icon-btn" id="lbs" aria-label="Save photo">${icon.save}</button></header>
    <div class="stage"><img alt="Photo from ${esc(name)}" src="${esc(p.thumb || '')}"></div>`;
  document.body.append(box);
  const close = () => { box.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  $('#lbx', box).addEventListener('click', close); $('#lbx', box).focus();
  try {
    const url = await photoURL(id); $('img', box).src = url;
    $('#lbs', box).addEventListener('click', async () => download(await (await fetch(url)).blob(), `photo-${id.slice(0, 8)}.jpg`));
  } catch { $('.cap', box).textContent = "This photo couldn't be loaded."; }
}

// ---------- go ----------
const theme = store.get('theme'); if (theme) document.documentElement.dataset.theme = theme;
window.__func = S; // handy for debugging in the console
boot();
