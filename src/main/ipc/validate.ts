import type { Command, Position, Progress } from '../../shared/ipc';
import { err, ok, type Result } from '../domain/result';

/**
 * 境界での実行時検証(design/coding-standards.md §5)
 *
 * TypeScript の型は実行時には存在しない。renderer や(Phase 4の)AI から届く
 * ペイロードは検証されていない生のデータであり、ここが唯一の関門になる。
 *
 * 検証を怠ると、たとえば範囲外の progress がドメイン層を素通りし、
 * SQLite の CHECK 制約で初めて弾かれる。その時点では既にメモリ上の状態が
 * 変わっており、永続化失敗として巻き戻す羽目になる(app-service.ts)。
 * 手前で止めるほうが安い。
 */

const PROGRESS_VALUES: readonly string[] = ['not_done', 'in_progress', 'done'];

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isProgress = (v: unknown): v is Progress =>
  typeof v === 'string' && PROGRESS_VALUES.includes(v);

function readPosition(v: unknown, key: string): Result<Position, string> {
  if (!isObject(v)) return err(`"${key}" must be a position object`);
  const { x, y } = v;
  if (typeof x !== 'number' || !Number.isFinite(x))
    return err(`"${key}.x" must be a finite number`);
  if (typeof y !== 'number' || !Number.isFinite(y))
    return err(`"${key}.y" must be a finite number`);
  return ok({ x, y });
}

function readSize(o: Obj): Result<{ width: number; height: number }, string> {
  const { width, height } = o;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return err('"width" must be a positive number');
  }
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return err('"height" must be a positive number');
  }
  return ok({ width, height });
}

function readColorIndex(o: Obj): Result<number, string> {
  const value = o.colorIndex;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return err('"colorIndex" must be a non-negative integer');
  }
  return ok(value);
}

