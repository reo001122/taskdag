/**
 * 名前を打つ流れ(FR-1)
 *
 * ここで見ているのは「入力欄が出たか」ではなく 「打った文字がその欄に入るか」。
 * 実際に、入力欄は出ているのにフォーカスが移っておらず、打鍵がどこにも
 * 入らない、という不具合が出たことがある。
 */ import { actions } from '../actions.mjs';

export default {
  name: 'editing',
  description: '名前の編集、Shift+Enter での書き出し、Backspace での取り消し',

  async run(ctx) {
    const {
      evaluate,
      waitFor,
      waitForFocus,
      wait,
      key,
      type,
      mouse,
      wheel,
      setViewportSize,
      check,
    } = ctx;
    const { clickToolbar, addTask, taskCount, fitView } = actions(ctx);
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
      /*
        間に合わなかったとき、どちら側で時間がかかったのかを添える。

        アプリは「ノードを測り終えた合図」を待ってからフォーカスを当てる。
        測り終えていなければ機械が遅いだけで、測り終えているのに当たって
        いなければアプリ側の問題。この2つは直し方がまったく違う。
      */
      const why =
        waitedMs >= 0
          ? undefined
          : await evaluate(`
              const node = document.querySelector('.react-flow__node-task');
              const a = document.activeElement;
              return {
                測れている: node ? node.offsetWidth > 0 : null,
                見えている: node ? getComputedStyle(node).visibility : null,
                今のフォーカス: (a?.tagName ?? 'なし') + '.' + (a?.className?.toString?.().slice(0, 24) ?? ''),
              };
            `);
      check(label, waitedMs >= 0, { waitedMs, ...s, ...(why ?? {}) });
      return s;
    };

    await clickToolbar('Task');
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
      名前からメモへは Ctrl+Enter で移る。

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
    await key({ key: 'Enter', code: 13, ctrl: true });
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
    check('名前から Ctrl+Enter でメモの入力へ移る', onMemo >= 0, { waitedMs: onMemo });

    await type('あとで読み返す用');
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    await evaluate(`document.querySelector('.task-title').click(); return 1;`);
    await waitFor(
      'Task 名が入力欄になる',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    await key({ key: 'Enter', code: 13, ctrl: true });
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

    /*
      名前を編集している間も、Task のボタンが効くこと。

      編集中は入力欄のぶんノードが広く、閉じると縮む。押した時点で効かせないと、
      指を離す頃にはボタンが動いていて click が成立しない(実測 201px 動いた)。
      実際、名前の編集中は ✎ ＋ × のどれも一度も効かなかった。
    */
    const pressButton = async (title) => {
      const at = await evaluate(`
        const btn = [...document.querySelectorAll('.task .state-button')]
          .find((b) => b.title === ${JSON.stringify(title)});
        if (!btn) throw new Error('ボタンが見つからない: ' + ${JSON.stringify(title)});
        const r = btn.getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        if (document.elementFromPoint(p.x, p.y) !== btn) {
          throw new Error('ボタンが覆われている: ' + ${JSON.stringify(title)});
        }
        return p;
      `);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
      await wait(500);
    };

    /** Task 名の編集に入る。 */
    const editName = async () => {
      await evaluate(`document.querySelector('.task-title')?.click(); return 1;`);
      await waitFor(
        '名前が入力欄になる',
        `return !!document.querySelector('.task-head .text-input')`,
      );
      await waitForFocus();
    };

    await key({ key: 'Escape', code: 27 });
    await wait(200);

    // ✎ → 名前が確定して、メモの入力へ移る
    await editName();
    await type('見出し');
    await pressButton('メモ');
    const afterMemo = await evaluate(`
      const a = document.activeElement;
      return {
        名前: document.querySelector('.task-title')?.textContent ?? '(編集中)',
        フォーカス: a?.tagName ?? 'なし',
      };
    `);
    check('J-1a 名前の編集中に ✎ を押すと、名前が確定する', afterMemo.名前 === '見出し', afterMemo);
    check('J-1b そのままメモの入力へ移る', afterMemo.フォーカス === 'TEXTAREA', afterMemo);
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    // ＋ → 名前が確定して、childTask が増える
    const childrenBefore = (await state()).children.length;
    await editName();
    await pressButton('子タスクを追加');
    check(
      'J-2 名前の編集中に ＋ を押すと、childTask が増える',
      (await state()).children.length === childrenBefore + 1,
      { childrenBefore, after: (await state()).children.length },
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    // × → 削除の確認が出る
    await editName();
    await pressButton('この Task を削除');
    check(
      'J-3 名前の編集中に × を押すと、削除の確認が出る',
      await evaluate(`return !!document.querySelector('dialog[open]')`),
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      Cmd+N で Task を足せること(FR-1)。

      Electron の既定メニューに横取りされていないかも、ここで分かる。
      取られていれば renderer まで届かず、件数が増えない。
    */
    const countBefore = await taskCount();
    await key({ key: 'n', code: 78, meta: true });
    await wait(600);
    check('K-1a Cmd+N で Task が1件増える', (await taskCount()) === countBefore + 1, {
      countBefore,
      after: await taskCount(),
    });
    check('K-1b そのまま名前を打ち始められる', (await waitForFocus()) >= 0);
    /*
      作った直後は選ばれている(FR-1)。

      名前を確定したあと、そのまま Enter でもう一度開ける。選ばれていないと、
      作ったばかりのものに触るのにクリックが要る。
    */
    check(
      'K-1c 作った直後の Task は選ばれている',
      await evaluate(`return !!document.querySelector('.react-flow__node-task.selected')`),
    );
    // 1回目の Enter で名前を確定し、2回目で開き直す。
    await key({ key: 'Enter', code: 13 });
    await wait(300);
    await key({ key: 'Enter', code: 13 });
    await wait(300);
    check(
      'K-1d 確定したあと、そのまま Enter でもう一度開ける',
      await evaluate(`return !!document.querySelector('.task-head .text-input')`),
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    /*
      名前を打っている最中でも増える。まず確定してから作る(FR-1)。

      書きかけを置き去りにしないために、かつては「打っている間は効かない」に
      していた。ところが ＋ Task のボタンは同じ場面で効く —— ボタンでは作れて
      キーでは作れない、という食い違いが残っていた。確定してから作れば、どちらも
      同じ結果になる。
    */
    const duringEdit = await taskCount();
    await editName();
    await type('打ちかけの名前');
    await key({ key: 'n', code: 78, meta: true });
    await wait(700);
    check('K-2a 名前を打っている最中の Cmd+N でも増える', (await taskCount()) === duringEdit + 1, {
      duringEdit,
      after: await taskCount(),
    });
    check(
      'K-2b 打ちかけの名前は確定する',
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === '打ちかけの名前')`,
      ),
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].map((t) => t.textContent)`,
      ),
    );
    check('K-2c そのまま新しい Task の名前を打ち始められる', (await waitForFocus()) >= 0);
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      選んでいる Task は Enter で名前の編集に入る(FR-1)。

      作った直後は打てるのに、既にある Task はクリックが要る、という非対称を
      なくす。どれが対象かは選択の見た目で分かる。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    const target = await evaluate(`
      const g = document.querySelector('.task-grip');
      const r = g.getBoundingClientRect();
      const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      if (document.elementFromPoint(p.x, p.y) !== g) throw new Error('取っ手が覆われている');
      return p;
    `);
    await mouse('mousePressed', target.x, target.y, { buttons: 1 });
    await mouse('mouseReleased', target.x, target.y, { buttons: 0 });
    await wait(300);
    check(
      'L-1a Task を押すと、選ばれていることが見た目に出る',
      await evaluate(`return !!document.querySelector('.react-flow__node-task.selected')`),
    );

    await key({ key: 'Enter', code: 13 });
    await wait(400);
    check(
      'L-1b Enter でその名前の編集に入る',
      await evaluate(`return !!document.querySelector('.task-head .text-input')`),
    );
    check('L-1c そのまま打ち始められる', (await waitForFocus()) >= 0);
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    // 余白を押すと選択が外れ、Enter は何もしない
    const empty = await evaluate(`
      // 本当に余白の点を選ぶ。左下には拡大縮小のボタンが乗っている。
      const pane = document.querySelector('.react-flow__pane');
      for (const y of [innerHeight * 0.3, innerHeight * 0.5, innerHeight * 0.75]) {
        for (const x of [innerWidth * 0.85, innerWidth * 0.7, innerWidth * 0.2]) {
          if (document.elementFromPoint(Math.round(x), Math.round(y)) === pane) {
            return { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
      throw new Error('余白が見つからない');
    `);
    await mouse('mousePressed', empty.x, empty.y, { buttons: 1 });
    await mouse('mouseReleased', empty.x, empty.y, { buttons: 0 });
    await wait(300);
    check(
      'L-2a 余白を押すと選択が外れる',
      !(await evaluate(`return !!document.querySelector('.react-flow__node-task.selected')`)),
    );
    await key({ key: 'Enter', code: 13 });
    await wait(400);
    check(
      'L-2b 選ばれていなければ Enter で編集に入らない',
      !(await evaluate(`return !!document.querySelector('.task-head .text-input')`)),
    );

    /*
      メモは Enter で確定、Shift+Enter で改行(FR-10)。

      名前の欄と同じで Enter は「書き終えた」の意味。改行のほうを修飾キー側へ
      置いてある —— メモは1行で済むことが多く、そのたびに枠の外を押して
      閉じるのでは手数が増える。
    */
    const waitForMemoFocus = () =>
      evaluate(`
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
    const memoValue = () => evaluate(`return document.querySelector('.memo-input')?.value ?? null`);

    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await editName();
    await key({ key: 'Enter', code: 13, ctrl: true });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    check('M-1 Ctrl+Enter でメモの入力へ移る', (await waitForMemoFocus()) >= 0);

    await type('1行目');
    // text を渡さないと既定の動作が起きず、改行が入らない。
    await key({ key: 'Enter', code: 13, shift: true, text: '\r' });
    await wait(200);
    check('M-2 Shift+Enter は改行になる', (await memoValue()) === '1行目\n', {
      value: await memoValue(),
    });

    await key({ key: 'Enter', code: 13 });
    await wait(400);
    check('M-3 Enter は確定。入力欄が閉じる', (await memoValue()) === null);
    check(
      'M-4 打った内容が残る',
      (
        (await evaluate(`return document.querySelector('.memo-text')?.textContent ?? null`)) ?? ''
      ).includes('1行目'),
      { 本文: await evaluate(`return document.querySelector('.memo-text')?.textContent ?? null`) },
    );

    /*
      Shift+↑↓ で、印を親 Task と childTask の間で動かす(FR-1)。

      見るのは2つ。印が Enter の開く相手と一致していること、そして矢印で
      ノードが動かないこと —— 修飾キーを足しただけでは React Flow の移動が
      生き残る、という形で壊れうる。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await clickToolbar('Task');
    await waitForFocus();
    await type('鍵を回す');
    // 確定して childTask へ。作った Task は選ばれたままになる。
    await key({ key: 'Enter', code: 13, shift: true });
    await waitForFocus();
    await type('手順あ');
    await key({ key: 'Enter', code: 13, shift: true });
    await waitForFocus();
    await type('手順い');
    await key({ key: 'Enter', code: 13 });
    await wait(300);

    /*
      全体を表示してから押す。

      新しい Task は空いている場所に置かれ、見えている範囲が埋まっていれば
      下へ送られる(FR-1)。ここまでで何件も作っているので、そのままでは
      窓の外の座標を押すことになる。
    */
    await fitView();

    const mark = () =>
      evaluate(`
        return {
          親: !!document.querySelector('.task-own.is-cursor'),
          行: document.querySelector('.child.is-cursor .child-title')?.textContent ?? null,
        };
      `);
    const positionOfSelected = () =>
      evaluate(
        `return document.querySelector('.react-flow__node-task.selected')?.style.transform ?? null`,
      );

    const before = await positionOfSelected();
    /*
      childTask を足した直後、印は**最後に足した行**にある(FR-2)。

      かつては親にあった。足したあとの Delete / Ctrl+Enter が前の行を相手に
      していて、見ている行と相手になる行が違ったため、印を足した行へ移すように
      した(#9)。
    */
    check(
      'N-1a childTask を足した直後、印は最後に足した行にある',
      (await mark()).行 === '手順い',
      await mark(),
    );

    // ここから先は親を起点に見るので、印を親へ戻しておく(この戻り方自体は N-1d で見る)
    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);
    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);

    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    check('N-1b Shift+↓ で1件目の childTask へ移る', (await mark()).行 === '手順あ', await mark());

    // 端まで押しても、次の Task へは回り込まない
    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    check('N-1c 一番下で止まる', (await mark()).行 === '手順い', await mark());

    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);
    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);
    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);
    check('N-1d Shift+↑ で親 Task まで戻る', (await mark()).親 === true, await mark());

    check('N-1e 印を動かしても Task の位置は変わらない', (await positionOfSelected()) === before, {
      before,
      after: await positionOfSelected(),
    });

    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    await key({ key: 'Enter', code: 13 });
    await wait(400);
    const opened = await evaluate(`
      const a = document.activeElement;
      return {
        値: a?.value ?? null,
        場所: a?.closest('.child') ? 'childTask' : a?.closest('.task-head') ? '親' : 'その他',
      };
    `);
    check(
      'N-1f Enter は印の付いている childTask の名前を開く',
      opened.場所 === 'childTask' && opened.値 === '手順あ',
      opened,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      押した行に印が移る(FR-1)。

      選択は React Flow が付け替えるが、行の位置までは知らない。同じ Task を
      押し直したときには選択が変わらないため、印が前の行に残りうる ——
      実際に、childTask を押しても親に印が出たままになっていた。
    */
    // 名前やボタンを避け、行の左寄りの余白を押す
    const pressRow = async (selector, index) => {
      /*
        その行そのものに当たる点を探す。

        「左から 120px」のような当て方はできない。拡大率で行の幅が変わり、
        同じ位置が名前のボタンになったり余白になったりする —— 実際、全体を
        表示したあとに名前の編集へ入ってしまった。
      */
      const at = await evaluate(`
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        if (!el) throw new Error('行が見つからない');
        const row = el.querySelector('.child-row') ?? el;
        const r = row.getBoundingClientRect();
        const y = Math.round(r.top + r.height / 2);
        for (let x = Math.round(r.left + 2); x < Math.round(r.right); x += 4) {
          const hit = document.elementFromPoint(x, y);
          if (hit === el || hit === row) return { x, y };
        }
        throw new Error('行の余白が見つからない');
      `);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
      await wait(250);
    };
    const markOn = () =>
      evaluate(`
        return {
          親: !!document.querySelector('.task-own.is-cursor'),
          行: document.querySelector('.child.is-cursor .child-title')?.textContent ?? null,
        };
      `);

    // 直前に作った Task(手順あ・手順い)が画面の最後にある
    const rows = await evaluate(`return document.querySelectorAll('.child').length`);
    await pressRow('.child', rows - 1);
    check(
      'N-2a childTask を押すと、その行に印が移る',
      (await markOn()).行 === '手順い',
      await markOn(),
    );
    /*
      フォーカスも押した行へ移す。放っておくと React Flow が Task ノード全体に
      当てるので、childTask を押したのにフォーカスは親、という状態になる。
      見た目には出ないが、ここから先のキー操作の起点になる値である。
    */
    check(
      'N-2b 押した行にフォーカスが移る',
      await evaluate(`return document.activeElement?.classList?.contains('child') ?? false`),
      { フォーカス: await evaluate(`return document.activeElement?.className ?? null`) },
    );

    const heads = await evaluate(`return document.querySelectorAll('.task-head').length`);
    await pressRow('.task-head', heads - 1);
    check('N-2c 親の見出しを押すと、印は親へ戻る', (await markOn()).親 === true, await markOn());

    /*
      取っ手を押したときも印が移る。

      取っ手は運搬を始めるために pointerdown を止めている(child-drag.ts)。
      行の受け取りを bubble 側に置くと、取っ手を押したときだけ印が動かない ——
      「取っ手の左の余白では移るのに、取っ手では移らない」という形で出た。
    */
    const gripAt = await evaluate(`
      const grips = document.querySelectorAll('.child-grip');
      const g = grips[grips.length - 2];
      if (!g) throw new Error('取っ手が足りない');
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    await mouse('mousePressed', gripAt.x, gripAt.y, { buttons: 1 });
    await mouse('mouseReleased', gripAt.x, gripAt.y, { buttons: 0 });
    await wait(300);
    check('N-2d 取っ手を押しても印が移る', (await markOn()).行 === '手順あ', await markOn());

    await pressRow('.child', rows - 1);
    await key({ key: 'Enter', code: 13 });
    await wait(400);
    const afterPress = await evaluate(`
      const a = document.activeElement;
      return { 値: a?.value ?? null, 場所: a?.closest('.child') ? 'childTask' : '親' };
    `);
    check(
      'N-2e 押した行が、そのまま Enter の開く相手になる',
      afterPress.場所 === 'childTask' && afterPress.値 === '手順い',
      afterPress,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      印の付いている行のメモを Ctrl+Enter で開く(FR-10)。

      名前を打っている最中の Ctrl+Enter と同じ相手が開く。編集に入ってからで
      ないとメモへ行けないのでは、直すつもりのない名前を一度開くことになる。
    */
    const memoAt = () =>
      evaluate(`
        const a = document.activeElement;
        return {
          欄: a?.className?.includes?.('memo-input') ?? false,
          場所: a?.closest('.child') ? 'childTask' : a?.closest('.task-own') ? '親' : 'その他',
        };
      `);

    await pressRow('.task-head', heads - 1);
    await key({ key: 'Enter', code: 13, ctrl: true });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    const onParentMemo = await memoAt();
    check(
      'N-3a 選んだ Task の Ctrl+Enter で、その Task のメモが開く',
      onParentMemo.欄 && onParentMemo.場所 === '親',
      onParentMemo,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    await pressRow('.child', rows - 1);
    await key({ key: 'Enter', code: 13, ctrl: true });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    const onChildMemo = await memoAt();
    check(
      'N-3b 印が childTask にあれば、その childTask のメモが開く',
      onChildMemo.欄 && onChildMemo.場所 === 'childTask',
      onChildMemo,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    // 2回目も効く(開く合図を下ろせている)
    await key({ key: 'Enter', code: 13, ctrl: true });
    await wait(500);
    check('N-3c 同じ行で続けて押しても開く', (await memoAt()).欄 === true, await memoAt());
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      新しい Task は、空いている場所に置く(FR-1)。

      重なると、下のカードの行が上のカードに覆われて押せなくなる。押した先は
      覆っている側の Task なので、印はそちらの親に出る —— 「childTask を
      押したのに親に印が出る」という報告の実体がこれだった。

      ここまでで Task を数件作ってある。運んではいないので、重なりがあれば
      置き場所の決め方が原因である。
    */
    const overlaps = await evaluate(`
      const cards = [...document.querySelectorAll('.react-flow__node-task')].map((n) => ({
        名: n.querySelector('.task-title')?.textContent ?? '?',
        r: n.getBoundingClientRect(),
      }));
      const hits = [];
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i].r;
          const b = cards[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            hits.push(cards[i].名 + ' × ' + cards[j].名);
          }
        }
      }
      return hits;
    `);
    check('N-4 作った Task のカードはどれも重なっていない', overlaps.length === 0, overlaps);
    /*
      印のある状態の Shift+Enter で、その Task に childTask を1件足す(FR-2)。

      名前を打っている最中の Shift+Enter と同じ結果になる。一度確定したあと
      もう1件足すのに、マウスへ手を戻す必要がなくなる。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await pressRow('.task-head', heads - 1);
    const rowsBeforeAdd = await evaluate(`return document.querySelectorAll('.child').length`);
    await key({ key: 'Enter', code: 13, shift: true });
    await wait(700);
    check(
      'N-5a 印のある状態の Shift+Enter で childTask が1件増える',
      (await evaluate(`return document.querySelectorAll('.child').length`)) === rowsBeforeAdd + 1,
      {
        before: rowsBeforeAdd,
        after: await evaluate(`return document.querySelectorAll('.child').length`),
      },
    );
    check('N-5b そのまま名前を打ち始められる', (await waitForFocus()) >= 0);

    /*
      足した行へ印も移る(FR-2)。

      打ち終わったあとの Delete / Ctrl+Enter / Shift+↑↓ は印を相手にするので、
      印が前の行に残っていると **見ている行と相手になる行が違う**。画面では
      区別が付かないため、目で見る確認では捕まらない種類の食い違いである。
    */
    await type('足した行');
    await key({ key: 'Enter', code: 13 });
    await waitFor('入力欄が閉じる', `return !document.querySelector('.text-input')`);
    await wait(200);
    check(
      'N-5c 打ち終わると、印は足した行に付いている',
      (await markOn()).行 === '足した行',
      await markOn(),
    );

    /*
      取り消して行が消えたときは、印も戻り先へ移る(FR-2)。既定の名前は選択
      された状態で入っているので、Backspace 2回 —— 1回目で空にし、2回目で
      その childTask を消す。
    */
    await key({ key: 'Enter', code: 13, shift: true });
    await waitForFocus();
    await key({ key: 'Backspace', code: 8 });
    await key({ key: 'Backspace', code: 8 });
    /*
      ここで入力欄は閉じない。消したぶん1つ上の名前へ移る(FR-2)ので、
      「閉じるのを待つ」ではなく「上の名前が入っているのを待つ」。
    */
    await waitFor(
      '1つ上の名前の入力へ戻る',
      `return document.querySelector('.text-input')?.value === '足した行'`,
    );
    // 編集中の行は名前が入力欄になっていて読めないので、閉じてから印を見る。
    await key({ key: 'Escape', code: 27 });
    await waitFor('入力欄が閉じる', `return !document.querySelector('.text-input')`);
    await wait(200);
    check(
      'N-5d 取り消して行が消えると、印は戻り先の行に付いている',
      (await markOn()).行 === '足した行',
      await markOn(),
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      メモの中を押しても、メモは閉じない(FR-10)。

      行がフォーカスを受け取るようにしたとき、入力欄の中の押下でも行へ移して
      いた。メモはフォーカスが外れた時点で確定する作りなので、キャレットを
      動かそうとしただけで閉じていた。
    */
    await pressRow('.task-head', heads - 1);
    await key({ key: 'Enter', code: 13, ctrl: true });
    await waitFor('メモの入力欄が開く', `return !!document.querySelector('.memo-input')`);
    await type('一行目のメモ');
    const inMemo = await evaluate(`
      const el = document.querySelector('.memo-input');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    await mouse('mousePressed', inMemo.x, inMemo.y, { buttons: 1 });
    await mouse('mouseReleased', inMemo.x, inMemo.y, { buttons: 0 });
    await wait(300);
    const memoStill = await evaluate(`
      const a = document.activeElement;
      return {
        開いている: !!document.querySelector('.memo-input'),
        焦点が欄にある: a?.className?.includes?.('memo-input') ?? false,
        値: document.querySelector('.memo-input')?.value ?? null,
      };
    `);
    check(
      'N-6 メモの中を押しても閉じない',
      memoStill.開いている && memoStill.焦点が欄にある && memoStill.値 === '一行目のメモ',
      memoStill,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    /*
      取り消した下書きは戻らない(FR-1)。

      Escape で取り消したあと Enter で開き直すと、取り消したはずの文字列が
      入力欄に現れていた。クリックで入る経路だけが下書きを詰め替えていたため。
    */
    await pressRow('.task-head', heads - 1);
    await key({ key: 'Enter', code: 13 });
    await waitFor(
      '名前の入力欄が開く',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    const beforeEscape = await evaluate(
      `return document.querySelector('.task-head .text-input')?.value ?? null`,
    );
    await type('捨てる文字列');
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    await key({ key: 'Enter', code: 13 });
    await waitFor(
      '名前の入力欄が開き直す',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    const reopened = await evaluate(
      `return document.querySelector('.task-head .text-input')?.value ?? null`,
    );
    check('N-7 取り消した下書きは戻らない', reopened === beforeEscape, { beforeEscape, reopened });
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    /*
      続けて2件作っても重ならない(FR-1)。

      作った結果がスナップショットに現れるまでには IPC の往復がある。その間に
      もう1件作ると、どちらも同じ空き桝を選ぶ。
    */
    await fitView();
    const beforeBurst = await taskCount();
    await evaluate(`
      const b = [...document.querySelectorAll('.toolbar button')].find((x) => x.textContent.includes('Task'));
      b.click();
      b.click();
      return 1;
    `);
    await wait(1200);
    check('N-8a 続けて2件作ると2件増える', (await taskCount()) === beforeBurst + 2, {
      before: beforeBurst,
      after: await taskCount(),
    });
    const burstOverlaps = await evaluate(`
      const cards = [...document.querySelectorAll('.react-flow__node-task')].map((n) => ({
        名: n.querySelector('.task-title')?.textContent ?? '?',
        r: n.getBoundingClientRect(),
      }));
      const hits = [];
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i].r;
          const b = cards[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            hits.push(cards[i].名 + ' × ' + cards[j].名);
          }
        }
      }
      return hits;
    `);
    check('N-8b そのとき重ならない', burstOverlaps.length === 0, burstOverlaps);
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      入力欄の中のキーは、キャンバスへ渡らない。

      **この境界は壊れても画面に出ない。** 実際に、入力欄側で止める処理を外して
      probe を全部走らせても1件も落ちなかった(実測)。落ちないまま、名前を
      打っている最中の Cmd+Z がグラフを1手戻す、という壊れ方になる。
      キーの扱いを整理するときに真っ先に踏むところなので、ここで固定する。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    const namesNow = () =>
      evaluate(`return [...document.querySelectorAll('.task-title')].map((t) => t.textContent)`);
    await pressRow('.task-head', heads - 1);
    await key({ key: 'Enter', code: 13 });
    await waitFor(
      '名前の入力欄が開く',
      `return !!document.querySelector('.task-head .text-input')`,
    );
    await waitForFocus();
    const graphBefore = { tasks: await taskCount(), names: await namesNow() };
    await type('打っている途中');
    await key({ key: 'z', code: 90, meta: true });
    await wait(500);
    const graphAfter = { tasks: await taskCount(), names: await namesNow() };
    check(
      'O-1 名前を打っている最中の Cmd+Z は、グラフを戻さない',
      graphAfter.tasks === graphBefore.tasks &&
        JSON.stringify(graphAfter.names) === JSON.stringify(graphBefore.names),
      { before: graphBefore, after: graphAfter },
    );
    check(
      'O-1b そのとき入力欄は開いたまま',
      await evaluate(`return !!document.querySelector('.task-head .text-input')`),
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);

    /*
      Cmd+Shift+Z でやり直せる(FR-8)。Undo だけを見ていて、戻す側は見ていなかった。
    */
    const beforeUndo = await taskCount();
    await clickToolbar('Task');
    await wait(600);
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    const afterAdd = await taskCount();
    await key({ key: 'z', code: 90, meta: true });
    await wait(600);
    const afterUndo = await taskCount();
    await key({ key: 'z', code: 90, meta: true, shift: true });
    await wait(600);
    const afterRedo = await taskCount();
    check(
      'O-2 Cmd+Shift+Z で、戻した1手をやり直せる',
      afterAdd === beforeUndo + 1 && afterUndo === beforeUndo && afterRedo === afterAdd,
      { beforeUndo, afterAdd, afterUndo, afterRedo },
    );

    /*
      ここから先は、印(Shift+↑↓ が動かす、Enter / Delete の相手)が
      「画面に出ている行だけを対象にする」という規則(requirements.md FR-1)の
      抜けを塞ぐ。折りたたみ・完了非表示は、どちらも childTask の行を画面
      から消すが、消し方が違う(前者は task.collapsed、後者は表示のフィルタ)。
      同じ「隠れている」でも経路が違うため、それぞれ別に確かめる。
    */

    /** 名前で探した Task ノード(.react-flow__node-task)を返す式。 */
    const taskNodeExpr = (title) =>
      `[...document.querySelectorAll('.react-flow__node-task')].find((n) => n.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;
    /** 名前で探した childTask の行(.child)を返す式。 */
    const childRowExpr = (title) =>
      `[...document.querySelectorAll('.child')].find((c) => c.querySelector('.child-title')?.textContent === ${JSON.stringify(title)})`;
    /** 名前の Task の見出し(.task-head)が、document 内で何番目かを返す。pressRow に渡す。 */
    const taskHeadIndexOf = (title) =>
      evaluate(`
        return [...document.querySelectorAll('.task-head')].findIndex(
          (h) => h.querySelector('.task-title')?.textContent === ${JSON.stringify(title)}
        );
      `);
    /**
     * 式が指す要素を実際のマウスで押す。ボタンに限らず、行の中の要素なら何でもよい
     * (state-toggle は button だが onClick、childTask の取っ手などは onPointerDown で
     * 効くため、pressButton のように onPointerDown 専用にはしない)。
     */
    const clickElement = async (expr) => {
      const at = await evaluate(`
        const el = ${expr};
        if (!el) throw new Error('要素が見つからない');
        const r = el.getBoundingClientRect();
        const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        // state-toggle は中に .state-box を持つので、当たった相手が el 自身とは
        // 限らない。el の中であればよい(pressButton と同様、覆われてはいないこと)。
        if (!el.contains(document.elementFromPoint(p.x, p.y))) {
          throw new Error('要素が覆われている');
        }
        return p;
      `);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
      await wait(300);
    };

    /*
      折りたたんだ Task(requirements.md FR-1「折りたたんでいる間の childTask には
      移らない」/ FR-6「折りたたんでいる間は、隠れている childTask の件数を表示」)。

      畳んでいる間、childTask の行は画面に無い。Shift+↑↓ で印は動かず、
      Enter は親の名前を開き、Delete は親そのものの削除確認を開くはず ——
      隠れている childTask のどれかが代わりに巻き添えになってはならない。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await addTask('折りたたみ確認', ['かくれ1', 'かくれ2']);
    await fitView();

    let headIdx = await taskHeadIndexOf('折りたたみ確認');
    await pressRow('.task-head', headIdx);
    check('P-1a 作った直後、印は親に出ている', (await markOn()).親 === true, await markOn());

    await clickElement(
      `${taskNodeExpr('折りたたみ確認')}?.querySelector('.state-button[title="折りたたむ"]')`,
    );
    const collapsedChildCount = await evaluate(
      `return ${taskNodeExpr('折りたたみ確認')}.querySelectorAll('.child').length;`,
    );
    check('P-1b 畳むと childTask の行が画面から消える', collapsedChildCount === 0, {
      collapsedChildCount,
    });

    headIdx = await taskHeadIndexOf('折りたたみ確認');
    await pressRow('.task-head', headIdx);
    check('P-2a 畳んだ Task を選ぶと印は親に出る', (await markOn()).親 === true, await markOn());

    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    check(
      'P-2b 畳んでいる間は Shift+↓ を押しても印が動かない',
      (await markOn()).親 === true,
      await markOn(),
    );

    await key({ key: 'ArrowUp', code: 38, shift: true });
    await wait(200);
    check(
      'P-2c 畳んでいる間は Shift+↑ を押しても印が動かない',
      (await markOn()).親 === true,
      await markOn(),
    );

    await key({ key: 'Enter', code: 13 });
    await wait(400);
    const collapsedEnter = await evaluate(`
      const a = document.activeElement;
      return {
        値: a?.value ?? null,
        場所: a?.closest('.child') ? 'childTask' : a?.closest('.task-head') ? '親' : 'その他',
      };
    `);
    check(
      'P-2d 畳んでいる間の Enter は、隠れた childTask ではなく親の名前を開く',
      collapsedEnter.場所 === '親' && collapsedEnter.値 === '折りたたみ確認',
      collapsedEnter,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    headIdx = await taskHeadIndexOf('折りたたみ確認');
    await pressRow('.task-head', headIdx);
    await key({ key: 'Delete', code: 46 });
    await wait(400);
    const collapsedDelete = await evaluate(`
      return {
        開いている: !!document.querySelector('dialog[open]'),
        対象: document.querySelector('dialog[open] .doomed')?.textContent ?? null,
      };
    `);
    check(
      'P-2e 畳んでいる間の Delete は、childTask ではなく親そのものの削除確認を開く',
      collapsedDelete.開いている && collapsedDelete.対象 === '折りたたみ確認',
      collapsedDelete,
    );
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    const afterCancelledDelete = await evaluate(
      `return ${taskNodeExpr('折りたたみ確認')}?.querySelector('.state-button.is-collapsed')?.textContent ?? null;`,
    );
    check(
      'P-2f 取り消すと畳んだ Task はそのまま残る(childTask も2件のまま)',
      afterCancelledDelete === '▸ 2',
      { afterCancelledDelete },
    );

    /*
      「完了を非表示」(requirements.md FR-6)を点けている間、隠れている
      childTask に印が移らないこと。完了は state-toggle で切り替える
      (FR-5)。折りたたみと違い、こちらは表示側のフィルタで隠す。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await addTask('完了非表示確認', ['済ませる', '残す']);
    await fitView();

    // '済ませる' を完了にする(未着手 → 着手中 → 完了、と2回押して進める)
    const doneToggleExpr = `${childRowExpr('済ませる')}?.querySelector('.state-toggle')`;
    await clickElement(doneToggleExpr);
    await clickElement(doneToggleExpr);
    const doneClass = await evaluate(`return ${childRowExpr('済ませる')}?.className ?? null;`);
    check('Q-0 「済ませる」を完了の状態にできた', (doneClass ?? '').includes('is-done'), {
      doneClass,
    });

    await clickElement(`document.querySelector('.toolbar input[type="checkbox"]')`);
    await wait(300);
    const hiddenAfterToggle = await evaluate(`return ${childRowExpr('済ませる')} === undefined;`);
    check(
      'Q-1 完了を非表示にすると、完了した childTask の行が画面から消える',
      hiddenAfterToggle === true,
      { hiddenAfterToggle },
    );

    headIdx = await taskHeadIndexOf('完了非表示確認');
    await pressRow('.task-head', headIdx);
    check('Q-2a 選んだ直後、印は親に出ている', (await markOn()).親 === true, await markOn());

    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    check(
      'Q-2b Shift+↓ で印は隠れていない行(残す)へ移る',
      (await markOn()).行 === '残す',
      await markOn(),
    );

    await key({ key: 'ArrowDown', code: 40, shift: true });
    await wait(200);
    check(
      'Q-2c 続けて Shift+↓ を押しても、隠れている「済ませる」へは移らない(一番下で止まる)',
      (await markOn()).行 === '残す',
      await markOn(),
    );

    await key({ key: 'Delete', code: 46 });
    await wait(400);
    const afterVisibleDelete = await evaluate(`
      return {
        残す: !!${childRowExpr('残す')},
        済ませる: !!${childRowExpr('済ませる')},
      };
    `);
    check(
      'Q-3a Delete は印のある「残す」だけを消す',
      afterVisibleDelete.残す === false,
      afterVisibleDelete,
    );

    // 完了を非表示を解除して、隠れていた「済ませる」が巻き添えで消えていないことを確かめる
    await clickElement(`document.querySelector('.toolbar input[type="checkbox"]')`);
    await wait(300);
    const stillThere = await evaluate(`return !!${childRowExpr('済ませる')};`);
    check('Q-3b 隠れていた「済ませる」は削除の巻き添えにならず残っている', stillThere === true, {
      stillThere,
    });

    /*
      状態の四角(.state-toggle)を押したときにも、押した行へ印が移ること
      (requirements.md FR-1「押した行にも印が移る」)。N-2 は行の余白と
      取っ手で確かめている。ここは同じ行にあるボタンの上で確かめる ——
      ボタンの上だけ例外的に印が動かない、という抜けを塞ぐ。

      フォーカスも同じ行が受けること(FR-1)を併せて見る。かつてはここだけ
      効いていなかった —— state-toggle は button なので、押すとブラウザの
      既定でボタン自身にフォーカスが着き、pressRow が先に行へ移していても
      後から上書きされていた(#11)。見た目には出ないが、そこから先のキー操作の
      起点になる値である。

      既定を止めただけで onClick は残してあるので、**キーボードから起動できる
      ことも見る** —— onPress に寄せるとその経路が消える。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await addTask('状態四角確認', ['状態あ', '状態い']);
    await fitView();

    headIdx = await taskHeadIndexOf('状態四角確認');
    await pressRow('.task-head', headIdx);
    check('R-1a 選んだ直後、印は親に出ている', (await markOn()).親 === true, await markOn());

    await clickElement(`${childRowExpr('状態い')}?.querySelector('.state-toggle')`);
    check(
      'R-1b 状態の四角を押すと、その行へ印が移る',
      (await markOn()).行 === '状態い',
      await markOn(),
    );
    /*
      **行そのものがフォーカスを持っていることを見る。** 内側にあるかどうかでは
      足りない —— 四角は行の子なので、ボタンにフォーカスが着いていても
      closest('.child') は行を返す。それで通してしまい、壊しても落ちない検査に
      なっていた(実際に踏んだ)。
    */
    const focusAfterToggle = await evaluate(`
      const a = document.activeElement;
      return {
        行そのもの: a?.classList?.contains('child') ?? false,
        行の名前: a?.closest('.child')?.querySelector('.child-title')?.textContent ?? null,
        要素: a?.className ?? null,
      };
    `);
    check(
      'R-1c 状態の四角を押すと、フォーカスもその行へ移る',
      focusAfterToggle.行そのもの && focusAfterToggle.行の名前 === '状態い',
      focusAfterToggle,
    );

    await clickElement(
      `${taskNodeExpr('状態四角確認')}?.querySelector('.task-head .state-toggle')`,
    );
    check(
      'R-1d 親の状態の四角を押すと、印は親へ戻る',
      (await markOn()).親 === true,
      await markOn(),
    );

    /*
      Tab は使わない(FR-1)。ダイアログの外では、押してもフォーカスは動かない。

      巡回させると、ツールバーのボタンにフォーカスがあるのに Enter が選んでいる
      Task の名前を開く、という食い違いが出た。印の付いた行から何度押しても、
      フォーカスはその行に留まること。
    */
    headIdx = await taskHeadIndexOf('状態四角確認');
    await pressRow('.task-head', headIdx);
    const focusBeforeTab = await evaluate(`return document.activeElement?.className ?? null`);
    for (let i = 0; i < 5; i += 1) {
      await key({ key: 'Tab', code: 9 });
      await key({ key: 'Tab', code: 9, shift: true });
    }
    await wait(100);
    const focusAfterTab = await evaluate(`return document.activeElement?.className ?? null`);
    check(
      'R-1e Tab / Shift+Tab を押しても、フォーカスは動かない',
      focusBeforeTab !== null && focusAfterTab === focusBeforeTab,
      { focusBeforeTab, focusAfterTab },
    );
    await key({ key: 'Escape', code: 27 });
    await wait(200);

    /*
      拡大率を上げた状態で Task を作っても、カードは重ならない(requirements.md
      FR-1「新しい Task は、既にある Task に重ならない場所に置く。探すのは今
      見えている範囲の中」)。拡大するとその範囲(キャンバス座標)は狭くなる ——
      桝の数が減っても重ならずに置けることを確かめる。
    */
    await key({ key: 'Escape', code: 27 });
    await wait(200);
    await fitView();

    const viewport = () =>
      evaluate(`
        const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
        const m = new DOMMatrixReadOnly(t);
        return { x: Math.round(m.e), y: Math.round(m.f), zoom: Number(m.a.toFixed(3)) };
      `);
    const paneCentre = await evaluate(`
      const r = document.querySelector('.react-flow__pane').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);

    const zoomBefore = (await viewport()).zoom;
    /*
      トラックパッドのピンチは、macOS では ctrlKey 付きの wheel として届く
      (project.mjs の N-3 と同じ)。ピンチそのものは送れないので、同じ形の
      入力で確かめる。負の deltaY が拡大方向(project.mjs の N-3 で、正の
      deltaY を縮小方向と確かめている)。
    */
    for (let i = 0; i < 25; i += 1) {
      await wheel(paneCentre, { deltaY: -120, modifiers: 2 });
      await wait(30);
    }
    await wait(300);
    const zoomAfter = (await viewport()).zoom;
    check('S-1 ピンチ相当の入力を繰り返すと拡大率が上がる', zoomAfter > zoomBefore, {
      zoomBefore,
      zoomAfter,
    });

    const beforeZoomedCount = await taskCount();
    for (let i = 0; i < 3; i += 1) {
      await clickToolbar('Task');
      await waitFor(
        `拡大した状態で ${i + 1} 件目の Task が増える`,
        `return document.querySelectorAll('.task').length === ${beforeZoomedCount + i + 1}`,
      );
      await key({ key: 'Escape', code: 27 });
      await wait(200);
    }
    check(
      'S-2a 拡大した状態で続けて3件作ると3件増える',
      (await taskCount()) === beforeZoomedCount + 3,
      { before: beforeZoomedCount, after: await taskCount() },
    );
    const zoomedOverlaps = await evaluate(`
      const cards = [...document.querySelectorAll('.react-flow__node-task')].map((n) => ({
        名: n.querySelector('.task-title')?.textContent ?? '?',
        r: n.getBoundingClientRect(),
      }));
      const hits = [];
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i].r;
          const b = cards[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            hits.push(cards[i].名 + ' × ' + cards[j].名);
          }
        }
      }
      return hits;
    `);
    check(
      'S-2b 拡大した状態で作ってもカードは重ならない',
      zoomedOverlaps.length === 0,
      zoomedOverlaps,
    );

    /*
      作った Task が表示範囲(.react-flow)に収まる(issue #10)。

      findFreeTaskSlot は桝の数を SLOT_STEP(間隔 260)だけから決めていたため、
      それより広い候補(NEW_TASK_SIZE の 280)の右端が表示範囲から欠けた。
      表示範囲の幅が 520 のとき、2列目は 260+280=540 まで伸びる。

      **既定の名前のままでは、この欠けは目に見えない。** 実測すると、名前が
      「新しいタスク」のカードは 181px しかなく(拡大率2倍で 363px)、2列目に
      置かれても表示範囲の内側に収まってしまう。280 は styles.css の
      `.task { max-width: 280px }` —— つまり**名前が長いときの幅**である。
      そのため、ここでは長い名前を打って最大幅まで広げた状態で確かめる。

      既にある Task もそのまま残っているため、まずそれらの外側 —— まだ何も
      ない場所までスクロールする。そうしないと桝がどれも既存の Task と重なり、
      「一番下の下」へ逃げる既存の経路ばかりを踏むことになり、直したいはみ出し
      そのものを確かめられない。
    */
    await setViewportSize(1088, 860);
    await wait(300);
    const paneCentreNarrow = await evaluate(`
      const r = document.querySelector('.react-flow__pane').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    const flowArea = () =>
      evaluate(`
        const r = document.querySelector('.react-flow').getBoundingClientRect();
        const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
        const m = new DOMMatrixReadOnly(t);
        const margin = 24;
        const toFlow = (x, y) => ({ x: (x - m.e) / m.a, y: (y - m.f) / m.a });
        const tl = toFlow(r.left + margin, r.top + margin);
        const br = toFlow(r.right - margin, r.bottom - margin);
        return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
      `);

    /*
      窓の幅 1088 が「2列目がはみ出す幅」になるのは、拡大率が2倍のときだけ ——
      (1088 - 余白48) / 2 = 520。S-1 で上限(React Flow の既定は2倍)まで
      上げてあることに依存しているので、ここで確かめておく。上限が変わったら、
      静かに別の条件を試すのではなく、この検査が落ちるようにする。
    */
    const zoomHere = (await viewport()).zoom;
    const areaWidthHere = (await flowArea()).width;
    check(
      'S-2c 拡大率が2倍で、表示範囲の幅が 520(2列目がはみ出す条件)',
      zoomHere === 2 && Math.round(areaWidthHere) === 520,
      { zoomHere, areaWidthHere },
    );

    const graphMaxY = await evaluate(`
      const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
      const m = new DOMMatrixReadOnly(t);
      const bottoms = [...document.querySelectorAll('.react-flow__node')].map(
        (n) => (n.getBoundingClientRect().bottom - m.f) / m.a,
      );
      return Math.max(...bottoms);
    `);
    const clearance = 150;
    for (let i = 0; i < 60 && (await flowArea()).y < graphMaxY + clearance; i += 1) {
      await wheel(paneCentreNarrow, { deltaY: 300 });
      await wait(20);
    }
    await wait(300);
    const areaForNew = await flowArea();
    check(
      'S-2d 空き地までスクロールできる(既存の Task の外側)',
      areaForNew.y >= graphMaxY + clearance,
      { areaForNew, graphMaxY },
    );

    /*
      2列目に置かれる条件は「1列目のカードが細いこと」である —— 桝の間隔は 260
      なので、1件目が既に最大幅(280)まで広がっていると2列目の候補はそれと
      重なり、桝は縦へ送られる。実測でここに1度はまった。

      そのため、短い名前で2件作って2件目を2列目へ置かせ、**その後で名前を
      長くして**最大幅まで広げる。NEW_TASK_SIZE が最大幅なのは「後から広がる
      ぶんの場所を取っておく」ためなので、これがその取り置きが効いているかを
      見る形になる。
    */
    await addTask('細1');
    await wait(200);
    await addTask('細2');
    await wait(300);

    const narrowWidths = await evaluate(`
      const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
      const m = new DOMMatrixReadOnly(t);
      return ['細1', '細2'].map((name) => {
        const n = [...document.querySelectorAll('.react-flow__node-task')].find(
          (x) => x.querySelector('.task-title')?.textContent === name,
        );
        return n ? Math.round(n.getBoundingClientRect().width / m.a) : null;
      });
    `);
    check(
      'S-3a 短い名前の2件は、桝の間隔(260)より細い',
      narrowWidths.every((w) => w !== null && w < 260),
      { narrowWidths },
    );

    const longName = 'はみ出しの確認。名前が長いとカードは最大幅まで広がる';
    const narrowIdx = await taskHeadIndexOf('細2');
    await pressRow('.task-head', narrowIdx);
    await key({ key: 'Enter', code: 13 });
    await waitForFocus();
    await type(longName);
    await key({ key: 'Enter', code: 13 });
    await waitFor('入力欄が閉じる', `return !document.querySelector('.text-input')`);
    await wait(300);

    const grown = await evaluate(`
      const round = (n) => Math.round(n);
      const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
      const m = new DOMMatrixReadOnly(t);
      const n = [...document.querySelectorAll('.react-flow__node-task')].find(
        (x) => x.querySelector('.task-title')?.textContent === ${JSON.stringify(longName)},
      );
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const a = document.querySelector('.react-flow').getBoundingClientRect();
      return {
        幅: round(r.width / m.a),
        矩形: { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom) },
        表示範囲: { left: round(a.left), top: round(a.top), right: round(a.right), bottom: round(a.bottom) },
      };
    `);
    check('S-3b 名前を長くするとカードは最大幅(280)まで広がる', grown?.幅 === 280, grown);
    check(
      'S-3c 広がったカードは表示範囲からはみ出さない',
      grown !== null &&
        grown.矩形.left >= grown.表示範囲.left &&
        grown.矩形.right <= grown.表示範囲.right &&
        grown.矩形.top >= grown.表示範囲.top &&
        grown.矩形.bottom <= grown.表示範囲.bottom,
      grown,
    );
  },
};
