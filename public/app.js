"use strict";

const $ = (id) => document.getElementById(id);
const ALLOWED = [".txt", ".md", ".pdf", ".docx"];
const MAX_SIZE = 2 * 1024 * 1024;

const el = {
  root: document.documentElement,
  themeToggle: $("theme-toggle"),
  dropzone: $("dropzone"),
  fileInput: $("file-input"),
  doclist: $("doclist"),
  count: $("doc-count"),
  limit: $("doc-limit"),
  meter: $("meter"),
  meterFill: $("meter-fill"),
  form: $("ask-form"),
  question: $("question"),
  askBtn: $("ask-btn"),
  answer: $("answer"),
  toast: $("toast"),
};

/* ─────────────────────────── theme ─────────────────────────── */
// initial theme is stamped pre-paint by the inline <head> script (avoids FOUC)
function effectiveTheme() {
  return el.root.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
el.themeToggle.addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  el.root.dataset.theme = next;
  localStorage.setItem("theme", next);
});

/* ─────────────────────────── toast ─────────────────────────── */
let toastTimer;
function hideToast() { clearTimeout(toastTimer); el.toast.hidden = true; }
function toast(message, isError) {
  clearTimeout(toastTimer);
  el.toast.classList.toggle("toast--error", !!isError);
  el.toast.setAttribute("role", isError ? "alert" : "status");
  el.toast.replaceChildren();
  const span = document.createElement("span");
  span.textContent = message;
  el.toast.appendChild(span);
  // Errors are sticky with a manual dismiss; success auto-hides.
  if (isError) {
    const close = document.createElement("button");
    close.className = "toast__close"; close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.appendChild(icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14));
    close.addEventListener("click", hideToast);
    el.toast.appendChild(close);
  } else {
    toastTimer = setTimeout(hideToast, 4200);
  }
  el.toast.hidden = false;
}

/* ─────────────────────────── documents ─────────────────────────── */
async function loadDocs() {
  const r = await fetch("/api/documents");
  const data = await r.json();
  renderDocs(data);
}

function renderDocs({ documents, count, limit }) {
  el.count.textContent = count;
  el.limit.textContent = limit;
  el.meterFill.style.transform = `scaleX(${limit ? count / limit : 0})`;
  el.meter.classList.toggle("is-full", count >= limit - 1);

  el.doclist.replaceChildren();
  for (const d of documents) el.doclist.appendChild(docRow(d));

  const ready = count > 0;
  const wasDisabled = el.question.disabled;
  el.question.disabled = !ready;
  el.askBtn.disabled = !ready || !el.question.value.trim();
  el.form.classList.toggle("is-ready", ready);
  el.question.placeholder = ready
    ? "Ask a question about your documents…"
    : "Upload a document to start asking…";
  // move focus into the question when it first unlocks
  if (ready && wasDisabled) el.question.focus();
}

function icon(paths, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = paths;   // static, trusted icon markup only
  return svg;
}

function docRow(d) {
  const li = document.createElement("li");
  li.className = "doc";

  const iconWrap = document.createElement("span");
  iconWrap.className = "doc__icon";
  iconWrap.appendChild(icon('<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/>', 17));

  const body = document.createElement("div");
  body.className = "doc__body";
  const name = document.createElement("span");
  name.className = "doc__name"; name.textContent = d.fileName; name.title = d.fileName;
  const meta = document.createElement("span");
  meta.className = "doc__meta";
  meta.textContent = d.chunkCount + (d.chunkCount === 1 ? " chunk" : " chunks");
  body.append(name, meta);

  const del = document.createElement("button");
  del.className = "doc__del"; del.type = "button";
  del.setAttribute("aria-label", `Delete ${d.fileName}`);
  del.appendChild(icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 15));
  del.addEventListener("click", () => deleteDoc(d.id, del));

  li.append(iconWrap, body, del);
  return li;
}

async function deleteDoc(id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch("/api/documents/" + id, { method: "DELETE" });
    if (!r.ok) throw new Error((await r.json()).error || "Delete failed");
    await loadDocs();
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
  }
}

/* ─────────────────────────── upload ─────────────────────────── */
function validate(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!ALLOWED.includes(ext)) return `Unsupported file type. Allowed: ${ALLOWED.join(", ")}`;
  if (file.size > MAX_SIZE) return "File too large (max 2 MB).";
  return null;
}

// Upload one file. Returns a result; does NOT toast (uploadMany summarizes).
async function upload(file) {
  const bad = validate(file);
  if (bad) return { ok: false, name: file.name, error: bad };

  el.dropzone.classList.add("is-busy");
  const title = el.dropzone.querySelector(".dropzone__title");
  const prev = title.textContent;
  title.textContent = `Uploading ${file.name}…`;

  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Upload failed");

    // Postgres commits and the row is searchable immediately — no index lag.
    await loadDocs();
    return { ok: true, name: data.fileName, chunkCount: data.chunkCount };
  } catch (e) {
    return { ok: false, name: file.name, error: e.message };
  } finally {
    el.dropzone.classList.remove("is-busy");
    title.textContent = prev;
    el.fileInput.value = "";
  }
}

