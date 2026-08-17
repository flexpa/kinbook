import sampleGed from "../sample.ged";
import { parseGedcom, type Archive } from "./gedcom";
import {
  computeLayout,
  lerpLayout,
  roman,
  traceLineage,
  type Layout,
  type Lineage,
} from "./layout";
import { Renderer } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = document.getElementById("stage") as unknown as SVGSVGElement;
const cameraG = document.getElementById("camera") as unknown as SVGGElement;
const searchInput = $<HTMLInputElement>("search");
const statsEl = $("stats");
const statusEl = $("status");
const filechip = $("filechip");
const filenameEl = $("filename");
const emptyEl = $("empty");
const toastEl = $("toast");
const zoomLevelEl = $("zoomlevel");
const minimap = $<HTMLCanvasElement>("minimap");
const fileInput = $<HTMLInputElement>("fileinput");

const reduced =
  matchMedia("(prefers-reduced-motion: reduce)").matches ||
  new URLSearchParams(location.search).has("instant");

// ── State ────────────────────────────────────────────────────────────────────

let archive: Archive | null = null;
let renderer: Renderer | null = null;
let target: Layout | null = null; // the layout being tweened toward
let drawn: Layout | null = null; // what is currently on screen
let selectedId: string | null = null;
let lineage: Lineage | null = null;
let matches: string[] = [];
let matchIdx = -1;
const cam = { x: 0, y: 0, k: 1 };

// ── Tweens ───────────────────────────────────────────────────────────────────

interface Tween {
  t0: number;
  dur: number;
  tick: (t: number) => void;
  done?: () => void;
  dead?: boolean;
}
const tweens: Tween[] = [];
let raf = 0;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function addTween(dur: number, tick: (t: number) => void, done?: () => void): () => void {
  if (reduced || dur <= 0) {
    tick(1);
    done?.();
    return () => {};
  }
  const tw: Tween = { t0: performance.now(), dur, tick, done };
  tweens.push(tw);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => {
    tw.dead = true;
  };
}

function frame(now: number) {
  raf = 0;
  for (const tw of tweens.slice()) {
    if (tw.dead) continue;
    const t = Math.min(1, (now - tw.t0) / tw.dur);
    tw.tick(t);
    if (t >= 1) {
      tw.dead = true;
      tw.done?.();
    }
  }
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i]!.dead) tweens.splice(i, 1);
  if (tweens.length) raf = requestAnimationFrame(frame);
}

// ── Camera ───────────────────────────────────────────────────────────────────

let cancelCamTween: (() => void) | null = null;

function applyCam() {
  cameraG.setAttribute("transform", `translate(${cam.x},${cam.y}) scale(${cam.k})`);
  zoomLevelEl.textContent = `${Math.round(cam.k * 100)}%`;
  drawMinimap();
}

function camTo(x: number, y: number, k: number, animate = true) {
  cancelCamTween?.();
  if (!animate) {
    cam.x = x;
    cam.y = y;
    cam.k = k;
    applyCam();
    return;
  }
  const from = { ...cam };
  const lk0 = Math.log(from.k);
  const lk1 = Math.log(k);
  cancelCamTween = addTween(420, (t) => {
    const e = easeInOut(t);
    cam.k = Math.exp(lk0 + (lk1 - lk0) * e);
    cam.x = from.x + (x - from.x) * e;
    cam.y = from.y + (y - from.y) * e;
    applyCam();
  });
}

function viewSize() {
  return { w: stage.clientWidth, h: stage.clientHeight };
}

function fitView(animate: boolean) {
  if (!target) return;
  const { w, h } = viewSize();
  const pad = 56;
  // include the generation-label gutter on the left
  const b = { x: target.bbox.x - 150, y: target.bbox.y, w: target.bbox.w + 190, h: target.bbox.h };
  const k = clamp(Math.min((w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1)), 0.06, 1.3);
  const x = w / 2 - (b.x + b.w / 2) * k;
  const y = h / 2 - (b.y + b.h / 2) * k;
  camTo(x, y, k, animate);
}

