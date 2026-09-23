import type { Rect } from '../../shared/geometry';

/**
 * 枠が重なっている領域を示す(FR-4)
 *
 * 置けない理由は「重なること」であって、どちらか一方の枠ではない。枠の片方を
 * 塗ると、動かしている側が悪いように見えるうえ、隠れることがある —— 枠はすべて
 * 同じ重なり順(zIndex -1)で、掴んだものが前面に出ないため、相手の下に潜る。
 *
 * 領域そのものに斜線を引く。両方の枠の上に描くので、前後に関係なく見える。
 * 色ではなく模様なのは、7色どの Project でも読めるようにするため —— 赤で
 * 塗っていたときは、暖色の Project と見分けにくいという報告が出た。
 *
 * React の状態を通さず直接 DOM に置く。運搬中は1フレームごとに変わるので、
 * 再描画に載せると手応えが鈍る(childDrag と同じ理由)。
 */

const marks: HTMLElement[] = [];

/** 画面座標の矩形に斜線を引く。渡さなければ消える。 */
export function showOverlapMarks(rects: readonly Rect[]): void {
  while (marks.length > rects.length) {
    marks.pop()?.remove();
  }
  while (marks.length < rects.length) {
    const element = document.createElement('div');
    element.className = 'overlap-mark';
    document.body.append(element);
    marks.push(element);
  }
  rects.forEach((rect, index) => {
    const element = marks[index];
    if (!element) return;
    element.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  });
}

export function clearOverlapMarks(): void {
  showOverlapMarks([]);
}
