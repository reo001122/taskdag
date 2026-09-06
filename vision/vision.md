# Vision v1

Status: first draft, synthesized from the R1–R3 research and the design discussion that followed it. Still open to revision — several points below are explicitly flagged as unresolved rather than forced to a conclusion.

## One-line summary

A local-first, graph-based tool for a single engineer to represent their day-to-day implementation work — below the granularity of a Jira/Linear ticket — as something they directly manipulate, where useful signals (what's ready, what's blocking, where the bottlenecks are, how the whole thing is flowing) come from the shape of the graph itself rather than from separately maintained fields.

## Problem & Opportunity

Research (R1) found that engineers already layer a lightweight, personal mechanism *underneath* their ticket tracker for this granular layer of work — plain text, in-repo markdown, org-mode, in-code TODOs — and that switching to a general-purpose external app for this layer repeatedly causes friction or breaks flow state. Several independent sources described multi-tier, ad hoc decomposition (day/sprint/ticket; overview/laundry-list/backlog) rather than a single flat list.

Research (R2, R3) found a structural gap that spans two entire categories of existing tools:

- **Task/PM tools** (Todoist, Things, TickTick, Jira, Linear, GitHub Projects, etc.) model work as a strict hierarchy or flat list. Where dependency relations exist at all, they are bolted on, not visualized, and are repeatedly requested by users across independent communities (HN 2016/2020/2022/2023, Taskwarrior, Super Productivity, Obsidian Tasks) in different words for the same underlying gap.
- **Visual/canvas tools** (Miro, tldraw, Excalidraw, FigJam, Obsidian Canvas, Heptabase, Workflowy, Logseq) all model edges as representational objects — a line with a label — with no mechanism to derive status (Ready/Blocked/etc.) from graph structure. The one shipped example of a real derived status (GitHub Issues' "blocked by/blocking") is not a visual tool at all, and took a multi-year public request thread to arrive.

No tool surveyed combines "graph you directly edit" with "status computed from that graph." That combination is the core bet of this product.

## Target User

A single individual: a software engineer, whether an employee or an individual/solo developer. Explicitly **not** a team-coordination tool — multi-user/team workflows are out of scope by design, not just by initial cut.

## Design Principles

Carried over unchanged from the original brief; everything below is built to serve these, not the other way around.

1. **The graph-editing experience is the main thing.** The product's primary interaction is editing the graph — not filling out fields, not managing a separate settings/status UI.
2. **The value is being able to directly manipulate your thinking, as-is.** Structure follows how the person actually thinks, not a template imposed on them. (This is why derived status must never restrict what a person can do with a node — see below.)
3. **Value emerges from the graph, not from separate bookkeeping.** Ready, Blocked, Bottleneck, and overall flow are all read off the graph's shape — some by explicit computation, some simply by looking at a well-drawn graph.

## Product Concept (current shape)

This section describes the shape the concept has taken through discussion. It is a concept, not a spec — no data schema, storage format, or UI mechanics are decided here.

**The core unit is a Task**, used recursively but with a deliberately shallow limit: a Task may have flat child Tasks (a checklist-like layer), but a child Task cannot itself have children. There is no arbitrarily deep tree.

**Two distinct relations exist between Tasks, kept separate on purpose:**
- *Parent/child* (composition): used when Tasks are simply part of the same whole, with no ordering to express.
- *Dependency edges* (the graph proper): used specifically when there *is* an ordering relationship. These only connect top-level Tasks — a child Task cannot be a dependency-graph participant. Two flavors are hypothesized (not fully settled — see Open Threads): a **strict** dependency (task B genuinely cannot start until task A is done — tied to technical/structural constraints) and a **loose** ordering (a natural sequence with no hard gate — tied to personal workflow habit, e.g. implementing a class while interleaving its tests).

**Project is a tag, not a container.** A top-level Task carries zero or one Project tag; a child Task automatically inherits its parent's tag. Dependency edges are always Task-to-Task, never Task-to-Project — a dependency that visually crosses a "project boundary" is just an ordinary edge between two specific Tasks that happen to carry different tags.

**State is two independent axes, not one pipeline:**
- Computed: Ready / Blocked, derived purely from whether a Task's strict-blocking predecessors are Done. Meaningful only for top-level Tasks (child Tasks have no dependency edges to compute from — whether they should inherit their parent's value here is still open).
- Self-reported: Not Done / In Progress / Done, set explicitly by whichever actor — human, or an AI acting on the human's behalf in conversation — actually did the work. No external or automatic detection of completion (e.g. from a git commit) is in scope.
- The two axes being independent is what lets a Task be, say, Blocked *and* In Progress at once (refining/prepping a downstream Task before its dependency finishes) — and is why the computed axis must never restrict editing or block setting the self-reported axis.
- A parent Task's Done state and its children's Done states are independent by design (no auto-rollup), because new child Tasks may be added after existing ones were already completed.

