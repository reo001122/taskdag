import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command, DeletePlan, GraphSnapshot } from '../../shared/ipc';
import { PROJECT_COLOR_COUNT, projectColorAt } from './colors';
import { computeLayout } from './layout';
import { ProjectFrameNode, type ProjectNodeData, TaskNode, type TaskNodeData } from './TaskNode';

const nodeTypes: NodeTypes = { task: TaskNode, projectFrame: ProjectFrameNode };

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null);
  const [askProjectName, setAskProjectName] = useState(false);

  /**
   * 追加した直後の要素を、そのまま編集状態にするための目印。
   * 作ってから名前を打つまでを1続きの操作にする —— 毎回、仮の名前を
   * 消してから入力させるのは、分解の勢いを削ぐ。
   */
  const [autoEditTaskId, setAutoEditTaskId] = useState<string | null>(null);
  const [autoEditChildOf, setAutoEditChildOf] = useState<string | null>(null);

  /**
   * React Flow に描画を任せるための状態。
   *
   * スナップショットから作った配列をそのまま渡すだけでは、ドラッグ中の
   * 位置変更が反映されずノードがマウスに付いてこない。React Flow が発する
   * 変更を onNodesChange で受け取り、ここに反映する必要がある。
   * 確定した座標を DB に送るのは onNodeDragStop の1回だけ(FR-8)。
   */
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /**
   * 接続ドラッグ中に、接続してよい相手の集合を保持する。
   * React Flow の isValidConnection は同期APIなので、ドラッグ開始時に
   * 一度だけ main へ問い合わせてここに置いておく(判定の実体はドメイン層)。
   */
  const validTargets = useRef<Set<string> | null>(null);

  /**
   * 枠をドラッグしている間、中の Task を一緒に動かすための控え。
   *
   * 実際に位置を確定させるのはドラッグ終了時の moveProject 1回だけ。
   * ここでやっているのは見た目を追従させることだけで、置き去りにすると
   * 「枠だけ動いて中身が残る」という嘘の状態が見えてしまう。
   */
  const frameDrag = useRef<{
    nodeId: string;
    origin: { x: number; y: number };
    members: Map<string, { x: number; y: number }>;
  } | null>(null);

  /** コマンドを送り、更新後のスナップショットを返す。失敗しても投げない。 */
  const dispatch = useCallback(async (command: Command): Promise<GraphSnapshot | null> => {
    try {
      const result = await window.api.send(command);
      setSnapshot(result.snapshot);
      setError(result.ok ? null : result.error);
      return result.snapshot;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const send = useCallback(
    (command: Command) => {
      void dispatch(command);
    },
    [dispatch],
  );

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await window.api.getGraph());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Task を作り、そのまま名前の入力に入る。 */
  const addTask = useCallback(
    (position: { x: number; y: number }) => {
      void (async () => {
        const before = new Set(snapshot?.tasks.map((t) => t.id) ?? []);
        const next = await dispatch({ type: 'createTask', title: '新しいタスク', position });
        const created = next?.tasks.find((t) => !before.has(t.id));
        if (created) setAutoEditTaskId(created.id);
      })();
    },
    [dispatch, snapshot],
  );

  /** 子タスクを1件足し、そのまま名前の入力に入る。Enter で連続して足せる。 */
  const addChild = useCallback(
    (parentId: string) => {
      void (async () => {
        await dispatch({ type: 'createChildTask', parentId, title: '項目' });
        setAutoEditChildOf(parentId);
      })();
    },
    [dispatch],
  );

  // Cmd+Z / Cmd+Shift+Z(FR-8)。AI が行った操作もこれで戻せる。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      send({ type: e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send]);

  const requestDelete = useCallback((id: string) => {
    void (async () => {
      // 削除で何が変わるかを見せてから確定させる(FR-1)
      setDeletePlan(await window.api.planDelete(id));
    })();
  }, []);

  const onAutoEditConsumed = useCallback(() => {
    setAutoEditTaskId(null);
    setAutoEditChildOf(null);
  }, []);

  const built = useMemo(() => {
    if (!snapshot) return { nodes: [] as Node[], edges: [] as Edge[] };

    const hidden = new Set(
      snapshot.hideCompleted
        ? snapshot.tasks.filter((t) => t.progress === 'done').map((t) => t.id)
        : [],
    );

    const colorOf = new Map(
      snapshot.projects.map((p) => [p.id, projectColorAt(p.colorIndex)] as const),
    );

    const frames: Node[] = snapshot.projects.map((project) => {
      const data: ProjectNodeData = {
        id: project.id,
        name: project.name,
        color: projectColorAt(project.colorIndex),
        colorIndex: project.colorIndex,
        onRecolor: (id, colorIndex) => send({ type: 'setProjectColor', id, colorIndex }),
        onResizeEnd: (id, position, width, height) =>
          send({ type: 'resizeProject', id, position, width, height }),
        onRename: (id, name) => send({ type: 'renameProject', id, name }),
        onDelete: (id) => send({ type: 'deleteProject', id }),
      };
      return {
        id: `project:${project.id}`,
        type: 'projectFrame',
        position: project.position,
        data: data as never,
        // ラベルだけを掴んで動かす。枠の内側は Task を掴めるよう透過させている。
        dragHandle: '.project-frame-label',
        // Task より背面に置く
        zIndex: -1,
        style: { width: project.width, height: project.height },
      };
    });

    const childrenByParent = new Map<string, GraphSnapshot['childTasks']>();
    for (const child of snapshot.childTasks) {
      const list = childrenByParent.get(child.parentId) ?? [];
      list.push(child);
      childrenByParent.set(child.parentId, list);
    }

    const taskNodes: Node[] = snapshot.tasks
      .filter((t) => !hidden.has(t.id))
      .map((task) => {
        // childTaskIds の並びが表示順。実体を並び順どおりに引き当てる。
        const pool = childrenByParent.get(task.id) ?? [];
        const ordered = task.childTaskIds
          .map((id) => pool.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);

        const data: TaskNodeData = {
          task,
          children: ordered,
          projectColor: task.projectId === null ? null : (colorOf.get(task.projectId) ?? null),
          hideCompleted: snapshot.hideCompleted,
          autoEditTitle: autoEditTaskId === task.id,
          autoEditLastChild: autoEditChildOf === task.id,
          send,
          requestDelete,
          onAutoEditConsumed,
          onChildChainAdd: addChild,
        };
        return {
          id: task.id,
          type: 'task',
          position: task.position,
          data: data as never,
          // 左上の取っ手だけで動かす。本体でも動かせると、タイトルを
          // クリックして編集するつもりが動いてしまう。
          dragHandle: '.task-grip',
        };
      });

    // 非表示の Task に繋がるエッジは描かない。
    // 結果として残るエッジは「まだ実際にブロックしているもの」だけになる(FR-6)。
    const visibleEdges: Edge[] = snapshot.edges
      .filter((e) => !hidden.has(e.from) && !hidden.has(e.to))
      .map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        // 向きが依存の向きそのもの。線だけでは「どちらが先か」が伝わらない。
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      }));

    return { nodes: [...frames, ...taskNodes], edges: visibleEdges };
  }, [
    snapshot,
    send,
    requestDelete,
    addChild,
    onAutoEditConsumed,
    autoEditTaskId,
    autoEditChildOf,
  ]);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const readyCount =
    snapshot?.tasks.filter((t) => t.readiness === 'ready' && t.progress !== 'done').length ?? 0;

  return (
    <div className="app">
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            // 同じ場所に重ならないよう、少しずつずらして置く
            const n = snapshot?.tasks.length ?? 0;
            addTask({ x: 120 + (n % 6) * 40, y: 120 + (n % 6) * 70 });
          }}
        >
          + Task
        </button>
        <button type="button" onClick={() => setAskProjectName(true)}>
          + Project
        </button>

        <button type="button" disabled={!snapshot?.canUndo} onClick={() => send({ type: 'undo' })}>
          Undo
        </button>
        <button type="button" disabled={!snapshot?.canRedo} onClick={() => send({ type: 'redo' })}>
          Redo
        </button>

        <button
          type="button"
          disabled={!snapshot || snapshot.tasks.length === 0}
          onClick={() => {
            if (!snapshot) return;
            const layout = computeLayout(snapshot);
            send({ type: 'applyLayout', ...layout });
          }}
          title="依存関係にそって並べ直す。手動で置いた位置は上書きされる"
        >
          整列
        </button>

        <label>
          <input
            type="checkbox"
            checked={snapshot?.hideCompleted ?? false}
            onChange={(e) => send({ type: 'setHideCompleted', value: e.target.checked })}
          />
          完了を非表示
        </label>

        <span className="spacer" />
        <span className="muted">
          {snapshot ? `${snapshot.tasks.length} tasks / 着手できる ${readyCount}` : '読み込み中…'}
        </span>
        {error && (
          <span className="error" title={error}>
            {error}
          </span>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          onNodeDragStart={(_event, node) => {
            if (node.type !== 'projectFrame') return;
            const projectId = node.id.replace('project:', '');
            frameDrag.current = {
              nodeId: node.id,
              origin: { ...node.position },
              members: new Map(
                (snapshot?.tasks ?? [])
                  .filter((t) => t.projectId === projectId)
                  .map((t) => [t.id, { ...t.position }]),
              ),
            };
          }}
          onNodeDrag={(_event, node) => {
            const drag = frameDrag.current;
            if (!drag || node.id !== drag.nodeId) return;
            const dx = node.position.x - drag.origin.x;
            const dy = node.position.y - drag.origin.y;
            setNodes((current) =>
              current.map((n) => {
                const start = drag.members.get(n.id);
                return start ? { ...n, position: { x: start.x + dx, y: start.y + dy } } : n;
              }),
            );
          }}
          onNodeDragStop={(_event, node) => {
            frameDrag.current = null;
            // ドラッグ確定時にだけ送る。中間座標を送ると Undo 履歴が
            // ドラッグの途中経過で埋まる(design/domain-design.md §4)。
            if (node.type === 'task') {
              send({ type: 'moveTask', id: node.id, position: node.position });
            }
            if (node.type === 'projectFrame') {
              // 枠を動かすと、中に入っている Task も一緒に動く(ドメイン側で処理)
              send({
                type: 'moveProject',
                id: node.id.replace('project:', ''),
                position: node.position,
              });
            }
          }}
          onConnectStart={(_event, params) => {
            validTargets.current = null;
            if (!params.nodeId) return;
            void window.api.validTargets(params.nodeId).then((ids) => {
              validTargets.current = new Set(ids);
            });
          }}
          onConnectEnd={() => {
            validTargets.current = null;
          }}
          isValidConnection={(connection) => {
            const target = connection.target;
            if (!target) return false;
            // 問い合わせが返る前は許可しておき、確定時にドメイン層が判断する。
            if (validTargets.current === null) return true;
            return validTargets.current.has(target);
          }}
          onConnect={(connection) => {
            if (connection.source && connection.target) {
              send({ type: 'connect', from: connection.source, to: connection.target });
            }
          }}
          onEdgesDelete={(deleted) => {
            for (const edge of deleted) send({ type: 'disconnect', id: edge.id });
          }}
        >
          <Background gap={20} color="var(--grid)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {askProjectName && (
        <TextPromptDialog
          title="Project を作成"
          placeholder="Project 名"
          onCancel={() => setAskProjectName(false)}
          onSubmit={(name) => {
            setAskProjectName(false);
            // 既存の枠と重ならないよう、少しずつずらして置く
            const existing = snapshot?.projects ?? [];
            // まだ使われていない色を優先する。全部使い切っていたら先頭へ戻る。
            const used = new Set(existing.map((p) => p.colorIndex));
            let colorIndex = 0;
            for (let i = 0; i < PROJECT_COLOR_COUNT; i += 1) {
              if (!used.has(i)) {
                colorIndex = i;
                break;
              }
              colorIndex = existing.length % PROJECT_COLOR_COUNT;
            }
            const n = existing.length;
            send({
              type: 'createProject',
              name,
              position: { x: 60 + n * 40, y: 60 + n * 40 },
              width: 460,
              height: 340,
              colorIndex,
            });
          }}
        />
      )}

      {deletePlan && snapshot && (
        <DeleteDialog
          plan={deletePlan}
          snapshot={snapshot}
          onCancel={() => setDeletePlan(null)}
          onConfirm={() => {
            send({ type: 'deleteTask', id: deletePlan.taskId });
            setDeletePlan(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * 文字列を1つ受け取るダイアログ。
 *
 * Electron は window.prompt を実装していないため、自前で用意する必要がある。
 * native <dialog> を使うのは、Escape での閉じ・フォーカストラップ・背景の
 * 不活性化が標準で得られるため。
 */
function TextPromptDialog({
  title,
  placeholder,
  onCancel,
  onSubmit,
}: {
  title: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    ref.current?.showModal();
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>{title}</h2>
        <input
          className="text-input wide"
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 変換確定の Enter を送信と取り違えない
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" onClick={submit}>
            作成
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * 削除確認(FR-1)
 *
 * 再接続ルールは条件によって挙動が変わり、特に入力・出力とも複数の場合は
 * 再接続されない。何が失われるかを見せてから確定させる。
 */
function DeleteDialog({
  plan,
  snapshot,
  onCancel,
  onConfirm,
}: {
  plan: DeletePlan;
  snapshot: GraphSnapshot;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const titleOf = (id: string): string => snapshot.tasks.find((t) => t.id === id)?.title ?? id;
  const target = titleOf(plan.taskId);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>「{target}」を削除しますか？</h2>

        {plan.removedChildTaskIds.length > 0 && (
          <p>子タスク {plan.removedChildTaskIds.length} 件も一緒に削除されます。</p>
        )}

        {plan.removedEdges.length > 0 && (
          <>
            <div>なくなる依存関係:</div>
            <ul>
              {plan.removedEdges.map((e) => (
                <li key={`${e.from}->${e.to}`}>
                  {titleOf(e.from)} → {titleOf(e.to)}
                </li>
              ))}
            </ul>
          </>
        )}

        {plan.addedEdges.length > 0 ? (
          <>
            <div>つなぎ直される依存関係:</div>
            <ul>
              {plan.addedEdges.map((e) => (
                <li key={`${e.from}->${e.to}`}>
                  {titleOf(e.from)} → {titleOf(e.to)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          plan.removedEdges.length > 0 && (
            <p className="error">つなぎ直しは行われません。上の依存関係は失われます。</p>
          )
        )}

        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            削除
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function Root(): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}
