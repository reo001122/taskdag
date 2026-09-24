/**
 * 削除の確認(FR-1)— QA チェックリスト F に対応
 *
 * 再接続の規則は条件で挙動が変わる(FR-3)。特に入力・出力の双方が複数だと
 * 何も繋ぎ直されない。何が起きるかを事前に見せることでこの非対称さを許容
 * 可能にする、というのが FR-1 の趣旨なので、提示の内容そのものが要件にあたる。
 */
export default {
  name: 'deleting',
  description: 'F. 削除前に、何がなくなり何が繋ぎ直されるかを見せる',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, drag, mouse, check }) {
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
      await wait(250);
    };

    const fitView = async () => {
      await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
      await wait(400);
    };

    const connect = async (from, to) => {
      const points = await evaluate(`
        const find = (title) => [...document.querySelectorAll('.react-flow__node')]
          .find((n) => n.querySelector('.task-title')?.textContent === title);
        const s = find(${JSON.stringify(from)}).querySelector('.react-flow__handle.source').getBoundingClientRect();
        const t = find(${JSON.stringify(to)}).querySelector('.react-flow__handle.target').getBoundingClientRect();
        return {
          from: { x: s.left + s.width / 2, y: s.top + s.height / 2 },
          to: { x: t.left + t.width / 2, y: t.top + t.height / 2 },
        };
      `);
      await drag(points.from, points.to);
      await wait(400);
    };

    /*
      × は押した時点で効く(onClick ではなく onPointerDown)。名前を編集している
      間にノードの幅が変わってボタンが動くため、離す位置では成立しないことが
      あるのが理由。ここも本物のマウスで押す —— click() では pointerdown が
      出ないので反応しない。
    */
    const openDeleteFor = async (title) => {
      const at = await evaluate(`
        const wrap = [...document.querySelectorAll('.task-wrap')]
          .find((w) => w.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        const btn = [...wrap.querySelectorAll('.task-actions .state-button')]
          .find((b) => b.textContent === '×');
        const r = btn.getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        if (document.elementFromPoint(p.x, p.y) !== btn) throw new Error('× が覆われている');
        return p;
      `);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
      await waitFor('確認が開く', `return !!document.querySelector('dialog[open]')`);
      await wait(200);
    };

    const dialogText = () =>
      evaluate(`return document.querySelector('dialog[open]')?.textContent ?? ''`);
    /** 依存の行を構造で読む。地の文の検索は、表示のしかたを変えるたびに壊れる。 */
    const edgeRows = (kind) =>
      evaluate(`
        return [...document.querySelectorAll('dialog[open] .edge-list.is-${kind} li')]
          .map((li) => [...li.children].map((c) => c.textContent).join(''));
      `);
    const edgeCount = () =>
      evaluate(`return document.querySelectorAll('.react-flow__edge').length`);
    /** Cmd+Z。削除も、その削除で消えた矢印も、まとめて戻るはず(FR-8)。 */
    const undo = async () => {
      await evaluate(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
        return 1;
      `);
      await wait(600);
    };

    const dismiss = async () => {
      await key({ key: 'Escape', code: 27 });
      await wait(300);
    };

    // --- A→B→C の B を消す。入力も出力も1本なので A→C へ繋ぎ直される ---
    await addTask('A');
    await addTask('B', ['子1', '子2']);
    await addTask('C');
    await fitView();
    await connect('A', 'B');
    await connect('B', 'C');
    await waitFor(
      '矢印が2本',
      `return document.querySelectorAll('.react-flow__edge').length === 2`,
    );

    await openDeleteFor('B');
    let removed = await edgeRows('removed');
    let added = await edgeRows('added');
    check('F-1a なくなる依存関係が両方とも挙がる', removed.join() === 'A→B,B→C', removed);
    check('F-1b 繋ぎ直される依存関係として A → C が挙がる', added.join() === 'A→C', added);
    check(
      'F-4 子タスクが何件消えるかを伝える',
      /子タスク\s*2\s*件/.test(await dialogText()),
      await dialogText(),
    );

    /*
      繋ぎ直しは確認の場で外せる(FR-1)。

      FR-3 の規則は「繋がっていた相手どうしを繋ぐ」であって、それがいつも
      利用者の意図と一致するとは限らない。外したものが本当に作られないことまで見る。
    */
    await evaluate(`
      document.querySelector('dialog[open] .edge-list.is-added input').click();
      return 1;
    `);
    await wait(200);
    check(
      'F-8a 繋ぎ直しを確認の場で外せる',
      (await evaluate(
        `return document.querySelector('dialog[open] .edge-list.is-added input').checked`,
      )) === false,
    );
    await evaluate(`document.querySelector('dialog[open] .danger').click(); return 1;`);
    await waitFor(
      'B が消える',
      `return ![...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
    );
    check('F-8b 外した繋ぎ直しは作られない', (await edgeCount()) === 0, await edgeCount());

    // 消した B を作り直して、続きの検査へ
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await waitFor(
      'B が戻る',
      `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
    );
    await waitFor(
      '矢印が2本に戻る',
      `return document.querySelectorAll('.react-flow__edge').length === 2`,
    );

    await openDeleteFor('B');
    await dismiss();
    check(
      'F-5a Escape で閉じる',
      !(await evaluate(`return !!document.querySelector('dialog[open]')`)),
    );
    check('F-5b Escape では何も消えない', (await edgeCount()) === 2, await edgeCount());

    // --- 線に重ねた × で、その依存だけを外せる(FR-3) ---
    const cross = await evaluate(`
      const el = document.querySelector('.edge-remove');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    check('F-6a 依存の線の上に、外すための印がある', cross !== null, cross);
    if (cross) {
      await mouse('mouseMoved', cross.x, cross.y);
      await wait(200);
      const shown = await evaluate(
        `return getComputedStyle(document.querySelector('.edge-remove')).opacity`,
      );
      check('F-6b 線に触れると印が見える', Number(shown) > 0.5, shown);

      await mouse('mousePressed', cross.x, cross.y);
      await mouse('mouseReleased', cross.x, cross.y);
      await waitFor(
        '矢印が1本になる',
        `return document.querySelectorAll('.react-flow__edge').length === 1`,
      );
      check('F-6c 印を押すと、その依存だけが外れる', (await edgeCount()) === 1, await edgeCount());

      // 続きの検査のために張り直す
      await connect('A', 'B');
      await waitFor(
        '矢印が2本',
        `return document.querySelectorAll('.react-flow__edge').length === 2`,
      );
    }

    // --- 入力・出力とも複数にすると、繋ぎ直しは行われない(FR-3) ---
    await addTask('A2');
    await addTask('C2');
    await fitView();
    await connect('A2', 'B');
    await connect('B', 'C2');
    await waitFor(
      '矢印が4本',
      `return document.querySelectorAll('.react-flow__edge').length === 4`,
    );

    await openDeleteFor('B');
    removed = await edgeRows('removed');
    added = await edgeRows('added');
    const text = await dialogText();
    check(
      'F-3a 両側が複数なら「繋ぎ直しは行われません」と伝える',
      text.includes('つなぎ直しは行われません'),
      text,
    );
    check('F-3b そのとき繋ぎ直しの一覧は出さない', added.length === 0, added);
    check('F-3c なくなる依存関係は4本とも挙がる', removed.length === 4, removed);

    /*
      Delete / Backspace では消えない。

      **この道は Task の削除と依存の削除を一緒くたにしており、確認(FR-1)を
      迂回する。** 実際、Task 自体は消えないのに、繋がっていた依存だけが
      黙って消えていた。
    */
    await dismiss();
    await evaluate(`
      const node = [...document.querySelectorAll('.react-flow__node-task')]
        .find((n) => n.querySelector('.task-title')?.textContent === 'B');
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 1;
    `);
    await wait(300);
    const edgesBefore = await edgeCount();
    await key({ key: 'Backspace', code: 8 });
    await key({ key: 'Delete', code: 46 });
    await wait(500);
    check(
      'F-7a Delete / Backspace では Task が消えない',
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
      ),
    );
    check('F-7b そのとき依存も消えない', (await edgeCount()) === edgesBefore, {
      before: edgesBefore,
      after: await edgeCount(),
    });

    // --- 実行すると、提示どおりになる ---
    await dismiss();
    await openDeleteFor('B');
    await evaluate(`document.querySelector('dialog[open] .danger').click(); return 1;`);
    await waitFor(
      'B が消える',
      `return ![...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
    );
    check(
      'F-2 実行すると、繋ぎ直されない場合は矢印がすべてなくなる',
      (await edgeCount()) === 0,
      await edgeCount(),
    );

    await undo();
    check(
      'E-1a 削除を Undo すると Task が戻る',
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
      ),
    );
    check('E-1b 繋がっていた矢印も戻る', (await edgeCount()) === 4, await edgeCount());

    /*
      表示設定は Undo の対象外(FR-6)。タスクグラフのデータではないため。
      **ここを履歴に積むと、Cmd+Z が「表示を戻す」のか「変更を戻す」のか
      分からなくなる。**
    */
    await evaluate(`document.querySelector('.toolbar input[type=checkbox]').click(); return 1;`);
    await wait(400);
    const hiddenOn = await evaluate(
      `return document.querySelector('.toolbar input[type=checkbox]').checked`,
    );
    await undo();
    const hiddenAfterUndo = await evaluate(
      `return document.querySelector('.toolbar input[type=checkbox]').checked`,
    );
    check('E-5 「完了を非表示」は Undo で戻らない(表示設定のため)', hiddenAfterUndo === hiddenOn, {
      hiddenOn,
      hiddenAfterUndo,
    });
  },
};
