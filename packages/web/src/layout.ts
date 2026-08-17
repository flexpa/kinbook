/**
 * Generation layout for a GEDCOM archive.
 *
 * Persons are laid out on generation rows. Spouses are grouped into adjacent
 * "blocks" (a remarriage chains three cards into one block). Block order per
 * row is refined with barycenter sweeps, then x positions are solved with an
 * iterative align-and-project pass that centers children under their parents'
 * union and unions over their children. Connectors are orthogonal, drafted:
 * a marriage bar between spouses, a drop line to a child rail, and an elbow
 * up from every child. Rails share corridors between rows via lane assignment
 * so they never overlap.
 */

import type { Archive, GPerson } from "./gedcom";

export const CARD_W = 176;
export const CARD_H = 58;
export const CARD_W_EXP = 272;

const SP_GAP = 34; // gap between spouse cards (holds the marriage bar)
const BLOCK_GAP = 30; // gap between unrelated blocks in a row
const COMPONENT_GAP = 96; // extra gap between disconnected trees
const CORRIDOR_BASE = 66; // vertical space between generation rows
const LANE_GAP = 11; // extra corridor height per rail lane
const RAIL_OFF = 22; // rail distance above the child row
const BAR_Y = 29; // marriage bar offset from row top (mid collapsed card)

export interface LNode {
  id: string;
  x: number; // left
  y: number; // top
  w: number;
  h: number;
  rank: number;
}

export interface LElbow {
  childId: string;
  x: number; // child top-center x
  topY: number; // child row top
}

export interface LUnion {
  famId: string;
  /** marriage bar between spouse cards; null for a single-parent family */
  bar: { x1: number; x2: number; y: number } | null;
  dropX: number;
  dropTop: number;
  railY: number;
  elbows: LElbow[];
  divorced: boolean;
}

export interface LBand {
  rank: number;
  top: number;
  height: number;
  label: string;
  years: string;
}

export interface Layout {
  nodes: Map<string, LNode>;
  unions: Map<string, LUnion>;
  bands: LBand[];
  bbox: { x: number; y: number; w: number; h: number };
  maxRank: number;
  /** impossible or cyclic links that were ignored */
  warnings: string[];
}

export type SizeOf = (p: GPerson, expanded: boolean) => { w: number; h: number };

interface Block {
  rank: number;
  members: string[];
  w: number;
  x: number; // center
  /** member center offset from block center, by member index */
  offs: number[];
}

