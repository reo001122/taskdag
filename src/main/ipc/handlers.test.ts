import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppService } from '../app-service';
import { openInMemoryDatabase } from '../db/open';
import { buildSnapshot, executeCommand } from './handlers';
import { parseCommand } from './validate';

let db: DatabaseSync;
let service: AppService;
const NOW = 1_700_000_000_000;

beforeEach(() => {
  db = openInMemoryDatabase();
  service = new AppService(db);
});

const send = (raw: unknown) => {
  const parsed = parseCommand(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return executeCommand(service, db, parsed.value, () => NOW);
};

describe('アーカイブのコマンド(FR-11)', () => {
  it('FR-11: validate が archiveTask の id と archiveCompletedTasks を通し、不正な形は弾く', () => {
    expect(parseCommand({ type: 'archiveTask', id: 'x' }).ok).toBe(true);
    expect(parseCommand({ type: 'archiveTask' }).ok).toBe(false);
    expect(parseCommand({ type: 'archiveTask', id: '' }).ok).toBe(false);
    expect(parseCommand({ type: 'archiveCompletedTasks' }).ok).toBe(true);
  });

  it('FR-1, FR-11: keepReconnections は3つのコマンドで同じ検証を通る(省略と空配列は別)', () => {
    const keep = [{ from: 'a', to: 'b' }];
    for (const base of [
      { type: 'archiveTask', id: 'x' },
      { type: 'archiveCompletedTasks' },
      { type: 'deleteTask', id: 'x' },
    ]) {
      expect(parseCommand({ ...base, keepReconnections: keep })).toEqual({
        ok: true,
        value: { ...base, keepReconnections: keep },
      });
      expect(parseCommand({ ...base, keepReconnections: [] })).toEqual({
        ok: true,
        value: { ...base, keepReconnections: [] },
      });
      expect(parseCommand(base)).toEqual({ ok: true, value: base });
      expect(parseCommand({ ...base, keepReconnections: 'a' }).ok).toBe(false);
      expect(parseCommand({ ...base, keepReconnections: [null] }).ok).toBe(false);
      expect(parseCommand({ ...base, keepReconnections: [{ from: 'a' }] }).ok).toBe(false);
      expect(parseCommand({ ...base, keepReconnections: [{ from: '', to: 'b' }] }).ok).toBe(false);
    }
  });

  it('FR-1, FR-11: 繋ぎ直しを外してアーカイブすると、その依存は作られない', () => {
    const chain = (): string[] => {
      const ids: string[] = [];
      for (const title of ['A', 'B', 'C']) {
        send({ type: 'createTask', title, position: { x: 0, y: 0 } });
        ids.push([...service.graph.tasks.keys()].at(-1) as string);
      }
      send({ type: 'connect', from: ids[0], to: ids[1] });
      send({ type: 'connect', from: ids[1], to: ids[2] });
      send({ type: 'setTaskProgress', id: ids[1], progress: 'done' });
      return ids;
    };
    const edges = () => buildSnapshot(service, db, 'x').edges.map((e) => `${e.from}->${e.to}`);

    const ids = chain();
    expect(send({ type: 'archiveTask', id: ids[1] as string, keepReconnections: [] }).ok).toBe(
      true,
    );
    expect(edges()).toEqual([]);

    send({ type: 'undo' });
    expect(edges()).toHaveLength(2);
    expect(send({ type: 'archiveTask', id: ids[1] as string }).ok).toBe(true);
    expect(edges()).toEqual([`${ids[0]}->${ids[2]}`]);

    // まとめて
    send({ type: 'undo' });
    expect(send({ type: 'archiveCompletedTasks', keepReconnections: [] }).ok).toBe(true);
    expect(edges()).toEqual([]);
  });

  it('FR-11: 完了した Task を移すと、スナップショットに記録が出て、時刻は main が付ける', () => {
    send({ type: 'createTask', title: 'T', position: { x: 0, y: 0 } });
    const id = [...service.graph.tasks.keys()][0] as string;
    send({ type: 'setTaskProgress', id, progress: 'done' });
    send({ type: 'createChildTask', parentId: id, title: 'c' });

    expect(send({ type: 'archiveTask', id }).ok).toBe(true);

    const snap = buildSnapshot(service, db, 'x');
    expect(snap.tasks).toEqual([]);
    expect(snap.archived).toEqual([
      {
        id,
        title: 'T',
        memo: '',
        childTasks: [{ title: 'c', progress: 'not_done', memo: '' }],
        archivedAt: NOW,
        projectName: null,
      },
    ]);
  });

  it('FR-11: 完了していない Task は拒否され、理由が文字列で返る', () => {
    send({ type: 'createTask', title: 'T', position: { x: 0, y: 0 } });
    const id = [...service.graph.tasks.keys()][0] as string;
    const result = send({ type: 'archiveTask', id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not done/);
  });

  it('FR-11, FR-8: undo でスナップショットの記録も消える', () => {
    send({ type: 'createTask', title: 'T', position: { x: 0, y: 0 } });
    const id = [...service.graph.tasks.keys()][0] as string;
    send({ type: 'setTaskProgress', id, progress: 'done' });
    send({ type: 'archiveCompletedTasks' });
    expect(buildSnapshot(service, db, 'x').archived).toHaveLength(1);

    send({ type: 'undo' });
    const snap = buildSnapshot(service, db, 'x');
    expect(snap.archived).toEqual([]);
    expect(snap.tasks).toHaveLength(1);
  });
});
