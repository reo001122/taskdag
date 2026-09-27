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
    /** × を押す。押した時点で効く(FR-1)。 */
    const pressDelete = async (title) => {
      const at = await evaluate(`
        const wrap = [...document.querySelectorAll('.task-wrap')]
          .find((w) => w.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        const btn = [...wrap.querySelectorAll('.task-actions .state-button')]
          .find((b) => b.textContent === '×');
        const r = btn.getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        if (document.elementFromPoint(p.x, p.y) !== btn) {
          const over = document.elementFromPoint(p.x, p.y);
          throw new Error(
            '× が覆われている: ' + (over?.className?.toString?.().slice(0, 40) ?? '?') +
            ' / 画面内=' + (p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight),
          );
        }
        return p;
      `);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
      await wait(500);
    };

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
      Delete / Backspace は、印の付いている行を消す(FR-1)。

      消すのは印の1件だけ。React Flow の既定(選んでいるものを全部)は切って
      ある —— Task 自体は消えないのに、繋がっていた依存だけが黙って消えて
      いた。Task を消すときは × と同じ確認を通す。
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
    await key({ key: 'Delete', code: 46 });
    await wait(500);
    check(
      'F-7a Delete は消す前に確認を出す',
      await evaluate(`return !!document.querySelector('dialog[open]')`),
    );

    await dismiss();
    await wait(300);
    check(
      'F-7b 取り消せば Task は残る',
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === 'B')`,
      ),
    );
    check('F-7c そのとき依存も残る', (await edgeCount()) === edgesBefore, {
      before: edgesBefore,
      after: await edgeCount(),
    });

    /*
      入力欄が開いている間は効かない。

      フォーカスが入力欄にあれば keydown はそこで止まる。止まらないのは
      「入力欄は出ているのにフォーカスが移っていない」場合で、これは実際に
      起きている。その1打が文字ではなく Task に効くのでは代償が大きすぎる
      ので、開いて見えているなら入力欄のものとして扱う。
    */
    await evaluate(`
      const node = [...document.querySelectorAll('.react-flow__node-task')]
        .find((n) => n.querySelector('.task-title')?.textContent === 'B');
      node.querySelector('.task-title').click();
      return 1;
    `);
    await waitFor('入力欄が開く', `return !!document.querySelector('.task-head .text-input')`);
    // フォーカスだけ落とす(入力欄は開いたまま)。報告された状態の再現。
    await evaluate(`document.activeElement?.blur(); return 1;`);
    await wait(200);
    const tasksBefore = await evaluate(`return document.querySelectorAll('.task').length`);
    await key({ key: 'Backspace', code: 8 });
    await key({ key: 'Delete', code: 46 });
    await wait(500);
    const after = {
      tasks: await evaluate(`return document.querySelectorAll('.task').length`),
      edges: await edgeCount(),
      dialog: await evaluate(`return !!document.querySelector('dialog[open]')`),
    };
    check(
      'F-7d 入力欄が開いている間は、フォーカスが外れていても消えない',
      after.tasks === tasksBefore && after.edges === edgesBefore && !after.dialog,
      { before: { tasks: tasksBefore, edges: edgesBefore }, after },
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    /*
      ダイアログが開いている間は、背景のグラフに触れない。

      Enter の経路だけが押された場所を見ていたため、Cmd+Z と Cmd+N が素通り
      していた —— 削除の確認を開いたまま Cmd+Z を押すと、提示中の削除計画と
      実際のグラフが食い違う。
    */
    await openDeleteFor('B');
    const underDialog = async () => ({
      tasks: await evaluate(`return document.querySelectorAll('.task').length`),
      edges: await edgeCount(),
      dialog: await evaluate(`return !!document.querySelector('dialog[open]')`),
    });
    const beforeKeys = await underDialog();
    await key({ key: 'z', code: 90, meta: true });
    await wait(400);
    await key({ key: 'n', code: 78, meta: true });
    await wait(600);
    const afterKeys = await underDialog();
    check(
      'F-9 確認を開いている間は Cmd+Z / Cmd+N が背景に効かない',
      afterKeys.tasks === beforeKeys.tasks &&
        afterKeys.edges === beforeKeys.edges &&
        afterKeys.dialog,
      { before: beforeKeys, after: afterKeys },
    );
    await dismiss();
    await wait(300);

    /*
      印が childTask にあれば、その1行だけが消える。

      確認は挟まない —— × と同じ扱いで、巻き添えになるものが無いため
      見せるものがない。誤ったら Undo で戻す(FR-8)。
    */
    const childNames = () =>
      evaluate(`return [...document.querySelectorAll('.child-title')].map((c) => c.textContent)`);
    const childrenBefore = await childNames();
    await evaluate(`
      const row = [...document.querySelectorAll('.child')]
        .find((c) => c.querySelector('.child-title')?.textContent === '子2');
      if (!row) throw new Error('子2 が見つからない');
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: Math.round(r.left + 8), clientY: Math.round(r.top + 8) }));
      return 1;
    `);
    await wait(300);
    await key({ key: 'Delete', code: 46 });
    await wait(500);
    const childrenAfter = await childNames();
    check(
      'F-7e 印が childTask にあれば、その1行だけが消える',
      !childrenAfter.includes('子2') && childrenAfter.includes('子1'),
      { before: childrenBefore, after: childrenAfter },
    );
    await key({ key: 'z', code: 90, meta: true });
    await wait(500);
    check('F-7f 1回の Undo で戻る', (await childNames()).includes('子2'), await childNames());

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

    /*
      見せるものが無ければ、確認を出さずに消す(FR-1)。

      確認の目的は「何が消えて何が繋ぎ直されるか」を見せること。依存も
      childTask も持たない Task では、空の一覧を見せて聞くだけになる。
    */
    await addTask('ひとりだけ');
    // 新しい Task は画面の外に出ることがある(既知の弱点)。戻してから押す。
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(600);
    const countBefore = await evaluate(`return document.querySelectorAll('.task').length`);
    await pressDelete('ひとりだけ');
    check(
      'F-9a 依存も childTask も無い Task は、確認を出さずに消える',
      !(await evaluate(`return !!document.querySelector('dialog[open]')`)) &&
        (await evaluate(`return document.querySelectorAll('.task').length`)) === countBefore - 1,
      {
        確認: await evaluate(`return !!document.querySelector('dialog[open]')`),
        件数: [countBefore, await evaluate(`return document.querySelectorAll('.task').length`)],
      },
    );

    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await wait(600);
    check(
      'F-9b それも1回の Undo で戻る',
      (await evaluate(`return document.querySelectorAll('.task').length`)) === countBefore,
    );
  },
};
