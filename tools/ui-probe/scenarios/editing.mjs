/**
 * 名前を打つ流れ(FR-1)
 *
 * ここで見ているのは「入力欄が出たか」ではなく **「打った文字がその欄に入るか」**。
 * 実際に、入力欄は出ているのにフォーカスが移っておらず、打鍵がどこにも
 * 入らない、という不具合が出たことがある。
 */
export default {
  name: 'editing',
  description: '名前の編集と、Shift+Enter による分解の書き出し',

  async run({ evaluate, waitFor, wait, key, type, check }) {
    const state = () =>
      evaluate(`
        const active = document.activeElement;
        return {
          activeTag: active.tagName,
          activeClass: active.className,
          tasks: [...document.querySelectorAll('.task')]
            .map((t) => t.querySelector('.task-title')?.textContent ?? null),
          children: [...document.querySelectorAll('.child')]
            .map((c) => c.querySelector('.child-title')?.textContent ?? null),
        };
      `);

    const focusedInput = async (label) => {
      const s = await state();
      check(label, s.activeTag === 'INPUT' && s.activeClass.includes('text-input'), s);
      return s;
    };

    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
    );
    await waitFor('Task が現れる', `return document.querySelectorAll('.task').length === 1`);
    await focusedInput('作った直後の Task 名にフォーカスが移る');

    await type('親タスク');
    await wait(100);
    await key({ key: 'Enter', code: 13, shift: true });

    await waitFor(
      'childTask が1件現れる',
      `return document.querySelectorAll('.child').length === 1`,
    );
    let s = await focusedInput('Shift+Enter で足した childTask の入力にフォーカスが移る');
    check('Task 名が確定している', s.tasks[0] === '親タスク', s.tasks);

    await type('こども1');
    await wait(100);
    await key({ key: 'Enter', code: 13, shift: true });

    await waitFor(
      'childTask が2件になる',
      `return document.querySelectorAll('.child').length === 2`,
    );
    s = await focusedInput('続けて Shift+Enter を押しても入力に入る');
    check('1件目の名前が確定している', s.children[0] === 'こども1', s.children);

    await type('こども2');
    await wait(100);
    await key({ key: 'Enter', code: 13 });
    await wait(400);

    s = await state();
    check('Enter は確定するだけで childTask を増やさない', s.children.length === 2, s.children);
    check('2件目の名前が確定している', s.children[1] === 'こども2', s.children);
  },
};
