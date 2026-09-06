# taskdag

> Your implementation work as a DAG, not a list.

**taskdag** is a local-first, graph-based task manager for the granular implementation work a single engineer does day to day — the layer *below* a Jira/Linear ticket.

You draw your work as a graph. The graph tells you what you can actually start right now.

## Why

Every task manager we surveyed — Todoist, Things 3, TickTick, Microsoft To Do, OmniFocus, Jira, Linear, GitHub Projects — models work as a **strict hierarchy or a flat list**. Dependencies, where they exist, are bolted onto that model rather than part of it. GitHub Issues does derive a blocked state from its dependency links, but you read it as a badge in a list; there is no picture of the graph to edit.

Every visual canvas tool we surveyed — Miro, tldraw, Excalidraw, FigJam, Obsidian Canvas, Heptabase, Workflowy, Logseq — has **nodes and edges, but the edges are decorative**. Nothing is computed from them.

One category has the dependency data without a picture. The other has a picture that computes nothing.

taskdag is the combination: **a graph you directly edit, where Ready and Blocked are computed from the graph itself and never maintained by hand.**

## Core ideas

- **Task** — the unit of work. Can hold a flat checklist of **childTasks** (one level deep, no deeper).
- **Dependency edge** — connects two top-level Tasks. `A → B` means B can't start until A is done.
- **Project** — a region on the canvas, not a tag. A task belongs to it by sitting inside it; drag it out and it stops belonging. Membership is derived from position, never stored.
- **Two independent state axes:**
  - *Computed*: `Ready` / `Blocked` — derived from the dependency graph. You never set these.
  - *Self-reported*: `Not Done` / `In Progress` / `Done` — set by whoever did the work.

The axes being independent is deliberate: a task can be **Blocked and In Progress at once** — you're doing prep work before its blocker clears. A status that forbade that would get in the way of thinking.

## Design principles

1. **Editing the graph is the main experience.** Not filling in fields.
2. **You manipulate your thinking directly.** The tool doesn't impose a structure on you — which is why derived status never restricts what you can edit.
3. **Value comes from the graph.** Ready and Blocked are computed. Bottlenecks and overall flow are meant to be *seen*, not calculated.

## Status

**In development, and not yet released.** The canvas runs: you can create tasks, draw dependencies and watch Ready/Blocked update. It has not been through a manual QA pass, so expect rough edges. There is no packaged build to install — see Development below to run it from source.

| Phase | Scope | Status |
|---|---|---|
| 0 | Walking skeleton — Electron + React Flow + SQLite integration | ✅ Done |
| 1 | Domain layer (TDD, no framework dependencies) | ✅ Done |
| 2 | Persistence (SQLite) | ✅ Done |
| 3 | UI (React Flow canvas) | ✅ Done |
| 4 | MCP server for AI operation | Next |

## Non-goals

Deliberately out of scope, not just deferred:

- Team / multi-user coordination
- Cloud storage or sync — **data stays entirely local**
- Integration with external trackers (Jira, GitHub Issues, Linear)
- Executing your tasks for you — taskdag manages the graph; doing the work is yours
- Enforcing a decomposition granularity — how big a task is, is always your call

## AI operation

**Not built yet — this is what Phase 4 is for.** The plan: an MCP server so an AI coding tool (e.g. Claude Code) can manage the graph conversationally — "what's ready?", "mark the auth task done", "drop that one" — while the canvas stays open beside you as a live view.

The architecture is already arranged for it. Every write goes through the application layer rather than straight to the database, so when AI operation arrives, dependency rules, cycle prevention and undo will apply to it exactly as they do to your own edits.

## Development

Requires **Node.js 24+** (pinned in `.nvmrc`). The project uses the built-in
`node:sqlite` module, which needs Node 22.5 or newer — 24 matches the Node version
Electron itself bundles, so tests and production run the same SQLite.

```bash
npm install          # no native modules, no rebuild step
npm run dev          # start with hot reload
npm run typecheck    # TypeScript
npm test             # Vitest
npm run check        # Biome (lint + format)
npm run build        # production build
```

### Documentation

The reasoning behind this project is written down, in order:

| Path | Contents |
|---|---|
| `research/` | Primary-source research into how engineers manage granular work, and what existing tools do |
| `vision/vision.md` | Problem framing, principles, product concept |
| `vision/PRD.md` | Product requirements |
| `vision/requirements.md` | v1 requirements with acceptance criteria |
| `design/` | Tech stack, coding standards, domain design, persistence design, development process |
| `design/decisions.md` | What was rejected, and what each decision cost |
| `design/qa-checklist.md` | What to check by hand — the things typecheck and tests cannot catch |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Before proposing a design change, `design/decisions.md` records what each choice rejected and cost — the idea may already have been weighed.

## License

MIT
