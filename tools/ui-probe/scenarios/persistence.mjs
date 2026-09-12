/**
 * 永続化と Undo(FR-7, FR-8)— QA チェックリスト E / I に対応
 *
 * **1回の起動の中では確かめようがないものがある。** 再起動してデータが残って
 * いるか、そして履歴がセッションを跨がないか(FR-8: Undo はセッション内のみ)。
 */
/** 残っているべきものを、画面から一度に読み取る式。再起動の前後で同じものを使う。 */
const READ_SCREEN = `
  return {
    tasks: [...document.querySelectorAll('.react-flow__node-task')].map((n) => ({
      title: n.querySelector('.task-title')?.textContent ?? null,
      memo: n.querySelector('.memo-text')?.textContent ?? null,
      state: n.querySelector('.state-toggle')?.className.replace(/state-toggle |nodrag /g, ''),
      collapsed: !!n.querySelector('.state-button.is-collapsed'),
      project: n.querySelector('.task-grip-dot.is-unassigned')
        ? null
        : getComputedStyle(n.querySelector('.task-grip-dot')).backgroundColor,
      position: [Math.round(n.offsetLeft), Math.round(n.offsetTop)],
      children: [...n.querySelectorAll('.child')].map((c) => ({
        title: c.querySelector('.child-title')?.textContent ?? null,
        memo: c.querySelector('.memo-text')?.textContent ?? null,
      })),
    })),
    edges: document.querySelectorAll('.react-flow__edge').length,
    projects: [...document.querySelectorAll('.project-name')].map((p) => p.textContent),
  };
`;

export default {
  name: 'persistence',
  description: 'E / I. 再起動しても残ること、Undo がセッションを跨がないこと',

  async run(ctx) {
    const { evaluate, waitFor, waitForFocus, wait, key, type, drag, check } = ctx;

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

    const snapshot = () => evaluate(READ_SCREEN);

    // --- 残しておくべきものを一通り作る ---
    await click('Project');
    await waitFor('dialog', `return !!document.querySelector('dialog[open]')`);
    await waitForFocus();
    await type('設計');
    await key({ key: 'Enter', code: 13 });
    await wait(400);

    await addTask('要件を洗う', ['聞き取り', '整理']);
    await addTask('実装する');
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(400);

    // 依存を張る
    const points = await evaluate(`
      const find = (t) => [...document.querySelectorAll('.react-flow__node')]
        .find((n) => n.querySelector('.task-title')?.textContent === t);
      const s = find('要件を洗う').querySelector('.react-flow__handle.source').getBoundingClientRect();
      const t = find('実装する').querySelector('.react-flow__handle.target').getBoundingClientRect();
      return {
        from: { x: s.left + s.width / 2, y: s.top + s.height / 2 },
        to: { x: t.left + t.width / 2, y: t.top + t.height / 2 },
      };
    `);
    await drag(points.from, points.to);
    await waitFor(
      '矢印が1本',
      `return document.querySelectorAll('.react-flow__edge').length === 1`,
    );

    // メモ、状態、折りたたみ
    await evaluate(`document.querySelector('.task-title').click(); return 1;`);
    await waitForFocus();
    await key({ key: 'Tab', code: 9 });
    await waitFor('メモ欄', `return !!document.querySelector('.memo-input')`);
    await waitForFocus();
    await type('あとで見返す');
    await evaluate(`document.querySelector('.memo-input').blur(); return 1;`);
    await wait(400);

    await evaluate(`document.querySelector('.task .state-toggle').click(); return 1;`);
    await wait(350);
    await evaluate(`
      [...document.querySelectorAll('.task-actions .state-button')].find((b) => b.textContent === '▾').click();
      return 1;
    `);
    await wait(400);

    const before = await snapshot();
    check(
      'I-0 前提: 残すべきものが一通り揃っている',
      before.tasks.length === 2 && before.edges === 1,
      {
        tasks: before.tasks.length,
        edges: before.edges,
        projects: before.projects,
      },
    );

    // --- 再起動 ---
    const next = await ctx.restart();
    await next.wait(600);
    // snapshot() は前の操作口に束縛されているので、新しい口で読み直す
    const restored = await next.evaluate(READ_SCREEN);

    check(
      'I-1a 再起動しても Task と依存が残る',
      restored.tasks.length === 2 && restored.edges === 1,
      {
        tasks: restored.tasks.length,
        edges: restored.edges,
      },
    );
    check('I-1b Project の枠が残る', restored.projects.join() === before.projects.join(), {
      before: before.projects,
      after: restored.projects,
    });
    const titles = (s) => s.tasks.map((t) => t.title).join();
    check('I-1c 名前が残る', titles(restored) === titles(before), {
      before: titles(before),
      after: titles(restored),
    });
    check(
      'I-1d メモが残る',
      restored.tasks.some((t) => t.memo === 'あとで見返す'),
      restored.tasks.map((t) => t.memo),
    );
    check(
      'I-1e 状態(着手中)が残る',
      restored.tasks.some((t) => (t.state ?? '').includes('is-in-progress')),
      restored.tasks.map((t) => t.state),
    );
    check(
      'I-1f 折りたたみが残る',
      restored.tasks.some((t) => t.collapsed),
      restored.tasks.map((t) => t.collapsed),
    );
    check(
      'I-1g 座標が残る',
      JSON.stringify(restored.tasks.map((t) => t.position)) ===
        JSON.stringify(before.tasks.map((t) => t.position)),
      { before: before.tasks.map((t) => t.position), after: restored.tasks.map((t) => t.position) },
    );

    // --- Undo はセッションを跨がない(FR-8) ---
    const undoDisabled = await next.evaluate(`
      const b = [...document.querySelectorAll('.toolbar button')].find((x) => x.textContent.includes('Undo'));
      return b.disabled;
    `);
    check('E-1 再起動直後は Undo が効かない(履歴はセッション内のみ)', undoDisabled === true, {
      undoDisabled,
    });

    await next.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await next.wait(500);
    const afterUndo = await next.evaluate(
      `return document.querySelectorAll('.react-flow__node-task').length`,
    );
    check('E-1b 再起動直後の Cmd+Z で何も消えない', afterUndo === 2, { afterUndo });
  },
};