export function computeLayout(archive: Archive, expandedId: string | null, sizeOf: SizeOf): Layout {
  const { persons, families } = archive;
  const ids = [...persons.keys()];

  // ── 1. Ranks: spouses share a rank, children sit below their parents.
  // Contradictory data (a person recorded as both spouse and descendant of
  // the same union) is dropped with a warning instead of breaking the
  // layering — real archives contain such records.
  const warnings: string[] = [];
  const rank = new Map<string, number>();
  {
    // fuse spouses into rank groups (union-find)
    const parent = new Map<string, string>(ids.map((id) => [id, id]));
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root)! !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur)! !== cur) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    for (const fam of families.values()) {
      if (fam.husb && fam.wife) parent.set(find(fam.husb), find(fam.wife));
    }

    // parent-group → child-group edges; a self-edge is an impossible link
    const edges = new Map<string, Set<string>>();
    for (const fam of families.values()) {
      const spouses = [fam.husb, fam.wife].filter((s): s is string => !!s);
      if (spouses.length === 0) continue;
      const pg = find(spouses[0]!);
      for (const c of fam.children) {
        const cg = find(c);
        if (cg === pg) {
          warnings.push(`Impossible link ignored: ${c} is both spouse and child around ${fam.id}.`);
          continue;
        }
        if (!edges.has(pg)) edges.set(pg, new Set());
        edges.get(pg)!.add(cg);
      }
    }

    // break remaining ancestor cycles (drop DFS back edges)
    const groups = new Set(ids.map((id) => find(id)));
    const color = new Map<string, number>();
    const kept = new Map<string, Set<string>>();
    const dfs = (g: string) => {
      color.set(g, 1);
      for (const nb of edges.get(g) ?? []) {
        if (color.get(nb) === 1) {
          warnings.push(`Ancestor cycle ignored near ${nb}.`);
          continue;
        }
        if (!kept.has(g)) kept.set(g, new Set());
        kept.get(g)!.add(nb);
        if (!color.get(nb)) dfs(nb);
      }
      color.set(g, 2);
    };
    for (const g of groups) if (!color.get(g)) dfs(g);

    // longest-path layering over the group DAG
    const indeg = new Map<string, number>([...groups].map((g) => [g, 0]));
    for (const nbs of kept.values()) for (const nb of nbs) indeg.set(nb, indeg.get(nb)! + 1);
    const grank = new Map<string, number>();
    const queue = [...groups].filter((g) => indeg.get(g) === 0);
    for (const g of queue) grank.set(g, 0);
    while (queue.length) {
      const g = queue.shift()!;
      for (const nb of kept.get(g) ?? []) {
        grank.set(nb, Math.max(grank.get(nb) ?? 0, grank.get(g)! + 1));
        indeg.set(nb, indeg.get(nb)! - 1);
        if (indeg.get(nb) === 0) queue.push(nb);
      }
    }
    for (const id of ids) rank.set(id, grank.get(find(id)) ?? 0);
  }

  // ── 2. Connected components (for per-tree normalization and grouping). ──
  const comp = new Map<string, number>();
  {
    const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const fam of families.values()) {
      const members = [fam.husb, fam.wife, ...fam.children].filter((s): s is string => !!s);
      for (let i = 1; i < members.length; i++) {
        adj.get(members[0]!)!.push(members[i]!);
        adj.get(members[i]!)!.push(members[0]!);
      }
    }
    let c = 0;
    for (const id of ids) {
      if (comp.has(id)) continue;
      const queue = [id];
      comp.set(id, c);
      while (queue.length) {
        const cur = queue.pop()!;
        for (const nb of adj.get(cur)!) {
          if (!comp.has(nb)) { comp.set(nb, c); queue.push(nb); }
        }
      }
      c++;
    }
    // Normalize each component so its shallowest generation is rank 0.
    const minRank = new Map<number, number>();
    for (const id of ids) {
      const c2 = comp.get(id)!;
      minRank.set(c2, Math.min(minRank.get(c2) ?? Infinity, rank.get(id)!));
    }
    for (const id of ids) rank.set(id, rank.get(id)! - minRank.get(comp.get(id)!)!);
  }
  const maxRank = Math.max(0, ...ids.map((id) => rank.get(id)!));

  // ── 3. Blocks: spouse-connected groups within a rank. ──
  const blockOf = new Map<string, Block>();
  const rowBlocks: Block[][] = Array.from({ length: maxRank + 1 }, () => []);
  {
    // spousal adjacency (spouses always share a rank after step 1)
    const sadj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
    for (const fam of families.values()) {
      if (fam.husb && fam.wife) {
        sadj.get(fam.husb)!.add(fam.wife);
        sadj.get(fam.wife)!.add(fam.husb);
      }
    }
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      // gather the spousal component
      const group: string[] = [];
      const queue = [id];
      seen.add(id);
      while (queue.length) {
        const cur = queue.pop()!;
        group.push(cur);
        for (const nb of sadj.get(cur)!) {
          if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
        }
      }
      // order the group as a path when possible (chains from remarriage)
      let members: string[];
      if (group.length <= 1) {
        members = group;
      } else {
        const deg = (g: string) => [...sadj.get(g)!].filter((o) => group.includes(o)).length;
        const start = group.find((g) => deg(g) === 1) ?? group[0]!;
        members = [start];
        const used = new Set([start]);
        while (members.length < group.length) {
          const last = members[members.length - 1]!;
          const next = [...sadj.get(last)!].find((o) => group.includes(o) && !used.has(o));
          if (!next) { for (const g of group) if (!used.has(g)) { members.push(g); used.add(g); } break; }
          members.push(next);
          used.add(next);
        }
        // convention: a plain couple reads husband → wife
        if (members.length === 2) {
          const fam = [...families.values()].find(
            (f) => f.husb && f.wife && members.includes(f.husb) && members.includes(f.wife),
          );
          if (fam && members[0] !== fam.husb) members.reverse();
        }
      }
      const b: Block = { rank: rank.get(id)!, members, w: 0, x: 0, offs: [] };
      measureBlock(b);
      for (const m of members) blockOf.set(m, b);
      rowBlocks[b.rank]!.push(b);
    }
  }

  function measureBlock(b: Block) {
    const widths = b.members.map((m) => sizeOf(persons.get(m)!, m === expandedId).w);
    b.w = widths.reduce((a, w) => a + w, 0) + SP_GAP * (b.members.length - 1);
    b.offs = [];
    let cur = -b.w / 2;
    for (const w of widths) {
      b.offs.push(cur + w / 2);
      cur += w + SP_GAP;
    }
  }

  // ── 4. Initial order: DFS from each component's root couples. ──
  {
    const ordered: Block[][] = Array.from({ length: maxRank + 1 }, () => []);
    const placed = new Set<Block>();
    const place = (b: Block) => {
      if (placed.has(b)) return;
      placed.add(b);
      ordered[b.rank]!.push(b);
      for (const m of b.members) {
        for (const famId of persons.get(m)!.fams) {
          const fam = families.get(famId)!;
          for (const c of fam.children) place(blockOf.get(c)!);
        }
      }
    };
    // components ordered by size (largest tree first), roots are rank-0 blocks
    const compSize = new Map<number, number>();
    for (const id of ids) compSize.set(comp.get(id)!, (compSize.get(comp.get(id)!) ?? 0) + 1);
    const roots = rowBlocks[0]!.slice().sort((a, b) => {
      const ca = comp.get(a.members[0]!)!;
      const cb = comp.get(b.members[0]!)!;
      if (ca !== cb) return compSize.get(cb)! - compSize.get(ca)! || ca - cb;
      return 0;
    });
    for (const r of roots) place(r);
    for (const row of rowBlocks) for (const b of row) place(b); // safety net
    for (let r = 0; r <= maxRank; r++) rowBlocks[r] = ordered[r]!;
  }

  // ── 5. Barycenter sweeps to reduce crossings. ──
  {
    const pos = new Map<string, number>();
    const reindex = (r: number) => {
      let i = 0;
      for (const b of rowBlocks[r]!) for (const m of b.members) pos.set(m, i++);
    };
    for (let r = 0; r <= maxRank; r++) reindex(r);

    const parentPos = (m: string): number | null => {
      const vals: number[] = [];
      for (const famId of persons.get(m)!.famc) {
        const fam = families.get(famId)!;
        for (const s of [fam.husb, fam.wife]) if (s && pos.has(s)) vals.push(pos.get(s)!);
      }
      return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
    };
    const childPos = (m: string): number | null => {
      const vals: number[] = [];
      for (const famId of persons.get(m)!.fams) {
        for (const c of families.get(famId)!.children) if (pos.has(c)) vals.push(pos.get(c)!);
      }
      return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
    };
    const sweep = (dir: "down" | "up") => {
      const ranks = dir === "down"
        ? Array.from({ length: maxRank }, (_, i) => i + 1)
        : Array.from({ length: maxRank }, (_, i) => maxRank - 1 - i);
      for (const r of ranks) {
        const row = rowBlocks[r]!;
        const bary = new Map<Block, number>();
        for (let bi = 0; bi < row.length; bi++) {
          const b = row[bi]!;
          const vals = b.members
            .map((m) => (dir === "down" ? parentPos(m) : childPos(m)))
            .filter((v): v is number => v != null);
          bary.set(b, vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : posOfBlock(b));
        }
        row.sort((a, b2) => bary.get(a)! - bary.get(b2)!);
        reindex(r);
      }
    };
    const posOfBlock = (b: Block) => b.members.reduce((a, m) => a + (pos.get(m) ?? 0), 0) / b.members.length;
    sweep("down"); sweep("up"); sweep("down"); sweep("up"); sweep("down");
  }

  // ── 6. X coordinates: align-and-project iterations. ──
  const centerOf = (m: string): number => {
    const b = blockOf.get(m)!;
    return b.x + b.offs[b.members.indexOf(m)]!;
  };
  const widthOf = (m: string) => sizeOf(persons.get(m)!, m === expandedId).w;
  const dropXOf = (famId: string): number | null => {
    const fam = families.get(famId)!;
    if (fam.husb && fam.wife) {
      const a = centerOf(fam.husb) + widthOf(fam.husb) / 2;
      const b = centerOf(fam.wife) - widthOf(fam.wife) / 2;
      return (a + b) / 2; // mid-gap works for either left/right order:
      // when wife is left, a > b and the average is still the gap center
    }
    const solo = fam.husb ?? fam.wife;
    return solo ? centerOf(solo) : null;
  };

  {
    // initial packing, with component gaps
    for (let r = 0; r <= maxRank; r++) {
      let cur = 0;
      let prevComp: number | null = null;
      for (const b of rowBlocks[r]!) {
        const c = comp.get(b.members[0]!)!;
        if (prevComp != null && c !== prevComp) cur += COMPONENT_GAP;
        prevComp = c;
        b.x = cur + b.w / 2;
        cur += b.w + BLOCK_GAP;
      }
    }

    const solveRow = (row: Block[], desired: number[]) => {
      const n = row.length;
      if (n === 0) return;
      const sep = (i: number) => {
        const gap =
          comp.get(row[i - 1]!.members[0]!) !== comp.get(row[i]!.members[0]!)
            ? BLOCK_GAP + COMPONENT_GAP
            : BLOCK_GAP;
        return (row[i - 1]!.w + row[i]!.w) / 2 + gap;
      };
      const L = new Array<number>(n);
      const R = new Array<number>(n);
      for (let i = 0; i < n; i++) L[i] = i === 0 ? desired[i]! : Math.max(desired[i]!, L[i - 1]! + sep(i));
      for (let i = n - 1; i >= 0; i--) R[i] = i === n - 1 ? desired[i]! : Math.min(desired[i]!, R[i + 1]! - sep(i + 1));
      for (let i = 0; i < n; i++) row[i]!.x = (L[i]! + R[i]!) / 2;
    };

    // Every pass pulls each block toward both its parents' unions (from
    // above) and its children's midpoints (from below) at once, so the
    // sweeps relax toward one equilibrium instead of oscillating.
    const desireFor = (b: Block): number => {
      const shifts: number[] = [];
      for (const m of b.members) {
        const p = persons.get(m)!;
        for (const famId of p.famc) {
          const drop = dropXOf(famId);
          if (drop != null) shifts.push(drop - centerOf(m));
        }
        for (const famId of p.fams) {
          const fam = families.get(famId)!;
          if (fam.children.length === 0) continue;
          const drop = dropXOf(famId);
          if (drop == null) continue;
          const xs = fam.children.map((c) => centerOf(c));
          shifts.push((Math.min(...xs) + Math.max(...xs)) / 2 - drop);
        }
      }
      return shifts.length ? b.x + shifts.reduce((a, v) => a + v, 0) / shifts.length : b.x;
    };
    for (let pass = 0; pass < 12; pass++) {
      const ranks =
        pass % 2 === 0
          ? Array.from({ length: maxRank + 1 }, (_, i) => maxRank - i)
          : Array.from({ length: maxRank + 1 }, (_, i) => i);
      for (const r of ranks) {
        const row = rowBlocks[r]!;
        solveRow(row, row.map(desireFor));
      }
    }
  }

  // ── 7. Rails: lane assignment per corridor so rails never collide. ──
  interface RailPlan { famId: string; childRank: number; lane: number }
  const railPlans = new Map<string, RailPlan>();
  const laneCount = new Map<number, number>(); // childRank → lanes used
  {
    const byCorridor = new Map<number, { famId: string; x1: number; x2: number }[]>();
    for (const fam of families.values()) {
      if (fam.children.length === 0) continue;
      const drop = dropXOf(fam.id);
      if (drop == null) continue;
      const childRank = Math.min(...fam.children.map((c) => rank.get(c)!));
      const xs = fam.children.map((c) => centerOf(c)).concat(drop);
      const span = { famId: fam.id, x1: Math.min(...xs) - 8, x2: Math.max(...xs) + 8 };
      if (!byCorridor.has(childRank)) byCorridor.set(childRank, []);
      byCorridor.get(childRank)!.push(span);
    }
    for (const [childRank, spans] of byCorridor) {
      spans.sort((a, b) => a.x1 - b.x1);
      const laneEnds: number[] = [];
      for (const s of spans) {
        let lane = laneEnds.findIndex((end) => s.x1 > end + 14);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.x2); }
        else laneEnds[lane] = s.x2;
        railPlans.set(s.famId, { famId: s.famId, childRank, lane });
      }
      laneCount.set(childRank, laneEnds.length);
    }
  }

  // ── 8. Row tops. ──
  const rowH: number[] = [];
  for (let r = 0; r <= maxRank; r++) {
    let h = CARD_H;
    for (const b of rowBlocks[r]!) for (const m of b.members) h = Math.max(h, sizeOf(persons.get(m)!, m === expandedId).h);
    rowH.push(h);
  }
  const rowTop: number[] = [0];
  for (let r = 1; r <= maxRank; r++) {
    const lanes = laneCount.get(r) ?? 1;
    rowTop.push(rowTop[r - 1]! + rowH[r - 1]! + CORRIDOR_BASE + (lanes - 1) * LANE_GAP);
  }

  // ── 9. Emit nodes, unions, bands, bbox. ──
  const nodes = new Map<string, LNode>();
  for (let r = 0; r <= maxRank; r++) {
    for (const b of rowBlocks[r]!) {
      for (const m of b.members) {
        const size = sizeOf(persons.get(m)!, m === expandedId);
        nodes.set(m, { id: m, x: centerOf(m) - size.w / 2, y: rowTop[r]!, w: size.w, h: size.h, rank: r });
      }
    }
  }

  const unions = new Map<string, LUnion>();
  for (const fam of families.values()) {
    const drop = dropXOf(fam.id);
    if (drop == null) continue;
    const spouses = [fam.husb, fam.wife].filter((s): s is string => !!s);
    const parentRank = rank.get(spouses[0]!)!;
    const barY = rowTop[parentRank]! + BAR_Y;
    let bar: LUnion["bar"] = null;
    if (fam.husb && fam.wife) {
      const hn = nodes.get(fam.husb)!;
      const wn = nodes.get(fam.wife)!;
      const left = hn.x < wn.x ? hn : wn;
      const right = hn.x < wn.x ? wn : hn;
      bar = { x1: left.x + left.w, x2: right.x, y: barY };
    }
    const plan = railPlans.get(fam.id);
    const railY = plan
      ? rowTop[plan.childRank]! - RAIL_OFF - plan.lane * LANE_GAP
      : barY;
    unions.set(fam.id, {
      famId: fam.id,
      bar,
      dropX: drop,
      dropTop: bar ? barY : rowTop[parentRank]! + nodes.get(spouses[0]!)!.h,
      railY,
      elbows: fam.children.map((c) => {
        const n = nodes.get(c)!;
        return { childId: c, x: n.x + n.w / 2, topY: n.y };
      }),
      divorced: !!fam.divorce,
    });
  }

  let minX = Infinity, maxX = -Infinity, minY = 0, maxY = 0;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  if (!isFinite(minX)) { minX = 0; maxX = 0; }
  const bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

  const bands: LBand[] = [];
  for (let r = 0; r <= maxRank; r++) {
    const years = ids
      .filter((id) => rank.get(id)! === r)
      .map((id) => persons.get(id)!.birth?.year)
      .filter((y): y is number => y != null);
    bands.push({
      rank: r,
      top: rowTop[r]! - 14,
      height: rowH[r]! + 28,
      label: `GEN ${roman(r + 1)}`,
      years: years.length ? `*${Math.min(...years)}–${Math.max(...years)}` : "",
    });
  }

  return { nodes, unions, bands, bbox, maxRank, warnings };
}

