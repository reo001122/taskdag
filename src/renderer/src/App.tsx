import {
  Background,
  Controls,
  type Edge,
  type EdgeTypes,
  MarkerType,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Rect, rectIntersection, rectsOverlap } from '../../shared/geometry';
import type { Command, CommandResult, DeletePlan, GraphSnapshot } from '../../shared/ipc';
import { clearDropFeedback, type DropPoint, findDropPoint, showDropFeedback } from './childDrag';
import { PROJECT_COLOR_COUNT, projectColorAt } from './colors';
import { DependencyEdge, type DependencyEdgeData } from './DependencyEdge';
import { computeLayout, findFreeProjectSlot, NEW_PROJECT_SIZE, type NodeSize } from './layout';
import { logger } from './log';
import { clearOverlapMarks, showOverlapMarks } from './overlapMark';
import {
  type AutoEdit,
  ProjectFrameNode,
  type ProjectNodeData,
  TaskNode,
  type TaskNodeData,
} from './TaskNode';

const log = logger('graph');

const edgeTypes: EdgeTypes = { dependency: DependencyEdge };

const nodeTypes: NodeTypes = { task: TaskNode, projectFrame: ProjectFrameNode };

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
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
  /** Task を別の Task へ運んでいる間、入る先を控える(W-3)。 */
  const nestTarget = useRef<DropPoint | null>(null);

  const frameDrag = useRef<{
    nodeId: string;
    origin: { x: number; y: number };
    size: { width: number; height: number };
    /** 今の位置では置けない。離したときに戻すかどうかの判断に使う(FR-4)。 */
    blocked: boolean;
    members: Map<string, { x: number; y: number }>;
  } | null>(null);

  /**
   * 自分以外の枠の矩形(FR-4)。
   *
   * 枠どうしは重ねられない。ドメイン側でも弾くが、それだけだと離した瞬間に
   * 戻るだけで理由が見えない。動かしている間に示すため、表示側でも同じ式を見る
   * (判定そのものは shared/geometry.ts に1つだけ置いてある)。
   */
  const otherFrames = useCallback(
    (projectId: string): Rect[] =>
      (snapshot?.projects ?? [])
        .filter((p) => p.id !== projectId)
        .map((p) => ({ x: p.position.x, y: p.position.y, width: p.width, height: p.height })),
    [snapshot],
  );

  const wouldOverlap = useCallback(
    (projectId: string, rect: Rect) =>
      otherFrames(projectId).some((other) => rectsOverlap(rect, other)),
    [otherFrames],
  );

  /**
   * 置けないことを示す(FR-4)。
   *
   * 枠には形だけの印を付け(破線を実線にする)、重なっている領域には斜線を引く。
   * 色で示さないのは、7色どの Project でも読める必要があるため。
   *
   * 斜線は画面座標で描く。判定はキャンバス座標で行うので、そのまま変換して渡す。
   * 別々に計算すると、弾く範囲と示す範囲がずれる。
   */
  const markFrameBlocked = useCallback(
    (nodeId: string, rect: Rect | null) => {
      const projectId = nodeId.replace('project:', '');
      const overlaps =
        rect === null
          ? []
          : otherFrames(projectId)
              .map((other) => rectIntersection(rect, other))
              .filter((r): r is Rect => r !== null);

      showOverlapMarks(
        overlaps.map((r) => {
          const topLeft = flowToScreenPosition({ x: r.x, y: r.y });
          const bottomRight = flowToScreenPosition({ x: r.x + r.width, y: r.y + r.height });
          return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
          };
        }),
      );

      const blocked = overlaps.length > 0;
      setNodes((current) =>
        current.map((n) =>
          n.id === nodeId ? { ...n, className: blocked ? 'is-blocked' : undefined } : n,
        ),
      );
    },
    [setNodes, otherFrames, flowToScreenPosition],
  );

  /**
   * 枠の寸法をスナップショットの値へ戻す(FR-4)。
   *
   * React Flow は大きさを変えると width / height をノードへ書き込み、以降は
   * style より優先して読む。送らずに戻すときは、そこを落として style を
   * 読ませ直さないと、画面だけが変形したまま残る。
   */
  const restoreFrameSize = useCallback(
    (projectId: string) => {
      const project = snapshot?.projects.find((p) => p.id === projectId);
      if (!project) return;
      setNodes((current) =>
        current.map((n) =>
          n.id === `project:${projectId}`
            ? {
                ...n,
                position: { ...project.position },
                width: undefined,
                height: undefined,
                style: { width: project.width, height: project.height },
              }
            : n,
        ),
      );
    },
    [snapshot, setNodes],
  );

  /**
   * コマンドを送り、結果をそのまま返す。失敗しても投げない。
   *
   * 成否まで返すのは、成功したときにしか続けてはいけない後処理があるため。
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

  /**
   * childTask が離された(W-3)。
   *
   * 別の Task の上なら、その下へ移す。余白なら独立した Task にして、落とした
   * 場所に置く —— 所属する Project もそこから導かれる(FR-4)。元の親の上で
   * 離したときは何もしない。
   */
  /**
   * 「どの行の手前か」を、ドメインが扱う並びの位置に直す(W-3)。
   *
   * 完了を非表示にしている間、画面に出ている行とドメイン側の並びは食い違う。
   * 画面から数えた数をそのまま渡すと、隠れている行のぶんだけずれる。
   */
  const indexOfDrop = useCallback(
    (to: DropPoint): number => {
      const parent = snapshot?.tasks.find((t) => t.id === to.taskId);
      if (!parent) return 0;
      if (to.beforeChildId === null) return parent.childTaskIds.length;
      const at = parent.childTaskIds.indexOf(to.beforeChildId);
      return at < 0 ? parent.childTaskIds.length : at;
    },
    [snapshot],
  );

  const onChildDropped = useCallback(
    (childId: string, at: { x: number; y: number }, to: DropPoint | null) => {
      if (to !== null) {
        send({
          type: 'moveChildTask',
          id: childId,
          newParentId: to.taskId,
          index: indexOfDrop(to),
        });
        return;
      }
      send({ type: 'promoteChildTask', id: childId, position: screenToFlowPosition(at) });
    },
    [send, indexOfDrop, screenToFlowPosition],
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

  /**
   * Task を1件足す。ツールバーのボタンと Cmd+N の両方から呼ぶ(FR-1)。
   *
   * 置き場所は少しずつずらす。同じ座標に重ねると、作ったものが前のものの
   * 真下に隠れて、増えたことが見えない。
   */
  const addTaskHere = useCallback(() => {
    const n = snapshot?.tasks.length ?? 0;
    addTask({ x: 120 + (n % 6) * 40, y: 120 + (n % 6) * 70 });
  }, [addTask, snapshot]);

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
   * 戻り先は、削除が成功したうえで、削除後もまだ在ることを確かめてから決める。
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
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();

      if (key === 'z') {
        e.preventDefault();
        send({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }

      /*
        Cmd+N で Task を1件足す(FR-1)。

        名前や メモ を打っている間は届かない —— 入力欄が keydown を止めている。
        打っている途中で新しい Task に移るのは、書きかけを置き去りにする操作なので、
        そこは Enter で確定してからにする。
      */
      if (key === 'n') {
        e.preventDefault();
        addTaskHere();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send, addTaskHere]);

  const requestDelete = useCallback(
    (id: string) => {
      void (async () => {
        const plan = await window.api.planDelete(id);
        // 立てられなければ(Task が既に無いなど)何もしない。
        if (!plan) return;
        /*
          見せるものが無ければ、そのまま消す(FR-1)。

          確認の目的は「何が消えて何が繋ぎ直されるか」を見せることなので、
          依存も childTask も持たない Task では、空の一覧を出して「本当に
          消しますか」と聞くだけになる。手数だけが増える。
          消しすぎたら Undo で戻る(FR-8)。
        */
        const nothingToShow =
          plan.removedEdges.length === 0 &&
          plan.addedEdges.length === 0 &&
          plan.removedChildTaskIds.length === 0;
        if (nothingToShow) {
          send({ type: 'deleteTask', id });
          return;
        }
        setDeletePlan(plan);
      })();
    },
    [send],
  );

  const onAutoEditConsumed = useCallback(() => {
    setAutoEdit(null);
  }, []);

  /** 依存を1本外す(FR-3)。線の上の × から呼ばれる。 */
  const removeEdge = useCallback(
    (id: string) => {
      send({ type: 'disconnect', id });
    },
    [send],
  );

  /**
   * 描かれている Task の実寸(FR-6 の整列で使う)。
   *
   * 決め打ちの見積もりでは足りない。 子タスクやメモで背が伸びるため、
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
        onResizing: (id: string, rect: Rect) => markFrameBlocked(`project:${id}`, rect),
        onResizeEnd: (id, position, width, height) => {
          markFrameBlocked(`project:${id}`, null);
          // 相手に届く大きさで離したら、送らずに元の寸法へ戻す(FR-4)。
          if (wouldOverlap(id, { ...position, width, height })) {
            restoreFrameSize(id);
            return;
          }
          send({ type: 'resizeProject', id, position, width, height });
        },
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
          onChildDropped,
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
          // 取っ手からだけ動かす(FR-6)。本体のどこでも掴めると、childTask の
          // 取っ手との違いが読めず、掴めるかどうかが場所ごとに変わる。
          dragHandle: '.task-grip',
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
      .map((e) => {
        const data: DependencyEdgeData = { onRemove: removeEdge };
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'dependency',
          data: data as never,
          // 向きが依存の向きそのもの。線だけでは「どちらが先か」が伝わらない。
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        };
      });

    return { nodes: [...frames, ...taskNodes], edges: visibleEdges };
  }, [
    snapshot,
    send,
    requestDelete,
    addChild,
    removeChildWhileEditing,
    removeEdge,
    onAutoEditConsumed,
    autoEdit,
    markFrameBlocked,
    wouldOverlap,
    restoreFrameSize,
    onChildDropped,
  ]);

  /*
    作り直したノードを、既にあるものへ重ねる。丸ごと差し替えない。

    React Flow はノードを差し替えられると、そのノードの measured(測った寸法)を
    受け取り直す。こちらが作る側は寸法を知らないので undefined になり、
    測り直しが終わるまでの1フレーム、そのノードは visibility: hidden にされる。
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
        if (!before) return node;
        /*
          大きさだけは引き継がない。

          枠の大きさを変えると React Flow はノードに width / height を書き込み、
          以降そちらを style より優先して読む。重ねるときにそれを残すと、
          Undo でスナップショットが前の大きさへ戻っても、画面は変形後のまま
          になる(実測: 460×340 → 400×295 にしてから Cmd+Z しても 400×295)。
          幾何はこちらが持っている値が正なので、毎回 style から読ませる。
        */
        return { ...before, ...node, width: undefined, height: undefined };
      });
    });
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const readyCount =
    snapshot?.tasks.filter((t) => t.readiness === 'ready' && t.progress !== 'done').length ?? 0;

  return (
    <div className="app">
      <div className="toolbar">
        <button type="button" onClick={addTaskHere}>
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
          edgeTypes={edgeTypes}
          /*
            Delete / Backspace による削除を無効にする。

            React Flow の既定では、選んだノードやエッジをこのキーで消せる。
            **Task がそれで消えると、削除前に何が起きるかを見せる約束(FR-1)を
            迂回する。** 実際には Task 自体は消えず(こちらがコマンドを送らないため
            次のスナップショットで戻る)、繋がっていた依存だけが黙って消えていた。

            Task は × から(確認つき)、依存は線の上の × から、childTask は名前を
            空にした Backspace から。どれも対象がはっきりしている経路にまとめる。
          */
          deleteKeyCode={null}
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
          /*
            掴んでの平行移動は行わない。スクロールに一本化する。

            枠の内側がドラッグで動くようになった時点で、掴んで動かせる場所は
            「どこにも属さない余白」だけになっていた。**残しておくと、掴んだ先が
            余白か枠かで結果が変わる**ことになり、狙いを外したときに何が起きるかが
            読めない。移動はスクロール、と決め切るほうが手が迷わない。
          */
          panOnDrag={false}
          onNodeDragStart={(_event, node) => {
            if (node.type !== 'projectFrame') return;
            const projectId = node.id.replace('project:', '');
            const project = snapshot?.projects.find((p) => p.id === projectId);
            frameDrag.current = {
              nodeId: node.id,
              origin: { ...node.position },
              size: { width: project?.width ?? 0, height: project?.height ?? 0 },
              blocked: false,
              members: new Map(
                (snapshot?.tasks ?? [])
                  .filter((t) => t.projectId === projectId)
                  .map((t) => [t.id, { ...t.position }]),
              ),
            };
          }}
          onNodeDrag={(event, node) => {
            if (node.type === 'task') {
              /*
                見出しの帯の上に来たときだけ、受け取る相手として光らせる(W-3)。
                重なっただけで子になると、事故で入れ子になる。
              */
              // React Flow はタッチのイベントも渡してくる。座標の取り口が違う。
              const point = 'clientX' in event ? event : event.touches[0];
              if (!point) return;
              const onto = findDropPoint(point.clientX, point.clientY, {
                except: node.id,
                onlyHead: true,
              });
              nestTarget.current = onto;
              showDropFeedback(onto);
              return;
            }
            const drag = frameDrag.current;
            if (!drag || node.id !== drag.nodeId) return;
            const dx = node.position.x - drag.origin.x;
            const dy = node.position.y - drag.origin.y;
            const projectId = node.id.replace('project:', '');
            const rect = {
              x: node.position.x,
              y: node.position.y,
              width: drag.size.width,
              height: drag.size.height,
            };
            drag.blocked = wouldOverlap(projectId, rect);
            markFrameBlocked(node.id, rect);
            setNodes((current) =>
              current.map((n) => {
                const start = drag.members.get(n.id);
                return start ? { ...n, position: { x: start.x + dx, y: start.y + dy } } : n;
              }),
            );
          }}
          onNodeDragStop={(_event, node) => {
            const drag = frameDrag.current;
            frameDrag.current = null;
            // ドラッグ確定時にだけ送る。中間座標を送ると Undo 履歴が
            // ドラッグの途中経過で埋まる(design/domain-design.md §4)。
            if (node.type === 'task') {
              const onto = nestTarget.current;
              nestTarget.current = null;
              clearDropFeedback();
              if (onto !== null) {
                // 相手の下へ入れる。依存は相手へ付け替わる(W-3)。
                send({
                  type: 'demoteTaskToChild',
                  id: node.id,
                  newParentId: onto.taskId,
                  index: indexOfDrop(onto),
                });
                return;
              }
              send({ type: 'moveTask', id: node.id, position: node.position });
            }
            if (node.type === 'projectFrame') {
              /*
                置けない場所で離したら、送らずにその場で元へ戻す(FR-4)。

                送って弾かれるのに任せると、返ってきたスナップショットで
                位置は戻るが、失敗の文言が画面に出る。置けない場所へ運んだのは
                操作のうちであって、報告すべき失敗ではない。
              */
              clearOverlapMarks();
              if (drag?.blocked) {
                setNodes((current) =>
                  current.map((n) => {
                    if (n.id === node.id) {
                      return { ...n, position: { ...drag.origin }, className: undefined };
                    }
                    const start = drag.members.get(n.id);
                    return start ? { ...n, position: { ...start } } : n;
                  }),
                );
                return;
              }
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
            // 枠どうしは重ねられない(FR-4)ので、空いている場所を探して置く。
            send({
              type: 'createProject',
              name,
              position: findFreeProjectSlot(
                existing.map((p) => ({
                  x: p.position.x,
                  y: p.position.y,
                  width: p.width,
                  height: p.height,
                })),
              ),
              ...NEW_PROJECT_SIZE,
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
          onConfirm={(keepReconnections) => {
            send({ type: 'deleteTask', id: deletePlan.taskId, keepReconnections });
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
  onConfirm: (keepReconnections: { from: string; to: string }[]) => void;
}): React.JSX.Element {
  const titleOf = (id: string): string => snapshot.tasks.find((t) => t.id === id)?.title ?? id;
  const target = titleOf(plan.taskId);
  const ref = useRef<HTMLDialogElement>(null);

  /*
    繋ぎ直しは、外したいものを外せるようにする(FR-1)。

    FR-3 の規則は「繋がっていた相手どうしを繋ぐ」であって、**それがいつも
    利用者の意図と一致するとは限らない。** 既定は全て繋ぐ —— 規則どおりの
    結果を、確認の場で削るだけにする。
  */
  const key = (edge: { from: string; to: string }): string => `${edge.from}->${edge.to}`;
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (edge: { from: string; to: string }): void =>
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key(edge))) next.delete(key(edge));
      else next.add(key(edge));
      return next;
    });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div>
        <h2>
          「<span className="doomed">{target}</span>」を削除しますか？
        </h2>

        {plan.removedChildTaskIds.length > 0 && (
          <p className="dialog-lead">
            子タスク {plan.removedChildTaskIds.length} 件も一緒に削除されます。
          </p>
        )}

        {/*
          なくなるものと、代わりにできるものを、色で見分けられるようにする。
          再接続の規則は条件で変わる(FR-3)ので、読み比べる場面が必ず来る。
        */}
        {plan.removedEdges.length > 0 && (
          <section className="dialog-section">
            <h3 className="dialog-label">なくなる依存関係</h3>
            <ul className="edge-list is-removed">
              {plan.removedEdges.map((e) => (
                <li key={`${e.from}->${e.to}`}>
                  {/* 消える当人を赤くする。どちら側が居なくなるのかが一目で分かる。 */}
                  <span className={e.from === plan.taskId ? 'doomed' : undefined}>
                    {titleOf(e.from)}
                  </span>
                  <span className="arrow">→</span>
                  <span className={e.to === plan.taskId ? 'doomed' : undefined}>
                    {titleOf(e.to)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.addedEdges.length > 0 ? (
          <section className="dialog-section">
            <h3 className="dialog-label">つなぎ直される依存関係</h3>
            <ul className="edge-list is-added">
              {plan.addedEdges.map((e) => (
                <li key={key(e)} className={dropped.has(key(e)) ? 'is-dropped' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      className="edge-check"
                      checked={!dropped.has(key(e))}
                      onChange={() => toggle(e)}
                    />
                    <span className="edge-box" aria-hidden="true" />
                    <span>{titleOf(e.from)}</span>
                    <span className="arrow">→</span>
                    <span>{titleOf(e.to)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="dialog-hint">外したものは繋ぎ直されません。</p>
          </section>
        ) : (
          plan.removedEdges.length > 0 && (
            <p className="dialog-warning">つなぎ直しは行われません。上の依存関係は失われます。</p>
          )
        )}

        <div className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onConfirm(plan.addedEdges.filter((e) => !dropped.has(key(e))))}
          >
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
