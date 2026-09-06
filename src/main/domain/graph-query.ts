import type { DependencyEdge, TaskGraph, TaskId } from './model';

/**
 * TaskGraph に対する参照専用の問い合わせ。
 * 状態を変えない。React Flow の isValidConnection から同期的に呼ばれるものを含むため、
 * このファイルの関数は副作用を持ってはならない(design/domain-design.md §3.1)。
 */

export function incomingEdges(graph: TaskGraph, to: TaskId): DependencyEdge[] {
  return [...graph.edges.values()].filter((e) => e.to === to);
}

export function outgoingEdges(graph: TaskGraph, from: TaskId): DependencyEdge[] {
  return [...graph.edges.values()].filter((e) => e.from === from);
}

/** `to` を指す先行Taskのid(重複なし)。 */
export function predecessors(graph: TaskGraph, to: TaskId): TaskId[] {
  return [...new Set(incomingEdges(graph, to).map((e) => e.from))];
}

/** `from` から出る後続Taskのid(重複なし)。 */
export function successors(graph: TaskGraph, from: TaskId): TaskId[] {
  return [...new Set(outgoingEdges(graph, from).map((e) => e.to))];
}

export function hasEdge(graph: TaskGraph, from: TaskId, to: TaskId): boolean {
  for (const e of graph.edges.values()) {
    if (e.from === from && e.to === to) return true;
  }
  return false;
}

/**
 * `start` から有向エッジを辿って `target` に到達できるか。
 *
 * 循環検知に使う: エッジ A→B を追加してよいのは、B から A へ到達できないときに限る
 * (到達できるなら A→B→…→A の循環になる)。
 */
export function isReachable(graph: TaskGraph, start: TaskId, target: TaskId): boolean {
  const visited = new Set<TaskId>();
  const stack: TaskId[] = [start];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...successors(graph, current));
  }

  return false;
}
