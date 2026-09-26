// Phone Viewer local helper.
//
// Start it with:  npm start   (or: node server.js)
//
// It does two jobs, both only on this computer:
//   1. Serves the viewer page at http://phoneviewer.localhost:8080
//   2. Runs a helper that stands in for every website shown in the phone.
//      Each real site gets its own address on this computer, for example
//        https://nightsealmask.com  ->  http://nightsealmask.com.phoneviewer.localhost:8081
//      (anything ending in ".localhost" always means "this computer").
//      Every request (pages, "add to cart", cookies) goes through the helper
//      to the real site, and on the way back it removes the "don't show me
//      inside another page" rules that sites like Shopify stores send, and
//      makes sure links to any website open inside the phone.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const VIEWER_PORT = Number(process.env.VIEWER_PORT) || 8080;
const HELPER_PORT = 8081; // app.js expects this port

// Both the viewer and the sites live under this name so the browser treats
// them as one "site" and lets the shopping cart's cookies work.
const PARENT = "phoneviewer.localhost";
const VIEWER_ORIGIN = `http://${PARENT}:${VIEWER_PORT}`;

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

// ---------- Real address <-> helper address ----------

// "https://nightsealmask.com/x" -> "http://nightsealmask.com.phoneviewer.localhost:8081/x"
// Sites on plain http or an unusual port get an extra tag, e.g. "pv-http-9000".
function toHelper(realUrl) {
  const u = new URL(realUrl);
  const scheme = u.protocol.slice(0, -1);
  let host = u.hostname;
  if (scheme !== "https" || u.port) host += `.pv-${scheme}${u.port ? "-" + u.port : ""}`;
  return `http://${host}.${PARENT}:${HELPER_PORT}${u.pathname}${u.search}${u.hash}`;
}

// The real site behind a helper host, e.g. "https://nightsealmask.com".
// Returns null for anything that isn't one of ours.
function realOrigin(helperHost) {
  const name = helperHost.toLowerCase().split(":")[0];
  if (!name.endsWith("." + PARENT)) return null;
  const labels = name.slice(0, -(PARENT.length + 1)).split(".");
  let scheme = "https";
  let port = "";
  const tag = labels[labels.length - 1].match(/^pv-(https?)(?:-(\d+))?$/);
  if (tag) {
    labels.pop();
    scheme = tag[1];
    port = tag[2] ? ":" + tag[2] : "";
  }
  if (!labels.length || labels.some((l) => !l)) return null;
  return `${scheme}://${labels.join(".")}${port}`;
}

function toReal(url) {
  try {
    const u = new URL(url);
    const real = realOrigin(u.host);
    return real ? real + u.pathname + u.search + u.hash : url;
  } catch {
    return url;
  }
}

// ---------- 1. The viewer page ----------

function serveViewer(req, res) {
  // Always use the phoneviewer.localhost name (see PARENT above).
  if ((req.headers.host || "").split(":")[0] !== PARENT) {
    res.writeHead(302, { Location: VIEWER_ORIGIN + req.url });
    return res.end();
  }
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(ROOT, urlPath === "/" ? "index.html" : urlPath));
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(ROOT + path.sep) || !type) return send(res, 404, "Not found");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
}

// ---------- 2. The helper ----------

let ua = "ios";

async function serveHelper(req, res) {
  const host = req.headers.host || "";
  const reqUrl = new URL(req.url, `http://${host}`);

  // Only the viewer and the pages inside the phone may use the helper, not
  // other websites you have open.
  if (req.headers["sec-fetch-site"] === "cross-site") return send(res, 403, "Not allowed");

  if (reqUrl.pathname === "/__pv/ping") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" });
    return res.end("ok");
  }

  // The viewer sends /__pv/open?u=<site>&ua=ios|android to show a site.
  if (reqUrl.pathname === "/__pv/open") {
    let start;
    try { start = new URL(reqUrl.searchParams.get("u") || ""); } catch { start = null; }
    if (!start || !/^https?:$/.test(start.protocol)) {
      return send(res, 400, "That doesn't look like a website address.");
    }
    ua = reqUrl.searchParams.get("ua") === "android" ? "android" : "ios";
    res.writeHead(302, { Location: toHelper(start.href), "Cache-Control": "no-store" });
    return res.end();
  }

  const real = realOrigin(host);
  if (!real) return send(res, 404, "Open a website from the Phone Viewer page.");

  try {
    await forward(req, res, reqUrl, real, `http://${host}`);
  } catch (err) {
    send(res, 502, errorPage(real + reqUrl.pathname, err.cause?.code || err.message));
  }
}

