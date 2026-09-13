/**
 * Task と childTask の入れ替え(W-3)
 *
 * childTask は React Flow のノードではなく、Task ノードの中の DOM でしかない。
 * 掴んで運ぶ仕組みは自前で持っているので、実際にマウスを送って確かめる。
 */
export default {
  name: 'nesting',
  description: 'W-3. 手順を並べ替える / 別の Task へ移す / 独立させる / 入れ子にする',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, mouse, check }) {
    const click = (text) =>
      evaluate(
        `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click(); return 1;`,
      );

    const addTask = async (title, children = []) => {
      const before = await evaluate(`return document.querySelectorAll('.task').length`);
      await click('Task');
      await waitFor('増える', `return document.querySelectorAll('.task').length === ${before + 1}`);
      await waitForFocus();
      await type(title);
      for (const child of children) {
        await key({ key: 'Enter', code: 13, shift: true });
        await waitForFocus();
        await type(child);
      }
      await key({ key: 'Enter', code: 13 });
      await wait(300);
    };

    const fitView = async () => {
      await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
      await wait(600);
    };

    /** Task ごとの childTask の並び。 */
    const structure = () =>
      evaluate(`
        const out = {};
        for (const n of document.querySelectorAll('.react-flow__node-task')) {
          out[n.querySelector('.task-title')?.textContent ?? '?'] =
            [...n.querySelectorAll('.child-title')].map((c) => c.textContent);
        }
        return out;
      `);

    const undo = async () => {
      await evaluate(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
        return 1;
      `);
      await wait(600);
    };

    /**
     * 掴み手の座標。
     *
     * 他の Task に覆われていないことを確かめてから返す。覆われていると押した先が
     * 上に乗っているほうになり、別のものを運んでしまう。
     */
    const gripOf = (childTitle) =>
      evaluate(`
        const row = [...document.querySelectorAll('.child')]
          .find((c) => c.querySelector('.child-title')?.textContent === ${JSON.stringify(childTitle)});
        if (!row) throw new Error('その childTask が見つからない: ' + ${JSON.stringify(childTitle)});
        const el = row.querySelector('.child-grip');
        const r = el.getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        if (document.elementFromPoint(p.x, p.y) !== el) {
          throw new Error('掴み手が覆われている: ' + ${JSON.stringify(childTitle)});
        }
        return p;
      `);

    /** その行の「手前」に当たる高さ。入れる位置を狙うのに使う。 */
    const aboveRow = (childTitle) =>
      evaluate(`
        const row = [...document.querySelectorAll('.child')]
          .find((c) => c.querySelector('.child-title')?.textContent === ${JSON.stringify(childTitle)});
        const r = row.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 3) };
      `);

    /** その Task の見出しの上。 */
    const headOf = (title) =>
      evaluate(`
        const n = [...document.querySelectorAll('.react-flow__node-task')]
          .find((x) => x.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        const r = n.querySelector('.task-head').getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        if (document.elementFromPoint(p.x, p.y)?.closest('.react-flow__node-task') !== n) {
          throw new Error('見出しが覆われている: ' + ${JSON.stringify(title)});
        }
        return p;
      `);

    /** 掴んで運ぶ。途中の見え方(影・線・光り)も返す。 */
    const carry = async (from, to) => {
      await mouse('mousePressed', from.x, from.y, { buttons: 1 });
      for (let i = 1; i <= 8; i += 1) {
        await mouse(
          'mouseMoved',
          from.x + ((to.x - from.x) * i) / 8,
          from.y + ((to.y - from.y) * i) / 8,
          { buttons: 1 },
        );
        await wait(20);
      }
      const mid = await evaluate(`
        const ghost = document.querySelector('.drag-ghost');
        const line = document.querySelector('.drop-line');
        return {
          影: ghost?.textContent ?? null,
          線: line ? Math.round(line.getBoundingClientRect().top) : null,
          光: document.querySelectorAll('.is-drop-target').length,
        };
      `);
      await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
      await wait(500);
      return mid;
    };

    await addTask('親A', ['手順1', '手順2', '手順3']);
    await addTask('親B', ['既にある']);
    await fitView();

    check(
      'W-3-0 前提: 親A に手順が3件ある',
      JSON.stringify((await structure())['親A']) === '["手順1","手順2","手順3"]',
      await structure(),
    );

    // 1. 運んでいる様子が見える
    const seen = await carry(await gripOf('手順3'), await aboveRow('手順1'));
    check('W-3-1a 掴んでいるものが影として出る', seen.影 === '手順3', seen);
    check('W-3-1b 入る場所に線が引かれる', typeof seen.線 === 'number', seen);
    check('W-3-1c 受け取る Task が光る', seen.光 === 1, seen);

    // 2. 同じ親の中で、狙った位置へ並べ替わる
    check(
      'W-3-2a 手順1 の手前へ入る',
      JSON.stringify((await structure())['親A']) === '["手順3","手順1","手順2"]',
      await structure(),
    );
    await undo();
    check(
      'W-3-2b 並べ替えは1回の Undo で戻る',
      JSON.stringify((await structure())['親A']) === '["手順1","手順2","手順3"]',
      await structure(),
    );

    // 3. 別の Task の、狙った位置へ移す
    await carry(await gripOf('手順1'), await aboveRow('既にある'));
    const moved = await structure();
    check('W-3-3a 元の親から外れる', JSON.stringify(moved['親A']) === '["手順2","手順3"]', moved);
    check(
      'W-3-3b 狙った位置に入る',
      JSON.stringify(moved['親B']) === '["手順1","既にある"]',
      moved,
    );
    await undo();

    // 4. 余白へ落として独立させる
    const before = await evaluate(`return document.querySelectorAll('.task').length`);
    const empty = await evaluate(`
      const ns = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
      return {
        x: Math.round(innerWidth / 2),
        y: Math.round(Math.min(innerHeight - 40, Math.max(...ns.map((r) => r.bottom)) + 90)),
      };
    `);
    await carry(await gripOf('手順3'), empty);
    const promoted = await structure();
    check(
      'W-3-4a Task が1つ増える',
      (await evaluate(`return document.querySelectorAll('.task').length`)) === before + 1,
      { before },
    );
    check(
      'W-3-4b 元の親から外れる',
      JSON.stringify(promoted['親A']) === '["手順1","手順2"]',
      promoted,
    );
    check('W-3-4c 独立した Task として現れる', Object.hasOwn(promoted, '手順3'), promoted);
    check(
      'W-3-4d 独立したものは childTask を持たない',
      JSON.stringify(promoted['手順3']) === '[]',
      promoted,
    );

    // 5. Task を、別の Task の見出しへ運んで入れ子にする
    const taskBody = (title) =>
      evaluate(`
        const n = [...document.querySelectorAll('.react-flow__node-task')]
          .find((x) => x.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 6) };
      `);
    const nestSeen = await carry(await taskBody('手順3'), await headOf('親B'));
    check('W-3-5a 入れ子でも、入る場所に線が引かれる', typeof nestSeen.線 === 'number', nestSeen);

    const nested = await structure();
    check('W-3-5b Task が消えて、相手の childTask になる', !Object.hasOwn(nested, '手順3'), nested);
    check(
      'W-3-5c 見出しへ落としたので先頭に入る',
      JSON.stringify(nested['親B']) === '["手順3","既にある"]',
      nested,
    );
    await undo();
    check(
      'W-3-5d 入れ子は1回の Undo で戻る',
      Object.hasOwn(await structure(), '手順3'),
      await structure(),
    );

    // 6. 何もない場所へ落としたときは、動くだけで入れ子にならない
    const countBefore = await evaluate(`return document.querySelectorAll('.task').length`);
    await carry(await taskBody('手順3'), empty);
    check(
      'W-3-6 余白へ落としても入れ子にならない',
      (await evaluate(`return document.querySelectorAll('.task').length`)) === countBefore,
      await structure(),
    );
  },
};
