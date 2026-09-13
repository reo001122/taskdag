import type { DatabaseSync } from 'node:sqlite';
import type { IpcMain } from 'electron';
import type { Command, CommandResult, DeletePlan, GraphSnapshot } from '../../shared/ipc';
import { IPC } from '../../shared/ipc';
import type { Logger } from '../../shared/log';
import type { AppService } from '../app-service';
import { getHideCompleted, setHideCompleted } from '../db/settings';
import { type DomainError, describeDomainError } from '../domain/errors';
import { childTaskId, edgeId, projectId, taskId } from '../domain/model';
import { err, ok, type Result } from '../domain/result';
import { parseCommand } from './validate';

/**
 * renderer との境界(design/coding-standards.md §1)
 *
 * 薄い変換層に留めること。ここに判断を書くとドメイン層を迂回した経路ができ、
 * AI(MCP)側から同じ操作をしたときに挙動がずれる。
 */

export function buildSnapshot(
  service: AppService,
  db: DatabaseSync,
  dbPath: string,
): GraphSnapshot {
  const graph = service.graph;
  const readiness = service.query((store) => store.getAllReadiness());
  // Project への所属も導出値。保存されていないのでここで求めて送る(FR-4)。
  const membership = service.query((store) => store.getAllTaskProjects());

  return {
    tasks: [...graph.tasks.values()].map((t) => ({
      id: t.id,
      title: t.title,
      progress: t.progress,
      readiness: readiness.get(t.id) ?? 'ready',
      projectId: membership.get(t.id) ?? null,
      position: { x: t.position.x, y: t.position.y },
      collapsed: t.collapsed,
      memo: t.memo,
      childTaskIds: [...t.childTaskIds],
    })),
    childTasks: [...graph.childTasks.values()].map((c) => ({
      id: c.id,
      parentId: c.parentId,
      title: c.title,
      progress: c.progress,
      memo: c.memo,
    })),
    edges: [...graph.edges.values()].map((e) => ({ id: e.id, from: e.from, to: e.to })),
    projects: [...graph.projects.values()].map((p) => ({
      id: p.id,
      name: p.name,
      position: { x: p.position.x, y: p.position.y },
      width: p.width,
      height: p.height,
      colorIndex: p.colorIndex,
    })),
    canUndo: service.query((store) => store.canUndo),
    canRedo: service.query((store) => store.canRedo),
    hideCompleted: getHideCompleted(db),
    dbPath,
  };
}

/** ドメインの Result を、UI と AI の双方が読める文字列エラーへ変換する。 */
function run(result: Result<void, DomainError>): Result<void, string> {
  return result.ok ? ok(undefined) : err(describeDomainError(result.error));
}

export function executeCommand(
  service: AppService,
  db: DatabaseSync,
  command: Command,
): Result<void, string> {
  switch (command.type) {
    case 'createTask':
      return run(service.mutate((s) => s.createTask(command.title, command.position)));
    case 'updateTaskTitle':
      return run(service.mutate((s) => s.updateTaskTitle(taskId(command.id), command.title)));
    case 'setTaskProgress':
      return run(service.mutate((s) => s.setTaskProgress(taskId(command.id), command.progress)));
    case 'moveTask':
      return run(service.mutate((s) => s.moveTask(taskId(command.id), command.position)));
    case 'setTaskMemo':
      return run(service.mutate((s) => s.setTaskMemo(taskId(command.id), command.memo)));
    case 'setTaskCollapsed':
      return run(service.mutate((s) => s.setTaskCollapsed(taskId(command.id), command.collapsed)));
    case 'deleteTask':
      return run(
        service.mutate((s) =>
          s.deleteTask(
            taskId(command.id),
            command.keepReconnections?.map((edge) => ({
              from: taskId(edge.from),
              to: taskId(edge.to),
            })),
          ),
        ),
      );

    case 'createChildTask':
      return run(service.mutate((s) => s.createChildTask(taskId(command.parentId), command.title)));
    case 'updateChildTaskTitle':
      return run(
        service.mutate((s) => s.updateChildTaskTitle(childTaskId(command.id), command.title)),
      );
    case 'setChildTaskMemo':
      return run(service.mutate((s) => s.setChildTaskMemo(childTaskId(command.id), command.memo)));
    case 'setChildTaskProgress':
      return run(
        service.mutate((s) => s.setChildTaskProgress(childTaskId(command.id), command.progress)),
      );
    case 'deleteChildTask':
      return run(service.mutate((s) => s.deleteChildTask(childTaskId(command.id))));
    case 'reorderChildTask':
      return run(
        service.mutate((s) => s.reorderChildTask(childTaskId(command.id), command.newIndex)),
      );

    case 'demoteTaskToChild':
      return run(
        service.mutate((s) => s.demoteTaskToChild(taskId(command.id), taskId(command.newParentId))),
      );

    case 'promoteChildTask':
      return run(
        service.mutate((s) => s.promoteChildTask(childTaskId(command.id), command.position)),
      );

    case 'moveChildTask':
      return run(
        service.mutate((s) =>
          s.moveChildTask(childTaskId(command.id), taskId(command.newParentId)),
        ),
      );

    case 'connect':
      return run(service.mutate((s) => s.connect(taskId(command.from), taskId(command.to))));
    case 'disconnect':
      return run(service.mutate((s) => s.disconnect(edgeId(command.id))));

    case 'createProject':
      return run(
        service.mutate((s) =>
          s.createProject(
            command.name,
            command.position,
            command.width,
            command.height,
            command.colorIndex,
          ),
        ),
      );
    case 'setProjectColor':
      return run(
        service.mutate((s) => s.setProjectColor(projectId(command.id), command.colorIndex)),
      );
    case 'renameProject':
      return run(service.mutate((s) => s.renameProject(projectId(command.id), command.name)));
    case 'moveProject':
      return run(service.mutate((s) => s.moveProject(projectId(command.id), command.position)));
    case 'resizeProject':
      return run(
        service.mutate((s) =>
          s.resizeProject(projectId(command.id), command.position, command.width, command.height),
        ),
      );
    case 'deleteProject':
      return run(service.mutate((s) => s.deleteProject(projectId(command.id))));

    case 'applyLayout':
      return run(
        service.mutate((s) =>
          s.applyLayout(
            command.positions.map((p) => ({ id: taskId(p.id), position: p.position })),
            command.projects.map((p) => ({
              id: projectId(p.id),
              position: p.position,
              width: p.width,
              height: p.height,
            })),
          ),
        ),
      );

    case 'undo':
      // 履歴がないだけならエラーではない(FR-8)
      service.mutate((s) => s.undo());
      return ok(undefined);
    case 'redo':
      service.mutate((s) => s.redo());
      return ok(undefined);

    case 'setHideCompleted':
      // 表示設定はタスクグラフの外。Undo 対象外(FR-6)。
      setHideCompleted(db, command.value);
      return ok(undefined);
  }
}

