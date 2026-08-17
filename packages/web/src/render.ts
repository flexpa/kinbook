/**
 * SVG scene renderer. Builds DOM once per archive, then `draw(layout)`
 * applies positions — so re-layouts tween by drawing interpolated layouts.
 */

import type { Archive, GEvent, GPerson } from "./gedcom";
import { lifespan } from "./gedcom";
import type { Layout, Lineage, LUnion } from "./layout";
import { CARD_H, CARD_W, CARD_W_EXP } from "./layout";

const NS = "http://www.w3.org/2000/svg";

const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

interface CardEls {
  g: SVGGElement;
  bg: SVGRectElement;
  tick: SVGRectElement;
  content: SVGGElement;
}

interface FamEls {
  g: SVGGElement;
  bar: SVGPathElement | null;
  diamond: SVGPathElement | null;
  slashes: SVGPathElement | null;
  label: SVGTextElement | null;
  drop: SVGPathElement | null;
  elbows: Map<string, SVGPathElement>;
}

interface BandEls {
  rect: SVGRectElement;
  label: SVGTextElement;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute("class", cls);
  return e;
}

function text(cls: string, x: number, y: number, anchor?: string): SVGTextElement {
  const t = el("text", cls);
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  if (anchor) t.setAttribute("text-anchor", anchor);
  return t;
}

export class Renderer {
  private archive: Archive;
  private bandsG: SVGGElement;
  private edgesG: SVGGElement;
  private cardsG: SVGGElement;
  private cards = new Map<string, CardEls>();
  private fams = new Map<string, FamEls>();
  private bands: BandEls[] = [];
  private measureCtx = document.createElement("canvas").getContext("2d")!;
  private lineageAnims: Animation[] = [];
  private lineageCleanup: number | null = null;
  readonly root: SVGSVGElement;

  constructor(root: SVGSVGElement, camera: SVGGElement, archive: Archive) {
    this.root = root;
    this.archive = archive;
    this.bandsG = el("g", "bands");
    this.edgesG = el("g", "edges");
    this.cardsG = el("g", "cards");
    camera.append(this.bandsG, this.edgesG, this.cardsG);
    this.build();
  }

  destroy() {
    this.cancelLineageAnims();
    this.bandsG.remove();
    this.edgesG.remove();
    this.cardsG.remove();
  }

  /** Card size used by the layout. Expanded height depends on the record. */
  sizeOf = (p: GPerson, expanded: boolean): { w: number; h: number } => {
    if (!expanded) return { w: CARD_W, h: CARD_H };
    const rows = Math.max(p.events.length, 1);
    return { w: CARD_W_EXP, h: 57 + rows * 17 + 8 };
  };

  private build() {
    for (const fam of this.archive.families.values()) {
      const spouses = [fam.husb, fam.wife].filter(Boolean);
      if (spouses.length === 0) continue;
      const g = el("g", "fam");
      g.dataset.fam = fam.id;
      const f: FamEls = { g, bar: null, diamond: null, slashes: null, label: null, drop: null, elbows: new Map() };
      if (fam.husb && fam.wife) {
        f.bar = el("path", "bar");
        g.append(f.bar);
        f.diamond = el("path", "diamond");
        g.append(f.diamond);
        if (fam.divorce) {
          f.slashes = el("path", "slashes");
          g.append(f.slashes);
        }
        if (fam.marriage?.year != null) {
          // year only — it has to fit the narrow gap between the spouse cards
          f.label = text("mlabel", 0, 0, "middle");
          f.label.textContent = String(fam.marriage.year);
          g.append(f.label);
        }
      }
      if (fam.children.length > 0) {
        f.drop = el("path", "drop");
        g.append(f.drop);
        for (const c of fam.children) {
          const p = el("path", "elbow");
          p.dataset.child = c;
          f.elbows.set(c, p);
          g.append(p);
        }
      }
      this.fams.set(fam.id, f);
      this.edgesG.append(g);
    }

    for (const p of this.archive.persons.values()) {
      const g = el("g", "card");
      g.dataset.id = p.id;
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      const life = lifespan(p);
      g.setAttribute("aria-label", `${p.given} ${p.surname}${life ? ", " + life : ""}`);
      const bg = el("rect", "bg");
      bg.setAttribute("rx", "3");
      const tick = el("rect", `tick sex-${p.sex}`);
      tick.setAttribute("x", "0");
      tick.setAttribute("y", "0");
      tick.setAttribute("width", "3");
      const content = el("g", "content");
      g.append(bg, tick, content);
      this.cards.set(p.id, { g, bg, tick, content });
      this.cardsG.append(g);
      this.setCardContent(p.id, false);
    }
  }

