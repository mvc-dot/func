# Func: getting the first 100 users

Written 2026-11-05. Status that day: zero users. One room on our relay, created by us on launch night. Nothing live on public relays.

## Log
- 2026-11-05: official profile (kind 0) and launch note published from the Func account to relay.func.rsvp, nos.lol, primal and snort (damus refused the Worker's websocket handshake). Note id `0d5a71d449fc74a375b842297b541a788c35cf6ff6960033baa40e9d311b4461`. awesome-nostr pull request opened: https://github.com/aljazceru/awesome-nostr/pull/790.

## What counts

A **user** is a distinct person who posted in a room (a distinct pubkey with a kind 4333 event). `node scripts/stats.mjs` reports it from our relay, and a nightly job appends the numbers to `~/Library/Application Support/func-relay/stats.csv`. Rooms expire, so the CSV is the only history.

100 users is roughly 6 to 10 real events. The plan is built around getting real events, not clicks.

## Positioning

Func is the free, private alternative to the wedding photo QR apps (The Guest, Guestpix, POV, Wedshoots). Those cost $50 to $200 per event, make guests install an app, and keep the photos. Func costs nothing, runs in the browser, encrypts everything, and deletes itself after the event. "One night, then it's gone."

One line: **A private room for your event. Guests scan a code and they're in.**

## Channels, in order of expected yield

1. **Your own events, then friends'.** The first three real parties will deliver more users than everything else combined. Any dinner, birthday, launch, or wedding in the next 60 days. The host prints the table card from the room's QR screen. Ask directly; template below.
2. **Nostr.** The official account (`npub1ph5cm...x85xe4`, NIP-05 `func@func.rsvp`) posts the launch note. Nostr users are the people who will try something new because it is built on Nostr and needs no account. They repost. Also submit to the app directories: nostrapps.com, and a pull request adding Func to `aljazceru/awesome-nostr`.
3. **Show HN.** Hacker News likes "one static file, no backend, encrypted, open protocol." Post Tuesday to Thursday, 8 to 10 am Eastern. The repo is public, which HN expects.
4. **Reddit.** r/SideProject and r/nostr welcome launches. r/weddingplanning and r/selfhosted need a question or story, not a pitch; answer "how do I collect guest photos without an app" threads with Func as one option.
5. **Wedding planners and photographers.** After the first weddings, message 20 local planners: a free, private photo and chat room they can offer every couple. Slow, but each planner is many events.
6. **Product Hunt.** Only once there are a few real events and a couple of quotes. A launch with no traction wastes the one shot.

## Before posting anywhere

- The landing page needs a picture of a live room. Visitors cannot imagine it from the form. Add one screenshot strip under the steps, using the test shots in `test/shots/`.
- Keep a demo room alive for a week during the launch, so "see an example" works. Create it with a 1-week close and put the link in the posts.

## Drafts

### Nostr profile (kind 0)

```json
{"name":"Func","display_name":"Func","about":"A private room for your event. Guests scan a code and they're in: chat and photos, no app, no signup, encrypted, gone when the night ends. Built on Nostr. Free. https://func.rsvp","website":"https://func.rsvp","nip05":"func@func.rsvp","picture":"https://func.rsvp/og.png","lud16":""}
```

### Nostr launch note (kind 1)

> Func is live: a private room for your event. Put a QR code on the table, guests scan it, type a name, and they're in a shared chat and photo stream. No app, no signup, no account. Every message and photo is encrypted with a key that only exists in the invite link, and everything expires after the event.
>
> It's one static HTML file. Rooms are Nostr events (kinds 4333 and 34333) on our relay plus damus, nos.lol, primal and snort. Photos go to a Blossom server on Cloudflare R2. Code is open: https://github.com/mvc-dot/func
>
> Try it: https://func.rsvp
>
> #nostr #introductions #blossom

### Show HN

Title: `Show HN: Func – private, expiring event rooms on Nostr, in one static file`

> Func is a private chat and photo room for a party or wedding. The host creates a room and puts the QR code on a table. Guests scan it, type a name, and they're in. No app, no accounts.
>
> How it works: the invite link carries a 16-byte secret in the URL fragment, so it never reaches a server. An AES-256-GCM key is derived from it. Messages and photos are Nostr events, encrypted client-side, tagged with a hash of the secret, and published to our strfry relay plus four public ones. Every event carries a NIP-40 expiration, so relays delete the room a few days after it closes. Photos are encrypted and uploaded to a small Blossom server (a Cloudflare Worker on R2) that expires blobs after 30 days.
>
> The whole app is one 180 KB HTML file with no backend of its own beyond that photo server. The relay is strfry with a write policy that only stores Func's event kinds.
>
> Known limits: anyone with the link can post, relays see metadata (room tag, throwaway keys, timing), and there are no notifications.
>
> Live: https://func.rsvp  Code: https://github.com/mvc-dot/func

### r/SideProject

Title: `I built a free, private "scan the QR and share photos" room for parties. No app, no signup, deletes itself after.`

> Every wedding now has a QR code for guest photos, and the apps behind it cost $50 to $200 and make everyone install something. I wanted the same thing for a birthday dinner without any of that.
>
> Func: create a room, print the QR, guests scan and they're in a shared chat and photo stream. Everything is encrypted with a key that lives only in the link, and the room expires when the night ends. It's a single static file on top of Nostr relays. Free, open source.
>
> https://func.rsvp. Would love to hear what you'd need before using it at a real event.

### awesome-nostr pull request line

Under "Clients" or "Other": `- [Func](https://func.rsvp) - private, expiring event rooms (chat + photos) using kinds 4333/34333 and Blossom, one static file. [source](https://github.com/mvc-dot/func)`

### Message to a friend hosting something

> Hey, I built a thing for parties and I want to test it at a real one. It's a private chat + photo room: you put a QR code on the table, people scan it and share photos, no app, and it deletes itself afterward. Can I set one up for yours? Takes a minute, costs nothing, and I'll print the card. https://func.rsvp

## Posting from the official account

The key never leaves Cloudflare. The Worker signs and publishes:

```
curl -s -X POST https://media.func.rsvp/admin/publish \
  -H "Authorization: Bearer $(cat ~/.config/func/admin.token)" \
  -H "Content-Type: application/json" \
  -d '{"kind":1,"content":"...","tags":[["t","nostr"]]}'
```

`relays: []` in the body signs without publishing, for a dry run.