// Upload dropped/picked files sequentially, then show ONE summary toast.
async function uploadMany(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;

  const results = [];
  for (const f of files) results.push(await upload(f));
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);

  if (bad.length) {
    const prefix = ok.length ? `Added ${ok.length}. ` : "";
    toast(`${prefix}${bad.length} failed — ${bad.map((b) => `${b.name}: ${b.error}`).join("; ")}`, true);
  } else if (ok.length === 1) {
    toast(`Added ${ok[0].name} · ${ok[0].chunkCount} chunk${ok[0].chunkCount === 1 ? "" : "s"}`);
  } else {
    toast(`Added ${ok.length} documents.`);
  }
}

el.fileInput.addEventListener("change", () => uploadMany(el.fileInput.files));

["dragenter", "dragover"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("is-drag"); }));
["dragleave", "drop"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove("is-drag"); }));
el.dropzone.addEventListener("drop", (e) => uploadMany(e.dataTransfer.files));

/* ─────────────────────────── ask ─────────────────────────── */
el.question.addEventListener("input", () => {
  el.question.style.height = "auto";
  const max = window.innerHeight * 0.4;
  el.question.style.height = Math.min(el.question.scrollHeight, max) + "px";
  el.question.style.overflowY = el.question.scrollHeight > max ? "auto" : "hidden";
  el.askBtn.disabled = el.question.disabled || !el.question.value.trim();
});
el.question.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.form.requestSubmit(); }
});

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = el.question.value.trim();
  if (!question) return;

  showThinking();
  el.askBtn.disabled = true;
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Something went wrong");
    renderResult(data);
  } catch (e) {
    renderNotice("error", "Couldn’t answer that", e.message);
  } finally {
    el.askBtn.disabled = !el.question.value.trim();
  }
});

function clearAnswer() { el.answer.replaceChildren(); }

// Render the LLM's Markdown answer (tables, lists, code) to sanitized HTML.
// Model output isn't fully trusted, so marked's HTML is always run through DOMPurify.
marked.setOptions({ gfm: true, breaks: true });
function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ""));
}

function showThinking() {
  clearAnswer();
  const t = document.createElement("div");
  t.className = "thinking";
  t.innerHTML = '<span class="thinking__dots"><i></i><i></i><i></i></span>';  // static
  t.append("Searching your documents…");
  el.answer.appendChild(t);
}

function renderResult(data) {
  clearAnswer();
  if (!data.sources || data.sources.length === 0) {
    renderNotice("empty", "No matching passages found",
      "Nothing in your uploaded documents matched this question closely enough.");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "result";

  const prose = document.createElement("div");
  prose.className = "result__prose";
  prose.innerHTML = renderMarkdown(data.answer);
  wrap.appendChild(prose);

  const sources = document.createElement("div");
  sources.className = "sources";
  const label = document.createElement("p");
  label.className = "sources__label";
  label.textContent = `${data.sources.length} source${data.sources.length === 1 ? "" : "s"} · hover to inspect the match`;
  sources.appendChild(label);

  data.sources.forEach((s, i) => sources.appendChild(sourceItem(s, i)));
  wrap.appendChild(sources);
  el.answer.appendChild(wrap);
}

function sourceItem(s, i) {
  const score = Math.max(0, Math.min(1, s.score ?? 0));
  const details = document.createElement("details");
  details.className = "source";

  const summary = document.createElement("summary");
  summary.className = "source__head";

  const rank = document.createElement("span");
  rank.className = "source__rank"; rank.textContent = String(i + 1).padStart(2, "0");

  const name = document.createElement("span");
  name.className = "source__name"; name.textContent = s.fileName;

  const scoreWrap = document.createElement("span");
  scoreWrap.className = "source__score";
  const bar = document.createElement("span");
  bar.className = "source__bar";
  const fill = document.createElement("i");
  fill.style.width = (score * 100).toFixed(0) + "%";
  bar.appendChild(fill);
  const num = document.createElement("span");
  num.className = "source__num"; num.textContent = score.toFixed(2);
  scoreWrap.append(bar, num);

  const caret = icon('<path d="m9 6 6 6-6 6"/>', 14);
  caret.classList.add("source__caret");

  summary.append(rank, name, scoreWrap, caret);

  const snippet = document.createElement("div");
  snippet.className = "source__snippet";
  snippet.textContent = s.snippet + (s.snippet && s.snippet.length >= 200 ? "…" : "");

  details.append(summary, snippet);
  return details;
}

function renderNotice(kind, title, body) {
  clearAnswer();
  const n = document.createElement("div");
  n.className = "notice notice--" + kind;
  const wrap = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  wrap.append(strong, document.createElement("br"), document.createTextNode(body));
  n.appendChild(wrap);
  el.answer.appendChild(n);
}

/* ─────────────────────────── go ─────────────────────────── */
loadDocs().catch((e) => toast("Couldn’t reach the server: " + e.message, true));
