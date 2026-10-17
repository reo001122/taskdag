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

  /**
   * クリック/ドラッグの起点となる点を求める。
   *
   * 各シナリオが「名前で1件探し、その中の一部分の矩形から中心点を求め、
   * elementFromPoint で本当にそこへ当たるか確かめる」処理を、少しずつ違う
   * 形で書き写していた。ここではその形を1つにする。
   *
   * 対象の絞り方は2通り:
   * - `id` を渡すと、`idAttr`(既定 `data-id`。React Flow のノードはこれを持つ。
   *   childTask には `data-child-id` がある)でちょうど1件に絞る。
   * - `id` を渡さなければ `container` の中から `nameSelector` の文字列が
   *   `name` と一致するものを探す。**一致が複数あれば投げる** —— 名前は
   *   利用者が自由に付けられるので重複しうる。黙って1件目を選ぶと、
   *   探していたのと違うものを操作してしまう。
   *
   * 求めた点は、`hitSelector` を渡せばその祖先までを、渡さなければ `part`
   * (省略時は対象自身)そのものを elementFromPoint が返すかで確かめる。
   * 覆われていれば、押しても別のものに当たるということなので投げる。
   *
   * 部分の指定は2通り:
   * - `part`: 対象の中を1つの CSS セレクタで絞る(`.task-grip` など)。
   * - `partAll` + `partText`: 対象の中に同じセレクタの要素が複数あるとき
   *   (× ▾ ↑ などのボタン群)、文字列の完全一致で選ぶ。ここでも一致が
   *   複数あれば投げる。
   *
   * 期待する状態(見つかるはず・覆われていないはず)はここでは確かめない。
   * それを check() するかどうかはシナリオ側の判断。ここで投げるのは
   * 「押しても意図した相手に届かない」という、操作そのものが成立しない場合だけ。
   */
  const locatePoint = ({
    id,
    idAttr = 'data-id',
    container,
    nameSelector,
    name,
    part,
    partAll,
    partText,
    hitSelector,
  }) => {
    const findExpr =
      id !== undefined
        ? `document.querySelector(\`[${idAttr}="\${CSS.escape(${JSON.stringify(id)})}"]\`)`
        : `(() => {
            const matches = [...document.querySelectorAll(${JSON.stringify(container)})]
              .filter((el) => el.querySelector(${JSON.stringify(nameSelector)})?.textContent === ${JSON.stringify(name)});
            if (matches.length > 1) {
              throw new Error('同じ名前が複数ある(' + matches.length + '件): ' + ${JSON.stringify(name)});
            }
            return matches[0] ?? null;
          })()`;
    const label = JSON.stringify(id !== undefined ? id : name);
    const partLabel = JSON.stringify(part ?? partText ?? '');
    const targetExpr = part
      ? `found.querySelector(${JSON.stringify(part)})`
      : partAll
        ? `(() => {
            const cands = [...found.querySelectorAll(${JSON.stringify(partAll)})]
              .filter((el) => el.textContent === ${JSON.stringify(partText)});
            if (cands.length > 1) {
              throw new Error(
                '部分の候補が複数一致した(' + cands.length + '件): ' + ${JSON.stringify(partText)},
              );
            }
            return cands[0] ?? null;
          })()`
        : 'found';
    return evaluate(`
      const found = ${findExpr};
      if (!found) throw new Error('見つからない: ' + ${label});
      const target = ${targetExpr};
      if (!target) throw new Error('対象の中に無い(' + ${partLabel} + '): ' + ${label});
      const r = target.getBoundingClientRect();
      const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      /*
        窓の外は「覆われている」と区別する。elementFromPoint は窓の外の点に
        対して null を返すので、同じ文言にすると原因を取り違える
        (実際、下端からはみ出したカードを掴もうとして「覆われている」と出た)。
      */
      if (p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) {
        throw new Error(
          '画面の外にある(' + ${label} + '): ' + JSON.stringify(p) +
            ' 窓は ' + innerWidth + 'x' + innerHeight,
        );
      }
      const hit = document.elementFromPoint(p.x, p.y);
      const ok = ${hitSelector ? `hit?.closest(${JSON.stringify(hitSelector)}) === found` : 'hit === target'};
      if (!ok) {
        throw new Error(
          '覆われている(' + ${label} + '): ' + (hit?.className?.toString?.().slice(0, 60) ?? '?'),
        );
      }
      return p;
    `);
  };

  return { clickToolbar, addTask, fitView, connect, taskCount, edgeCount, locatePoint };
}
