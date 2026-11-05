// Renders the social preview card to src/static/og.png (1200x630). Run after changing the copy or colours.
//   node scripts/og.mjs
import { chromium } from 'playwright';
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,800&display=swap" rel="stylesheet">
<style>
  body { margin: 0; width: 1200px; height: 630px; background: #13152A; color: #ECEEF8; font-family: "Atkinson Hyperlegible", system-ui, sans-serif; display: grid; place-items: center; }
  .wrap { width: 1040px; }
  .ticket { display: grid; grid-template-columns: 1fr 200px; background: #F4B73A; color: #2A1F05; border-radius: 28px; overflow: hidden;
    -webkit-mask: radial-gradient(circle 22px at calc(100% - 200px) 0, #0000 98%, #000) top / 100% 51% no-repeat,
                  radial-gradient(circle 22px at calc(100% - 200px) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat; }
  .main { padding: 44px 48px; }
  h1 { font: 800 92px/0.95 "Bricolage Grotesque", sans-serif; letter-spacing: -.035em; margin: 0 0 18px; }
  p { font-size: 32px; line-height: 1.3; margin: 0; max-width: 24ch; }
  .stub { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    background-image: linear-gradient(#2A1F05 50%, transparent 0); background-size: 3px 14px; background-repeat: repeat-y; background-position: left; }
  .stub b { font: 800 56px/1 "Bricolage Grotesque", sans-serif; }
  .stub span { font-size: 24px; opacity: .8; margin-top: 6px; }
  .foot { display: flex; justify-content: space-between; align-items: baseline; margin-top: 34px; font-size: 30px; color: #9DA2C4; }
  .foot b { color: #ECEEF8; font: 800 40px "Bricolage Grotesque", sans-serif; letter-spacing: -.02em; }
</style></head><body><div class="wrap">
  <div class="ticket"><div class="main"><h1>A private room for your event</h1><p>Guests scan a code and they're in. Chat and photos, no app, no signup.</p></div>
  <div class="stub"><b>one<br>night</b><span>then it's gone</span></div></div>
  <div class="foot"><b>func.rsvp</b><span>free · encrypted · built on Nostr</span></div>
</div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html); await p.waitForTimeout(1500); // let the fonts land
await p.screenshot({ path: 'src/static/og.png', type: 'png' }); await b.close();
console.log('src/static/og.png written');
