# Func

A private room for an event. The host creates a room and puts the QR code on a table. Guests scan it, type a name, and they're in a shared chat and photo stream. No app, no signup. The room closes at a set time.

Built on Nostr. The whole app is one static file (`dist/index.html`, ~180 KB), with no server and no database of its own.

## Deploy (Cloudflare Pages, ~5 minutes)

Option A, dashboard:
1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Upload assets**.
2. Name the project `func` and drag in the `dist` folder.
3. Under Custom domains, add something like `func.rsvp`.

Option B, command line:
```
npx wrangler pages deploy dist --project-name func
```

Any static host works, as long as it serves over HTTPS. The camera upload and clipboard need a secure origin.

## How it works

- **Room link.** `https://<host>/#r=<room secret>&h=<host public key>`. The secret sits after the `#`, so browsers never send it to any server, including your host.
- **Encryption.** Every message, photo and the room name is encrypted (AES-256-GCM) with a key derived from the room secret. Relays and the photo host only ever store ciphertext.
- **Identity.** Each guest gets a throwaway Nostr key, generated on the spot and kept in their browser for that room only.
- **Transport.**
  - Messages are Nostr events (kind 4333), tagged with a room id that is a hash of the secret. They're published to 4 public relays: damus, nos.lol, primal, snort.
  - Room details are a host-signed addressable event (kind 34333). Only the host's key in the link can set the name or close time.
- **Photos.**
  - Resized to 1600 px, encrypted, and uploaded to a Blossom server (`nostr.download`).
  - If no photo host accepts the upload, a ~35 KB copy travels inside the message itself.
- **Expiry.** Every event carries a NIP-40 `expiration` tag of close time + 3 days, so well-behaved relays delete it afterward. After close, the app goes read-only and "Save all" zips the photos.
- **Moderation.** The host can remove any message for everyone. Guests can remove their own. Removals are encrypted events that clients honor.

## Known limits (v1)

- **Anyone with the link can read and post.** A forwarded link is a full invite. Treat it like a party's group chat link.
- **Metadata is visible to relays.** They can see a room tag, throwaway keys and timing, but not names or content.
- **Single photo host.** `nostr.download` is the only free Blossom server that accepted encrypted files in testing. Primal and nostr.build reject anything that isn't a real image. Its retention policy is not guaranteed. For real use, run your own Blossom server (or a paid plan) and add it to `BLOSSOM` in `src/app.js`.
- **No notifications.** Guests see new posts only while the page is open.
- **Messages are cut off at 1,000 per room** on initial load (`limit: 1000`).

## Develop

```
npm install
npm run build        # → dist/index.html
npm test             # local relay + photo host + two headless browsers
```

`?relays=ws://...&blossom=http://...` overrides the network, which the tests use. `test/live-e2e.mjs` runs the same flow against the real public relays.

Files: `src/app.js` (all logic), `src/styles.css`, `src/index.template.html`, `build.mjs`, `test/`.
