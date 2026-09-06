# Contributing

taskdag is early and maintained by one person. Issues and pull requests are welcome, with one
caveat worth stating up front: several parts of the design are deliberate and cost something,
and the cheapest way to have a change rejected is to undo one of those on purpose.

## Read this first

`design/decisions.md` lists what each design choice rejected and what it cost. If you are about
to propose something that feels obviously better — storing Ready/Blocked instead of deriving it,
letting childTasks have dependency edges, reconnecting every edge on delete — check there first.
It may already have been weighed and dropped, and the entry will say why.

## Setup

Requires **Node.js 24+**, pinned in `.nvmrc`. The project uses the built-in `node:sqlite`, which
needs 22.5 or newer; 24 matches the Node version Electron bundles, so tests and production run
the same SQLite.

```bash
nvm use
npm install     # no native modules, no rebuild step
npm run dev
```

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run check   # Biome
```

CI runs all three. It will not catch what matters most, though — see below.

## The one architectural rule

**The domain layer under `src/main/domain/` has no external imports.** Not Electron, not
`node:sqlite`, not React. It is plain TypeScript.

That is not a style preference. Every write — from the UI today, from an AI over MCP later —
has to pass through the same code, so dependency rules, cycle prevention and undo apply
identically to both. Putting domain logic in the renderer would let AI operations bypass it.
`design/coding-standards.md` §1 has the details.

Practically: if you find yourself reimplementing a judgement in `src/renderer/`, that judgement
belongs in the domain and should be called, not copied.

## Testing

The domain layer is tested first, and its tests name the requirement they cover
(`FR-3: 両側が複数の場合は自動再接続しない`). If you change behaviour there, change the test that
describes it — the naming exists so requirement and test stay traceable.

UI is not unit tested. Whether a graph reads well is not something a test can answer.

## What automated checks do not catch

Typecheck and tests have passed repeatedly while the canvas was visibly broken — nodes that
would not follow the cursor, titles that could not be edited, borders missing at three corners.
`design/qa-checklist.md` is the manual pass that catches those. If your change touches the
canvas, run the relevant sections.

## Commits

Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`), written in English, one
concern per commit. Explain why, not what — the diff already says what.

## Scope

Some things are out of scope by design, not by backlog order: team coordination, cloud sync,
integration with external trackers, and the product executing your tasks for you. The README's
Non-goals section is the full list. A pull request adding one of these will not be merged, so
please open an issue first if you think one of them is wrong.
