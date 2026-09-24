// Phone Viewer local helper.
//
// Start it with:  npm start   (or: node server.js)
//
// It does two jobs, both only on this computer:
//   1. Serves the viewer page at http://localhost:8080
//   2. Runs a helper on http://localhost:8081 that stands in for the website
//      you're viewing. Every request (pages, "add to cart", cookies) goes
//      through it to the real site, and on the way back it removes the
//      "don't show me inside another page" rules (X-Frame-Options /
//      Content-Security-Policy) that sites like Shopify stores send.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const HOST = "127.0.0.1";
const VIEWER_PORT = Number(process.env.VIEWER_PORT) || 8080;
const HELPER_PORT = 8081; // app.js expects this port
const ROOT = __dirname;

const USER_AGENTS = {
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};

// Headers from the browser we don't pass on to the real site.
const SKIP_REQUEST_HEADERS = new Set([
  "host", "connection", "content-length", "accept-encoding", "origin", "referer",
  "user-agent", "upgrade-insecure-requests",
]);

// Headers from the real site we don't pass back. The first three are the
// "don't frame me" rules; the rest no longer fit once the body is unpacked
// or are handled separately.
const SKIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "strict-transport-security",
  "alt-svc",
  "set-cookie",
  "location",
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- 1. The viewer page ----------

const viewer = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(ROOT, urlPath === "/" ? "index.html" : urlPath));
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(ROOT + path.sep) || !type) return send(res, 404, "Not found");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
});

// ---------- 2. The helper ----------

// The site being viewed right now, e.g. "https://mystore.com". The helper
// shows one site at a time: opening a new one replaces it.
let target = null;
let ua = "ios";

const helper = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `localhost:${HELPER_PORT}`}`);
  const self = reqUrl.origin; // how the browser reaches this helper

  if (reqUrl.pathname === "/__pv/ping") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // The viewer sends /__pv/open?u=<site>&ua=ios|android to switch sites.
  if (reqUrl.pathname === "/__pv/open") {
    let start;
    try { start = new URL(reqUrl.searchParams.get("u") || ""); } catch { start = null; }
    if (!start || !/^https?:$/.test(start.protocol)) {
      return send(res, 400, "That doesn't look like a website address.");
    }
    target = start.origin;
    ua = reqUrl.searchParams.get("ua") === "android" ? "android" : "ios";
    res.writeHead(302, { Location: start.pathname + start.search + start.hash, "Cache-Control": "no-store" });
    return res.end();
  }

  if (!target) {
    return send(res, 200, "<p style='font:16px system-ui;padding:24px'>Open a website from the Phone Viewer page first.</p>");
  }

  try {
    await forward(req, res, reqUrl, self);
  } catch (err) {
    send(res, 502, errorPage(target + reqUrl.pathname, err.cause?.code || err.message));
  }
});

async function forward(req, res, reqUrl, self) {
  const upstreamUrl = target + reqUrl.pathname + reqUrl.search;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!SKIP_REQUEST_HEADERS.has(name) && !name.startsWith("sec-")) headers[name] = value;
  }
  headers["user-agent"] = USER_AGENTS[ua];
  if (req.headers.origin) headers["origin"] = target;
  if (req.headers.referer) headers["referer"] = toReal(req.headers.referer, self);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
    redirect: "manual",
  });

  const out = {};
  upstream.headers.forEach((value, name) => {
    if (!SKIP_RESPONSE_HEADERS.has(name)) out[name] = value;
  });
  out["cache-control"] = "no-store";

  // Cookies (like the shopping cart) are saved for this helper instead of
  // the real site, so they come back with the next request.
  const cookies = upstream.headers.getSetCookie().map(localCookie);
  if (cookies.length) out["set-cookie"] = cookies;

  // Redirects: keep them going through the helper.
  const location = upstream.headers.get("location");
  if (location) {
    const next = new URL(location, upstreamUrl);
    if (next.origin !== target && sameStore(next.host, new URL(target).host)) {
      target = next.origin; // e.g. mystore.com -> www.mystore.com
    }
    out["location"] = next.origin === target ? self + next.pathname + next.search + next.hash : next.href;
  }

  const type = upstream.headers.get("content-type") || "";
  const isText = /text\/|javascript|json|xml/.test(type);
  if (!isText || req.method === "HEAD") {
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, out);
    return res.end(body);
  }

  let text = rewriteLinks(await upstream.text(), self);
  if (type.includes("text/html")) {
    text = text.replace(/\sintegrity=("[^"]*"|'[^']*')/gi, ""); // we changed the files
    text = injectHelper(text);
    out["content-type"] = "text/html; charset=utf-8";
  }
  res.writeHead(upstream.status, out);
  res.end(text);
}

// Swap the real site's address for the helper's, so clicks and "add to
// cart" come back through the helper instead of leaving the phone.
function rewriteLinks(text, self) {
  const selfHost = new URL(self).host;
  for (const host of storeHosts(new URL(target).host)) {
    const h = host.replace(/[.]/g, "\\.");
    const end = "(?![\\w.-])";
    text = text
      .replace(new RegExp(`https?://${h}${end}`, "gi"), self)
      .replace(new RegExp(`https?:\\\\/\\\\/${h}${end}`, "gi"), self.replace(/\//g, "\\/"))
      .replace(new RegExp(`(^|[^:\\w])//${h}${end}`, "gi"), `$1//${selfHost}`)
      .replace(new RegExp(`(^|[^:\\w])\\\\/\\\\/${h}${end}`, "gi"), `$1\\/\\/${selfHost}`);
  }
  return text;
}

