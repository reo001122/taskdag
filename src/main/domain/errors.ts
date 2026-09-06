import type { ChildTaskId, EdgeId, ProjectId, TaskId } from './model';

/**
 * ドメイン層が返しうる失敗(design/domain-design.md §5)
 *
 * 判別可能ユニオンにしているのは、呼び出し側が網羅的に分岐でき、
 * かつ MCP 経由で AI に構造化されたエラーを返せるようにするため。
 */
export type DomainError =
  | { readonly type: 'task_not_found'; readonly id: TaskId }
  | { readonly type: 'child_task_not_found'; readonly id: ChildTaskId }
  | { readonly type: 'edge_not_found'; readonly id: EdgeId }
  | { readonly type: 'project_not_found'; readonly id: ProjectId }
  | { readonly type: 'would_create_cycle'; readonly from: TaskId; readonly to: TaskId }
  | { readonly type: 'edge_already_exists'; readonly from: TaskId; readonly to: TaskId }
  | { readonly type: 'self_loop'; readonly id: TaskId }
  | { readonly type: 'index_out_of_range'; readonly index: number; readonly length: number };

export const taskNotFound = (id: TaskId): DomainError => ({ type: 'task_not_found', id });
export const childTaskNotFound = (id: ChildTaskId): DomainError => ({
  type: 'child_task_not_found',
  id,
});
export const edgeNotFound = (id: EdgeId): DomainError => ({ type: 'edge_not_found', id });
export const projectNotFound = (id: ProjectId): DomainError => ({ type: 'project_not_found', id });
export const wouldCreateCycle = (from: TaskId, to: TaskId): DomainError => ({
  type: 'would_create_cycle',
  from,
  to,
});
export const edgeAlreadyExists = (from: TaskId, to: TaskId): DomainError => ({
  type: 'edge_already_exists',
  from,
  to,
});
export const selfLoop = (id: TaskId): DomainError => ({ type: 'self_loop', id });
export const indexOutOfRange = (index: number, length: number): DomainError => ({
  type: 'index_out_of_range',
  index,
  length,
});

/**
 * 失敗を人間にも AI にも読める1行にする。
 *
 * IPC(UI への表示)と MCP(AI への応答)の双方で使う。エラーの文言を
 * 呼び出し側ごとに組み立てると表現がばらつくため、ここに集約する。
 */
export function describeDomainError(error: DomainError): string {
  switch (error.type) {
    case 'task_not_found':
      return `Task ${error.id} does not exist.`;
    case 'child_task_not_found':
      return `Child task ${error.id} does not exist.`;
    case 'edge_not_found':
      return `Dependency edge ${error.id} does not exist.`;
    case 'project_not_found':
      return `Project ${error.id} does not exist.`;
    case 'would_create_cycle':
      return `Connecting ${error.from} to ${error.to} would create a cycle in the dependency graph.`;
    case 'edge_already_exists':
      return `A dependency edge from ${error.from} to ${error.to} already exists.`;
    case 'self_loop':
      return `Task ${error.id} cannot depend on itself.`;
    case 'index_out_of_range':
      return `Index ${error.index} is out of range (0..${error.length - 1}).`;
  }
}
