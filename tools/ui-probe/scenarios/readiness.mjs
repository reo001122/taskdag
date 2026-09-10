/**
 * 依存と状態(FR-3, FR-5)— QA チェックリスト B に対応
 *
 * **壊れたら製品が成立しない部分。** 依存が外れているかどうかは枠線の実線と点線
 * だけで示しているので、判定そのものが狂っても画面は「それらしく」見える。
 * バッジを置いていない以上、目視では気づきにくい。
 */
export default {
  name: 'readiness',
  description: 'B. 依存の向き、Ready/Blocked、完了の非表示',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, drag, check }) {
    /*
      全体が入るように表示を合わせる。

      **Task の配置は固定のカスケードで、4つ目あたりから画面の外へ出る。**
      端をドラッグして繋ぐには両端が画面に入っている必要がある。
      (配置そのものの是非は QA へ回す。ここでは操作できる状態を作るだけ。)
    */
    const fitView = async () => {
      await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
      await wait(400);
    };

    /** Task を1つ作って名前を確定する。 */
    const addTask = async (title) => {
      await evaluate(
        `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
      );
      await waitFor('入力欄が開く', `return !!document.querySelector('.task-head .text-input')`);
      await waitForFocus();
      await type(title);
      await key({ key: 'Enter', code: 13 });
      await wait(250);
    };

    /** 名前から Task の見え方を読む。 */
    const look = (title) =>
      evaluate(`
        const el = [...document.querySelectorAll('.task')]
          .find((t) => t.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          borderStyle: style.borderStyle,
          ready: el.classList.contains('is-ready'),
          blocked: el.classList.contains('is-blocked'),
          active: el.classList.contains('is-active'),
          height: Math.round(el.getBoundingClientRect().height),
          badge: /READY|BLOCKED/.test(el.textContent),
        };
      `);

    /** 端をドラッグして繋ぐ。ドメインの循環判定はここを通ってしか働かない。 */
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

    const edgeCount = () =>
      evaluate(`return document.querySelectorAll('.react-flow__edge').length`);

    /**
     * 矢印の本数が n 本に落ち着くまで待つ。
     * 描き直しの最中は一瞬 0 本になるため、数えた1回の値は当てにならない。
     */
    const edgesSettle = (n) =>
      waitFor(
        `矢印が ${n} 本になる`,
        `return document.querySelectorAll('.react-flow__edge').length === ${n}`,
      );

    /*
      状態を1つ進める(未着手 → 着手中 → 完了)。

      **1回押すごとに、反映されるまで待つ。** 次に送る状態は今の状態から決まる
      ため、反映前にもう一度押すと、同じ遷移を2度送って1段ぶん取りこぼす。
      人の操作を写すなら、押して、変わってから、また押す。
    */
    const advance = async (title, times) => {
      const find = `[...document.querySelectorAll('.task')]
        .find((t) => t.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;
      for (let i = 0; i < times; i += 1) {
        const was = await evaluate(`return ${find}.querySelector('.state-toggle').className`);
        await evaluate(`${find}.querySelector('.state-toggle').click(); return 1;`);
        await waitFor(
          `${title} の状態が変わる`,
          `return ${find}?.querySelector('.state-toggle')?.className !== ${JSON.stringify(was)}`,
        );
      }
    };

    await addTask('A');
    await addTask('B');
    await addTask('C');
    await fitView();

    const soloHeight = (await look('A')).height;

    await connect('A', 'B');
    await edgesSettle(1);
    await connect('B', 'C');
    await edgesSettle(2);
    check('B-1a 端をドラッグして依存を張れる', (await edgeCount()) === 2, await edgeCount());

    let [a, b, c] = [await look('A'), await look('B'), await look('C')];
    check('B-1b 依存のない A だけが実線で立つ', a.ready && a.borderStyle === 'solid', a);
    check('B-1c 依存の残る B と C は点線で沈む', b.blocked && c.blocked, { b, c });
    check('B-1d Ready / Blocked のバッジは出ない', !a.badge && !b.badge, { a, b });
    check('B-8 依存を張っても Task の高さは変わらない', a.height === soloHeight, {
      soloHeight,
      now: a.height,
    });

    await advance('A', 2); // 未着手 → 着手中 → 完了
    b = await look('B');
    check('B-2 A を完了にすると B が即座に実線へ変わる', b.ready && b.borderStyle === 'solid', b);

    await advance('B', 2);
    c = await look('C');
    check('B-3 B を完了にすると C も実線になる', c.ready && c.borderStyle === 'solid', c);

    // 循環になる接続は成立しない(FR-3)
    await edgesSettle(2);
    await connect('C', 'A');
    await wait(400);
    check('B-4 循環になる接続は成立しない', (await edgeCount()) === 2, await edgeCount());

    // 着手中でも枠線は軸 a のまま(FR-5)
    await addTask('D');
    await fitView();
    await connect('C', 'D');
    await edgesSettle(3);
    await advance('D', 1); // 着手中へ
    const d = await look('D');
    check('B-7 ブロック中に着手しても枠線は点線のまま', d.blocked && d.active, d);

    const counter = await evaluate(
      `return document.querySelector('.toolbar .muted')?.textContent ?? ''`,
    );
    const readyShown = Number(counter.match(/着手できる\s*(\d+)/)?.[1] ?? -1);
    const readyActual = await evaluate(`
      return [...document.querySelectorAll('.task')]
        .filter((t) => t.classList.contains('is-ready')).length;
    `);
    check('B-5 「着手できる」の数が画面の実線の数と一致する', readyShown === readyActual, {
      counter,
      readyShown,
      readyActual,
    });

    // 完了を非表示にすると、それに繋がる矢印も消える(FR-6)
    await edgesSettle(3);
    const edgesBeforeHide = await edgeCount();
    await evaluate(`document.querySelector('.toolbar input[type=checkbox]').click(); return 1;`);
    await waitFor(
      '完了した Task が消える',
      `return ![...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'A')`,
    );
    const shown = await evaluate(
      `return [...document.querySelectorAll('.task-title')].map((t) => t.textContent)`,
    );
    check('B-6a 完了した Task が消える', !shown.includes('A') && !shown.includes('B'), shown);
    check('B-6b それに繋がる矢印も消える', (await edgeCount()) < edgesBeforeHide, {
      before: edgesBeforeHide,
      after: await edgeCount(),
    });
  },
};
