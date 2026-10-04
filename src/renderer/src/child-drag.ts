/**
 * childTask を掴んで運ぶ(W-3)
 *
 * childTask は React Flow のノードではなく、Task ノードの中の DOM でしかない。
 * ノードなら用意されている「掴んで動かす」が無いので、pointer で自前に持つ。
 *
 * 行の上はボタンでほぼ埋まっている。実測すると、幅 316px のうち空いているのは
 * 左端の x 18-42 だけで、残りは状態の四角・名前・操作のボタンだった。
 * 専用の掴み手をそこに置いているのはこのため。
 *
 * 運搬中の見せ方(掴んでいるものの影、入る場所の線)は、React の状態を通さず
 * 直接 DOM に置く。1フレームごとに再描画すると、React Flow の描画と重なって
 * 手応えが鈍る。
 */

const DROP_TARGET = 'is-drop-target';
const THRESHOLD = 4;

/**
 * 運んでいる最中に、どこへ入るかを指す。
 *
 * 位置を数ではなく「どの行の手前か」で持つ。完了を非表示にしていると、画面に
 * 出ている行数とドメイン側の並びの長さが食い違い、数で渡すと別の場所へ入る
 * (並べ替えが同じ罠を踏んでいる)。id なら、隠れている行があってもずれない。
 */
export type DropPoint = {
  /** 受け取る Task。 */
  taskId: string;
  /** この childTask の手前に入る。末尾なら null。 */
  beforeChildId: string | null;
};

/** 画面上のその点にある Task ノードの id。無ければ null。 */
function taskUnder(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  return element?.closest('.react-flow__node-task')?.getAttribute('data-id') ?? null;
}

function nodeOf(taskId: string): HTMLElement | null {
  return document.querySelector(`.react-flow__node-task[data-id="${CSS.escape(taskId)}"]`);
}

/**
 * その Task の中で、今の高さならどの行の手前に入るか。末尾なら null。
 *
 * 行の中点より上なら、その行の手前。
 */
function beforeChildAt(node: HTMLElement, y: number): string | null {
  for (const row of node.querySelectorAll('.child')) {
    const rect = row.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return row.getAttribute('data-child-id');
  }
  return null;
}

/**
 * その点で離したら、どこへ入るか。受け取れないところなら null。
 *
 * except を除くのは、運んでいる Task 自身がカーソルの下にいるため。
 * onlyHead を立てると、見出しの帯の上でしか受け取らない —— Task を Task の
 * 下へ入れるときに使う。重なっただけで子になると、事故で入れ子になる。
 */
export function findDropPoint(
  x: number,
  y: number,
  options: { except?: string; onlyHead?: boolean } = {},
): DropPoint | null {
  const { except, onlyHead = false } = options;
  for (const element of document.elementsFromPoint(x, y)) {
    const node = element.closest('.react-flow__node-task');
    if (!node) continue;
    const taskId = node.getAttribute('data-id');
    if (!taskId || taskId === except) continue;
    if (!(node instanceof HTMLElement)) return null;

    const onHead = !!element.closest('.task-head');
    const onChildren = !!element.closest('.task-children');
    // 見出しに限る指定のときは、見出しか手順の並びの上だけを受け取り口にする。
    if (onlyHead && !onHead && !onChildren) return null;
    return {
      taskId,
      // 見出しの上なら先頭へ。手順の並びの上なら、その高さの行の手前へ。
      beforeChildId: onHead
        ? (node.querySelector('.child')?.getAttribute('data-child-id') ?? null)
        : beforeChildAt(node, y),
    };
  }
  return null;
}

// --- 運搬中の見せ方 --------------------------------------------------------

let ghost: HTMLElement | null = null;
let line: HTMLElement | null = null;

/** 掴んでいるものを、カーソルに付いて回る影として出す。 */
function showGhost(title: string, x: number, y: number): void {
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    document.body.append(ghost);
  }
  ghost.textContent = title || '(名前なし)';
  ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
}

function hideGhost(): void {
  ghost?.remove();
  ghost = null;
}

/** 入る場所に線を引く。 */
function showLine(at: DropPoint | null): void {
  if (!at) {
    line?.remove();
    line = null;
    return;
  }
  const node = nodeOf(at.taskId);
  if (!node) return;
  const rows = [...node.querySelectorAll('.child')];
  const row =
    at.beforeChildId === null
      ? null
      : rows.find((r) => r.getAttribute('data-child-id') === at.beforeChildId);
  const box = node.getBoundingClientRect();
  // 行と行の間。末尾なら最後の行の下、行が無ければ見出しの下。
  const y = row
    ? row.getBoundingClientRect().top
    : (rows[rows.length - 1]?.getBoundingClientRect().bottom ??
      node.querySelector('.task-head')?.getBoundingClientRect().bottom ??
      box.top);

  if (!line) {
    line = document.createElement('div');
    line.className = 'drop-line';
    document.body.append(line);
  }
  line.style.transform = `translate(${box.left}px, ${y}px)`;
  line.style.width = `${box.width}px`;
}

/** 受け取る Task を光らせ、入る場所に線を引く。 */
export function showDropFeedback(at: DropPoint | null): void {
  for (const node of document.querySelectorAll(`.${DROP_TARGET}`)) {
    node.classList.remove(DROP_TARGET);
  }
  if (at) nodeOf(at.taskId)?.classList.add(DROP_TARGET);
  showLine(at);
}

export function clearDropFeedback(): void {
  showDropFeedback(null);
  hideGhost();
  document.body.classList.remove('is-dragging-child');
}

/**
 * 掴み手の上で押されたときに呼ぶ。離した時点の座標と行き先を onDrop へ渡す。
 *
 * 少し動かすまでは何も起きない。押しただけで運搬が始まると、掴み手を
 * 押しただけのつもりが位置を変えてしまう。
 */
export function startChildDrag(
  event: React.PointerEvent<HTMLElement>,
  child: { id: string; title: string },
  onDrop: (at: { x: number; y: number }, to: DropPoint | null) => void,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const from = { x: event.clientX, y: event.clientY };
  let moved = false;

  const onMove = (moveEvent: PointerEvent) => {
    if (!moved && Math.hypot(moveEvent.clientX - from.x, moveEvent.clientY - from.y) < THRESHOLD) {
      return;
    }
    moved = true;
    document.body.classList.add('is-dragging-child');
    showGhost(child.title, moveEvent.clientX, moveEvent.clientY);
    showDropFeedback(findDropPoint(moveEvent.clientX, moveEvent.clientY));
  };

  const onUp = (upEvent: PointerEvent) => {
    document.removeEventListener('pointermove', onMove);
    const to = moved ? findDropPoint(upEvent.clientX, upEvent.clientY) : null;
    clearDropFeedback();
    if (!moved) return;
    onDrop({ x: upEvent.clientX, y: upEvent.clientY }, to);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
}

export { taskUnder };
