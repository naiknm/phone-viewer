(function () {
  const devices = window.PHONE_DEVICES;
  const CUSTOM = "custom";
  const BEZEL = 12;

  // The local helper (server.js) runs on this port. It is only reachable
  // when the viewer itself is opened from this computer.
  const HELPER_PORT = 8081;
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const helperOrigin = isLocal ? `http://${location.hostname}:${HELPER_PORT}` : null;
  let helperOn = false;

  const $ = (id) => document.getElementById(id);
  const urlForm = $("url-form");
  const urlInput = $("url-input");
  const select = $("device-select");
  const customBox = $("custom-size");
  const customW = $("custom-width");
  const customH = $("custom-height");
  const stage = $("stage");
  const holder = $("phone-holder");
  const phone = $("phone");
  const screen = $("screen");
  const statusBar = $("status-bar");
  const cutout = $("cutout");
  const frame = $("site-frame");
  const emptyMsg = $("empty-msg");
  const deviceInfo = $("device-info");
  const modeBadge = $("mode-badge");

  let landscape = false;
  let currentUrl = "";

  // ---------- Remembering choices (only in this browser) ----------

  function load(key) {
    try { return localStorage.getItem("phone-viewer:" + key); } catch { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem("phone-viewer:" + key, value); } catch { /* private mode */ }
  }

  // ---------- Dropdown ----------

  function fillDropdown() {
    const groups = {};
    devices.forEach((d, i) => {
      if (!groups[d.brand]) {
        groups[d.brand] = document.createElement("optgroup");
        groups[d.brand].label = d.brand;
        select.appendChild(groups[d.brand]);
      }
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${d.top10 ? "★ " : ""}${d.name}  (${d.width}×${d.height})`;
      groups[d.brand].appendChild(opt);
    });
    const other = document.createElement("optgroup");
    other.label = "Other";
    const opt = document.createElement("option");
    opt.value = CUSTOM;
    opt.textContent = "Custom size…";
    other.appendChild(opt);
    select.appendChild(other);
  }

  function currentDevice() {
    if (select.value === CUSTOM) {
      const w = clamp(parseInt(customW.value, 10) || 400, 200, 1600);
      const h = clamp(parseInt(customH.value, 10) || 860, 300, 2000);
      return { name: "Custom", width: w, height: h, os: "android", cutout: "none", radius: 24 };
    }
    return devices[Number(select.value)];
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // ---------- Drawing the phone ----------

  function statusBarHeight(d) {
    if (landscape) return 0;
    if (d.os === "ios") return d.cutout === "notch" ? 47 : 54;
    return d.cutout === "none" ? 0 : 32;
  }

  function drawPhone() {
    const d = currentDevice();
    const w = landscape ? d.height : d.width;
    const h = landscape ? d.width : d.height;

    phone.classList.toggle("landscape", landscape);
    phone.classList.toggle("android", d.os === "android");
    phone.style.borderRadius = `${d.radius + BEZEL}px`;
    screen.style.width = `${w}px`;
    screen.style.height = `${h}px`;
    screen.style.borderRadius = `${d.radius}px`;

    const sb = statusBarHeight(d);
    statusBar.hidden = sb === 0;
    statusBar.style.height = `${sb}px`;
    cutout.className = `cutout ${d.cutout}`;

    const siteHeight = h - sb;
    deviceInfo.textContent =
      `${d.name}${landscape ? " (sideways)" : ""} · screen ${w} × ${h} · website sees ${w} × ${siteHeight}`;

    fitToWindow(w + BEZEL * 2, h + BEZEL * 2);
  }

  // Shrink the phone so it always fits in the window.
  function fitToWindow(phoneW, phoneH) {
    const style = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(1, availW / phoneW, availH / phoneH);
    phone.style.transform = `scale(${scale})`;
    holder.style.width = `${phoneW * scale}px`;
    holder.style.height = `${phoneH * scale}px`;
    const pct = Math.round(scale * 100);
    if (pct < 100) deviceInfo.textContent += ` · shown at ${pct}%`;
  }

  // ---------- Loading a website ----------

  function cleanUrl(text) {
    let t = text.trim();
    if (!t) return "";
    if (!/^https?:\/\//i.test(t)) t = "https://" + t;
    try { return new URL(t).href; } catch { return ""; }
  }

  function frameSrc(url) {
    if (!helperOn) return url;
    const ua = currentDevice().os === "ios" ? "ios" : "android";
    return `${helperOrigin}/__pv/open?ua=${ua}&u=${encodeURIComponent(url)}`;
  }

  function show(url) {
    currentUrl = url;
    if (!url) {
      frame.removeAttribute("src");
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;
    frame.src = frameSrc(url);
    save("url", url);
  }

  // Pages opened through the helper tell us their real address when you
  // click around, so the address box stays up to date.
  window.addEventListener("message", (e) => {
    if (e.origin !== helperOrigin || !e.data || e.data.type !== "phone-viewer-url") return;
    currentUrl = e.data.url;
    urlInput.value = e.data.url;
    save("url", e.data.url);
  });

  // ---------- Local helper check ----------

  async function checkHelper() {
    if (helperOrigin) {
      try {
        const res = await fetch(`${helperOrigin}/__pv/ping`, { signal: AbortSignal.timeout(1500) });
        helperOn = res.ok;
      } catch { helperOn = false; }
    }
    if (helperOn) {
      modeBadge.className = "badge full";
      modeBadge.textContent = "● Full mode: local helper is on, so every website can be shown";
    } else {
      modeBadge.className = "badge simple";
      modeBadge.textContent =
        "● Simple mode: some sites (like Shopify stores) block this. Blank screen? Start it from PowerShell with \"npm start\" instead.";
    }
  }

  // ---------- Buttons ----------

  urlForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = cleanUrl(urlInput.value);
    urlInput.value = url;
    show(url);
  });

  select.addEventListener("change", () => {
    customBox.hidden = select.value !== CUSTOM;
    save("device", select.value);
    drawPhone();
    // Android and iPhone get different page versions from some sites.
    if (helperOn && currentUrl) show(currentUrl);
  });

  [customW, customH].forEach((el) => el.addEventListener("input", () => {
    save("custom", `${customW.value}x${customH.value}`);
    drawPhone();
  }));

  $("rotate-btn").addEventListener("click", () => {
    landscape = !landscape;
    drawPhone();
  });

  $("reload-btn").addEventListener("click", () => show(currentUrl));

  window.addEventListener("resize", drawPhone);

  // ---------- Start ----------

  async function start() {
    fillDropdown();
    const savedCustom = (load("custom") || "").split("x");
    if (savedCustom.length === 2) { customW.value = savedCustom[0]; customH.value = savedCustom[1]; }
    const savedDevice = load("device");
    const valid = savedDevice === CUSTOM || (savedDevice !== null && devices[Number(savedDevice)]);
    select.value = valid ? savedDevice : "0";
    customBox.hidden = select.value !== CUSTOM;
    drawPhone();

    await checkHelper();

    const params = new URLSearchParams(location.search);
    const startUrl = cleanUrl(params.get("url") || load("url") || "");
    urlInput.value = startUrl;
    show(startUrl);
  }

  start();
})();