function zoomAt(px: number, py: number, factor: number) {
  cancelCamTween?.();
  const k = clamp(cam.k * factor, 0.06, 4);
  const f = k / cam.k;
  cam.x = px - (px - cam.x) * f;
  cam.y = py - (py - cam.y) * f;
  cam.k = k;
  applyCam();
}

function ensureVisible(id: string) {
  if (!target) return;
  const n = target.nodes.get(id);
  if (!n) return;
  const { w, h } = viewSize();
  if (cam.k < 0.5) {
    const k = 0.85;
    camTo(w / 2 - (n.x + n.w / 2) * k, h / 2 - (n.y + n.h / 2) * k, k);
    return;
  }
  const m = 48;
  const x1 = n.x * cam.k + cam.x;
  const y1 = n.y * cam.k + cam.y;
  const x2 = (n.x + n.w) * cam.k + cam.x;
  const y2 = (n.y + n.h) * cam.k + cam.y;
  let dx = 0;
  let dy = 0;
  if (x1 < m) dx = m - x1;
  else if (x2 > w - m) dx = w - m - x2;
  if (y1 < m + 8) dy = m + 8 - y1;
  else if (y2 > h - m) dy = h - m - y2;
  if (dx || dy) camTo(cam.x + dx, cam.y + dy, cam.k);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Layout transitions ───────────────────────────────────────────────────────

let cancelLayoutTween: (() => void) | null = null;

function setLayout(next: Layout, animate: boolean, after?: () => void) {
  const from = drawn;
  target = next;
  cancelLayoutTween?.();
  if (!animate || reduced || !from) {
    drawn = next;
    renderer!.draw(next);
    drawMinimap();
    after?.();
    return;
  }
  cancelLayoutTween = addTween(
    460,
    (t) => {
      drawn = lerpLayout(from, next, easeInOut(t));
      renderer!.draw(drawn);
      drawMinimap();
    },
    () => {
      drawn = next;
      after?.();
    },
  );
}

function relayout(animate: boolean, after?: () => void) {
  if (!archive || !renderer) return;
  setLayout(computeLayout(archive, selectedId, renderer.sizeOf), animate, after);
}

// ── Selection ────────────────────────────────────────────────────────────────

function setSelection(id: string | null) {
  if (!archive || !renderer) return;
  clearSearch(true);
  const prev = selectedId;
  selectedId = id;
  renderer.clearLineage();
  renderer.setSelected(id);
  if (prev) renderer.setCardContent(prev, false);
  if (id) {
    renderer.setCardContent(id, true, !reduced);
    lineage = traceLineage(archive, id);
    renderer.applyLineageCards(lineage);
    const lin = lineage;
    relayout(true, () => {
      renderer!.revealContent(id);
      if (selectedId === id && lin) renderer!.applyLineageEdges(lin, !reduced);
    });
    ensureVisible(id);
    const p = archive.persons.get(id)!;
    const name = [p.given, p.surname].filter(Boolean).join(" ");
    setStatus(
      `${name} — ${lineage.nAnc} ancestor${lineage.nAnc === 1 ? "" : "s"} · ` +
        `${lineage.nDesc} descendant${lineage.nDesc === 1 ? "" : "s"} · esc clears`,
    );
    history.replaceState(null, "", "#" + encodeURIComponent(id));
  } else {
    lineage = null;
    relayout(true);
    setStatus(DEFAULT_STATUS);
    history.replaceState(null, "", location.pathname + location.search);
  }
  drawMinimap();
}

const DEFAULT_STATUS = "Click a record to trace its bloodline.";

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

// ── Search ───────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function runSearch(q: string) {
  if (!archive || !renderer || !target) return;
  q = norm(q.trim());
  if (q.length < 2) {
    clearSearch(false);
    return;
  }
  if (selectedId) setSelection(null);
  matches = [...archive.persons.values()]
    .filter((p) => norm(`${p.given} ${p.surname}`).includes(q))
    .map((p) => p.id)
    .sort((a, b) => {
      const na = target!.nodes.get(a)!;
      const nb = target!.nodes.get(b)!;
      return na.rank - nb.rank || na.x - nb.x;
    });
  matchIdx = -1;
  renderer.setSearchHits(new Set(matches), null);
  setStatus(
    matches.length
      ? `${matches.length} record${matches.length === 1 ? "" : "s"} match · enter cycles`
      : "No records match.",
  );
}