async function forward(req, res, reqUrl, real, self) {
  const upstreamUrl = real + reqUrl.pathname + reqUrl.search;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!SKIP_REQUEST_HEADERS.has(name) && !name.startsWith("sec-")) headers[name] = value;
  }
  headers["user-agent"] = USER_AGENTS[ua];
  if (req.headers.origin) headers["origin"] = new URL(toReal(req.headers.origin)).origin;
  if (req.headers.referer) headers["referer"] = toReal(req.headers.referer);

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

  // Cookies (like the shopping cart) are saved for the helper address
  // instead of the real site, so they come back with the next request.
  const cookies = upstream.headers.getSetCookie().map(localCookie);
  if (cookies.length) out["set-cookie"] = cookies;

  // Redirects to any website stay inside the phone.
  const location = upstream.headers.get("location");
  if (location) {
    const next = new URL(location, upstreamUrl);
    out["location"] = /^https?:$/.test(next.protocol) ? toHelper(next.href) : next.href;
  }

  const type = upstream.headers.get("content-type") || "";
  const isText = /text\/|javascript|json|xml/.test(type);
  if (!isText || req.method === "HEAD") {
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, out);
    return res.end(body);
  }

  let text = await upstream.text();
  const doors = frontDoors(new URL(real).host, text);
  text = rewriteLinks(text, doors, self);
  if (type.includes("text/html")) {
    text = text.replace(/\sintegrity=("[^"]*"|'[^']*')/gi, ""); // we changed the files
    text = injectGuard(text, real, doors);
    out["content-type"] = "text/html; charset=utf-8";
  }
  res.writeHead(upstream.status, out);
  res.end(text);
}

