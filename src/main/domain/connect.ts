import {
  type DomainError,
  edgeAlreadyExists,
  selfLoop,
  taskNotFound,
  wouldCreateCycle,
} from './errors';
import { hasEdge, isReachable } from './graph-query';
import type { TaskGraph, TaskId } from './model';
import { okVoid, type Result } from './result';

/**
 * 依存エッジ A→B を追加してよいかの判定(FR-3, design/domain-design.md §3.1)
 *
 * React Flow の isValidConnection から、接続が確定する前に同期的に呼ばれる。
 * 循環になる接続はドロップしても成立しない、という要件をここで担保する。
 * 事後的な検知・警告は行わない。
 *
 * 副作用を持たせないこと。
 */
export function canConnect(graph: TaskGraph, from: TaskId, to: TaskId): Result<void, DomainError> {
  if (!graph.tasks.has(from)) return { ok: false, error: taskNotFound(from) };
  if (!graph.tasks.has(to)) return { ok: false, error: taskNotFound(to) };

  if (from === to) return { ok: false, error: selfLoop(from) };

  if (hasEdge(graph, from, to)) return { ok: false, error: edgeAlreadyExists(from, to) };

  // to から from へ到達できるなら、from→to を足すと循環する。
  if (isReachable(graph, to, from)) return { ok: false, error: wouldCreateCycle(from, to) };

  return okVoid;
}