function cycleSearch() {
  if (!matches.length || !renderer || !target) return;
  matchIdx = (matchIdx + 1) % matches.length;
  const id = matches[matchIdx]!;
  renderer.setSearchHits(new Set(matches), id);
  const n = target.nodes.get(id)!;
  const { w, h } = viewSize();
  const k = Math.max(cam.k, 0.9);
  camTo(w / 2 - (n.x + n.w / 2) * k, h / 2 - (n.y + n.h / 2) * k, k);
  const p = archive!.persons.get(id)!;
  setStatus(`${matchIdx + 1} of ${matches.length} — ${p.given} ${p.surname}`);
}

function clearSearch(clearInput: boolean) {
  matches = [];
  matchIdx = -1;
  renderer?.setSearchHits(null, null);
  if (clearInput && searchInput.value) searchInput.value = "";
}

// ── Minimap ──────────────────────────────────────────────────────────────────

function drawMinimap() {
  if (!drawn) return;
  const dpr = devicePixelRatio || 1;
  const cw = minimap.clientWidth;
  const ch = minimap.clientHeight;
  if (minimap.width !== cw * dpr) {
    minimap.width = cw * dpr;
    minimap.height = ch * dpr;
  }
  const ctx = minimap.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const b = drawn.bbox;
  const pad = 30;
  const s = Math.min(cw / (b.w + pad * 2), ch / (b.h + pad * 2));
  const ox = (cw - b.w * s) / 2 - b.x * s;
  const oy = (ch - b.h * s) / 2 - b.y * s;
  const hitSet = matches.length ? new Set(matches) : null;
  for (const n of drawn.nodes.values()) {
    if (lineage) {
      ctx.fillStyle = lineage.related.has(n.id) ? "#c2472e" : "rgba(242,233,210,0.22)";
    } else if (hitSet) {
      ctx.fillStyle = hitSet.has(n.id) ? "#a9c4ae" : "rgba(242,233,210,0.28)";
    } else {
      ctx.fillStyle = "rgba(242,233,210,0.75)";
    }
    ctx.fillRect(ox + n.x * s, oy + n.y * s, Math.max(2, n.w * s), Math.max(1.5, n.h * s));
  }
  // viewport
  const { w, h } = viewSize();
  const wx = (0 - cam.x) / cam.k;
  const wy = (0 - cam.y) / cam.k;
  const ww = w / cam.k;
  const wh = h / cam.k;
  ctx.strokeStyle = "rgba(169,196,174,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + wx * s, oy + wy * s, ww * s, wh * s);
}

function minimapJump(e: PointerEvent) {
  if (!drawn) return;
  const r = minimap.getBoundingClientRect();
  const b = drawn.bbox;
  const pad = 30;
  const s = Math.min(r.width / (b.w + pad * 2), r.height / (b.h + pad * 2));
  const ox = (r.width - b.w * s) / 2 - b.x * s;
  const oy = (r.height - b.h * s) / 2 - b.y * s;
  const wx = (e.clientX - r.left - ox) / s;
  const wy = (e.clientY - r.top - oy) / s;
  const { w, h } = viewSize();
  camTo(w / 2 - wx * cam.k, h / 2 - wy * cam.k, cam.k, false);
}

// ── Pan / zoom / pointer input ───────────────────────────────────────────────

