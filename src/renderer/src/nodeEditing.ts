import { createContext, useEffect, useRef } from 'react';
import { logger } from './log';

const log = logger('edit');

/**
 * カーソルの置き方。
 *
 * 足したばかりの項目は仮の名前が入っているので全選択(打てば置き換わる)。
 * 消した先で1つ上へ戻ったときは末尾に置く —— 全選択だと、次の1打で
 * 前の項目の名前まで消える。
 */
export type Caret = 'all' | 'end';

/**
 * このノードが測り終えたか(FR-1)
 *
 * React Flow は、ノードの大きさを測り終えるまで `visibility: hidden` にする。
 * 隠れている要素に focus() を呼んでも何も起きず、しかもエラーにならない。
 * 測り終えた合図を待ってから当てる。
 *
 * ノードの外(ダイアログなど)では常に真。待つ相手がいないため。
 */
export const NodeMeasured = createContext(true);

/**
 * 入力欄へフォーカスを当てる。
 *
 * かつては「20フレームだけ再試行」していた。フレームの間隔は機械の忙しさで
 * 変わるので、描画が詰まっているときほど早く諦める —— 遅い機械ほど待たない、
 * という逆の挙動だった。負荷の高い CI で実際に落ちた。
 *
 * 測り終えた合図で呼ぶようにしたので、再試行はしない。当たらなければ、
 * 黙って失うより残しておくほうがよい。
 */
export function focusInput(el: HTMLInputElement | HTMLTextAreaElement | null, caret: Caret): void {
  if (!el || !document.contains(el)) return;

  /*
    preventScroll: ブラウザに画面を動かさせない。

    既定では、フォーカスした要素が見えるところまで入れ物を巻き上げる。
    キャンバスは巻き上げて使うものではないので、React Flow がすぐ 0 へ戻す ——
    その1往復が画面のちらつきとして出る(実測: 592.5px へ飛んで同じミリ秒に 0)。
    画面の外に置かれた Task を作ったときに見える。
  */
  el.focus({ preventScroll: true });
  if (document.activeElement !== el) {
    log.warn('入力欄にフォーカスできなかった', { タグ: el.tagName });
    return;
  }
  if (caret === 'all') el.select();
  else el.setSelectionRange(el.value.length, el.value.length);
}

/**
 * 開いている間、外側が押されたら閉じる。
 *
 * blur を閉じる合図にすると、フォーカスを奪われただけで畳まれてしまう。
 * 押された場所を見るなら、フォーカスがどこへ行ったかに依存しない。
 *
 * 判定と後始末は毎レンダー詰め替えた ref 越しに呼ぶ。リスナは登録した時点の
 * クロージャを掴んだままなので、直接呼ぶと古い値を見る。
 */
export function useCloseOnOutsidePointerDown(
  active: boolean,
  isInside: (target: Node) => boolean,
  onOutside: () => void,
): void {
  const latest = useRef({ isInside, onOutside });
  useEffect(() => {
    latest.current = { isInside, onOutside };
  });

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (latest.current.isInside(event.target as Node)) return;
      latest.current.onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active]);
}
