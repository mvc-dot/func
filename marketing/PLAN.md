# Func launch plan: first 100 users

Goal: **100 people who posted in a room someone else hosted**, across at least 10 rooms, by Dec 31, 2026.
Counting posting guests (not page views) measures the real loop: a host brings people, and some of those people become hosts.

## Why these channels
- There's no personal network to lean on, and local Bitcoin and Nostr meetups are small (3–8 RSVPs on Meetup). Meetups are a supporting channel, not the main one.
- Func's strongest hook for builders is technical: an encrypted group chat for one night in a single HTML file, with no accounts, no database, and an expiring relay. Hacker News and the Nostr crowd respond to exactly that, and one good post can produce more hosts than a month of cold email.
- The season helps: Friendsgiving and Thanksgiving (Nov 21–26), holiday parties (December) and New Year's Eve are the year's densest stretch of hosted events, and "get everyone's photos in one place" is an active need.

## Week 0: fix before anyone is sent to the site (Claude Code)
1. **The GitHub link is broken.** The About text says "the code is on GitHub", but `mvc-dot/func` is private, so visitors get a 404. Make the repo public (recommended: it's what earns trust from this audience) or remove the link. **Decision needed: SM.**
2. **Link previews.** `/og.png`, `/robots.txt`, `/sitemap.xml` and `/privacy` all return the app page, so invite links pasted into iMessage, WhatsApp or Slack show no image or card. Add real files: a 1200×630 OG image (the ticket header with "A private room for your event") and `og:`/`twitter:` meta tags.
3. **Growth loop.** Guests never see a way to start their own room. Add:
   - "Start your own room" on the join screen, in the room menu and on the closed-room screen.
   - "Made with Func, func.rsvp" in the printed table-card footer.
   - A post-event line on the closed screen: "Hosting something? Make a room in 10 seconds."
4. **Privacy page** (`/privacy`): what is stored where, what expires when, and who can read what. Link it from the landing page.
5. **Stats.** `scripts/stats.mjs` scans relay.func.rsvp (strfry) and counts per day: rooms created (kind 34333), distinct posting pubkeys per room, and rooms with 5+ posters. Content is encrypted, so this counts only, it doesn't read anything. Writes `marketing/stats.csv`.
6. **Posting from the official account.** The Func nsec exists only as a Worker secret, so nothing can post as Func today. Add `POST /admin/publish` on `func-media`, protected by a separate `ADMIN_TOKEN` secret. It signs a kind 1 or kind 30023 note with `NOSTR_NSEC` and publishes it to the five relays. The token lets marketing runs post without ever holding the key.
7. **Relay uptime.** relay.func.rsvp runs on the Mac mini, so if the Mini sleeps the app falls back to public relays. Rooms still work, but set Energy Saver to "prevent automatic sleeping" before the launch posts.

## Launch sequence
| When | What | Who |
|---|---|---|
| Week 0 (by Nov 4) | Fixes above, deploy, live test | Claude Code |
| Nov 5 | Nostr launch note and long-form post from the Func account | Claude (via admin endpoint), after SM approves the copy |
| Nov 5–7 | Directory listings: awesome-nostr PR, Nostr Compass PR, nostrapps.com, No Bullshit Bitcoin tip | Claude Code opens the PRs as mvc-dot; Claude drafts the copy |
| Nov 10 (Tue, ~8am PT) | **Show HN** | **SM posts** (HN requires the maker to post; reply to comments for the first 3 hours, and Claude drafts replies on request) |
| Nov 10–12 | Stacker News post in ~nostr | SM's account, or Claude creates a Func account via the browser |
| Nov 12–20 | Friendsgiving and Thanksgiving pages live, seasonal Nostr posts | Claude Code builds the pages; Claude writes the copy |
| Nov–Dec, weekly | Pitch 10 meetup organizers worldwide (bitcoinonly.events, nostr.co.uk/events, Luma) with a ready-made room and table card | Claude drafts; sending needs a Func email address (see below) |
| Dec 1–20 | Holiday party and NYE pages, NYE post | Claude |
| Weekly | Stats report: rooms, posting guests, hosts who came back | Claude (scheduled task) |

## Channels, ranked by expected users
1. **Show HN.** The most likely single source of hosts. Success looks like front page for a few hours: 5–20k visits, 50–200 rooms created, most of them tests, some real.
2. **Nostr launch and directories.** A small audience, but it shares, and it's the right audience for the open-source and relay story.
3. **Seasonal pages and search.** "Friendsgiving photo sharing", "wedding QR photo sharing no app", "NYE party photos". Competitors (Guestpix, Wedibox, GuestCam, POV) are paid, app-based or upload-only albums. Func is free, needs no app or signup, and includes a chat. Expect search traffic only in 2–4 months, but the pages also give Show HN and Nostr readers a clear "what's it for".
4. **Meetup organizers.** Each yes is 5–40 users plus a credible case study. Volume is low; the value is proof.

## What not to do
- No fake accounts, astroturfed comments or undisclosed self-promotion on Reddit, X or HN.
- No paid ads at this stage: cold traffic doesn't create hosts.
- Don't market the wedding use case hard until Func has been used at a few real events. A failure at a wedding is costly.

## Still needed from SM
1. Repo public: yes or no.
2. Approve the launch copy in COPY.md, or edit it.
3. Post Show HN on Nov 10 (or say "skip").
4. A Func email address that can send (e.g. a new Gmail connected to Claude), for organizer outreach. Optional: skip outreach until it exists.
