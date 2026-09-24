# Ideas for later

## 1. Cloudflare helper for the live (GitHub Pages) site

**Problem:** On the public GitHub Pages version, sites like Shopify stores
send a "don't show me inside another page" rule (X-Frame-Options /
Content-Security-Policy), so the phone screen stays blank.

**Idea:** Put the same helper that `server.js` runs locally onto a free
Cloudflare Worker. The live site asks the Worker for the store, the Worker
removes the blocking rules, and the store shows up inside the phone.

- Free tier: about 100,000 requests a day.
- **Must have a guest list** (allowlist) of websites it may fetch, e.g. your
  own store domains. Without it, strangers could misuse it as an open proxy.
- `app.js` would use the Worker's address instead of `localhost:8081` when
  the page isn't running locally.
- Same limits as local Full mode: logging in and the cart may not work.
- Needs testing: some sites block requests coming from Cloudflare.
- Needs a free Cloudflare account.

**Backup idea to pair with it:** an "Open in phone-sized window" button that
opens the site in a small popup window the phone's width. Popups aren't
frames, so no site can block it.
