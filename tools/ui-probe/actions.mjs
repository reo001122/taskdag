/**
 * シナリオが共通して行う操作。
 *
 * 同じ手順が各シナリオに書き写されていた(Task を作る、ツールバーを押す、
 * 全体を表示する、依存を繋ぐ)。**写しがずれると、同じつもりの操作が
 * シナリオごとに違うものになる。** 実際、Task を作ったあとの待ち方が
 * 250ms と 300ms に分かれていた。
 *
 * ここに置くのは「利用者が行う操作」だけにする。**期待することは書かない** ——
 * 何を確かめるかはシナリオ側に残す。失敗を隠す再試行も置かない(見えなくなる)。
 *
 * 操作は本物のキーとマウスで行う。内部の API を直接呼ぶ形に置き換えない ——
 * それでは「押したら起きるか」を見たことにならない。
 */

/**
 * probe の操作口(cdp.mjs が返すもの)を渡すと、共通の操作を返す。
 *
 * @param {object} probe connect() が返すもの。scenario の run が受け取るものと同じ。
 */
export function actions(probe) {
  const { evaluate, waitFor, waitForFocus, wait, key, type, drag } = probe;

  /** ツールバーのボタンを、書かれている文字で選んで押す。 */
  const clickToolbar = (text) =>
    evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click(); return 1;`,
    );

  /**
   * Task を1件作り、名前を確定する。children を渡すと childTask も足す。
   *
   * 作った直後は名前の入力に入っている(FR-1)ので、打ってから確定させる。
   * childTask は Shift+Enter で続けて足す(FR-2)。
   */
  const addTask = async (title, children = []) => {
    const before = await evaluate(`return document.querySelectorAll('.task').length`);
    await clickToolbar('Task');
    await waitFor(
      'Task が増える',
      `return document.querySelectorAll('.task').length === ${before + 1}`,
    );
    await waitForFocus();
    await type(title);
    for (const child of children) {
      await key({ key: 'Enter', code: 13, shift: true });
      await waitForFocus();
      await type(child);
    }
    await key({ key: 'Enter', code: 13 });
    await waitFor('入力欄が閉じる', `return !document.querySelector('.text-input')`);
  };

  /** 左下の「全体を表示」。画面の外に出たものを呼び戻す。 */
  const fitView = async () => {
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(400);
  };

  /**
   * 名前で指した2つの Task を、右端から左端へ引いて繋ぐ(FR-3)。
   *
   * 端が見つからないときは投げる。黙って何もしないと、繋がらなかったことが
   * 「繋いだのに矢印が出ない」という別の失敗に化ける。
   */
  const connect = async (from, to) => {
    const points = await evaluate(`
      const find = (title) => [...document.querySelectorAll('.react-flow__node')]
        .find((n) => n.querySelector('.task-title')?.textContent === title);
      const source = find(${JSON.stringify(from)})?.querySelector('.react-flow__handle.source');
      const target = find(${JSON.stringify(to)})?.querySelector('.react-flow__handle.target');
      if (!source || !target) return null;
      const a = source.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      return {
        from: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
        to: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
      };
    `);
    if (!points) throw new Error(`端が見つからない: ${from} → ${to}`);
    await drag(points.from, points.to);
    await wait(400);
  };

  /** 今ある Task の数。増減を見るときの起点に使う。 */
  const taskCount = () => evaluate(`return document.querySelectorAll('.task').length`);

  /** 今ある依存の本数。 */
  const edgeCount = () => evaluate(`return document.querySelectorAll('.react-flow__edge').length`);

  return { clickToolbar, addTask, fitView, connect, taskCount, edgeCount };
}
