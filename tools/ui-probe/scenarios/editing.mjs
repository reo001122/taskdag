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

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, mouse, check }) {
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
    const taskCount = () => evaluate(`return document.querySelectorAll('.task').length`);
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
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
    );
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
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(500);

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
    check('N-1a 選んだ直後は親 Task を指している', (await mark()).親 === true, await mark());

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

      取っ手は運搬を始めるために pointerdown を止めている(childDrag.ts)。
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
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(400);
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
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
    );
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
  },
};
