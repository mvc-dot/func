# Func launch copy (drafts, needs SM's approval before anything is posted)

## 1. Nostr launch note (kind 1, from the Func account)

> Func is live: a private room for your event.
>
> Guests scan a QR code, type a first name, and they're in a shared chat and photo stream. No app, no account, no signup. The room closes when you say, and everything expires a few days later.
>
> Under the hood it's Nostr. Each room is encrypted notes (kinds 4333/34333) on public relays plus our own strfry relay that only accepts Func events. The key lives in the invite link's #fragment, so relays and our Blossom photo server only ever see ciphertext. The whole app is one ~180 KB HTML file.
>
> Try it at your next meetup or dinner: https://func.rsvp
>
> Code: https://github.com/mvc-dot/func
>
> #nostr #grownostr #bitcoin

## 2. Nostr long-form (kind 30023): "A group chat that's supposed to die"

> Most group chats outlive the thing they were for. The wedding chat from 2019 is still on your phone; the conference Slack still pings you. Func is the opposite: a room made for one event, which closes when the event is over.
>
> **How it works**
> - The host picks a name and a close time and gets a QR code. Guests scan it, type a first name, and post. There are no accounts, and every guest gets a throwaway key for that room only.
> - The room secret sits after the `#` in the invite link, which browsers never send to any server. From it the app derives an AES-256-GCM key. Every message, photo and the room name are encrypted before they leave the phone.
> - Messages are Nostr events carrying a NIP-40 `expiration` (close time + 3 days). They go to relay.func.rsvp, a strfry relay whose write policy accepts only Func's two event kinds, plus damus, nos.lol, primal and snort as fallbacks.
> - Photos are resized on the phone, encrypted, and uploaded to media.func.rsvp, a small Blossom server (BUD-01/02) on a Cloudflare Worker and R2 that deletes every blob after 30 days. Most public Blossom hosts reject encrypted uploads because they sniff for real images, so we run our own.
> - The host can remove any message, and guests can remove their own. Removals are encrypted events that every client honors.
>
> **What it doesn't do**
> - Anyone with the link can read and post. A forwarded link is a full invite.
> - Relays can see that a room exists, plus throwaway keys and timing. They can't see names or content.
> - There's no forward secrecy and no push notifications.
>
> It's free and open source. If you run a meetup, try it at the next one, and tell us what broke: https://func.rsvp

## 3. Show HN (SM posts)

**Title:** Show HN: Func – an encrypted group chat for one night, in a single HTML file

**URL:** https://func.rsvp

**First comment (post immediately after submitting):**

> I wanted a way to get everyone's photos and messages from a dinner or party into one place without making 30 people install an app or join a WhatsApp group that lives forever.
>
> Func is a room with a close time. The host gets a QR code, guests scan it, type a name and post. When the room closes it goes read-only, and a few days later everything expires.
>
> Some details HN might find interesting:
>
> - **No backend for the chat.** It runs over Nostr relays: public ones plus a strfry relay I run that only accepts Func's two event kinds. Each message is a signed event with a NIP-40 expiration tag.
> - **The key is in the URL fragment.** The room secret is after the `#`, so it never reaches any server, including mine. Everything is AES-GCM encrypted client-side, and the relays and photo store only see ciphertext.
> - **Photos** are resized and encrypted on the phone, then uploaded to a small Blossom server on a Cloudflare Worker and R2, with a 30-day lifecycle rule. If uploads fail, a ~35 KB copy rides inside the message.
> - **The app is one ~180 KB HTML file.** No framework, no accounts, no analytics.
>
> Known limits: a forwarded link is a full invite, there's no forward secrecy, relays can see timing metadata, and there are no notifications while the page is closed.
>
> Code: https://github.com/mvc-dot/func. I'd love feedback on the threat model and on where the guest flow loses people.

(Tips: post on a weekday morning, Pacific time. Don't ask anyone to upvote; HN penalizes vote rings. Answer every technical question plainly, including the limits.)

## 4. Stacker News (~nostr)

**Title:** Func: expiring, encrypted event rooms on Nostr. No accounts, a QR code and you're in.

**Body:** a shortened version of the long-form post, ending with: "Free. If you run a Bitcoin meetup, I'll set up the room and send you a printable table card. Reply here."

## 5. Directory listings

- **awesome-nostr** (github.com/aljazceru/awesome-nostr), under Clients/Apps (or Misc, by category fit):
  `- [Func](https://func.rsvp) - Private, expiring event rooms: guests scan a QR code and share an encrypted chat and photos. No accounts. [code](https://github.com/mvc-dot/func)`
- **Nostr Compass** (nostrcompass.org projects), under Communities/Messaging:
  `Func: Expiring encrypted event rooms with a QR invite, Blossom photos and NIP-40 expiry. web · code`
- **nostrapps.com:** submit via its form, under Messaging and Social.
- **No Bullshit Bitcoin** (tips via Nostr DM or their site): the 2-sentence pitch from the launch note plus the code link.

## 6. Meetup organizer email (Func address, personalized per organizer)

**Subject:** A room for [event name] on [date]?

> Hi [first name],
>
> I saw [event name] on [Luma/Meetup] for [date]. I built Func, a free, open-source room for events: guests scan a QR code at the venue and share messages and photos in one place, with no app or signup. It's end-to-end encrypted, runs on Nostr, and closes when the event's over.
>
> I've made a room for [event name] already. Here's the printable table card: [link to PDF]. If you put it out, attendees can use it during and after the talk. If not, no worries; just delete this.
>
> [Name]
> func.rsvp · code: github.com/mvc-dot/func

(Pre-making the room and card turns "try my app" into "your thing is ready." Send no more than 10 a week, one follow-up maximum, and stop at any "no".)

## 7. Seasonal landing pages (static pages under func.rsvp)

Each page has: an H1, a 2-sentence pitch, a "Create a room" button (deep link to the app with the event name prefilled, e.g. `/#new=Friendsgiving`), 3 how-it-works lines, an FAQ and a printable card example.

### /friendsgiving
- **H1:** Everyone's Friendsgiving photos, in one place
- **Pitch:** Put a QR code by the pie. Guests scan it, add their photos and messages, and you get them all the next morning, with no group chat that never ends and no app to install.
- **FAQ:** Is it free? (Yes.) Do guests need an account? (No, just a first name.) Who can see the photos? (Only people with the link. Even we can't.) How long does it last? (You pick when it closes; photos can be saved for 3 days after.)

### /new-years-eve
- **H1:** One room for your New Year's Eve party
- **Pitch:** The countdown, the toasts, the blurry midnight photos: guests scan a code and drop them all in one place. The room closes on New Year's Day, and you keep the photos.

### /wedding-photo-sharing (publish later, after real events)
- **H1:** Wedding guest photos without an app
- **Pitch:** A QR code on each table, and guests' photos and notes go to one private room. Free, encrypted, no signup.
- **Honest comparison block:** Func is free, needs no app or account, includes a chat, and is end-to-end encrypted. It isn't a long-term album: download the photos within 3 days of close.

### /holiday-party
- **H1:** A room for the office holiday party
- **Pitch:** No Slack channel, no WhatsApp group with your manager in it. One QR code, shared photos and messages, and it disappears after.
