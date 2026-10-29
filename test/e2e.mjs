import { createRequire } from 'node:module'; import { execSync } from 'node:child_process'; import { mkdirSync } from 'node:fs';
let pw; try { pw = await import('playwright'); } catch { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
const { chromium, devices } = pw.default ?? pw; mkdirSync('test/shots', { recursive: true });
import { log } from './server.mjs';
const BASE = 'http://localhost:7779/?relays=ws://localhost:7777&blossom=http://localhost:7778';
const shot = (p, n) => p.screenshot({ path: `test/shots/${n}.png` });
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const browser = await chromium.launch();
const phone = { ...devices['iPhone 13'] };
const errs = [];
const mk = async () => { const ctx = await browser.newContext(phone); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); return p; };

// host creates
const host = await mk();
await host.goto(BASE); await host.waitForTimeout(400); await shot(host, '01-landing');
await host.fill('#rname', "Priya and Sam's wedding"); await host.fill('#hname', 'Sam');
await host.click('button[type=submit]');
await host.waitForSelector('.qr svg'); await host.waitForTimeout(300); await shot(host, '02-invite');
const link = await host.textContent('.linkbox');
ok(link.includes('#r=') && link.includes('&h='), 'invite link has secret + host key: ' + link.length + ' chars');
await host.click('#done');
await host.fill('#text', 'Welcome everyone! Post your photos here 📸'); await host.click('#sendb');
await host.waitForFunction(() => !document.querySelector('.msg.sending'));

// guest joins
const guest = await mk();
await guest.goto(link);
await guest.waitForFunction(() => document.querySelector('.room-title')?.textContent.includes('Priya'));
await shot(guest, '03-join');
await guest.fill('#gname', 'Ana'); await guest.click('button[type=submit]');
await guest.waitForSelector('.bubble');
ok((await guest.textContent('.bubble')).includes('Welcome everyone'), 'guest decrypts host message');
await guest.fill('#text', 'So happy for you two!'); await guest.click('#sendb');
// photo
await host.screenshot({ path: 'test/shots/_photo.png' });
await guest.setInputFiles('#file', 'test/shots/_photo.png');
await guest.waitForFunction(() => document.querySelectorAll('.photo img:not(.blur)').length === 1, null, { timeout: 15000 });
ok(log.uploads === 1, 'photo uploaded encrypted to blossom mock');
await host.waitForFunction(() => document.querySelectorAll('.photo img:not(.blur)').length === 1, null, { timeout: 15000 });
ok(true, 'host sees decrypted photo');
await host.waitForTimeout(300); await shot(host, '04-host-chat');
await guest.waitForTimeout(300); await shot(guest, '05-guest-chat');

// encryption check: relay sees no plaintext
const raw = JSON.stringify(log.events);
ok(!raw.includes('Welcome') && !raw.includes('Priya') && !raw.includes('Ana'), 'relay stores ciphertext only');
ok(log.events.every(e => e.tags.some(t => t[0] === 'expiration')), 'every event carries an expiration tag');

// host removes guest text message
const guestMsgId = await host.evaluate(() => [...document.querySelectorAll('.msg:not(.mine)')].find(m => m.textContent.includes('So happy')).dataset.id);
await host.click(`[data-act="${guestMsgId}"]`); await host.click('#rm');
await guest.waitForFunction(id => !document.querySelector(`[data-id="${id}"]`), guestMsgId, { timeout: 5000 });
ok(true, 'host removal propagates to guest');

// guest cannot remove host message (no menu)
const hostMsgId = await guest.evaluate(() => document.querySelector('.msg:not(.mine)').dataset.id);
ok(!(await guest.$(`[data-act="${hostMsgId}"]`)), 'guest has no remove option on others\' messages');

// photos tab
await host.click('[data-tab=photos]'); await host.waitForTimeout(500); await shot(host, '06-photos');
ok((await host.textContent('.grid-head')).includes('1 photo'), 'photos tab lists photo');
const [dl] = await Promise.all([host.waitForEvent('download'), host.click('#saveall')]);
ok(dl.suggestedFilename().endsWith('-photos.zip'), 'save all produces zip: ' + dl.suggestedFilename());

// late joiner sees history (reload as new device)
const late = await mk();
await late.goto(link);
await late.fill('#gname', 'Lee'); await late.click('button[type=submit]');
await late.waitForFunction(() => document.querySelectorAll('.msg').length === 2, null, { timeout: 8000 });
ok(true, 'late joiner sees history minus removed message');

// inline fallback when photo host is down
const g2 = await mk();
await g2.goto(link.replace('blossom=http://localhost:7778','blossom=http://localhost:9'));
await g2.fill('#gname', 'Off'); await g2.click('button[type=submit]'); await g2.waitForSelector('.msg');
await g2.setInputFiles('#file', 'test/shots/_photo.png');
await host.click('[data-tab=chat]');
await host.waitForFunction(() => document.querySelectorAll('.photo img:not(.blur)').length === 2, null, { timeout: 15000 });
const inl = log.events.at(-1); ok(JSON.stringify(inl).length < 70000, 'inline fallback photo event size ' + JSON.stringify(inl).length);

// host closes room
await host.click('#menu'); await host.click('#endnow'); await host.click('#yes');
await guest.waitForSelector('.closed-bar', { timeout: 5000 });
ok(true, 'closing room locks guest composer');
await guest.waitForTimeout(200); await shot(guest, '07-closed');

// dark mode screenshot
const dark = await browser.newContext({ ...phone, colorScheme: 'dark' }); const dp = await dark.newPage();
await dp.goto(link);
await dp.fill('#gname', 'Night'); await dp.click('button[type=submit]'); await dp.waitForTimeout(1200); await shot(dp, '08-dark');
// desktop
const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const dk = await desk.newPage();
await dk.goto(BASE); await dk.waitForTimeout(300); await shot(dk, '09-desktop-landing');

const real = errs.filter(e => !e.includes('ERR_UNSAFE_PORT')); ok(real.length === 0, 'no page errors ' + JSON.stringify(real.slice(0, 5)));
await browser.close(); process.exit();