/**
 * 作成コマンドが対象とする集合の id。実行の前後で比べて、作られた id を割り出す。
 *
 * main はコマンドを1件ずつ同期実行するため、この前後は必ず1コマンド分だけ離れている
 * (design/tech-stack.md「書き込みが構造的に直列化される」)。renderer 側で
 * スナップショットの差分を取ると、この保証がないので取り違える。
 */
function idsCreatedBy(service: AppService, command: Command): Set<string> | null {
  switch (command.type) {
    case 'createTask':
      return service.query((s) => new Set<string>(s.graph.tasks.keys()));
    case 'createChildTask':
      return service.query((s) => new Set<string>(s.graph.childTasks.keys()));
    case 'createProject':
      return service.query((s) => new Set<string>(s.graph.projects.keys()));
    default:
      return null;
  }
}

export function registerIpc(
  ipcMain: IpcMain,
  service: AppService,
  db: DatabaseSync,
  dbPath: string,
  log: Logger,
): void {
  const snapshot = (): GraphSnapshot => buildSnapshot(service, db, dbPath);

  ipcMain.handle(IPC.getGraph, (): GraphSnapshot => snapshot());

  ipcMain.handle(IPC.command, (_event, raw: unknown): CommandResult => {
    const parsed = parseCommand(raw);
    if (!parsed.ok) {
      // ここを通るのは renderer か MCP クライアント側の不具合。握りつぶすと
      // 「操作しても何も起きない」としか見えないので、必ず残す。
      log.warn('コマンドを検証で弾いた', { error: parsed.error, raw });
      return { ok: false, error: parsed.error, snapshot: snapshot() };
    }

    log.debug('コマンド', parsed.value);

    const before = idsCreatedBy(service, parsed.value);

    const result = executeCommand(service, db, parsed.value);
    if (!result.ok) {
      log.info('コマンドをドメインが拒否した', { type: parsed.value.type, error: result.error });
      return { ok: false, error: result.error, snapshot: snapshot() };
    }

    const after = before === null ? null : idsCreatedBy(service, parsed.value);
    const createdId =
      before === null || after === null ? null : ([...after].find((id) => !before.has(id)) ?? null);

    return { ok: true, snapshot: snapshot(), createdId };
  });

  // 接続ドラッグ開始時に一度だけ呼ばれる。副作用を持たない。
  ipcMain.handle(IPC.validTargets, (_event, from: unknown): string[] => {
    if (typeof from !== 'string') return [];
    return service.query((s) => {
      const source = taskId(from);
      return [...s.graph.tasks.keys()].filter((candidate) => s.canConnect(source, candidate));
    });
  });

  // 削除前に変更内容を提示するための計画(FR-1)
  ipcMain.handle(IPC.planDelete, (_event, id: unknown): DeletePlan | null => {
    if (typeof id !== 'string') return null;
    const plan = service.query((s) => s.planDeleteTask(taskId(id)));
    if (!plan.ok) return null;
    return {
      taskId: plan.value.taskId,
      removedEdges: plan.value.removedEdges.map((e) => ({ from: e.from, to: e.to })),
      addedEdges: plan.value.addedEdges.map((e) => ({ from: e.from, to: e.to })),
      removedChildTaskIds: [...plan.value.removedChildTaskIds],
    };
  });
}
