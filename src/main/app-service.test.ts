import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppService, PersistenceError } from './app-service';
import { openInMemoryDatabase } from './db/open';
import type { Progress, TaskId } from './domain/model';

let db: DatabaseSync;
let service: AppService;

beforeEach(() => {
  db = openInMemoryDatabase();
  service = new AppService(db);
});

const firstTaskId = (): TaskId => {
  const id = [...service.graph.tasks.keys()][0];
  if (!id) throw new Error('no task');
  return id;
};

describe('AppService — 通常の永続化', () => {
  it('操作の結果が DB に書き出される', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    const row = db.prepare('SELECT COUNT(*) n FROM tasks').get() as unknown as { n: number };
    expect(row.n).toBe(1);
  });

  it('undo も永続化される', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    service.mutate((store) => store.undo());

    const row = db.prepare('SELECT COUNT(*) n FROM tasks').get() as unknown as { n: number };
    expect(row.n).toBe(0);
    expect(service.graph.tasks.size).toBe(0);
  });

  it('batch が失敗してロールバックされた場合、DB は変更されない', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    const id = firstTaskId();

    service.mutate((store) =>
      store.batch(() => {
        const ok = store.updateTaskTitle(id, 'renamed');
        if (!ok.ok) return ok;
        return store.updateTaskTitle('missing' as TaskId, 'x'); // 失敗させる
      }),
    );

    const row = db.prepare('SELECT title FROM tasks').get() as unknown as { title: string };
    expect(row.title).toBe('t1');
    expect(service.graph.tasks.get(id)?.title).toBe('t1');
  });
});

describe('AppService — 永続化に失敗したときの巻き戻し', () => {
  /**
   * ドメイン層は Progress を型でしか縛れない。IPC / MCP から実行時に不正な値が
   * 渡ると、DB の CHECK 制約に到達して初めて失敗する。
   * これを再現し、メモリ上の状態が DB に合わせて巻き戻ることを確認する。
   */
  it('DBに拒否された変更がメモリ上に残らない', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    const id = firstTaskId();

    expect(() =>
      service.mutate((store) => store.setTaskProgress(id, 'archived' as Progress)),
    ).toThrow(PersistenceError);

    // 巻き戻っていること。ここが 'archived' のままだと、以降の差分計算の基準が
    // 汚染され、変更は二度と再試行されないまま再起動時に消える。
    expect(service.graph.tasks.get(id)?.progress).toBe('not_done');

    const row = db.prepare('SELECT progress FROM tasks WHERE id = ?').get(id) as unknown as {
      progress: string;
    };
    expect(row.progress).toBe('not_done');
  });

  it('巻き戻した後も通常の操作を続けられる', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    const id = firstTaskId();

    expect(() =>
      service.mutate((store) => store.setTaskProgress(id, 'archived' as Progress)),
    ).toThrow(PersistenceError);

    service.mutate((store) => store.setTaskProgress(id, 'done'));
    const row = db.prepare('SELECT progress FROM tasks WHERE id = ?').get(id) as unknown as {
      progress: string;
    };
    expect(row.progress).toBe('done');
  });

  it('巻き戻せた場合は recovered = true を伝える', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    const id = firstTaskId();

    try {
      service.mutate((store) => store.setTaskProgress(id, 'archived' as Progress));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PersistenceError);
      expect((e as PersistenceError).recovered).toBe(true);
    }
  });

  it('DB自体が使えない場合は recovered = false を伝える', () => {
    service.mutate((store) => store.createTask('t1', { x: 0, y: 0 }));
    db.close();

    try {
      service.mutate((store) => store.createTask('t2', { x: 0, y: 0 }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PersistenceError);
      expect((e as PersistenceError).recovered).toBe(false);
    }
  });
});
