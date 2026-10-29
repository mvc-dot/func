# Func

Private, expiring event rooms on Nostr. Host creates a room and shares a QR code. Guests scan it, pick a name, and share an encrypted chat and photo stream. No accounts, no backend. See README.md for the full design and known limits.

## Commands
- `npm install`, then `npx playwright install chromium` (first time only, for tests)
- `npm run build` builds `dist/index.html`, a single self-contained file with CSS and JS inlined
- `npm test` builds, then runs `test/e2e.mjs`: a local relay and Blossom mock (`test/server.mjs`) plus host and guest headless browsers. All checks must print `ok`.
- `node test/live-e2e.mjs` runs the same flow against the real public relays and photo host. Run it before deploying.

## Deploy
- Cloudflare Pages, project name `func`: `npm run build && npx wrangler pages deploy dist --project-name func`
- Custom domain: `func.rsvp` (zone is on this Cloudflare account)
- `dist/` is the only thing deployed. There are no server functions.

## Architecture (all in src/app.js)
- Invite link `#r=<16-byte secret, base64url>&h=<host pubkey, base64url>`. The fragment never reaches servers.
- AES-256-GCM key comes from HKDF(secret). Room id is sha256("func:id:"+secret), first 32 hex chars, used as the `t` tag.
- kind 4333 is an encrypted message, photo, or hide event. kind 34333 is host-signed room meta (name, close time), `d` = room id.
- Every event has a NIP-40 `expiration` = close time + 3 days.
- Photos are resized and encrypted, then uploaded to Blossom (BUD-02 PUT /upload, kind 24242 auth). If the upload fails, a ~35 KB inline copy goes in the event.
- Dev overrides: `?relays=ws://..,..&blossom=http://..`

## Constraints learned from live testing (Oct 2026)
- Relays that accept these kinds: damus, nos.lol, primal, snort. relay.nos.social rejects custom kinds. offchain.pub rejects large events from keys outside its web of trust.
- Blossom: only nostr.download accepts encrypted application/octet-stream. Primal, nostr.build/blossom.band, nostrcheck and 24242.io sniff content and reject non-images. Don't disguise ciphertext as image/jpeg. The real fix is our own Blossom server, for example on Cloudflare R2 plus a Worker.

## Conventions
- Keep the output a single static file with no CDN script dependencies. Google Fonts is the only external request.
- UI copy is plain, sentence case, and active voice. The ticket-stub header is the one bold design element. Keep everything else quiet.
- Run `npm test` after any change to src/.
