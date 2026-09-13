/**
 * Task と childTask の入れ替え(W-3)
 *
 * childTask は React Flow のノードではなく、Task ノードの中の DOM でしかない。
 * 掴んで運ぶ仕組みは自前で持っているので、実際にマウスを送って確かめる。
 */
export default {
  name: 'nesting',
  description: 'W-3. childTask を独立させる / 別の Task の下へ移す',

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
          const title = n.querySelector('.task-title')?.textContent ?? '?';
          out[title] = [...n.querySelectorAll('.child-title')].map((c) => c.textContent);
        }
        return out;
      `);

    /**
     * 掴み手と、運び先の座標。
     *
     * 運び先は、その点が本当にその Task かを elementFromPoint で確かめてから返す。
     * Task どうしは重なるので、矩形から計算しただけの点は、別の Task に
     * 覆われていることがある。
     */
    const pointsFor = (childTitle, targetTitle) =>
      evaluate(`
        const row = [...document.querySelectorAll('.child')]
          .find((c) => c.querySelector('.child-title')?.textContent === ${JSON.stringify(childTitle)});
        if (!row) throw new Error('その childTask が見つからない: ' + ${JSON.stringify(childTitle)});
        const gripEl = row.querySelector('.child-grip');
        const grip = gripEl.getBoundingClientRect();
        const from = { x: Math.round(grip.left + grip.width / 2), y: Math.round(grip.top + grip.height / 2) };
        // 掴み手が他の Task に覆われていないか。覆われていると、押した先が
        // 上に乗っているほうになり、別のものを運んでしまう。
        if (document.elementFromPoint(from.x, from.y) !== gripEl) {
          throw new Error('掴み手が他のものに覆われている: ' + ${JSON.stringify(childTitle)});
        }
        if (${JSON.stringify(targetTitle)} === null) return { from, onto: null };

        const target = [...document.querySelectorAll('.react-flow__node-task')]
          .find((n) => n.querySelector('.task-title')?.textContent === ${JSON.stringify(targetTitle)});
        const t = target.getBoundingClientRect();
        for (const y of [t.top + 14, t.top + t.height / 2, t.bottom - 10]) {
          for (const x of [t.left + t.width / 2, t.left + 30, t.right - 30]) {
            const el = document.elementFromPoint(Math.round(x), Math.round(y));
            if (el?.closest('.react-flow__node-task') === target) {
              return { from, onto: { x: Math.round(x), y: Math.round(y) } };
            }
          }
        }
        throw new Error('その Task の上で、他に覆われていない点が見つからない');
      `);

    /** 掴んで運ぶ。途中で、受け取り先が光っているかを見る。 */
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
      const lit = await evaluate(`return document.querySelectorAll('.is-drop-target').length`);
      await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
      await wait(500);
      return lit;
    };

    await addTask('親A', ['手順1', '手順2']);
    await addTask('親B');
    await fitView();

    check(
      'W-3-0 前提: 親A に手順が2件ある',
      JSON.stringify((await structure())['親A']) === '["手順1","手順2"]',
      await structure(),
    );

    /*
      元の親の上で離したときは、何も起きない。

      重なりが増える前に確かめる。Task どうしが重なると、掴み手が上の Task に
      覆われて、押した先が別のものになる。
    */
    const same = await pointsFor('手順1', '親A');
    const litSame = await carry(same.from, same.onto);
    check('W-3-0a 元の親は受け取る先として光らない', litSame === 0, { litSame });
    check(
      'W-3-0b 元の親へ落としても何も変わらない',
      JSON.stringify((await structure())['親A']) === '["手順1","手順2"]',
      await structure(),
    );

    // 1. 別の Task の下へ移す
    const toB = await pointsFor('手順1', '親B');
    const lit = await carry(toB.from, toB.onto);
    check('W-3-1a 運んでいる間、受け取る Task が光る', lit === 1, { lit });

    const moved = await structure();
    check('W-3-1b 元の親から外れる', JSON.stringify(moved['親A']) === '["手順2"]', moved);
    check('W-3-1c 移した先の末尾に付く', JSON.stringify(moved['親B']) === '["手順1"]', moved);

    // 2. Cmd+Z で戻る(確認を出さずに動かすので、戻せることが要る)
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await wait(600);
    const undone = await structure();
    check(
      'W-3-2 移動は1回の Undo で戻る',
      JSON.stringify(undone['親A']) === '["手順1","手順2"]' &&
        JSON.stringify(undone['親B']) === '[]',
      undone,
    );

    // 3. 余白へ落として独立させる
    const before = await evaluate(`return document.querySelectorAll('.task').length`);
    const out = await pointsFor('手順2', null);
    const empty = await evaluate(`
      const ns = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
      const bottom = Math.max(...ns.map((r) => r.bottom));
      return { x: Math.round(innerWidth / 2), y: Math.round(Math.min(innerHeight - 40, bottom + 90)) };
    `);
    await carry(out.from, empty);

    const after = await evaluate(`return document.querySelectorAll('.task').length`);
    check('W-3-3a Task が1つ増える', after === before + 1, { before, after });

    const promoted = await structure();
    check('W-3-3b 元の親から外れる', JSON.stringify(promoted['親A']) === '["手順1"]', promoted);
    check('W-3-3c 独立した Task として現れる', Object.hasOwn(promoted, '手順2'), promoted);
    check(
      'W-3-3d 独立したものは childTask を持たない',
      JSON.stringify(promoted['手順2']) === '[]',
      promoted,
    );

    /*
      5. Task を、別の Task の見出しへ運んで入れ子にする。

      見出しの帯の上でだけ受け取る。重なっただけで子になると、事故で入れ子に
      なる —— 新しい Task は既にあるものへ重なって出るため。
    */
    const taskPoints = (title, ontoTitle, y) =>
      evaluate(`
        const find = (t) => [...document.querySelectorAll('.react-flow__node-task')]
          .find((n) => n.querySelector('.task-title')?.textContent === t);
        const me = find(${JSON.stringify(title)}).getBoundingClientRect();
        const other = find(${JSON.stringify(ontoTitle)});
        const head = other.querySelector('.task-head').getBoundingClientRect();
        const body = other.getBoundingClientRect();
        return {
          from: { x: Math.round(me.left + me.width / 2), y: Math.round(me.bottom - 6) },
          head: { x: Math.round(head.left + head.width / 2), y: Math.round(head.top + head.height / 2) },
          below: { x: Math.round(body.left + body.width / 2), y: Math.round(body.bottom - 4) },
        };
      `);

    // 5a. 見出しではないところで離しても、入れ子にならない
    let p5 = await taskPoints('手順2', '親A');
    const litBody = await carry(p5.from, p5.below);
    check('W-3-5a 見出し以外の上では光らない', litBody === 0, { litBody });
    check(
      'W-3-5b 見出し以外へ落としても入れ子にならない',
      Object.hasOwn(await structure(), '手順2'),
      await structure(),
    );

    // 5c. 見出しの上なら入れ子になる
    p5 = await taskPoints('手順2', '親A');
    const litHead = await carry(p5.from, p5.head);
    check('W-3-5c 見出しの上では光る', litHead === 1, { litHead });

    const nested = await structure();
    check('W-3-5d Task が消えて、相手の childTask になる', !Object.hasOwn(nested, '手順2'), nested);
    check('W-3-5e 末尾に付く', JSON.stringify(nested['親A']) === '["手順1","手順2"]', nested);

    // 5f. これも1回の Undo で戻る
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await wait(600);
    check(
      'W-3-5f 入れ子は1回の Undo で戻る',
      Object.hasOwn(await structure(), '手順2'),
      await structure(),
    );
  },
};
