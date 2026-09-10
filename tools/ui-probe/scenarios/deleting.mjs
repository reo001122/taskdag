/**
 * 削除の確認(FR-1)— QA チェックリスト F に対応
 *
 * **再接続の規則は条件で挙動が変わる**(FR-3)。特に入力・出力の双方が複数だと
 * 何も繋ぎ直されない。何が起きるかを事前に見せることでこの非対称さを許容
 * 可能にする、というのが FR-1 の趣旨なので、提示の内容そのものが要件にあたる。
 */
export default {
  name: 'deleting',
  description: 'F. 削除前に、何がなくなり何が繋ぎ直されるかを見せる',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, drag, check }) {
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

    const openDeleteFor = async (title) => {
      await evaluate(`
        const wrap = [...document.querySelectorAll('.task-wrap')]
          .find((w) => w.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        [...wrap.querySelectorAll('.task-actions .state-button')].find((b) => b.textContent === '×').click();
        return 1;
      `);
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
    const escape = async () => {
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

    await escape();
    check(
      'F-5a Escape で閉じる',
      !(await evaluate(`return !!document.querySelector('dialog[open]')`)),
    );
    check('F-5b Escape では何も消えない', (await edgeCount()) === 2, await edgeCount());

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

    // --- 実行すると、提示どおりになる ---
    await escape();
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
  },
};
