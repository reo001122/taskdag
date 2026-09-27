import { type Rect, rectsOverlap } from '../../shared/geometry';
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

/**
 * 新しい Task の見積もりの大きさ。
 *
 * 実際の幅は名前の長さで、高さは childTask とメモで変わる。空き場所を探す時点
 * ではまだ描かれていないので測れない。最大幅(styles.css の max-width)と、
 * 1行の Task の高さに余裕を見た値を使う。
 */
export const NEW_TASK_SIZE: NodeSize = { width: 280, height: 72 };

/**
 * 空き場所を探すときの桝の間隔。
 *
 * 見積もりより狭くしてある。桝が触れ合っていても、置いてよいかは実測した矩形で
 * 判定するので重なりはしない。広く取ると、拡大しているときに見えている範囲へ
 * 2列目が入らず、すぐ画面の外へ送ることになる。
 */
const SLOT_STEP = { x: 260, y: 100 };

/**
 * 新しい Task を置ける場所を探す(FR-1)。
 *
 * かつては作った順に少しずつずらして置いていた(カスケード)。重なった Task の
 * 行は上のカードに覆われ、そこを押すと別の Task を押したことになる ——
 * 印とフォーカスを行ごとに持つようにしたことで、これが実害として出た。
 * 名前を編集するとカードが広がるため、何が何を覆うかは操作のたびに変わる。
 *
 * 探すのは**今見えている範囲の中**。キャンバス全体の左上から探すと、拡大して
 * いるときや別の場所を見ているときに、作ったものが画面の外に出る。見えている
 * 範囲を格子に切って、どの Task にも重ならない最初の桝を返す。
 *
 * 既にある Task の寸法は呼び出し側が実測して渡す —— childTask やメモで背が
 * 伸びた Task を1行分と見積もると、その下に重ねてしまう。
 */
export function findFreeTaskSlot(existing: readonly Rect[], area: Rect): Position {
  const columns = Math.max(1, Math.floor(area.width / SLOT_STEP.x));
  const rows = Math.max(1, Math.floor(area.height / SLOT_STEP.y));

  for (let n = 0; n < columns * rows; n += 1) {
    const candidate: Rect = {
      x: area.x + (n % columns) * SLOT_STEP.x,
      y: area.y + Math.floor(n / columns) * SLOT_STEP.y,
      ...NEW_TASK_SIZE,
    };
    if (!existing.some((rect) => rectsOverlap(candidate, rect))) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  /*
    見えている範囲が埋まっている。一番下の Task の下に置く。

    画面の外になるが、重ねるよりはよい —— 重なると下のカードの行に触れなく
    なる。「全体を表示」で戻せる(FR-6)。
  */
  const bottom = existing.reduce((lowest, rect) => Math.max(lowest, rect.y + rect.height), area.y);
  return { x: area.x, y: bottom + ROW_GAP };
}

/** 新しい Project の枠の大きさ。 */
export const NEW_PROJECT_SIZE = { width: 460, height: 340 };

/**
 * 新しい枠を置ける場所を探す(FR-4)。
 *
 * 枠どうしは重ねられないので、空いている場所を選ばないと作成そのものが弾かれる。
 * 左上から格子状に、行方向へ順に見ていき、どの枠にも重ならない最初の桝を返す。
 * 3列で折り返すのは、横へ一直線に伸びて画面の外へ出ていくのを避けるため。
 */
export function findFreeProjectSlot(existing: readonly Rect[]): Position {
  const stepX = NEW_PROJECT_SIZE.width + GROUP_GAP;
  const stepY = NEW_PROJECT_SIZE.height + GROUP_GAP;
  const columns = 3;

  for (let n = 0; n < 200; n += 1) {
    const candidate: Rect = {
      x: ORIGIN.x + (n % columns) * stepX,
      y: ORIGIN.y + Math.floor(n / columns) * stepY,
      ...NEW_PROJECT_SIZE,
    };
    if (!existing.some((rect) => rectsOverlap(candidate, rect))) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  // 200 桝すべて埋まっている。最後の桝の下に置く(そこも重なるなら作成が弾かれる)。
  return { x: ORIGIN.x, y: ORIGIN.y + Math.ceil(200 / columns) * stepY };
}