// Swap the site's own address for the helper's in the page, so "add to
// cart" and similar requests come back through the helper.
function rewriteLinks(text, doors, self) {
  const selfHost = new URL(self).host;
  for (const host of doors) {
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

// Endings where the website's name is the part before them, e.g.
// "shop.co.uk" not "co.uk". Covers the common ones; others fall back to the
// last two parts.
const TWO_PART_ENDINGS = /\.(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/i;

// The website a host belongs to: "m.youtube.com" -> "youtube.com".
function siteOf(host) {
  const [name, port] = host.toLowerCase().split(":");
  if (/^[\d.]+$/.test(name) || !name.includes(".")) return host.toLowerCase(); // IP or "localhost"
  const keep = TWO_PART_ENDINGS.test(name) ? 3 : 2;
  const site = name.split(".").slice(-keep).join(".");
  return port ? `${site}:${port}` : site;
}

// The other names this same site goes by: "www.", "m.", the bare name,
// and for Shopify stores the hidden "xxx.myshopify.com" address the page
// mentions (apps often link to it).
function frontDoors(host, page) {
  const [name, port] = host.toLowerCase().split(":");
  const site = siteOf(name);
  const doors = [name, site, `www.${site}`, `m.${site}`, `mobile.${site}`]
    .map((d) => (port ? `${d}:${port}` : d));
  const shop = page.match(/Shopify\.shop\s*=\s*["']([\w-]+\.myshopify\.com)["']/i);
  if (shop) doors.push(shop[1].toLowerCase());
  return [...new Set(doors)];
}

// Make a cookie from the real site stick to the helper address (plain
// http, no domain). Without this the cart would forget everything.
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

// A small guard added to every page in the phone. It tells the viewer
// which page is showing, and catches every link, form and pop-up the
// moment it's used, so it opens inside the phone whatever website it
// points to. (The phone's frame also forbids new tabs outright.)
function injectGuard(html, real, doors) {
  const script = `
<script>
(function () {
  var REAL = ${jsString(real)};
  var DOORS = ${jsString(doors)};
  var PARENT = ${jsString(PARENT)};
  var PORT = ${jsString(String(HELPER_PORT))};

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

  // Any web address -> its address through the helper.
  function inPhone(url) {
    try {
      var u = new URL(url, location.href);
      if (!/^https?:$/.test(u.protocol)) return null;
      var host = u.host.toLowerCase();
      var shop = window.Shopify && window.Shopify.shop;
      if (u.origin === location.origin || DOORS.indexOf(host) !== -1 || host === shop) {
        return location.origin + u.pathname + u.search + u.hash;
      }
      if (u.hostname.slice(-(PARENT.length + 1)) === "." + PARENT) return u.href;
      var name = u.hostname;
      var scheme = u.protocol.slice(0, -1);
      if (scheme !== "https" || u.port) name += ".pv-" + scheme + (u.port ? "-" + u.port : "");
      return "http://" + name + "." + PARENT + ":" + PORT + u.pathname + u.search + u.hash;
    } catch (e) {
      return null;
    }
  }

  function onLinkClick(e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (a.target && a.target !== "_self") a.target = "_self";
    var url = inPhone(a.href);
    if (url && a.href !== url) a.href = url;
    // Scroll-wheel, Ctrl and Shift clicks mean "new tab/window": open the
    // link in the phone instead.
    if (e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      location.href = a.href;
    }
  }
  document.addEventListener("click", onLinkClick, true);
  document.addEventListener("auxclick", function (e) { if (e.button === 1) onLinkClick(e); }, true);

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.target && f.target !== "_self") f.target = "_self";
    var url = inPhone(f.action || location.href);
    if (url && f.action !== url) f.action = url;
  }, true);

  window.open = function (url) {
    var next = url ? inPhone(url) : null;
    if (next) location.href = next;
    return window;
  };

  // Scripts that jump straight to another website (location.href = ...).
  // Browsers with the Navigation API (Chrome, Edge) let us catch those too.
  if (window.navigation) {
    navigation.addEventListener("navigate", function (e) {
      if (!e.cancelable || e.hashChange || e.downloadRequest || e.formData) return;
      var next = inPhone(e.destination.url);
      if (next && next !== e.destination.url) {
        e.preventDefault();
        location.href = next;
      }
    });
  }
})();
</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + script);
  return script + html;
}

// Safe to drop inside a <script> tag.
function jsString(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function errorPage(url, reason) {
  return `<!doctype html><meta name="viewport" content="width=device-width">
<body style="font:16px system-ui;padding:24px;color:#333">
<h2>Couldn't open that website</h2>
<p><b>${escapeHtml(url)}</b></p>
<p>Reason: ${escapeHtml(String(reason))}</p>
<p>Check the address is spelled right and that this computer is online.</p></body>`;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

// ---------- Start both ----------

// Listen on this computer only: 127.0.0.1, plus ::1 where it exists, since
// browsers may use either for "localhost" names.
function listen(handler, port, name) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`\nPort ${port} is already in use, so the ${name} can't start.`);
        console.error("   Is Phone Viewer already running in another window? Close it and try again.\n");
      } else {
        console.error(err);
      }
      process.exit(1);
    });
    server.listen(port, "127.0.0.1", () => {
      const v6 = http.createServer(handler);
      v6.once("error", () => resolve()); // no IPv6 here, that's fine
      v6.listen(port, "::1", resolve);
    });
  });
}

(async () => {
  await listen(serveHelper, HELPER_PORT, "helper");
  await listen(serveViewer, VIEWER_PORT, "viewer");
  console.log(`\nPhone Viewer is running at ${VIEWER_ORIGIN}`);
  console.log("   Leave this window open while you use it. Press Ctrl+C to stop.\n");
  if (!process.env.NO_OPEN) openBrowser(VIEWER_ORIGIN);
})();

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
