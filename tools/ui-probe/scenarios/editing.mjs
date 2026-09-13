/**
 * 名前を打つ流れ(FR-1)
 *
 * ここで見ているのは「入力欄が出たか」ではなく 「打った文字がその欄に入るか」。
 * 実際に、入力欄は出ているのにフォーカスが移っておらず、打鍵がどこにも
 * 入らない、という不具合が出たことがある。
 */
export default {
  name: 'editing',
  description: '名前の編集、Shift+Enter での書き出し、Backspace での取り消し',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, check }) {
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

    /*
      フォーカスは即座には移らない。React Flow がノードを測り終えるまで待つ必要が
      あり、実測で初回は 70ms 前後かかる。直後に見にいくと、**移らなかったのか、
      まだ移っていないだけなのかを取り違える。** 待った時間も残しておく ——
      遅くなったこと自体が兆候になる。
    */
    const focusedInput = async (label) => {
      const waitedMs = await waitForFocus();
      const s = await state();
      check(label, waitedMs >= 0, { waitedMs, ...s });
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

    // 行き過ぎたぶんを、手をキーボードに置いたまま戻す
    await evaluate(`[...document.querySelectorAll('.child-title')].at(-1).click(); return 1;`);
    await waitFor('名前が入力欄になる', `return !!document.querySelector('.child .text-input')`);
    await key({ key: 'Enter', code: 13, shift: true });
    await waitFor(
      'childTask が3件になる',
      `return document.querySelectorAll('.child').length === 3`,
    );
    // 打つ前にフォーカスが着くのを待つ。着く前に押すと、どこにも入らない。
    await waitForFocus();
    await key({ key: 'Backspace', code: 8 });
    await key({ key: 'Backspace', code: 8 });

    await waitFor(
      'childTask が2件へ戻る',
      `return document.querySelectorAll('.child').length === 2`,
    );
    s = await focusedInput('消したあとは1つ上の名前へ戻る');
    check('空の名前で Backspace を押すと childTask が消える', s.children.length === 2, s.children);
    check('戻った先の名前は消えていない', s.children[1] === null, s.children);

    /*
      名前からメモへは Tab で移る。

      名前を打ち終えてメモを書きたいたびにマウスへ持ち替えるのでは、
      書き出しの流れが切れる。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await evaluate(`document.querySelector('.task-title').click(); return 1;`);
    await waitFor(
      'Task 名が入力欄になる',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    await key({ key: 'Tab', code: 9 });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    const onMemo = await evaluate(`
      const t0 = performance.now();
      return await new Promise((resolve) => {
        const tick = () => {
          if (document.activeElement?.classList?.contains('memo-input')) {
            return resolve(Math.round(performance.now() - t0));
          }
          if (performance.now() - t0 > 2000) return resolve(-1);
          requestAnimationFrame(tick);
        };
        tick();
      });
    `);
    check('名前から Tab でメモの入力へ移る', onMemo >= 0, { waitedMs: onMemo });

    await type('あとで読み返す用');
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    await evaluate(`document.querySelector('.task-title').click(); return 1;`);
    await waitFor(
      'Task 名が入力欄になる',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    await key({ key: 'Tab', code: 9 });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    await waitForFocus();
    await type('あとで読み返す用');
    await evaluate(`document.querySelector('.memo-input').blur(); return 1;`);
    await wait(400);
    check(
      'メモに打った内容が名前の下に出る',
      await evaluate(
        `return document.querySelector('.memo-text')?.textContent === 'あとで読み返す用'`,
      ),
      await evaluate(`return document.querySelector('.memo-text')?.textContent ?? null`),
    );

    /*
      メモは打鍵ごとに履歴へ積まない(FR-10)。1回の Cmd+Z で書く前へ戻る。
      一文字ごとに積むと、履歴が打鍵で埋まって FR-8 が機能しなくなる。
    */
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await wait(600);
    check(
      'H-3 メモは1回の Undo で書く前に戻る(打鍵ごとに積まれていない)',
      (await evaluate(`return document.querySelector('.memo-text')?.textContent ?? null`)) === null,
      await evaluate(`return document.querySelector('.memo-text')?.textContent ?? null`),
    );

    // Task 名では同じ操作で消えない(FR-1 の確認を迂回しないこと)
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await evaluate(`document.querySelector('.task-title').click(); return 1;`);
    await waitFor(
      'Task 名が入力欄になる',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    for (let i = 0; i < 6; i += 1) await key({ key: 'Backspace', code: 8 });
    await wait(300);
    check(
      'Task 名は空にして Backspace を押しても消えない',
      (await state()).tasks.length === 1,
      await state(),
    );
  },
};