const pointers = new Map<number, { x: number; y: number }>();
let pan: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
let pinch: { d0: number; k0: number } | null = null;
// pointer capture retargets pointerup to the svg, so remember what was pressed
let downTarget: Element | null = null;

function stagePos(e: { clientX: number; clientY: number }) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    cancelCamTween?.();
    downTarget = e.target as Element;
    pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  } else if (pointers.size === 2) {
    pan = null;
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a!.x - b!.x, a!.y - b!.y), k0: cam.k };
  }
});

stage.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const mid = stagePos({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
    zoomAt(mid.x, mid.y, clamp((pinch.d0 ? d / pinch.d0 : 1) * pinch.k0, 0.06, 4) / cam.k);
    pinch.d0 = d;
    pinch.k0 = cam.k;
  } else if (pan) {
    const dx = e.clientX - pan.sx;
    const dy = e.clientY - pan.sy;
    if (Math.hypot(dx, dy) > 4) {
      pan.moved = true;
      stage.classList.add("panning");
    }
    if (pan.moved) {
      cam.x = pan.cx + dx;
      cam.y = pan.cy + dy;
      applyCam();
    }
  }
});

function endPointer(e: PointerEvent) {
  const wasClick = pan && !pan.moved && pointers.size === 1;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    stage.classList.remove("panning");
    if (wasClick) {
      const card = downTarget?.closest?.(".card") as SVGGElement | null;
      if (card) {
        const id = card.dataset.id!;
        setSelection(id === selectedId ? null : id);
      } else if (selectedId) {
        setSelection(null);
      }
    }
    pan = null;
    downTarget = null;
  }
}
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = stagePos(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
  },
  { passive: false },
);

stage.addEventListener("dblclick", (e) => {
  if ((e.target as Element).closest?.(".card")) return;
  const p = stagePos(e);
  zoomAt(p.x, p.y, 1.7);
});

// hover previews the immediate family's connectors
stage.addEventListener("pointerover", (e) => {
  const card = (e.target as Element).closest?.(".card") as SVGGElement | null;
  renderer?.setHover(card?.dataset.id ?? null);
});
stage.addEventListener("pointerout", (e) => {
  if (!(e.relatedTarget as Element | null)?.closest?.(".card")) renderer?.setHover(null);
});

// keyboard activation of a focused card
stage.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = (e.target as Element).closest?.(".card") as SVGGElement | null;
  if (!card) return;
  e.preventDefault();
  const id = card.dataset.id!;
  setSelection(id === selectedId ? null : id);
});

minimap.addEventListener("pointerdown", (e) => {
  minimap.setPointerCapture(e.pointerId);
  minimapJump(e);
});
minimap.addEventListener("pointermove", (e) => {
  if (e.buttons & 1) minimapJump(e);
});

// ── Keyboard ─────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const { w, h } = viewSize();
  switch (e.key) {
    case "Escape":
      if (selectedId) setSelection(null);
      else {
        clearSearch(true);
        if (archive) setStatus(DEFAULT_STATUS);
      }
      break;
    case "+":
    case "=":
      zoomAt(w / 2, h / 2, 1.25);
      break;
    case "-":
      zoomAt(w / 2, h / 2, 0.8);
      break;
    case "0":
      fitView(true);
      break;
    case "/":
      e.preventDefault();
      searchInput.focus();
      break;
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      if (selectedId) {
        e.preventDefault();
        navigate(e.key);
      }
      break;
  }
});

function navigate(key: string) {
  if (!archive || !selectedId || !target) return;
  const p = archive.persons.get(selectedId)!;
  let next: string | null = null;
  if (key === "ArrowUp") {
    const fam = p.famc[0] ? archive.families.get(p.famc[0]) : null;
    next = fam?.husb ?? fam?.wife ?? null;
  } else if (key === "ArrowDown") {
    for (const famId of p.fams) {
      const c = archive.families.get(famId)?.children[0];
      if (c) {
        next = c;
        break;
      }
    }
  } else {
    const n = target.nodes.get(selectedId)!;
    const row = [...target.nodes.values()].filter((o) => o.rank === n.rank).sort((a, b) => a.x - b.x);
    const i = row.findIndex((o) => o.id === selectedId);
    const j = key === "ArrowLeft" ? i - 1 : i + 1;
    next = row[j]?.id ?? null;
  }
  if (next) setSelection(next);
}

