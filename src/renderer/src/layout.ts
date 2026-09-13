import type { GraphSnapshot, Position } from '../../shared/ipc';

/**
 * 「整列」操作の座標計算(FR-6)
 *
 * レイアウトは正しさの問題ではなく見た目の問題であり、ドメインロジックではない
 * (design/domain-design.md §7)。ここで座標を算出し、applyLayout で送る。
 *
 * 組み立ての順序:
 *
 *   1. 依存の深さで列を決める。列の x は全体で共通にする ——
 *      Project をまたいでも、依存が左から右へ読める並びになる。
 *   2. Project ごとにグループを組み、その中で列に沿って縦へ積む。
 *   3. グループを縦に重ねずに並べ、外接矩形へ余白を足したものを枠にする。
 *
 * 寸法は呼び出し側が実測して渡す。 以前は 240×60 の決め打ちで見積もって
 * いたため、子タスクやメモで背が伸びた Task が枠からはみ出し、下の帯の枠と
 * 重なっていた。所属は位置から導かれる(FR-4)ので、はみ出しはそのまま
 * 所属の消失につながる。
 */

/** 列と列の間隔。ノードの幅は含まない(列ごとに実測した最大幅を使う)。 */
const COLUMN_GAP = 90;
/** 同じ列で縦に積むときの間隔。 */
const ROW_GAP = 40;
const ORIGIN: Position = { x: 80, y: 80 };
/** 枠と、中の Task との余白。左上の丸点や接続点がはみ出すぶんも見込む。 */
const FRAME_PADDING = 36;
/** グループ(枠)どうしの間隔。 */
const GROUP_GAP = 72;
/** 実測が取れなかったときの当て。描画前に整列された場合の保険。 */
const FALLBACK_SIZE: NodeSize = { width: 240, height: 60 };
/** 所属する Task がない枠の大きさ。 */
const EMPTY_FRAME = { width: 300, height: 160 };

export type NodeSize = { width: number; height: number };

export type LayoutResult = {
  positions: { id: string; position: Position }[];
  projects: { id: string; position: Position; width: number; height: number }[];
};

/** 先行を辿ったときの最大の深さ。これが列になる。 */
function computeDepths(snapshot: GraphSnapshot): Map<string, number> {
  const predecessors = new Map<string, string[]>();
  for (const task of snapshot.tasks) predecessors.set(task.id, []);
  for (const edge of snapshot.edges) {
    predecessors.get(edge.to)?.push(edge.from);
  }

  const depth = new Map<string, number>();
  const resolving = new Set<string>();

  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;

    // 循環はドメイン層と load 時の検証で防いでいるが、表示側が無限再帰で
    // 落ちないよう保険をかける。
    if (resolving.has(id)) return 0;
    resolving.add(id);

    const preds = predecessors.get(id) ?? [];
    const value = preds.length === 0 ? 0 : Math.max(...preds.map(depthOf)) + 1;

    resolving.delete(id);
    depth.set(id, value);
    return value;
  };

  for (const task of snapshot.tasks) depthOf(task.id);
  return depth;
}

/** 列ごとの x。実測した最大幅で決めるので、幅の広い Task があっても隣と重ならない。 */
function columnPositions(
  snapshot: GraphSnapshot,
  depth: ReadonlyMap<string, number>,
  sizeOf: (id: string) => NodeSize,
): Map<number, number> {
  const widest = new Map<number, number>();
  for (const task of snapshot.tasks) {
    const column = depth.get(task.id) ?? 0;
    widest.set(column, Math.max(widest.get(column) ?? 0, sizeOf(task.id).width));
  }

  const x = new Map<number, number>();
  let cursor = ORIGIN.x;
  for (const column of [...widest.keys()].sort((a, b) => a - b)) {
    x.set(column, cursor);
    cursor += (widest.get(column) ?? 0) + COLUMN_GAP;
  }
  return x;
}

export function computeLayout(
  snapshot: GraphSnapshot,
  sizes: ReadonlyMap<string, NodeSize>,
): LayoutResult {
  const sizeOf = (id: string): NodeSize => sizes.get(id) ?? FALLBACK_SIZE;
  const depth = computeDepths(snapshot);
  const columnX = columnPositions(snapshot, depth, sizeOf);

  // Project ごとにまとめる。所属なしは最後のグループへ(枠は持たない)。
  const groups: { projectId: string | null; taskIds: string[] }[] = [
    ...snapshot.projects.map((project) => ({
      projectId: project.id as string | null,
      taskIds: snapshot.tasks.filter((t) => t.projectId === project.id).map((t) => t.id),
    })),
    {
      projectId: null,
      taskIds: snapshot.tasks.filter((t) => t.projectId === null).map((t) => t.id),
    },
  ];

  const positions: { id: string; position: Position }[] = [];
  const frames: LayoutResult['projects'] = [];

  let top = ORIGIN.y;
  for (const group of groups) {
    if (group.taskIds.length === 0) continue;

    const byColumn = new Map<number, string[]>();
    for (const id of group.taskIds) {
      const column = depth.get(id) ?? 0;
      byColumn.set(column, [...(byColumn.get(column) ?? []), id]);
    }

    let bottom = top;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;

    for (const [column, ids] of byColumn) {
      const x = columnX.get(column) ?? ORIGIN.x;
      let y = top;
      for (const id of [...ids].sort()) {
        positions.push({ id, position: { x, y } });
        const size = sizeOf(id);
        left = Math.min(left, x);
        right = Math.max(right, x + size.width);
        y += size.height + ROW_GAP;
        bottom = Math.max(bottom, y - ROW_GAP);
      }
    }

    if (group.projectId !== null) {
      frames.push({
        id: group.projectId,
        position: { x: left - FRAME_PADDING, y: top - FRAME_PADDING },
        width: right - left + FRAME_PADDING * 2,
        height: bottom - top + FRAME_PADDING * 2,
      });
    }

    // 枠は上下に余白のぶんはみ出す。次のグループはそのぶんも空けて置く。
    top = bottom + FRAME_PADDING * 2 + GROUP_GAP;
  }

  /*
    所属する Task がない枠は、最後尾の空き地へ縦に並べて退ける。
    他のグループに重ねると、そこにある Task を意図せず取り込んでしまう。
  */
  const placed = new Set(frames.map((f) => f.id));
  for (const project of snapshot.projects) {
    if (placed.has(project.id)) continue;
    frames.push({
      id: project.id,
      position: { x: ORIGIN.x - FRAME_PADDING, y: top },
      ...EMPTY_FRAME,
    });
    top += EMPTY_FRAME.height + GROUP_GAP;
  }

  // 元の並び(snapshot.projects の順)へ戻して返す
  const order = new Map(snapshot.projects.map((p, index) => [p.id, index]));
  frames.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { positions, projects: frames };
}
