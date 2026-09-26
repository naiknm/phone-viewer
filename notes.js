// Notes board: click anywhere around the phone to type a note.
//
// Notion-style shortcuts, typed at the start of a note:
//   "# "  big heading      "## " medium heading   "### " small heading
//   "- "  bullet list      "1. " numbered list     "[] " to-do checkbox
//   "> "  quote
// Notes are saved in this browser, so they're still there next time.
(function () {
  const stage = document.getElementById("stage");
  const layer = document.getElementById("notes-layer");
  const hint = document.getElementById("notes-hint");
  const clearBtn = document.getElementById("clear-notes");

  const KEY = "phone-viewer:notes";
  const PLACEHOLDER = "Type a note, or # for a heading, - for a list, [] for a to-do";
  const SHORTCUTS = [
    ["### ", { type: "h3" }],
    ["## ", { type: "h2" }],
    ["# ", { type: "h1" }],
    ["[] ", { type: "todo" }],
    ["[ ] ", { type: "todo" }],
    ["> ", { type: "quote" }],
    ["- ", { list: "insertUnorderedList" }],
    ["* ", { list: "insertUnorderedList" }],
    ["1. ", { list: "insertOrderedList" }],
  ];

  let notes = [];
  let topZ = 10;

  // Whatever was touched last (a note or the phone) sits on top.
  window.pvFront = function (el) { el.style.zIndex = String(++topZ); };

  // ---------- Saving ----------

  function load() {
    try { notes = JSON.parse(localStorage.getItem(KEY)) || []; } catch { notes = []; }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch { /* private mode */ }
    }, 200);
    hint.hidden = notes.length > 0;
    clearBtn.hidden = notes.length === 0;
  }

  // ---------- Building a note ----------

  const GRIP = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  function render(note) {
    const el = document.createElement("div");
    el.className = "note";
    el.dataset.id = note.id;
    el.innerHTML =
      `<button type="button" class="note-grip" title="Drag to move" aria-label="Move note">${GRIP}</button>` +
      `<input type="checkbox" class="note-check" aria-label="Done">` +
      `<div class="note-body" contenteditable="true" spellcheck="true"></div>` +
      `<button type="button" class="note-delete" title="Delete note" aria-label="Delete note">${CROSS}</button>`;
    const body = el.querySelector(".note-body");
    body.innerHTML = note.html || "";
    body.dataset.placeholder = PLACEHOLDER;
    applyType(el, note);
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    layer.appendChild(el);
    wire(el, note);
    return el;
  }

  function applyType(el, note) {
    el.className = `note ${note.type || "text"}${note.done ? " done" : ""}`;
    el.querySelector(".note-check").checked = !!note.done;
  }

  function create(x, y, type) {
    const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), x, y, type: type || "text", html: "" };
    notes.push(note);
    const el = render(note);
    window.pvFront(el);
    focusEnd(el.querySelector(".note-body"));
    save();
    return el;
  }

  function remove(note, el) {
    notes = notes.filter((n) => n !== note);
    el.remove();
    save();
  }

  function isEmpty(body) {
    return body.textContent.trim() === "" && !body.querySelector("li, img");
  }

  function focusEnd(body) {
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- Typing ----------

  function wire(el, note) {
    const body = el.querySelector(".note-body");

    el.addEventListener("pointerdown", () => window.pvFront(el));

    body.addEventListener("input", () => {
      shortcut(el, note, body);
      note.html = body.innerHTML;
      save();
    });

    body.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { body.blur(); return; }

      // Enter in a heading or to-do starts a fresh note underneath, like Notion.
      if (e.key === "Enter" && !e.shiftKey && ["h1", "h2", "h3", "todo", "quote"].includes(note.type)) {
        e.preventDefault();
        if (note.type === "todo" && isEmpty(body)) { setType(el, note, "text"); return; }
        const nextType = note.type === "todo" ? "todo" : "text";
        create(note.x, note.y + el.offsetHeight + 4, nextType);
        return;
      }

      // Backspace in an empty note: first undo its style, then delete it.
      if (e.key === "Backspace" && isEmpty(body)) {
        e.preventDefault();
        if (note.type !== "text") setType(el, note, "text");
        else remove(note, el);
      }
    });

    // Paste as plain text so notes keep a clean look.
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    body.addEventListener("blur", () => {
      if (isEmpty(body) && note.type === "text") remove(note, el);
    });

    el.querySelector(".note-check").addEventListener("change", (e) => {
      note.done = e.target.checked;
      applyType(el, note);
      save();
    });

    el.querySelector(".note-delete").addEventListener("click", () => remove(note, el));

    el.querySelector(".note-grip").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      drag(e, el, (x, y) => { note.x = x; note.y = y; save(); });
    });
  }

  function setType(el, note, type) {
    note.type = type;
    if (type !== "todo") note.done = false;
    applyType(el, note);
    save();
  }

  // Turn "# ", "- ", "[] " etc. at the start of a note into a style.
  function shortcut(el, note, body) {
    if (note.type !== "text") return;
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || firstText(body) !== node) return;
    if (node.parentNode.closest("li")) return;
    const typed = node.data.slice(0, sel.anchorOffset).replace(/ /g, " ");
    const match = SHORTCUTS.find(([prefix]) => typed === prefix);
    if (!match) return;
    const [prefix, action] = match;
    node.data = node.data.slice(prefix.length);
    const range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    if (action.type) setType(el, note, action.type);
    if (action.list) document.execCommand(action.list);
  }

  function firstText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
  }

  // ---------- Dragging (shared with the phone) ----------

  // Moves `el` with the pointer inside the stage, then calls done(x, y).
  function drag(e, el, done, opts) {
    const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
    window.pvFront(el);

    function move(ev) {
      const x = start.left + ev.clientX - start.x;
      const y = start.top + ev.clientY - start.y;
      const pos = clampTo(el, x, y, opts);
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
    }
    function up() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      stage.classList.remove("dragging");
      done(el.offsetLeft, el.offsetTop);
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // Keep at least a bit of the thing on screen so it can't get lost.
  function clampTo(el, x, y, opts) {
    const keep = 48;
    const top = (opts && opts.minTop) || 0;
    return {
      x: Math.min(stage.clientWidth - keep, Math.max(keep - el.offsetWidth, x)),
      y: Math.min(stage.clientHeight - keep, Math.max(top, y)),
    };
  }

  window.pvDrag = drag;
  window.pvClamp = clampTo;

  // ---------- Clicking the board ----------

  stage.addEventListener("click", (e) => {
    if (e.target !== stage && e.target !== layer) return;
    const rect = stage.getBoundingClientRect();
    create(Math.round(e.clientX - rect.left), Math.round(e.clientY - rect.top - 12));
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Delete all notes?")) return;
    notes = [];
    layer.innerHTML = "";
    save();
  });

  load();
  notes.forEach(render);
  hint.hidden = notes.length > 0;
  clearBtn.hidden = notes.length === 0;
})();
