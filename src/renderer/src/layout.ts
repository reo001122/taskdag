import type { GraphSnapshot, Position } from '../../shared/ipc';

/**
 * 「整列」操作の座標計算(FR-6)
 *
 * レイアウトは正しさの問題ではなく見た目の問題であり、ドメインロジックではない
 * (design/domain-design.md §7)。ここで座標を算出し、applyLayout で送る。
 *
 * 依存の深さで横の段を決め、**Project ごとに縦の帯へ分ける**。
 * 深さだけで並べると同じ Project の Task が縦に散らばり、それを囲む枠が
 * 巨大化して他の Task まで飲み込んでしまう。所属は位置から導出されるため、
 * レイアウトが所属を壊さないことは必須の条件になる。
 */

const COLUMN_GAP = 320;
const ROW_GAP = 190;
const ORIGIN: Position = { x: 80, y: 80 };
const FRAME_PADDING = 36;
/** 帯の間隔。枠どうしが接触しないよう、余白の2倍より広く取る。 */
const BAND_GAP = FRAME_PADDING * 3;
/** 枠を描くためのおおよそのノード寸法。実測ではなく見た目の当たり。 */
const NODE_WIDTH = 240;
const NODE_HEIGHT = 60;

export type LayoutResult = {
  positions: { id: string; position: Position }[];
  projects: { id: string; position: Position; width: number; height: number }[];
};

/** 先行を辿ったときの最大の深さ。これが横の段になる。 */
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

export function computeLayout(snapshot: GraphSnapshot): LayoutResult {
  const depth = computeDepths(snapshot);

  // Project ごとにまとめる。所属なしは最後の帯へ。
  const bands: { projectId: string | null; taskIds: string[] }[] = snapshot.projects.map((p) => ({
    projectId: p.id,
    taskIds: snapshot.tasks.filter((t) => t.projectId === p.id).map((t) => t.id),
  }));
  bands.push({
    projectId: null,
    taskIds: snapshot.tasks.filter((t) => t.projectId === null).map((t) => t.id),
  });

  const positions: { id: string; position: Position }[] = [];
  const bandBounds = new Map<string, { minY: number; maxY: number }>();

  let bandTop = ORIGIN.y;
  for (const band of bands) {
    if (band.taskIds.length === 0) continue;

    // 帯の中で、深さごとに縦に積む
    const columns = new Map<number, string[]>();
    for (const id of band.taskIds) {
      const column = depth.get(id) ?? 0;
      const list = columns.get(column) ?? [];
      list.push(id);
      columns.set(column, list);
    }

    let rowsUsed = 0;
    for (const [column, ids] of columns) {
      [...ids].sort().forEach((id, row) => {
        positions.push({
          id,
          position: { x: ORIGIN.x + column * COLUMN_GAP, y: bandTop + row * ROW_GAP },
        });
      });
      rowsUsed = Math.max(rowsUsed, ids.length);
    }

    if (band.projectId !== null) {
      bandBounds.set(band.projectId, {
        minY: bandTop,
        maxY: bandTop + (rowsUsed - 1) * ROW_GAP + NODE_HEIGHT,
      });
    }

    bandTop += rowsUsed * ROW_GAP + BAND_GAP;
  }

  return { positions, projects: frames(snapshot, positions, bandBounds, bandTop) };
}

/**
 * 整列後の位置に合わせて枠を張り直す。
 *
 * Task だけ動かすと枠から外れて所属が消えるため、枠のほうを追従させる。
 * 所属する Task がなくなった枠は、他の帯に重なって意図しない Task を
 * 取り込まないよう、最後尾の空き地へ退ける。
 */
function frames(
  snapshot: GraphSnapshot,
  positions: readonly { id: string; position: Position }[],
  bandBounds: ReadonlyMap<string, { minY: number; maxY: number }>,
  emptyAreaTop: number,
): { id: string; position: Position; width: number; height: number }[] {
  const byId = new Map(positions.map((p) => [p.id, p.position]));

  let emptySlot = emptyAreaTop;
  return snapshot.projects.map((project) => {
    const members = snapshot.tasks
      .filter((t) => t.projectId === project.id)
      .map((t) => byId.get(t.id))
      .filter((p): p is Position => p !== undefined);

    const bounds = bandBounds.get(project.id);
    if (members.length === 0 || !bounds) {
      const slot = emptySlot;
      emptySlot += 200;
      return {
        id: project.id,
        position: { x: ORIGIN.x - FRAME_PADDING, y: slot },
        width: 300,
        height: 160,
      };
    }

    const minX = Math.min(...members.map((p) => p.x));
    const maxX = Math.max(...members.map((p) => p.x)) + NODE_WIDTH;

    return {
      id: project.id,
      position: { x: minX - FRAME_PADDING, y: bounds.minY - FRAME_PADDING },
      width: maxX - minX + FRAME_PADDING * 2,
      height: bounds.maxY - bounds.minY + FRAME_PADDING * 2,
    };
  });
}
