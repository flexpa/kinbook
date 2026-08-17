import type { GedNode } from "./model";
import { parse } from "./parse";

export interface LintFinding {
  line: number;
  rule: string;
  message: string;
}

export interface LintResult {
  findings: LintFinding[];
  exitCode: number;
}

const POINTER_TAGS = new Set(["FAMC", "FAMS", "HUSB", "WIFE", "CHIL"]);

const MONTH_RE = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";

const KNOWN_55 = new Set([
  "HEAD","TRLR","INDI","FAM","NOTE","OBJE","REPO","SOUR","SUBM","SUBN",
  "SOUR","DEST","DATE","GEDC","CHAR","LANG","COPR","PLAC","VERS","FORM","NAME","CORP","DATA",
  "SEX","BIRT","DEAT","BURI","CHR","CHRA","ADOP","BAPM","BARM","BASM","BLES","CONF","FCOM",
  "ORDN","NATU","EMIG","IMMI","CENS","PROB","WILL","GRAD","RETI","EVEN",
  "MARR","DIV","ENG","MARB","MARC","MARL","MARS","ANUL",
  "FAMC","FAMS","GIVN","SURN","NPFX","NSFX","SPFX","NICK",
  "AGE","CAUS","TYPE","PAGE","QUAY","TEXT","MEDI","AUTH","PUBL","ABBR","CALN",
  "HUSB","WIFE","CHIL","NCHI","RESI","OCCU","TITL","EDUC","CAST","NMR","PROP","RELI",
  "SSN","IDNO","REFN","RIN","ALIA","ASSO","CHAN",
  "ADDR","ADR1","ADR2","ADR3","CITY","STAE","POST","CTRY","PHON","EMAIL","FAX","WWW",
  "CONT","CONC","TIME","BLOB",
]);

const KNOWN_70 = new Set([
  ...KNOWN_55,
  "SCHMA","SNOTE","UID","EXID","CREA","AGNC","LABL","NO","TRAN","MAP","LATI","LONG","FILE","RECORD",
]);

