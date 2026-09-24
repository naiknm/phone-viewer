// Phone Viewer local helper.
//
// Start it with:  npm start   (or: node server.js)
//
// It does two jobs, both only on this computer:
//   1. Serves the viewer page at http://localhost:8080
//   2. Runs a helper on http://localhost:8081 that fetches a website for the
//      viewer and removes the "don't show me inside another page" rules
//      (X-Frame-Options / Content-Security-Policy) that sites like Shopify
//      stores send. That is what lets any site appear inside the phone.

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

// Headers we drop from the fetched page. The first three are the "don't
// frame me" rules; the rest no longer match once Node has unpacked the body.
const DROP_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "strict-transport-security",
  "set-cookie",
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

const helper = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${HOST}:${HELPER_PORT}`);

  if (reqUrl.pathname === "/ping") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" });
    return res.end("ok");
  }
  if (reqUrl.pathname !== "/p") return send(res, 404, "Not found");

  const target = reqUrl.searchParams.get("u") || "";
  const ua = reqUrl.searchParams.get("ua") === "ios" ? "ios" : "android";
  if (!/^https?:\/\//i.test(target)) return send(res, 400, "That doesn't look like a website address.");

  let upstream;
  try {
    upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENTS[ua],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    return send(res, 502, errorPage(target, err.cause?.code || err.message));
  }

  const headers = {};
  upstream.headers.forEach((value, name) => {
    if (!DROP_HEADERS.has(name)) headers[name] = value;
  });
  headers["cache-control"] = "no-store";

  const type = upstream.headers.get("content-type") || "";
  if (!type.includes("text/html")) {
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, headers);
    return res.end(body);
  }

  // text() always gives us UTF-8, so say so (the page's own <meta charset>
  // may end up too far down for the browser to notice).
  const html = await upstream.text();
  headers["content-type"] = "text/html; charset=utf-8";
  res.writeHead(upstream.status, headers);
  res.end(injectHelper(html, upstream.url, ua));
});

// Adds two things to the top of the page:
//  - <base>, so pictures, styles and scripts still load from the real site
//  - a small script that keeps link clicks going through this helper and
//    tells the viewer which address is showing
function injectHelper(html, pageUrl, ua) {
  const script = `
<base href="${escapeAttr(pageUrl)}">
<script>
(function () {
  var HELPER = location.origin + "/p?ua=${ua}&u=";
  var PAGE = ${jsString(pageUrl)};
  try { parent.postMessage({ type: "phone-viewer-url", url: PAGE }, "*"); } catch (e) {}

  function go(url) { location.href = HELPER + encodeURIComponent(url); }
  function isWeb(url) { return /^https?:/i.test(url); }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    var href = a.href;
    if (!isWeb(href)) return;
    var here = PAGE.split("#")[0];
    if (href.split("#")[0] === here && href.indexOf("#") !== -1) return; // same-page jump
    e.preventDefault();
    go(href);
  });

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (e.defaultPrevented || (f.method || "get").toLowerCase() !== "get") return;
    var url = new URL(f.action || PAGE);
    if (!isWeb(url.href)) return;
    url.search = new URLSearchParams(new FormData(f)).toString();
    e.preventDefault();
    go(url.href);
  });

  // The page lives at localhost but thinks it's on the real site, so
  // changing the address bar would throw an error and break the page.
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      try { return original.apply(history, arguments); } catch (e) {}
    };
  });
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + script);
  return script + html;
}

// Safe to drop inside a <script> tag.
function jsString(s) {
  return JSON.stringify(s).replace(/</g, "\\u003c");
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function errorPage(target, reason) {
  return `<!doctype html><meta name="viewport" content="width=device-width">
<body style="font:16px system-ui;padding:24px;color:#333">
<h2>😕 Couldn't open that website</h2>
<p><b>${escapeAttr(target)}</b></p>
<p>Reason: ${escapeAttr(String(reason))}</p>
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
