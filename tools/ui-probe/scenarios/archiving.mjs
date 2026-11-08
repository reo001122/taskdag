/**
 * 完了した Task のアーカイブ(FR-11)
 *
 * 受け入れ条件をそのまま見る。完了 Task を3件含むグラフで「完了をアーカイブ」を
 * 実行すると3件がキャンバスから消えて一覧に出る、Cmd+Z 1回で全部戻る、
 * A → B(完了) → C の B をアーカイブしても C は Blocked のまま。
 *
 * 内部の API は呼ばない。本物のマウスとキーで、押した結果を DOM から読む。
 */ import { actions } from '../actions.mjs';

export default {
  name: 'archiving',
  description: 'G. 完了した Task をアーカイブへ移し、一覧で読める',

  async run(ctx) {
    const { evaluate, waitFor, wait, key, mouse, check, emulateColorScheme } = ctx;
    const { addTask, fitView, connect, edgeCount, locatePoint } = actions(ctx);

    const find = (title) => `[...document.querySelectorAll('.task')]
      .find((t) => t.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;

    /** 状態を完了まで進める。1回ごとに反映を待つ(次の状態は今の状態で決まる)。 */
    const finish = async (title) => {
      for (let i = 0; i < 2; i += 1) {
        const was = await evaluate(
          `return ${find(title)}.querySelector('.state-toggle').className`,
        );
        await evaluate(`${find(title)}.querySelector('.state-toggle').click(); return 1;`);
        await waitFor(
          `${title} の状態が変わる`,
          `return ${find(title)}?.querySelector('.state-toggle')?.className !== ${JSON.stringify(was)}`,
        );
      }
    };

    const taskTitles = () =>
      evaluate(
        `return [...document.querySelectorAll('.task-title')].map((t) => t.textContent).sort()`,
      );
    const toolbarButton = (text) => `[...document.querySelectorAll('.toolbar button')]
      .find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
    const toolbarLabels = () =>
      evaluate(
        `return [...document.querySelectorAll('.toolbar button')].map((b) => b.textContent.trim())`,
      );
    const press = (text) => evaluate(`${toolbarButton(text)}.click(); return 1;`);
    const disabled = (text) => evaluate(`return ${toolbarButton(text)}.disabled`);

    /** 名前の横の「アーカイブ」の札の座標。押した時点で効くので、本物のマウスで押す(FR-11)。 */
    const archiveButtonOf = (title) =>
      locatePoint({
        container: '.task-wrap',
        nameSelector: '.task-title',
        name: title,
        part: '.archive-badge',
      });
    const pressArchiveOf = async (title) => {
      const at = await archiveButtonOf(title);
      await mouse('mousePressed', at.x, at.y, { buttons: 1 });
      await mouse('mouseReleased', at.x, at.y, { buttons: 0 });
    };
    const archiveButtonCount = (title) =>
      evaluate(`
        const wrap = [...document.querySelectorAll('.task-wrap')]
          .find((el) => el.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        return wrap.querySelectorAll('.task-head .archive-badge').length;
      `);

    const undo = async () => {
      await key({ key: 'z', code: 90, meta: true });
      await wait(600);
    };
    const dialogText = () =>
      evaluate(`return document.querySelector('dialog[open]')?.textContent ?? ''`);
    const confirmDialog = async () => {
      await evaluate(`document.querySelector('dialog[open] .primary').click(); return 1;`);
      await waitFor('確認が閉じる', `return !document.querySelector('dialog[open]')`);
    };
    const edgeRows = (kind) =>
      evaluate(`
        return [...document.querySelectorAll('dialog[open] .edge-list.is-${kind} li')]
          .map((li) => [...li.children].map((c) => c.textContent).join(''));
      `);

    const archiveItems = () =>
      evaluate(
        `return [...document.querySelectorAll('.archive-item')].map((el) => ({
          title: el.querySelector('.archive-title').textContent,
          date: el.querySelector('.archive-date')?.textContent ?? '',
          project: el.querySelector('.archive-project')?.textContent ?? null,
          memo: el.querySelector(':scope > .archive-memo')?.textContent ?? '',
          children: [...el.querySelectorAll('.archive-children li')].map((li) => li.textContent),
        }))`,
      );
    const viewOpen = () => evaluate(`return !!document.querySelector('.archive-view')`);
    const canvasVisible = () =>
      evaluate(`
        const el = document.querySelector('.react-flow');
        return !!el && el.getBoundingClientRect().width > 0;
      `);

    // --- 前提: 完了3件と未完了1件 -----------------------------------------
    await addTask('X', ['x子']);
    await addTask('Y');
    await addTask('Z');
    await addTask('W');
    await fitView();

    check(
      'G-0a 完了した Task が無いとき「完了をアーカイブ」は押せない',
      await disabled('完了をアーカイブ'),
    );
    check('G-0b 未完了の Task にアーカイブの札は出ない', (await archiveButtonCount('X')) === 0);

    for (const t of ['X', 'Y', 'Z']) await finish(t);
    check('G-0c 完了した Task があれば押せる', !(await disabled('完了をアーカイブ')));
    check(
      'G-1a アーカイブの札は完了した Task にだけ出る',
      (await archiveButtonCount('X')) === 1 &&
        (await archiveButtonCount('Y')) === 1 &&
        (await archiveButtonCount('Z')) === 1 &&
        (await archiveButtonCount('W')) === 0,
      {
        X: await archiveButtonCount('X'),
        W: await archiveButtonCount('W'),
      },
    );
    const badgeLook = await evaluate(`
      const wrap = [...document.querySelectorAll('.task-wrap')]
        .find((el) => el.querySelector('.task-title')?.textContent === 'X');
      const badge = wrap.querySelector('.task-head .archive-badge');
      const title = wrap.querySelector('.task-head .task-title');
      const b = badge.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      return {
        text: badge.textContent,
        tabIndex: badge.tabIndex,
        nodrag: badge.classList.contains('nodrag'),
        fontSize: parseFloat(getComputedStyle(badge).fontSize),
        gap: Math.round(b.left - t.right),
        sameLine: b.top < t.bottom && b.bottom > t.top,
        inActions: !!wrap.querySelector('.task-actions .archive-badge'),
        actionMarks: [...wrap.querySelectorAll('.task-actions button')].map((e) => e.textContent).join(''),
      };
    `);
    check(
      'G-1b 札は文字で「片付ける」と書かれ、名前のすぐ右に並ぶ',
      badgeLook.text === '片付ける' &&
        badgeLook.tabIndex === -1 &&
        badgeLook.nodrag &&
        badgeLook.fontSize >= 10 &&
        badgeLook.fontSize <= 11 &&
        badgeLook.sameLine &&
        badgeLook.gap >= 0 &&
        badgeLook.gap <= 12,
      badgeLook,
    );
    check(
      'G-1c 見出しのボタン列に ⤓ は無い(✎ ＋ × だけ)',
      !badgeLook.inActions && !badgeLook.actionMarks.includes('⤓'),
      badgeLook.actionMarks,
    );

    // 名前が長くても札は押し出されない(名前のほうが折り返す)。DOM の文字だけを一時的に差し替えて測る
    const longLook = await evaluate(`
      const wrap = [...document.querySelectorAll('.task-wrap')]
        .find((el) => el.querySelector('.task-title')?.textContent === 'X');
      const title = wrap.querySelector('.task-head .task-title');
      const original = title.textContent;
      title.textContent = '非常に長い名前の Task '.repeat(8);
      const node = wrap.querySelector('.task').getBoundingClientRect();
      const b = wrap.querySelector('.task-head .archive-badge').getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const out = { badgeRight: b.right, nodeRight: node.right, badgeWidth: b.width, titleHeight: t.height, badgeLeft: b.left, titleRight: t.right };
      title.textContent = original;
      return out;
    `);
    check(
      'G-1d 名前が長くても札はノードの内側に残り、名前が折り返す',
      longLook.badgeWidth > 30 &&
        longLook.badgeRight <= longLook.nodeRight &&
        longLook.badgeLeft >= longLook.titleRight &&
        longLook.titleHeight > 30,
      longLook,
    );

    // --- まとめて。非表示にしている完了 Task も対象(FR-11) ---------------
    await evaluate(`document.querySelector('.toolbar input[type=checkbox]').click(); return 1;`);
    await waitFor('完了が隠れる', `return document.querySelectorAll('.task').length === 1`);
    await press('完了をアーカイブ');
    await waitFor('確認が開く', `return !!document.querySelector('dialog[open]')`);
    const text = await dialogText();
    check('G-2a 何件移すかを確認で伝える(非表示の分も数える)', /3\s*件/.test(text), text);
    check('G-2b 子タスクが何件移るかも伝える', /子タスク\s*1\s*件/.test(text), text);
    await key({ key: 'Escape', code: 27 });
    await wait(300);
    check('G-2c Escape では何も移らない', (await taskTitles()).join() === 'W', await taskTitles());
    await press('完了をアーカイブ');
    await waitFor('確認が開く', `return !!document.querySelector('dialog[open]')`);
    await confirmDialog();
    await evaluate(`document.querySelector('.toolbar input[type=checkbox]').click(); return 1;`);
    await waitFor(
      'キャンバスに W だけが残る',
      `return document.querySelectorAll('.task').length === 1`,
    );
    check(
      'G-3a 3件がキャンバスから消え、未完了だけが残る',
      (await taskTitles()).join() === 'W',
      await taskTitles(),
    );
    check(
      'G-3b 完了が無くなったので「完了をアーカイブ」は押せない',
      await disabled('完了をアーカイブ'),
    );

    // --- 一覧(画面の切り替え) -------------------------------------------
    await press('アーカイブ一覧');
    await waitFor('一覧が出る', `return !!document.querySelector('.archive-view')`);
    check(
      'G-4j 一覧を出している間、ツールバーのボタンは「キャンバスに戻る」になる',
      (await toolbarLabels()).includes('キャンバスに戻る') &&
        !(await toolbarLabels()).includes('アーカイブ一覧'),
      await toolbarLabels(),
    );
    let items = await archiveItems();
    check('G-4a 一覧に3件出る', items.length === 3, items);
    check(
      'G-4b 一覧は読むだけ(ボタン・入力欄が無い)',
      await evaluate(
        `return document.querySelectorAll('.archive-view button, .archive-view input, .archive-view textarea').length === 0`,
      ),
    );
    const x = items.find((i) => i.title === 'X');
    check(
      'G-4c childTask の名前と状態、アーカイブした日時が出る',
      !!x &&
        x.children.length === 1 &&
        /x子/.test(x.children[0]) &&
        /未着手/.test(x.children[0]) &&
        /\d{4}/.test(x.date),
      x,
    );
    check('G-4d Project に属していなければ Project 名は出ない', x?.project === null, x);
    check('G-4e 一覧を出している間キャンバスは見えない', !(await canvasVisible()));
    check('G-4f 一覧を出している間は Undo のボタンが押せない', await disabled('Undo'));

    // 一覧を出している間、キーは背後のキャンバスに届かない
    await key({ key: 'z', code: 90, meta: true });
    await key({ key: 'n', code: 78, meta: true });
    await wait(500);
    check(
      'G-4g 一覧を出している間は Cmd+Z / Cmd+N が背後に効かない',
      (await archiveItems()).length === 3 &&
        (await evaluate(`return document.querySelectorAll('.task').length`)) === 1,
      { items: (await archiveItems()).length },
    );

    // 明暗どちらでも読める: 文字と面のコントラスト比
    const contrast = () =>
      evaluate(`
        const lum = (css) => {
          const m = css.match(/[\\d.]+/g).map(Number);
          const [r, g, b] = m.slice(0, 3).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (hi + 0.05) / (lo + 0.05);
        };
        const item = document.querySelector('.archive-item');
        const bg = getComputedStyle(item).backgroundColor;
        const of = (sel) => {
          const el = item.querySelector(sel);
          return el ? Math.round(ratio(getComputedStyle(el).color, bg) * 10) / 10 : null;
        };
        return { title: of('.archive-title'), date: of('.archive-date'), child: of('.archive-child-title') };
      `);
    for (const scheme of ['light', 'dark']) {
      await emulateColorScheme(scheme);
      await wait(200);
      const c = await contrast();
      check(
        `G-4h ${scheme} の配色で一覧の文字が読める(コントラスト比 4.5 以上)`,
        c.title >= 4.5 && c.date >= 4.5 && (c.child === null || c.child >= 4.5),
        c,
      );
    }
    await emulateColorScheme(null);

    await press('キャンバスに戻る');
    await waitFor('キャンバスへ戻る', `return !document.querySelector('.archive-view')`);
    check('G-4i もう一度押すとキャンバスへ戻る', await canvasVisible());
    check(
      'G-4k キャンバスを出している間は「アーカイブ一覧」に戻っている',
      (await toolbarLabels()).includes('アーカイブ一覧') &&
        !(await toolbarLabels()).includes('キャンバスに戻る'),
      await toolbarLabels(),
    );

    // --- Cmd+Z 1回で、キャンバスへの復帰と記録の取り消しが揃う(FR-8) -----
    await undo();
    await waitFor('3件が戻る', `return document.querySelectorAll('.task').length === 4`);
    check(
      'G-5a Cmd+Z 1回で3件がキャンバスに戻る',
      (await taskTitles()).join() === 'W,X,Y,Z',
      await taskTitles(),
    );
    await press('アーカイブ一覧');
    await waitFor('一覧が出る', `return !!document.querySelector('.archive-view')`);
    check(
      'G-5b そのとき一覧からも消える',
      (await archiveItems()).length === 0 &&
        /ありません/.test(
          await evaluate(`return document.querySelector('.archive-view').textContent`),
        ),
      await archiveItems(),
    );
    await press('キャンバスに戻る');
    await waitFor('キャンバスへ戻る', `return !document.querySelector('.archive-view')`);

    // --- Task ごと。依存が変わらなければ確認なしで移る。新しい順に並ぶ -----
    await pressArchiveOf('X');
    await waitFor('X が消える', `return document.querySelectorAll('.task').length === 3`);
    check(
      'G-6a 依存が変わらなければ確認なしで移る',
      !(await evaluate(`return !!document.querySelector('dialog[open]')`)),
    );
    await wait(30);
    await pressArchiveOf('Y');
    await waitFor('Y が消える', `return document.querySelectorAll('.task').length === 2`);
    await press('アーカイブ一覧');
    await waitFor('一覧が出る', `return !!document.querySelector('.archive-view')`);
    items = await archiveItems();
    check(
      'G-6b 一覧はアーカイブした日時の新しい順',
      items.map((i) => i.title).join() === 'Y,X',
      items.map((i) => i.title),
    );
    await press('キャンバスに戻る');
    await waitFor('キャンバスへ戻る', `return !document.querySelector('.archive-view')`);

    // --- 繋ぎ直しは1本ずつ外せる。外したものは作られない(FR-1, FR-11) -------
    await addTask('P');
    await addTask('Q');
    await addTask('R');
    await fitView();
    await connect('P', 'Q');
    await connect('Q', 'R');
    await waitFor(
      '矢印が2本',
      `return document.querySelectorAll('.react-flow__edge').length === 2`,
    );
    await finish('Q');
    await pressArchiveOf('Q');
    await waitFor('確認が開く', `return !!document.querySelector('dialog[open]')`);
    const boxes = () =>
      evaluate(
        `return [...document.querySelectorAll('dialog[open] .edge-list.is-added .edge-check')].map((c) => c.checked)`,
      );
    check(
      'G-6c 繋ぎ直しはチェックボックスで、はじめは全て入っている',
      (await boxes()).join() === 'true',
    );
    const box = await evaluate(`
      const r = document.querySelector('dialog[open] .edge-list.is-added .edge-box').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    await mouse('mousePressed', box.x, box.y, { buttons: 1 });
    await mouse('mouseReleased', box.x, box.y, { buttons: 0 });
    await waitFor(
      'チェックが外れる',
      `return !document.querySelector('dialog[open] .edge-check')?.checked`,
    );
    await confirmDialog();
    await waitFor('Q が消える', `return !${find('Q')}`);
    await wait(300);
    check(
      'G-6d チェックを外した繋ぎ直し(P → R)は作られない',
      (await evaluate(`return document.querySelectorAll('.react-flow__edge').length`)) === 0,
      await evaluate(`return document.querySelectorAll('.react-flow__edge').length`),
    );

    // --- A → B(完了) → C。B を移しても C は Blocked のまま(FR-3) --------
    await addTask('A');
    await addTask('B');
    await addTask('C');
    await fitView();
    await connect('A', 'B');
    await connect('B', 'C');
    await waitFor(
      '矢印が2本',
      `return document.querySelectorAll('.react-flow__edge').length === 2`,
    );
    await finish('B');
    await pressArchiveOf('B');
    await waitFor('確認が開く', `return !!document.querySelector('dialog[open]')`);
    const removed = await edgeRows('removed');
    const added = await edgeRows('added');
    check('G-7a なくなる依存が挙がる', removed.join() === 'A→B,B→C', removed);
    check('G-7b 繋ぎ直される依存として A → C が挙がる', added.join() === 'A→C', added);
    await confirmDialog();
    await waitFor('B が消える', `return !${find('B')}`);
    await wait(300);
    const cLook = await evaluate(`
      const c = ${find('C')};
      return { blocked: c.classList.contains('is-blocked'), edges: document.querySelectorAll('.react-flow__edge').length };
    `);
    check('G-7c B を移したあとも C は Blocked のまま', cLook.blocked && cLook.edges === 1, cLook);

    // --- 再起動しても記録が残る(FR-7) ------------------------------------
    const next = await ctx.restart();
    await next.wait(600);
    await next.evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === 'アーカイブ一覧').click(); return 1;`,
    );
    await next.waitFor('一覧が出る', `return !!document.querySelector('.archive-view')`);
    const restored = await next.evaluate(
      `return [...document.querySelectorAll('.archive-title')].map((e) => e.textContent)`,
    );
    check('G-8 再起動しても記録が残る', restored.join() === 'B,Q,Y,X', restored);
  },
};