  buildBands(layout: Layout) {
    this.bandsG.replaceChildren();
    this.bands = [];
    for (const b of layout.bands) {
      const rect = el("rect", "band" + (b.rank % 2 ? " alt" : ""));
      const label = text("bandlabel", 0, 0, "end");
      const t1 = el("tspan", "gen");
      t1.textContent = b.label;
      label.append(t1);
      if (b.years) {
        const t2 = el("tspan", "years");
        t2.textContent = `  ${b.years}`;
        label.append(t2);
      }
      this.bandsG.append(rect, label);
      this.bands.push({ rect, label });
    }
  }

  // ── Card content ─────────────────────────────────────────────────────────

  private width(str: string, font: string): number {
    this.measureCtx.font = font;
    return this.measureCtx.measureText(str).width;
  }

  private truncate(str: string, font: string, maxW: number): string {
    if (this.width(str, font) <= maxW) return str;
    let s = str;
    while (s.length > 1 && this.width(s + "…", font) > maxW) s = s.slice(0, -1);
    return s.trimEnd() + "…";
  }

  setCardContent(id: string, expanded: boolean, conceal = false) {
    const p = this.archive.persons.get(id)!;
    const { content, g } = this.cards.get(id)!;
    g.classList.toggle("expanded", expanded);
    content.classList.toggle("reveal", conceal);
    content.replaceChildren();
    const { w } = this.sizeOf(p, expanded);

    // xref, top-right — the machine's name for this record. Long ids are
    // truncated so they never crowd out the person's name.
    const xref = text("xref", w - 9, 16, "end");
    const rawId = p.id.replace(/@/g, "") + (expanded && p.sex !== "U" ? ` · ${p.sex}` : "");
    const shownId = this.truncate(rawId, `8px ${MONO}`, expanded ? 110 : 46);
    xref.textContent = shownId;
    if (shownId !== rawId) {
      const tip = el("title");
      tip.textContent = p.id;
      xref.append(tip);
    }
    content.append(xref);

    const nameFont = expanded ? `600 13.5px ${SERIF}` : `600 12.5px ${SERIF}`;
    const givenFont = expanded ? `13.5px ${SERIF}` : `12.5px ${SERIF}`;
    const nameMax = w - 20 - this.width(shownId, `8px ${MONO}`) - 8;
    let given = p.given;
    let surname = p.surname || "";
    const full = () => (given && surname ? `${given} ${surname}` : given || surname);
    if (this.width(full(), nameFont) > nameMax && given.includes(" ")) {
      given = given
        .split(/\s+/)
        .map((part, i) => (i === 0 ? part : part[0] + "."))
        .join(" ");
    }
    if (this.width(full(), nameFont) > nameMax) {
      given = given ? given.split(/\s+/).map((s) => s[0] + ".").join(" ") : "";
    }
    surname = this.truncate(surname, nameFont, Math.max(40, nameMax - this.width(given + " ", givenFont)));

    const name = text("name", 11, expanded ? 22 : 20);
    if (given) {
      const tg = el("tspan", "given");
      tg.textContent = given + (surname ? " " : "");
      name.append(tg);
    }
    if (surname) {
      const ts = el("tspan", "surname");
      ts.textContent = surname;
      name.append(ts);
    }
    if (expanded && p.suffix) {
      const tx = el("tspan", "suffix");
      tx.textContent = " " + p.suffix;
      name.append(tx);
    }
    content.append(name);

    if (!expanded) {
      const life = lifespan(p);
      if (life) {
        const t = text("life", 11, 36);
        t.textContent = life;
        content.append(t);
      }
      const place = p.birth?.place ?? p.death?.place ?? p.events.find((e) => e.place)?.place;
      if (place) {
        const t = text("place", 11, 50);
        t.textContent = this.truncate(place, `italic 10px ${SERIF}`, w - 22);
        content.append(t);
      }
      return;
    }

    // expanded: full record table
    const rule = el("path", "rule");
    rule.setAttribute("d", `M11,32 H${w - 11}`);
    content.append(rule);

    if (p.events.length === 0) {
      const t = text("evplace", 11, 52);
      t.textContent = "No events on record.";
      content.append(t);
    }
    p.events.forEach((ev, i) => {
      const y = 52 + i * 17;
      const lab = text("evlabel", 11, y);
      lab.textContent = ev.label.toUpperCase();
      content.append(lab);
      const val = text("evval", 84, y);
      const parts = this.eventLine(ev);
      const maxW = w - 84 - 11;
      let used = 0;
      for (const [cls, str] of parts) {
        const font = cls === "evdate" ? `10px ${MONO}` : `italic 10.5px ${SERIF}`;
        const fitted = this.truncate(str, font, maxW - used);
        if (!fitted || fitted === "…") break;
        const ts = el("tspan", cls);
        ts.textContent = fitted;
        val.append(ts);
        used += this.width(fitted, font);
        if (fitted.endsWith("…")) break;
      }
      content.append(val);
    });
  }