/** Interpolate between two layouts of the same archive (same entity keys). */
export function lerpLayout(a: Layout, b: Layout, t: number): Layout {
  const lp = (x: number, y: number) => x + (y - x) * t;
  const nodes = new Map<string, LNode>();
  for (const [id, bn] of b.nodes) {
    const an = a.nodes.get(id) ?? bn;
    nodes.set(id, {
      id,
      x: lp(an.x, bn.x),
      y: lp(an.y, bn.y),
      w: lp(an.w, bn.w),
      h: lp(an.h, bn.h),
      rank: bn.rank,
    });
  }
  const unions = new Map<string, LUnion>();
  for (const [famId, bu] of b.unions) {
    const au = a.unions.get(famId) ?? bu;
    const aElbows = new Map(au.elbows.map((e) => [e.childId, e]));
    unions.set(famId, {
      famId,
      bar: bu.bar
        ? {
            x1: lp(au.bar?.x1 ?? bu.bar.x1, bu.bar.x1),
            x2: lp(au.bar?.x2 ?? bu.bar.x2, bu.bar.x2),
            y: lp(au.bar?.y ?? bu.bar.y, bu.bar.y),
          }
        : null,
      dropX: lp(au.dropX, bu.dropX),
      dropTop: lp(au.dropTop, bu.dropTop),
      railY: lp(au.railY, bu.railY),
      elbows: bu.elbows.map((e) => {
        const ae = aElbows.get(e.childId) ?? e;
        return { childId: e.childId, x: lp(ae.x, e.x), topY: lp(ae.topY, e.topY) };
      }),
      divorced: bu.divorced,
    });
  }
  const bands = b.bands.map((bb, i) => {
    const ab = a.bands[i] ?? bb;
    return { ...bb, top: lp(ab.top, bb.top), height: lp(ab.height, bb.height) };
  });
  const bbox = {
    x: lp(a.bbox.x, b.bbox.x),
    y: lp(a.bbox.y, b.bbox.y),
    w: lp(a.bbox.w, b.bbox.w),
    h: lp(a.bbox.h, b.bbox.h),
  };
  return { nodes, unions, bands, bbox, maxRank: b.maxRank, warnings: b.warnings };
}