export function parseCommand(raw: unknown): Result<Command, string> {
  if (!isObject(raw)) return err('command must be an object');
  const type = raw.type;
  if (typeof type !== 'string') return err('command.type must be a string');

  const needId = (): Result<string, string> =>
    isNonEmptyString(raw.id) ? ok(raw.id) : err('"id" must be a non-empty string');

  switch (type) {
    case 'createTask': {
      if (!isNonEmptyString(raw.title)) return err('"title" must be a non-empty string');
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      return ok({ type, title: raw.title, position: pos.value });
    }

    case 'updateTaskTitle':
    case 'updateChildTaskTitle': {
      const id = needId();
      if (!id.ok) return id;
      if (!isNonEmptyString(raw.title)) return err('"title" must be a non-empty string');
      return ok({ type, id: id.value, title: raw.title });
    }

    case 'setTaskProgress':
    case 'setChildTaskProgress': {
      const id = needId();
      if (!id.ok) return id;
      if (!isProgress(raw.progress)) {
        return err(`"progress" must be one of ${PROGRESS_VALUES.join(', ')}`);
      }
      return ok({ type, id: id.value, progress: raw.progress });
    }

    case 'moveTask': {
      const id = needId();
      if (!id.ok) return id;
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      return ok({ type, id: id.value, position: pos.value });
    }

    case 'setTaskMemo':
    case 'setChildTaskMemo': {
      const id = needId();
      if (!id.ok) return id;
      // メモは空文字を許す(空 = メモなし)。改行もそのまま通す。
      if (typeof raw.memo !== 'string') return err('"memo" must be a string');
      return ok({ type, id: id.value, memo: raw.memo });
    }

    case 'setTaskCollapsed': {
      const id = needId();
      if (!id.ok) return id;
      if (typeof raw.collapsed !== 'boolean') return err('"collapsed" must be a boolean');
      return ok({ type, id: id.value, collapsed: raw.collapsed });
    }

    case 'deleteTask': {
      const id = needId();
      if (!id.ok) return id;
      if (raw.keepReconnections === undefined) return ok({ type, id: id.value });

      if (!Array.isArray(raw.keepReconnections)) {
        return err('"keepReconnections" must be an array');
      }
      const keep: { from: string; to: string }[] = [];
      for (const entry of raw.keepReconnections) {
        if (typeof entry !== 'object' || entry === null) {
          return err('"keepReconnections" must contain objects');
        }
        const { from, to } = entry as Record<string, unknown>;
        if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
          return err('"keepReconnections" entries need non-empty "from" and "to"');
        }
        keep.push({ from, to });
      }
      return ok({ type, id: id.value, keepReconnections: keep });
    }

    case 'deleteChildTask':
    case 'disconnect':
    case 'deleteProject': {
      const id = needId();
      if (!id.ok) return id;
      return ok({ type, id: id.value });
    }

    case 'createChildTask': {
      if (!isNonEmptyString(raw.parentId)) return err('"parentId" must be a non-empty string');
      if (!isNonEmptyString(raw.title)) return err('"title" must be a non-empty string');
      return ok({ type, parentId: raw.parentId, title: raw.title });
    }

    case 'reorderChildTask': {
      const id = needId();
      if (!id.ok) return id;
      if (typeof raw.newIndex !== 'number' || !Number.isInteger(raw.newIndex)) {
        return err('"newIndex" must be an integer');
      }
      return ok({ type, id: id.value, newIndex: raw.newIndex });
    }

    /*
      Task と childTask の入れ替え(W-3)

      newParentId は「どの Task の下に入れるか」。renderer は落とした先の
      ノードから読むが、届いた値が Task の id である保証はここにしかない。
    */
    case 'demoteTaskToChild':
    case 'moveChildTask': {
      const id = needId();
      if (!id.ok) return id;
      if (!isNonEmptyString(raw.newParentId)) {
        return err('"newParentId" must be a non-empty string');
      }
      return ok({ type, id: id.value, newParentId: raw.newParentId });
    }

    case 'promoteChildTask': {
      const id = needId();
      if (!id.ok) return id;
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      return ok({ type, id: id.value, position: pos.value });
    }

    case 'connect': {
      if (!isNonEmptyString(raw.from)) return err('"from" must be a non-empty string');
      if (!isNonEmptyString(raw.to)) return err('"to" must be a non-empty string');
      return ok({ type, from: raw.from, to: raw.to });
    }

    case 'createProject': {
      if (!isNonEmptyString(raw.name)) return err('"name" must be a non-empty string');
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      const size = readSize(raw);
      if (!size.ok) return size;
      const color = readColorIndex(raw);
      if (!color.ok) return color;
      return ok({
        type,
        name: raw.name,
        position: pos.value,
        ...size.value,
        colorIndex: color.value,
      });
    }

    case 'setProjectColor': {
      const id = needId();
      if (!id.ok) return id;
      const color = readColorIndex(raw);
      if (!color.ok) return color;
      return ok({ type, id: id.value, colorIndex: color.value });
    }

    case 'renameProject': {
      const id = needId();
      if (!id.ok) return id;
      if (!isNonEmptyString(raw.name)) return err('"name" must be a non-empty string');
      return ok({ type, id: id.value, name: raw.name });
    }

    case 'moveProject': {
      const id = needId();
      if (!id.ok) return id;
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      return ok({ type, id: id.value, position: pos.value });
    }

    case 'resizeProject': {
      const id = needId();
      if (!id.ok) return id;
      const pos = readPosition(raw.position, 'position');
      if (!pos.ok) return pos;
      const size = readSize(raw);
      if (!size.ok) return size;
      return ok({ type, id: id.value, position: pos.value, ...size.value });
    }

    case 'applyLayout': {
      if (!Array.isArray(raw.positions)) return err('"positions" must be an array');
      const positions: { id: string; position: Position }[] = [];
      for (const item of raw.positions) {
        if (!isObject(item)) return err('"positions" entries must be objects');
        if (!isNonEmptyString(item.id)) return err('"positions[].id" must be a non-empty string');
        const pos = readPosition(item.position, 'positions[].position');
        if (!pos.ok) return pos;
        positions.push({ id: item.id, position: pos.value });
      }
      if (!Array.isArray(raw.projects)) return err('"projects" must be an array');
      const projects: { id: string; position: Position; width: number; height: number }[] = [];
      for (const item of raw.projects) {
        if (!isObject(item)) return err('"projects" entries must be objects');
        if (!isNonEmptyString(item.id)) return err('"projects[].id" must be a non-empty string');
        const rect = readPosition(item.position, 'projects[].position');
        if (!rect.ok) return rect;
        const size = readSize(item);
        if (!size.ok) return size;
        projects.push({ id: item.id, position: rect.value, ...size.value });
      }

      return ok({ type, positions, projects });
    }

    case 'setHideCompleted': {
      if (typeof raw.value !== 'boolean') return err('"value" must be a boolean');
      return ok({ type, value: raw.value });
    }

    case 'undo':
    case 'redo':
      return ok({ type });

    default:
      return err(`unknown command type: ${type}`);
  }
}