  private eventLine(ev: GEvent): [string, string][] {
    const parts: [string, string][] = [];
    if (ev.date) parts.push(["evdate", ev.date]);
    if (ev.value) parts.push(["evplace", (parts.length ? " · " : "") + ev.value]);
    if (ev.place) parts.push(["evplace", (parts.length ? " · " : "") + ev.place]);
    if (parts.length === 0) parts.push(["evplace", "—"]);
    return parts;
  }

  revealContent(id: string) {
    this.cards.get(id)?.content.classList.remove("reveal");
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  draw(layout: Layout) {
    for (const [id, n] of layout.nodes) {
      const c = this.cards.get(id)!;
      c.g.setAttribute("transform", `translate(${n.x},${n.y})`);
      c.bg.setAttribute("width", String(n.w));
      c.bg.setAttribute("height", String(n.h));
      c.tick.setAttribute("height", String(n.h));
      c.tick.setAttribute("rx", "1.5");
    }
    for (const [famId, u] of layout.unions) {
      const f = this.fams.get(famId);
      if (!f) continue;
      if (f.bar && u.bar) {
        f.bar.setAttribute("d", `M${u.bar.x1},${u.bar.y} H${u.bar.x2}`);
        f.diamond?.setAttribute(
          "d",
          `M${u.dropX - 3.4},${u.bar.y} L${u.dropX},${u.bar.y - 3.4} L${u.dropX + 3.4},${u.bar.y} L${u.dropX},${u.bar.y + 3.4} Z`,
        );
        if (f.slashes) {
          const sx = (u.dropX + u.bar.x2) / 2;
          f.slashes.setAttribute("d", `M${sx - 5},${u.bar.y + 4} l4,-8 M${sx + 1},${u.bar.y + 4} l4,-8`);
        }
        if (f.label) {
          f.label.setAttribute("x", String(u.dropX));
          f.label.setAttribute("y", String(u.bar.y - 7));
        }
      }
      if (f.drop) f.drop.setAttribute("d", `M${u.dropX},${u.dropTop} V${u.railY}`);
      for (const e of u.elbows) {
        const path = f.elbows.get(e.childId);
        if (path) path.setAttribute("d", elbowPath(e.x, e.topY, u));
      }
    }
    // the band extends left under its label so the label sits in a gutter
    const bx = layout.bbox.x - 230;
    const bw = layout.bbox.w + 230 + 90;
    layout.bands.forEach((b, i) => {
      const els = this.bands[i];
      if (!els) return;
      els.rect.setAttribute("x", String(bx));
      els.rect.setAttribute("width", String(Math.max(bw, 0)));
      els.rect.setAttribute("y", String(b.top));
      els.rect.setAttribute("height", String(b.height));
      els.label.setAttribute("x", String(layout.bbox.x - 28));
      els.label.setAttribute("y", String(b.top + b.height / 2 + 3));
    });
  }

  // ── Selection / lineage ──────────────────────────────────────────────────

  setSelected(id: string | null) {
    for (const [pid, c] of this.cards) c.g.classList.toggle("selected", pid === id);
  }

  /** Phase 1 — instant feedback: related cards stay lit, the rest recede. */
  applyLineageCards(lin: Lineage) {
    this.cancelLineageAnims();
    this.root.classList.add("traced");
    for (const [pid, c] of this.cards) c.g.classList.toggle("lit", lin.related.has(pid));
  }

  /** Phase 2 — after the tree settles, ink flows along the bloodline. */
  applyLineageEdges(lin: Lineage, animate: boolean) {
    const seen = new Set<string>();
    let maxEnd = 0;
    for (const seg of lin.segments) {
      const f = this.fams.get(seg.famId);
      if (!f) continue;
      const part = seg.part;
      const path =
        part === "bar" ? f.bar : part === "drop" ? f.drop : f.elbows.get(part.childId) ?? null;
      const key = seg.famId + ":" + (part === "bar" || part === "drop" ? part : "e" + part.childId);
      if (!path || seen.has(key)) continue;
      seen.add(key);
      path.classList.add("lin");
      if (part === "bar") f.diamond?.classList.add("lin");
      if (part === "bar") f.label?.classList.add("lin");

      if (!animate) continue;
      const len = path.getTotalLength();
      if (!(len > 0)) continue;
      // ink flows outward from the selected record: ancestors draw from the
      // child end of each segment, descendants from the union end
      const from = seg.dir === "up"
        ? (part === "drop" ? -len : len)
        : (part === "drop" || part === "bar" ? len : -len);
      const delay = seg.depth * 230 + (part === "bar" ? (seg.dir === "up" ? 160 : 0) : part === "drop" ? 80 : seg.dir === "up" ? 0 : 160);
      const dur = 240;
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${from}`;
      const anim = path.animate(
        [{ strokeDashoffset: `${from}` }, { strokeDashoffset: "0" }],
        { duration: dur, delay, easing: "cubic-bezier(.4,0,.4,1)", fill: "both" },
      );
      this.lineageAnims.push(anim);
      maxEnd = Math.max(maxEnd, delay + dur);
    }
    if (animate) {
      this.lineageCleanup = window.setTimeout(() => this.finishLineageAnims(), maxEnd + 60);
    }
  }

  private finishLineageAnims() {
    for (const a of this.lineageAnims) a.cancel();
    this.lineageAnims = [];
    for (const f of this.fams.values()) {
      for (const p of [f.bar, f.drop, ...f.elbows.values()]) {
        if (p) { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; }
      }
    }
  }

  private cancelLineageAnims() {
    if (this.lineageCleanup != null) { clearTimeout(this.lineageCleanup); this.lineageCleanup = null; }
    this.finishLineageAnims();
  }

  clearLineage() {
    this.cancelLineageAnims();
    this.root.classList.remove("traced");
    for (const c of this.cards.values()) c.g.classList.remove("lit");
    for (const f of this.fams.values()) {
      f.g.querySelectorAll(".lin").forEach((e) => e.classList.remove("lin"));
    }
  }

  setHover(id: string | null) {
    for (const f of this.fams.values()) f.g.classList.remove("hov");
    if (!id) return;
    const p = this.archive.persons.get(id);
    if (!p) return;
    for (const famId of [...p.famc, ...p.fams]) this.fams.get(famId)?.g.classList.add("hov");
  }

  setSearchHits(hits: Set<string> | null, current: string | null) {
    this.root.classList.toggle("searching", !!hits && hits.size > 0);
    for (const [pid, c] of this.cards) {
      c.g.classList.toggle("hit", !!hits?.has(pid));
      c.g.classList.toggle("hit-current", pid === current);
    }
  }

  // ── Entrance ─────────────────────────────────────────────────────────────

  entrance(layout: Layout, reduced: boolean) {
    if (reduced) return;
    const small = this.archive.persons.size <= 200;
    for (const [id, c] of this.cards) {
      const n = layout.nodes.get(id)!;
      c.g.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 340, delay: n.rank * 85 + (small ? (n.x % 200) / 14 : 0), easing: "ease-out", fill: "backwards" },
      );
    }
    for (const [famId, f] of this.fams) {
      const u = layout.unions.get(famId);
      const delay = (u ? layoutRankOf(layout, u) : 0) * 85 + 180;
      if (small && u) {
        for (const p of [f.drop, ...f.elbows.values()]) {
          if (!p) continue;
          requestAnimationFrame(() => {
            const len = p.getTotalLength();
            if (!(len > 0)) return;
            p.style.strokeDasharray = `${len}`;
            const a = p.animate(
              [{ strokeDashoffset: `${len}` }, { strokeDashoffset: "0" }],
              { duration: 420, delay, easing: "cubic-bezier(.4,0,.3,1)", fill: "backwards" },
            );
            a.finished.then(() => { p.style.strokeDasharray = ""; }).catch(() => {});
          });
        }
        for (const p of [f.bar, f.diamond, f.slashes, f.label]) {
          p?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, fill: "backwards" });
        }
      } else {
        f.g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 120, fill: "backwards" });
      }
    }
    this.bandsG.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: "ease-out" });
  }
}

function layoutRankOf(layout: Layout, u: LUnion): number {
  const first = u.elbows[0];
  if (!first) return 0;
  const child = layout.nodes.get(first.childId);
  return child ? Math.max(0, child.rank - 1) : 0;
}

function elbowPath(x: number, topY: number, u: LUnion): string {
  const r = 6;
  const dx = u.dropX - x;
  if (Math.abs(dx) < 0.5) return `M${x},${topY} V${u.railY}`;
  if (Math.abs(dx) < r * 2) return `M${x},${topY} V${u.railY} H${u.dropX}`;
  const sx = Math.sign(dx);
  return `M${x},${topY} V${u.railY + r} Q${x},${u.railY} ${x + sx * r},${u.railY} H${u.dropX}`;
}