export function roman(n: number): string {
  const table: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let s = "";
  for (const [v, sym] of table) {
    while (n >= v) { s += sym; n -= v; }
  }
  return s;
}

// ── Lineage tracing for the selection animation. ──────────────────────────

export interface LineageSegment {
  famId: string;
  /** "bar" | "drop" | elbow child id */
  part: "bar" | "drop" | { childId: string };
  depth: number;
  dir: "up" | "down";
}

export interface Lineage {
  related: Set<string>;
  segments: LineageSegment[];
  nAnc: number;
  nDesc: number;
}

export function traceLineage(archive: Archive, id: string): Lineage {
  const { persons, families } = archive;
  const related = new Set<string>([id]);
  const segments: LineageSegment[] = [];
  let nAnc = 0;
  let nDesc = 0;

  const up = (pid: string, depth: number) => {
    for (const famId of persons.get(pid)!.famc) {
      const fam = families.get(famId)!;
      segments.push({ famId, part: { childId: pid }, depth, dir: "up" });
      segments.push({ famId, part: "drop", depth, dir: "up" });
      if (fam.husb && fam.wife) segments.push({ famId, part: "bar", depth, dir: "up" });
      for (const s of [fam.husb, fam.wife]) {
        if (s && !related.has(s)) {
          related.add(s);
          nAnc++;
          up(s, depth + 1);
        }
      }
    }
  };
  const down = (pid: string, depth: number) => {
    for (const famId of persons.get(pid)!.fams) {
      const fam = families.get(famId)!;
      if (fam.husb && fam.wife) segments.push({ famId, part: "bar", depth, dir: "down" });
      if (depth === 0) {
        // the selected person's spouses stay lit — they share the union
        for (const s of [fam.husb, fam.wife]) if (s) related.add(s);
      }
      if (fam.children.length > 0) segments.push({ famId, part: "drop", depth, dir: "down" });
      for (const c of fam.children) {
        segments.push({ famId, part: { childId: c }, depth, dir: "down" });
        if (!related.has(c)) {
          related.add(c);
          nDesc++;
          down(c, depth + 1);
        }
      }
    }
  };
  up(id, 0);
  down(id, 0);
  return { related, segments, nAnc, nDesc };
}