**Bottleneck and overall flow are not computed values.** Unlike Ready/Blocked, they're expected to be visible simply from a well-designed rendering of the graph — a node many edges converge on reads as a bottleneck; the graph's overall shape gives a gut sense of progress. This is a visualization-design problem, not an algorithm to build.

**Single shared canvas.** All Tasks and Projects coexist in one space, not per-project screens — a requirement of allowing dependency edges across Project tags. A Task's own children can be collapsed into a compact form; independently, a Project tag's member Tasks can be visually clustered/collapsed too (re-routing their edges to the collapsed shape for display only — the underlying edges still reference the specific Tasks).

**Local-first, AI-legible, execution stays outside the product.** All data lives locally; there is no cloud sync and no integration with external ticket systems (Jira, GitHub, etc.) planned. The data structure is meant to be easy for an AI (e.g. Claude Code) to read and act on conversationally — adding/removing Tasks, reporting state, answering "what's Ready" — because the human is expected to often manage the graph *through* a conversation with AI rather than only by direct manipulation. But the product's responsibility stops at managing the task graph: whether an AI (or the human) actually goes and does the underlying work is explicitly outside what this product is responsible for.

**Interaction expectations (not designed yet, but scoped):** the core structural moves — making a Task a child, connecting two Tasks with a dependency edge, applying a Project tag — are all expected to be reachable with simple mouse gestures (e.g. dragging a Task into a Project's visual frame applies that tag). The actual interaction design is deferred.

## Visualization Quality Is Core, Not Incidental

Because Bottleneck and overall flow are explicitly *not* computed values but things a person is meant to perceive by looking at the graph (see Product Concept above), and because Principle 1 makes graph-editing the primary experience, the legibility and operability of the visualization is not a peripheral implementation detail — it's load-bearing for whether the product's core value proposition works at all. A technically correct dependency graph that's hard to read or clumsy to manipulate would fail the product's actual goal even if every computed value (Ready/Blocked) were correct.

This is flagged here as a standing priority to carry into every later phase (interaction design, rendering approach, layout algorithm choices, etc.), rather than treated as a normal implementation concern to be traded off for convenience. The concrete design work itself — layout, readability at scale, interaction responsiveness — is not decided here; see Open Threads.

## Explicit Non-Goals

- Team/multi-user coordination of any kind.
- Cloud storage, sync, or any server-side component.
- Integration with external trackers (Jira, GitHub Issues, Linear, etc.).
- The product autonomously executing tasks (writing code, etc.) — AI's role here is managing the graph conversationally, not performing the work it describes.
- A prescribed decomposition granularity — the size of a "Task" is always the user's own contextual call, not something the tool enforces.

## Open Threads (carried into PRD / Requirements)

- Whether the strict/loose dependency distinction (H1) needs more than two categories, and how it's visually distinguished — unresolved, deferred as a design question.
- Whether the computed axis (Ready/Blocked) should be inherited by a child Task from its parent, or simply left undefined for children — explicitly undecided.
- Whether a strict dependency is always tied to a technical/structural constraint, or whether purely workflow-driven strict dependencies exist too — not explored.
- How the "nest ↔ dependency-edge" restructuring interaction should actually work — deferred, design question.
- Concrete visualization/layout design (how the graph renders and stays legible/operable as it grows, layout algorithm, rendering approach) — explicitly called out as a standing priority (see "Visualization Quality Is Core, Not Incidental" above), but not designed here; deferred to a later phase.

## Parking Lot (validated needs, deliberately deferred)

- A running, diary-style progress note/log per Task, anchored to entering "In Progress" — validated as a real personal need but based on one person's workflow; deferred to a later phase.
- Deadline- and effort-based progress percentages (per-parent childTask completion %, per-Project completion %, optionally effort-weighted) — deferred; the user was explicit this can be added after the first version.
