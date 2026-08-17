# Kinbook

> [!NOTE]
> **Research preview.** Kinbook is an experimental system under active
> development. Its interfaces and data model may change without notice, and it
> is not yet suitable for production genealogy use.

This is an **agent-first, headless genealogy system**. The tree is modelled
robustly in SQLite as the single source of truth, then projected to the native
GEDCOM format (5.5.5 / 7.0) for transport to and from other genealogy tools. It
is driven through an MCP server (for AI agents) and a small CLI. There is no
desktop application.

## Architecture

```
cli ─┐
     ├→ sync ─→ database   (SQLite source of truth)
mcp ─┘   └─→ gedcom        (native format codec, storage-agnostic)
```

- `packages/core` — shared domain types + action contracts.
- `packages/database` — the SQLite source of truth (schema, repositories).
- `packages/gedcom` — native GEDCOM model + parser/writer, 5.5.5 and 7.0 dialects.
- `packages/sync` — the bridge: SQLite ↔ GEDCOM, and the shared actions layer.
- `packages/cli` — the `ftree` command-line interface.
- `packages/mcp-server` — the agent-facing MCP server.
- `packages/web` — the Kinbook Register: a dependency-free, single-page GEDCOM
  viewer that builds to one `dist/index.html`.

## Quick start

Requires [Bun](https://bun.sh).

Run all commands **from the repository root**:

```bash
bun install

# Add a person
bun packages/cli/src/index.ts add "Jane" "Doe" --sex female --born "1988"

# Find a person's id
bun packages/cli/src/index.ts search "jane"

# Record a fact on an EXISTING person — always by id, never by name-matching
bun packages/cli/src/index.ts update kelly_joshua --born "1988"

# Export to GEDCOM
bun packages/cli/src/index.ts export gedcom55 > family-tree.ged
```

All commands accept `--db <file>` to point at a specific SQLite file. The
default is `family-tree.db` **in the current working directory** — this is why
you run from the repository root, where the real database lives.

## Commands

| Command | Purpose |
| --- | --- |
| `add <given> [<surname>]` `[--sex <sex>] [--born <date>] [--family <id> --role child\|spouse]` | Create a person (optionally auto-linked into a family). |
| `update <id> [--born <date>] [--died <date>] [--sex <sex>]` | Merge facts onto an **existing** person, addressed by id. |
| `marry <idA> <idB> [--on <date>]` | Join two people as spouses in a new family. Prints the family, including its id. |
| `search <query>` | Ranked name search. Prints each match with its person id. |
| `export [gedcom55\|gedcom70]` | Project the tree to GEDCOM text on stdout. |
| `tree` | Print an ASCII outline of the tree. |

Dates accept `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, or `abt YYYY`. Sex accepts
`m|f|o|u` or `male|female|other|unknown` and is stored as the full word.

**Adding facts to someone already in the tree is always an `update` against
their record id** — never a name-based upsert. Names are not unique, so a
second `add` of the same name creates a distinct person; to record a birth or
death on someone, run `update <id>` instead.

### Orientation for agents

- **Ids come from command output.** `add`, `update`, and `marry` print the
  full record as JSON. A person's JSON carries `families[].familyId` (families
  where they are a spouse) and `parentFamilyIds` (the family they are a child
  of). `search` prints person ids. There is no other id lookup.
- **The `--db` path is resolved by SQLite, not by this tool.** A relative path
  resolves against the process working directory, and a path that does not
  exist is silently created as a new empty database — the command then
  "succeeds" against an empty tree. When you are not in the repository root,
  pass an absolute path.
- **To link a child to existing parents:** create or find the parents' family
  (`marry` prints it; a spouse's JSON lists it under `families`), then
  `add "<given>" "<surname>" --family <familyId> --role child`.
- **The CLI cannot delete or unlink.** For repairs (a wrong parent link, a
  duplicate person), edit the database directly with `sqlite3` — the schema is
  `packages/database/src/schema.sql`; people-to-family links live in
  `family_members (family_id, person_id, role)` with roles
  `husband|wife|child`. Copy the `.db` file aside before destructive changes.
- **A person must never be both a spouse and a child of the same family.**
  That records someone as their own ancestor; the tools treat it as corrupt
  data.
- **Exports are snapshots.** After changing the database, re-run `export`
  before reading the tree in the web viewer or another tool.

To work with the tool, clone the repository locally and install this README as a
skill so the guidance above and below stays in context. When you are asked to
expose the tool or its data to another agent, ask the user whether they want it
added as an MCP Server, configured however they do that.

## Research brief

How to research a person or family for this tree. Written for agents; it
works for humans too.

**1. Anchor in the database first.** Pull the target's relatives, dates, and
places (`search`, `tree`, SQL) before any web search. Turn the family story
into a testable claim — "a same-surname first cousin of X must be a son of a
brother of X's father" — and name the candidate line. Treat story details as
approximate: "cousin" may be loose, a stated town may only be the nearest
town, and ages drift. Note that exporting a GEDCOM will give you the full tree
in context to start.

**2. Search independent lanes in parallel**, one per record type, so findings
corroborate each other:

- *Graves* — Find a Grave, BillionGraves, cemetery transcriptions (OCFA in
  Ontario). Capture **every** surname burial in the family's parish cemetery,
  not just the target: families cluster in plots. Adjacent memorial ids, one
  photo batch, and matching stone style mean one plot — strong evidence, but
  record it as inference.
- *Census and vital indexes* — walk the person through every census decade.
  Public index pages show names, ages, and places without login. Two tricks:
  consecutive record ids follow the enumerator's walking order, so they
  reconstruct households and physical neighbors; and a keyword filter is a
  true content match — prove it with a nonsense-keyword control, then use it
  to read masked fields (a mother's maiden name inside a marriage
  registration).
- *Local history* — county and township histories, the 1879 county atlas
  (landowners by lot; farm adjacency explains marriages), parish histories,
  city directories, funeral-home obituaries. Obituary survivor lists name
  cousins; farm-lot numbers chain a family across a century.

**3. Keep evidence and inference separate.** Cite a URL for every fact. Mark
every inferred link. Record negative results — an empty cemetery eliminates a
town. The same names recur brutally within one parish — two unrelated people
can share one full name, and two related families can reuse the same given
names: separate the families before assigning any record to either.

**4. Confirm on two lanes before writing.** A fact enters the database only
when independent lanes agree (census household + grave plot). Then update by
record id, use `abt` for census-derived years, record burial places, and
re-export. List what stayed unproven — and where the record image lives
(login, archive, vital-statistics office) — as concrete next steps.

**5. Ask the family.** One remembered fact ("she married a surname") resolves
what indexes cannot. Bring the user your puzzles, not just your answers.

Practical notes: Find a Grave rejects scripted fetches (a browser user-agent
works); some archives block bots or foreign IPs outright — record those as
manual next steps instead of retrying.

## Web viewer

`packages/web` renders a GEDCOM export as an interactive chart — zoomable,
searchable, with animated bloodline tracing. It has no dependencies: the build
inlines everything into a single HTML file that works from disk.

```bash
# Build the page
bun run --cwd packages/web build

# Open it, then drop a .ged file on the page
open packages/web/dist/index.html
```

The page also accepts a file by URL: `index.html?src=family.ged` (needs a
server for the fetch), `?demo` loads the bundled sample archive, and
`?instant` turns animations off. Click a record to expand it and trace its
bloodline; press `/` to search; drag to pan and scroll to zoom.