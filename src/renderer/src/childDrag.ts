/**
 * childTask を掴んで運ぶ(W-3)
 *
 * childTask は React Flow のノードではなく、Task ノードの中の DOM でしかない。
 * ノードなら用意されている「掴んで動かす」が無いので、pointer で自前に持つ。
 *
 * 行の上はボタンでほぼ埋まっている。実測すると、幅 316px のうち空いているのは
 * 左端の x 18-42 だけで、残りは状態の四角・名前・操作のボタンだった。
 * 専用の掴み手をそこに置いているのはこのため。
 */

const DROP_TARGET = 'is-drop-target';
const THRESHOLD = 4;

/** 画面上のその点にある Task ノードの id。無ければ null。 */
function taskUnder(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  return element?.closest('.react-flow__node-task')?.getAttribute('data-id') ?? null;
}

function clearHighlight(): void {
  for (const node of document.querySelectorAll(`.${DROP_TARGET}`)) {
    node.classList.remove(DROP_TARGET);
  }
}

/**
 * 掴み手の上で押されたときに呼ぶ。離した時点の座標を onDrop へ渡す。
 *
 * 少し動かすまでは何も起きない。押しただけで運搬が始まると、掴み手を
 * 押しただけのつもりが位置を変えてしまう。
 */
export function startChildDrag(
  event: React.PointerEvent<HTMLElement>,
  parentTaskId: string,
  onDrop: (at: { x: number; y: number }) => void,
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
    const over = taskUnder(moveEvent.clientX, moveEvent.clientY);
    clearHighlight();
    // 元の親は光らせない。そこへ戻すのは「何もしない」のと同じなので、
    // 受け取れる先のように見せない。
    if (over && over !== parentTaskId) {
      document
        .querySelector(`.react-flow__node-task[data-id="${CSS.escape(over)}"]`)
        ?.classList.add(DROP_TARGET);
    }
  };

  const onUp = (upEvent: PointerEvent) => {
    document.removeEventListener('pointermove', onMove);
    document.body.classList.remove('is-dragging-child');
    clearHighlight();
    if (!moved) return;
    onDrop({ x: upEvent.clientX, y: upEvent.clientY });
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
}

/**
 * その点にある「別の Task の見出し行」の id。無ければ null。
 *
 * Task を Task の下へ入れるときの受け取り口を、見出しの帯に限っている。
 * 重なっただけで子になると、事故で入れ子になる —— 新しい Task は既にある
 * ものへ重なって出るため、重なり自体は珍しくない。
 *
 * 運んでいる Task 自身がカーソルの下にいるので、elementsFromPoint で
 * 下まで見て、自分を飛ばす。
 */
export function taskHeadUnder(x: number, y: number, exceptId: string): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const node = element.closest('.react-flow__node-task');
    if (!node) continue;
    const id = node.getAttribute('data-id');
    if (!id || id === exceptId) continue;
    return element.closest('.task-head') ? id : null;
  }
  return null;
}

export { taskUnder };
