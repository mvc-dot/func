# Func

Private, expiring event rooms on Nostr. Host creates a room and shares a QR code. Guests scan it, pick a name, and share an encrypted chat and photo stream. No accounts, no backend of our own beyond a small photo server. See README.md for the full design and known limits.

## Live
- Repo: https://github.com/mvc-dot/func (private)
- App: https://func.rsvp (Cloudflare Pages project `func`; raw host https://func-28u.pages.dev)
- Photo server: https://media.func.rsvp (Cloudflare Worker `func-media`, R2 bucket `func-media`)
- Official Func Nostr account: `npub1ph5cm4sdsvnrw29dnt3uefdmt5tputk7w9z2xuam7wvq5pdk8emsx85xe4`. Its private key exists only as the Worker secret `NOSTR_NSEC` on `func-media`. Never put it in the repo, a log, or chat.
- Cloudflare account `584545320605a4829b1d8ed8c5521434`, zone `func.rsvp`. `npx wrangler whoami` should show the OAuth login.

## Commands
- `npm install`, then `npx playwright install chromium` (first time only, for tests)
- `npm run build` builds `dist/index.html`, a single self-contained file with CSS and JS inlined
- `npm test` builds, then runs `test/blossom.mjs` (the Worker in-process against a mock R2 bucket) and `test/e2e.mjs` (a local relay and Blossom mock from `test/server.mjs` plus host and guest headless browsers). All checks must print `ok`.
- `npm run test:blossom` runs only the Worker tests
- `node test/live-e2e.mjs` runs the room flow against the real public relays and `media.func.rsvp`. Run it before deploying. Set `HTTPS_PROXY` only if the network needs one.

## Deploy
- App: `npm run deploy` (builds, then `wrangler pages deploy dist --project-name func --branch main`). `dist/` is the only thing deployed to Pages. There are no Pages functions.
- Photo server: `npm run deploy:media` (`wrangler deploy -c worker/wrangler.jsonc`). The custom domain `media.func.rsvp`, the R2 binding, and the rate limit bindings are all declared in `worker/wrangler.jsonc`, so a deploy keeps them in sync.
- Blob expiry is a lifecycle rule on the bucket, set once with `npx wrangler r2 bucket lifecycle add func-media expire-after-30-days --expire-days 30`. Check it with `npx wrangler r2 bucket lifecycle list func-media`.
- Secrets: pipe the value in, never paste it into a file: `printf %s "$VALUE" | npx wrangler secret put NAME -c worker/wrangler.jsonc`
- DNS for `func.rsvp` is a proxied CNAME to `func-28u.pages.dev`. The Worker domain record is managed by Cloudflare. The wrangler OAuth token cannot edit DNS; `~/.config/cloudflare/dwarfnebula.token` can.

## Architecture (app, all in src/app.js)
- Invite link `#r=<16-byte secret, base64url>&h=<host pubkey, base64url>`. The fragment never reaches servers.
- AES-256-GCM key comes from HKDF(secret). Room id is sha256("func:id:"+secret), first 32 hex chars, used as the `t` tag.
- kind 4333 is an encrypted message, photo, or hide event. kind 34333 is host-signed room meta (name, close time), `d` = room id.
- Every event has a NIP-40 `expiration` = close time + 3 days.
- Photos are resized and encrypted, then uploaded to the first Blossom server in `BLOSSOM` that accepts them (BUD-02 PUT /upload, kind 24242 auth): `media.func.rsvp` first, `nostr.download` as fallback. If every upload fails, a ~35 KB inline copy goes in the event.
- Dev overrides: `?relays=ws://..,..&blossom=http://..`

## Photo server (worker/src/index.js)
- Implements BUD-01 and BUD-02: `PUT /upload` (kind 24242 auth with `t=upload` and an `x` tag equal to the body sha256), `GET`/`HEAD /<sha256>[.ext]`, `DELETE /<sha256>` (uploader's key only), and the BUD-06 `HEAD /upload` size check. There is no `/list`.
- CORS is open to any origin. Any content type is accepted, including `application/octet-stream`. Uploads are capped at 10 MB, checked from `Content-Length` and again while streaming.
- Blobs are stored under their sha256 with `customMetadata` `pubkey` and `uploaded`. Responses are immutable-cacheable. Range requests return 206 only when a `Range` header was sent.
- R2 deletes each blob 30 days after upload through the bucket's lifecycle rule. Rooms keep events readable for 3 days after close, so this leaves ample margin. There is no cron and no sweep code.
- Uploads are rate limited with the Workers rate limiting bindings: 60 per minute per client IP (`IP_LIMIT`) and 20 per minute per Nostr key (`KEY_LIMIT`). Over the limit returns 429 with `Retry-After: 60`. Limits are checked after the auth event verifies, so junk requests do not consume them. Missing bindings (local runs, tests without a mock) mean no limit.
- Add a case to `test/blossom.mjs` for any behavior change, then `npm test` and `npm run deploy:media`.

## Constraints learned from live testing (Oct 2026)
- Relays that accept these kinds: damus, nos.lol, primal, snort. relay.nos.social rejects custom kinds. offchain.pub rejects large events from keys outside its web of trust.
- Public Blossom hosts: only nostr.download accepts encrypted application/octet-stream. Primal, nostr.build/blossom.band, nostrcheck and 24242.io sniff content and reject non-images. Don't disguise ciphertext as image/jpeg. That is why we run `media.func.rsvp`.
- Cloudflare: Worker cron triggers need the account to have a workers.dev subdomain (it is `mvc-corp.workers.dev`; no cron is used now). Passing `range: request.headers` to R2 `get` marks every response as ranged, so only pass it when the request has a `Range` header. Rate limit bindings only allow 10 s or 60 s periods and count per Cloudflare location, so treat them as approximate.

## Conventions
- Keep the output a single static file with no CDN script dependencies. Google Fonts is the only external request.
- UI copy is plain, sentence case, and active voice. The ticket header is the one bold design element. Keep everything else quiet.
- Run `npm test` after any change to src/ or worker/.