// "mystore.com" and "www.mystore.com" are the same store.
function storeHosts(host) {
  const bare = host.replace(/^www\./, "");
  return [bare, "www." + bare];
}
function sameStore(a, b) {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

function toReal(url, self) {
  return url.startsWith(self) ? target + url.slice(self.length) : url;
}

// Make a cookie from the real site stick to the helper (plain http, no
// domain). Without this the cart would forget everything.
function localCookie(cookie) {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !/^(domain|secure|partitioned)(=|$)/i.test(part))
    .map((part) => (/^samesite=none$/i.test(part) ? "SameSite=Lax" : part))
    .join("; ");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Tells the viewer which page is showing, so its address box stays right.
function injectHelper(html) {
  const script = `
<script>
(function () {
  var REAL = ${jsString(target)};
  function tell() {
    try {
      parent.postMessage({ type: "phone-viewer-url", url: REAL + location.pathname + location.search + location.hash }, "*");
    } catch (e) {}
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () { var r = original.apply(history, arguments); tell(); return r; };
  });
  addEventListener("popstate", tell);
  addEventListener("hashchange", tell);
  tell();

  // A phone shows one page at a time, so keep "open in a new tab" links
  // and pop-ups for this site inside the phone.
  function ours(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[target]");
    if (a && a.target !== "_self" && ours(a.href)) a.target = "_self";
  }, true);
  var open = window.open;
  window.open = function (url) {
    if (url && ours(url)) { location.href = new URL(url, location.href).href; return window; }
    return open.apply(window, arguments);
  };
})();
</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + script);
  return script + html;
}

// Safe to drop inside a <script> tag.
function jsString(s) {
  return JSON.stringify(s).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function errorPage(url, reason) {
  return `<!doctype html><meta name="viewport" content="width=device-width">
<body style="font:16px system-ui;padding:24px;color:#333">
<h2>😕 Couldn't open that website</h2>
<p><b>${escapeHtml(url)}</b></p>
<p>Reason: ${escapeHtml(String(reason))}</p>
<p>Check the address is spelled right and that this computer is online.</p></body>`;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

// ---------- Start both ----------

function listen(server, port, name) {
  return new Promise((resolve) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`\n❌ Port ${port} is already in use, so the ${name} can't start.`);
        console.error("   Is Phone Viewer already running in another window? Close it and try again.\n");
      } else {
        console.error(err);
      }
      process.exit(1);
    });
    server.listen(port, HOST, resolve);
  });
}

(async () => {
  await listen(helper, HELPER_PORT, "helper");
  await listen(viewer, VIEWER_PORT, "viewer");
  const url = `http://localhost:${VIEWER_PORT}`;
  console.log(`\n📱 Phone Viewer is running at ${url}`);
  console.log("   Leave this window open while you use it. Press Ctrl+C to stop.\n");
  if (!process.env.NO_OPEN) openBrowser(url);
})();

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
