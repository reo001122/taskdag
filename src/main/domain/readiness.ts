import { incomingEdges } from './graph-query';
import type { Readiness, TaskGraph, TaskId } from './model';

/**
 * 軸a(Ready / Blocked)の導出(FR-5, design/domain-design.md §3.3)
 *
 * 永続化しない。常にここで導出する。
 *
 * Phase 2 で緩やかな(非ブロッキングな)依存エッジを導入する際、
 * 変更が必要になるのはこのファイルだけである。緩やかなエッジを
 * incoming から除外すればよい。
 */

export function readinessOf(graph: TaskGraph, id: TaskId): Readiness {
  // 存在しないTaskの問い合わせは呼び出し側のバグ。
  // 「起こってはならない状態」なので例外を投げる(design/coding-standards.md §5)。
  if (!graph.tasks.has(id)) {
    throw new Error(`readinessOf: task not found: ${id}`);
  }

  const incoming = incomingEdges(graph, id);

  // 入力エッジを持たないTaskは常に ready(FR-5)。
  // 下の every は空配列に対して true を返すため、この分岐がなくても結果は同じだが、
  // 要件として明示されている条件なので、意図が読めるよう分けて書いている。
  if (incoming.length === 0) return 'ready';

  const allPredecessorsDone = incoming.every((edge) => {
    const predecessor = graph.tasks.get(edge.from);
    if (!predecessor) {
      // INV-1(エッジは存在するTaskを指す)が破れている。
      throw new Error(`readinessOf: dangling edge ${edge.id} points to missing task ${edge.from}`);
    }
    return predecessor.progress === 'done';
  });

  return allPredecessorsDone ? 'ready' : 'blocked';
}

export function getAllReadiness(graph: TaskGraph): ReadonlyMap<TaskId, Readiness> {
  const result = new Map<TaskId, Readiness>();
  for (const id of graph.tasks.keys()) {
    result.set(id, readinessOf(graph, id));
  }
  return result;
}