export function lint(text: string, dialect: "55" | "70"): LintResult {
  let roots: GedNode[];
  try {
    roots = parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { findings: [{ line: 0, rule: "parse", message: msg }], exitCode: 2 };
  }

  const known = dialect === "55" ? KNOWN_55 : KNOWN_70;
  const findings: LintFinding[] = [];

  const records = new Map<string, { tag: string; node: GedNode; line: number }>();
  for (const r of roots) {
    if (!r.xref) continue;
    if (records.has(r.xref)) {
      findings.push({ line: r.line ?? 0, rule: "dup-xref", message: `duplicate xref ${r.xref}` });
    } else {
      records.set(r.xref, { tag: r.tag, node: r, line: r.line ?? 0 });
    }
  }

  const rootTags = roots.map((r) => r.tag);
  if (!rootTags.includes("HEAD")) {
    findings.push({ line: 0, rule: "missing-head", message: "no HEAD record" });
  }
  if (!rootTags.includes("TRLR")) {
    findings.push({ line: 0, rule: "missing-trlr", message: "no TRLR record" });
  }

  for (const r of roots) walk(r, null);

  findings.sort((a, b) => a.line - b.line);
  return { findings, exitCode: findings.length ? 1 : 0 };

  function walk(n: GedNode, enclosing: { xref: string; tag: string } | null): void {
    const line = n.line ?? 0;
    const enc: { xref: string; tag: string } | null =
      n.level === 0 && n.xref ? { xref: n.xref, tag: n.tag } : enclosing;

    if (n.xref && !/^[A-Za-z][A-Za-z0-9]*$/.test(n.xref.slice(1, -1))) {
      findings.push({ line, rule: "xref-format", message: `malformed xref ${n.xref}` });
    }

    if (!n.tag.startsWith("_") && !known.has(n.tag)) {
      findings.push({ line, rule: "unknown-tag", message: `unknown tag ${n.tag}` });
    }

    if (POINTER_TAGS.has(n.tag)) {
      const val = (n.value ?? "").trim();
      const m = /^@([^@]+)@$/.exec(val);
      if (m) {
        const target = records.get(val);
        if (!target) {
          findings.push({ line, rule: "dangling-ref", message: `${n.tag} points to undefined ${val}` });
        } else if (n.tag === "FAMS") {
          if (target.tag !== "FAM") {
            findings.push({ line, rule: "fams-mismatch", message: `FAMS ${val} is not a FAM` });
          } else if (!famSpouses(target.node).has(enc?.xref ?? "")) {
            findings.push({ line, rule: "fams-mismatch", message: `FAMS ${val} does not list ${enc?.xref} as HUSB/WIFE` });
          }
        } else if (n.tag === "FAMC") {
          if (target.tag !== "FAM") {
            findings.push({ line, rule: "famc-mismatch", message: `FAMC ${val} is not a FAM` });
          } else if (!famChildren(target.node).has(enc?.xref ?? "")) {
            findings.push({ line, rule: "famc-mismatch", message: `FAMC ${val} does not list ${enc?.xref} as CHIL` });
          }
        }
      } else if (val !== "") {
        findings.push({ line, rule: "xref-format", message: `${n.tag} value "${val}" is not an xref` });
      }
    }

    if ((n.tag === "NOTE" || n.tag === "SNOTE") && n.value) {
      const m = /^@([^@]+)@$/.exec(n.value.trim());
      if (m && !records.has(n.value.trim())) {
        findings.push({ line, rule: "dangling-note", message: `${n.tag} points to undefined ${n.value}` });
      }
    }

    if (n.tag === "DATE" && n.value && n.value.trim() && !isValidDate(n.value)) {
      findings.push({ line, rule: "bad-date", message: `invalid DATE "${n.value}"` });
    }

    if (n.tag === "SEX") {
      const v = (n.value ?? "").trim().toUpperCase();
      const allowed = dialect === "55" ? ["M", "F", "U"] : ["M", "F", "X", "U"];
      if (v && !allowed.includes(v)) {
        findings.push({ line, rule: "bad-sex", message: `invalid SEX "${n.value}"` });
      }
    }

    if (dialect === "55" && n.tag === "NAME" && enc?.tag === "INDI") {
      if (n.value && !/\//.test(n.value)) {
        findings.push({ line, rule: "name-slashes", message: `NAME "${n.value}" missing surname slashes` });
      }
    }

    if (n.level === 0 && n.tag === "INDI" && !childrenWithTag(n, "NAME").length) {
      findings.push({ line, rule: "empty-indi", message: "INDI has no NAME" });
    }
    if (
      n.level === 0 &&
      n.tag === "FAM" &&
      !childrenWithTag(n, "HUSB").length &&
      !childrenWithTag(n, "WIFE").length &&
      !childrenWithTag(n, "CHIL").length
    ) {
      findings.push({ line, rule: "empty-fam", message: "FAM has no HUSB/WIFE/CHIL" });
    }

    for (const c of n.children) {
      if (c.level > n.level + 1) {
        findings.push({ line: c.line ?? 0, rule: "level-skip", message: `level ${c.level} under level ${n.level}` });
      }
      walk(c, enc);
    }
  }
}

function childrenWithTag(n: GedNode, tag: string): GedNode[] {
  return n.children.filter((c) => c.tag === tag);
}

function famSpouses(fam: GedNode): Set<string> {
  const s = new Set<string>();
  for (const c of fam.children) {
    if ((c.tag === "HUSB" || c.tag === "WIFE") && c.value) s.add(c.value);
  }
  return s;
}

function famChildren(fam: GedNode): Set<string> {
  const s = new Set<string>();
  for (const c of fam.children) {
    if (c.tag === "CHIL" && c.value) s.add(c.value);
  }
  return s;
}

function baseDate(s: string): boolean {
  const t = s.trim();
  if (/^\d{1,4}(?:\/\d{1,2})?$/.test(t)) return true;
  if (new RegExp(`^(?:${MONTH_RE})\\s+\\d{1,4}$`, "i").test(t)) return true;
  if (new RegExp(`^\\d{1,2}\\s+(?:${MONTH_RE})\\s+\\d{1,4}$`, "i").test(t)) return true;
  return false;
}

function isValidDate(v: string): boolean {
  let s = v.trim();
  s = s.replace(/^@#[A-Z]+@\s*/i, "");
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  s = s.trim();
  if (!s) return true;
  if (/^INT\b/i.test(s)) return true;

  const bet = /^BET\s+(.+?)\s+AND\s+(.+)$/i.exec(s);
  if (bet) return baseDate(bet[1]!) && baseDate(bet[2]!);

  const from = /^FROM\s+(.+?)\s+TO\s+(.+)$/i.exec(s);
  if (from) return baseDate(from[1]!) && baseDate(from[2]!);

  const pre = /^(?:ABT|EST|CAL|BEF|AFT|TO|FROM)\s+(.+)$/i.exec(s);
  if (pre) s = pre[1]!.trim();

  return baseDate(s);
}
