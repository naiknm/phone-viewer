# 📱 Phone Viewer

Type in any website, like your Shopify store, and see how it looks on a
real phone screen. Pick a phone from the list, turn it sideways, or type in
your own screen size.

## Two ways to use it

| | 🖥️ On your computer (PowerShell) | 🌐 On the internet (GitHub Pages) |
|---|---|---|
| Cost | Free | Free |
| Shows **every** website, including Shopify | ✅ Yes | ❌ Only sites that allow it |
| Others can open it | ❌ Only you | ✅ Anyone with the link |

**Why the difference?** Many websites (Shopify stores included) carry a rule
that says *"don't show me inside someone else's page."* The computer version
runs a small helper that stands in for the website: every tap goes through
it, and it removes that rule, only on your own computer.

## 🖥️ Run it on your computer

You need **Node.js** (version 18 or newer). To check, open PowerShell and
type `node --version`. If you see a number like `v22.1.0`, you're ready.

1. Get the files: on GitHub, click the green **Code** button, then
   **Download ZIP**, and unzip it. (Or use `git clone`.)
2. Open the folder, click the address bar at the top of the window, type
   `powershell` and press **Enter**. A PowerShell window opens in that folder.
3. Type this and press **Enter**:

   ```powershell
   npm start
   ```

4. Your browser opens **http://localhost:8080** by itself. 🎉
   Leave the PowerShell window open while you use it. Press **Ctrl + C** in
   it to stop.

The bottom right corner of the page shows a green **Full mode** message when
the helper is on.

## 🌐 Put it on the internet (GitHub Pages)

Do this once, after the code is on the `main` branch:

1. On GitHub, open the repo and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Choose branch **main** and folder **/ (root)**, then click **Save**.
4. Wait a minute. Your link will be
   `https://<your-username>.github.io/phone-viewer/`.

This version runs in **Simple mode**. If a site shows a blank screen, it is
blocking this. Use the computer version for that site.

## Handy tricks

- **Share a ready-made view:** add `?url=` to the address, e.g.
  `http://localhost:8080/?url=mystore.myshopify.com`
- The page remembers the last website and phone you used.
- **★** in the list marks phones from the global top 10 best-sellers.

## The phones

Sizes are **CSS viewport** sizes. That's the width and height a website
"sees", which is what decides its layout. The real pixel count is bigger
(often 3×), but websites don't lay themselves out by that.

| Phone | Size | Top 10 |
|---|---|---|
| iPhone 17 Pro Max | 440 × 956 | ★ |
| iPhone 17 Pro | 402 × 874 | ★ |
| iPhone 17 | 402 × 874 | ★ |
| iPhone Air | 420 × 912 | |
| iPhone 17e | 390 × 844 | ★ |
| iPhone 16 Pro Max | 440 × 956 | |
| iPhone 16 | 393 × 852 | ★ |
| Galaxy S26 Ultra | 412 × 891 | ★ |
| Galaxy S26 | 360 × 780 | ★ |
| Galaxy A17 | 412 × 892 | ★ |
| Galaxy A07 | 412 × 915 (estimated) | ★ |
| Pixel 10 | 412 × 924 | |
| Pixel 10 Pro XL | 432 × 960 | |

Top 10 is Counterpoint Research's global best-seller list for Q2 2026, the
latest one out before September 2026. To add or change a phone, edit
`devices.js`.

## Things to know

- The top of the phone (clock, camera) takes some space, just like a real
  phone. A real browser's address bar takes a little more, so the real
  visible area is slightly shorter.
- In Full mode you can click around, add things to the cart, and the cart
  remembers them, because every tap goes through the helper. **Paying at
  checkout may not work**, since checkout pages have extra security. Use
  your real phone for that.
- The helper shows **one website at a time**. Opening a new site in the
  viewer switches it over.
- In Full mode the site is told it's being opened by an iPhone or an
  Android phone (to match the phone you picked), so it sends its phone
  version.

## Files

| File | What it does |
|---|---|
| `index.html` | The page itself |
| `style.css` | How it looks |
| `app.js` | What the buttons do |
| `devices.js` | The list of phones |
| `server.js` | The helper for the computer version |
