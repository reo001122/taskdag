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
import type { Command, CommandResult, DeletePlan, GraphSnapshot } from '../../shared/ipc';
import { PROJECT_COLOR_COUNT, projectColorAt } from './colors';
import { computeLayout, type NodeSize } from './layout';
import { logger } from './log';
import {
  type AutoEdit,
  ProjectFrameNode,
  type ProjectNodeData,
  TaskNode,
  type TaskNodeData,
} from './TaskNode';

const log = logger('graph');

const nodeTypes: NodeTypes = { task: TaskNode, projectFrame: ProjectFrameNode };

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null);
  const [askProjectName, setAskProjectName] = useState(false);

  /**
   * 直後に編集へ入れる相手。Task と childTask のどちらの id も入る。
   *
   * 作ってから名前を打つまでを1続きの操作にする —— 毎回、仮の名前を
   * 消してから入力させるのは、分解の勢いを削ぐ。消したときにも使う:
   * 1つ上へ戻して、手をキーボードに置いたまま続けられるようにする。
   */
  const [autoEdit, setAutoEdit] = useState<AutoEdit>(null);

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

  /**
   * コマンドを送り、結果をそのまま返す。失敗しても投げない。
   *
   * 成否まで返すのは、**成功したときにしか続けてはいけない後処理があるため**。
   * スナップショットは失敗時にも返る(現在の状態)ので、それだけを見ていると
   * 起きなかった変更を前提に画面を動かしてしまう。
   */
  const dispatch = useCallback(async (command: Command): Promise<CommandResult | null> => {
    try {
      const result = await window.api.send(command);
      setSnapshot(result.snapshot);
      setError(result.ok ? null : result.error);
      return result;
    } catch (e) {
      log.error('コマンドを送れなかった', { command, cause: e });
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
      log.error('グラフを読めなかった', e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Task を作り、そのまま名前の入力に入る。
   *
   * 作った id は main が返す。ここでスナップショットの差分から割り出すと、
   * 作成が2件同時に飛んだときに1つ前を掴む(shared/ipc.ts の createdId)。
   */
  const addTask = useCallback(
    (position: { x: number; y: number }) => {
      void (async () => {
        const result = await dispatch({ type: 'createTask', title: '新しいタスク', position });
        log.debug('Task を作った', { id: result?.ok ? result.createdId : null });
        if (result?.ok && result.createdId !== null) {
          setAutoEdit({ id: result.createdId, caret: 'all' });
        }
      })();
    },
    [dispatch],
  );

  /** childTask を1件足し、そのまま名前の入力に入る。Shift+Enter で連続して足せる。 */
  const addChild = useCallback(
    (parentId: string) => {
      void (async () => {
        const result = await dispatch({ type: 'createChildTask', parentId, title: '項目' });
        log.debug('childTask を作った', { id: result?.ok ? result.createdId : null });
        if (result?.ok && result.createdId !== null) {
          setAutoEdit({ id: result.createdId, caret: 'all' });
        }
      })();
    },
    [dispatch],
  );

  /**
   * 編集中の childTask を消し、1つ上の名前へ戻る(FR-2)。
   *
   * 上がなければフォーカスは移さない。親の Task 名へ送ると、次の項目の名前を
   * Task 名に打ち込んでしまう事故が起きる —— 見た目がほとんど同じ入力欄で、
   * 意味だけが違うため。
   *
   * **戻り先は、削除が成功したうえで、削除後もまだ在ることを確かめてから決める。**
   * 戻り先を選ぶのは削除前のグラフだが、その間に別の操作(将来は AI からのものも)が
   * 割り込めば、選んだ相手はもう別の位置にいるか、消えている。分からないときは
   * 動かさないほうがよい —— 違う項目にフォーカスすると、次の1打がそこへ入る。
   */
  const removeChildWhileEditing = useCallback(
    (childId: string) => {
      void (async () => {
        const parent = snapshot?.tasks.find((t) => t.childTaskIds.includes(childId));
        const siblings = parent?.childTaskIds ?? [];
        const previous = siblings[siblings.indexOf(childId) - 1] ?? null;

        const result = await dispatch({ type: 'deleteChildTask', id: childId });
        if (!result?.ok) {
          log.warn('childTask を消せなかった', { childId });
          return;
        }

        const stillThere =
          previous !== null && result.snapshot.childTasks.some((c) => c.id === previous);
        log.debug('空の childTask を消した', { childId, backTo: stillThere ? previous : null });
        setAutoEdit(stillThere ? { id: previous, caret: 'end' } : null);
      })();
    },
    [dispatch, snapshot],
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
    setAutoEdit(null);
  }, []);

  /**
   * 描かれている Task の実寸(FR-6 の整列で使う)。
   *
   * **決め打ちの見積もりでは足りない。** 子タスクやメモで背が伸びるため、
   * 固定値で枠を張ると中身がはみ出し、所属(位置から導かれる)が壊れる。
   * offsetWidth / offsetHeight はキャンバスの拡大縮小の影響を受けないので、
   * そのままレイアウトの座標系で使える。
   */
  const measureTasks = useCallback((): Map<string, NodeSize> => {
    const sizes = new Map<string, NodeSize>();
    for (const el of document.querySelectorAll<HTMLElement>('.react-flow__node-task[data-id]')) {
      const id = el.dataset.id;
      if (id) sizes.set(id, { width: el.offsetWidth, height: el.offsetHeight });
    }
    return sizes;
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
        // dragHandle は指定しない。枠の内側のどこを掴んでも動く。
        // 中の Task は手前(zIndex 0)にいるので、今までどおり個別に掴める。
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
          autoEdit,
          send,
          requestDelete,
          onAutoEditConsumed,
          onChildChainAdd: addChild,
          onChildRemoveWhileEditing: removeChildWhileEditing,
        };
        return {
          id: task.id,
          type: 'task',
          position: task.position,
          data: data as never,
          // dragHandle は指定しない。本体のどこを掴んでも動く。
          // 名前・メモ・各ボタンには nodrag が付いているので、
          // そこをクリックしても移動にはならない。
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
    removeChildWhileEditing,
    onAutoEditConsumed,
    autoEdit,
  ]);

  /*
    作り直したノードを、既にあるものへ**重ねる**。丸ごと差し替えない。

    React Flow はノードを差し替えられると、そのノードの measured(測った寸法)を
    受け取り直す。こちらが作る側は寸法を知らないので undefined になり、
    測り直しが終わるまでの1フレーム、**そのノードは visibility: hidden にされる。**
    グラフが変わるたびに画面がちらつく原因がこれだった(実測: 削除時に 333H222…)。
    端点の寸法が無い間はエッジも描かれないので、矢印も同じ1フレーム消える。

    重ねれば measured がそのまま残る。React Flow が持たせている選択状態も
    巻き添えで消えなくなる。
  */
  useEffect(() => {
    setNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return built.nodes.map((node) => {
        const before = existing.get(node.id);
        return before ? { ...before, ...node } : node;
      });
    });
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
            const layout = computeLayout(snapshot, measureTasks());
            log.debug('整列した', { tasks: layout.positions.length });
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
          /*
            選択したノードを前面に上げない。既定では選択が z を跳ね上げるため、
            Project の枠を選ぶと枠が Task の上に出てきて、中の Task に
            触れなくなる。枠は常に Task の背面(zIndex: -1)にいるべきもの。
          */
          elevateNodesOnSelect={false}
          /*
            2本指スクロールは拡大縮小ではなく移動に割り当てる。

            枠の内側がドラッグで移動できるようになったぶん、ドラッグでパンできる
            余白が減った。地図や図を扱う道具では、スクロール=移動・ピンチ=拡大が
            広く使われている慣習でもある。拡大縮小はピンチと Cmd+スクロールに残る。
          */
          zoomOnScroll={false}
          panOnScroll
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