// ── Header / search / file wiring ────────────────────────────────────────────

searchInput.addEventListener("input", () => runSearch(searchInput.value));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    cycleSearch();
  } else if (e.key === "Escape") {
    clearSearch(true);
    searchInput.blur();
    if (archive) setStatus(DEFAULT_STATUS);
  }
});

$("zoomin").addEventListener("click", () => zoomAt(viewSize().w / 2, viewSize().h / 2, 1.25));
$("zoomout").addEventListener("click", () => zoomAt(viewSize().w / 2, viewSize().h / 2, 0.8));
$("fitbtn").addEventListener("click", () => fitView(true));
$("openbtn").addEventListener("click", () => fileInput.click());
$("openbtn2").addEventListener("click", () => fileInput.click());
$("samplebtn").addEventListener("click", () => loadText(sampleGed, "sample.ged"));
$("clearfile").addEventListener("click", closeArchive);

fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (f) loadText(await f.text(), f.name);
  fileInput.value = "";
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dropping");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("dropping");
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  const f = e.dataTransfer?.files?.[0];
  if (f) loadText(await f.text(), f.name);
});

window.addEventListener("resize", () => {
  applyCam();
});

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 5000);
}

// ── Archive lifecycle ────────────────────────────────────────────────────────

function loadText(text: string, name: string) {
  let a: Archive;
  try {
    a = parseGedcom(text);
  } catch (err) {
    toast(err instanceof Error ? err.message : "Could not read the file.");
    return;
  }
  renderer?.destroy();
  selectedId = null;
  lineage = null;
  clearSearch(true);
  archive = a;
  renderer = new Renderer(stage, cameraG, a);
  const l = computeLayout(a, null, renderer.sizeOf);
  renderer.buildBands(l);
  target = l;
  drawn = l;
  renderer.draw(l);
  fitView(false);
  renderer.entrance(l, reduced);
  statsEl.textContent = `${a.persons.size} INDI · ${a.families.size} FAM · GEN ${roman(l.maxRank + 1)}`;
  filenameEl.textContent = name;
  filechip.hidden = false;
  document.title = `${name} — Kinbook`;
  emptyEl.hidden = true;
  document.body.classList.add("loaded");
  setStatus(DEFAULT_STATUS);
  drawMinimap();

  const problems = [...a.warnings, ...l.warnings];
  if (problems.length) {
    for (const wmsg of problems) console.warn("family-register:", wmsg);
    toast(
      problems.length === 1
        ? problems[0]!
        : `${problems.length} impossible or broken links were ignored — see the console.`,
    );
  }

  const want = decodeURIComponent(location.hash.slice(1));
  if (want && a.persons.has(want)) {
    window.setTimeout(() => setSelection(want), reduced ? 0 : 700);
  }
}

function closeArchive() {
  renderer?.destroy();
  renderer = null;
  archive = null;
  target = null;
  drawn = null;
  selectedId = null;
  lineage = null;
  clearSearch(true);
  statsEl.textContent = "";
  filechip.hidden = true;
  emptyEl.hidden = false;
  document.body.classList.remove("loaded");
  document.title = "Kinbook";
  setStatus("Open an archive to begin.");
  history.replaceState(null, "", location.pathname + location.search);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

(async function boot() {
  setStatus("Open an archive to begin.");
  const q = new URLSearchParams(location.search);
  if (q.has("demo")) {
    loadText(sampleGed, "sample.ged");
  } else if (q.get("src")) {
    const src = q.get("src")!;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadText(await res.text(), src.split("/").pop() || src);
    } catch {
      toast(`Could not fetch ${src}.`);
    }
  }
})();
