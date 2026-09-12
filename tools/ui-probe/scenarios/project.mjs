/**
 * Project の枠(FR-4)
 *
 * 枠は Task の背面にいなければならない。選択したときに前面へ出ると、
 * 枠の中の Task に触れなくなる。**画面を見ても「枠が選択されている」以上のことは
 * 分からず、触れないことに気づくのは触ろうとしたときだけ。**
 */
export default {
  name: 'project',
  description: 'Project の枠が Task を覆わないこと、色パレットが閉じること',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, drag, wheel, check }) {
    /** ノードの画面上の位置。動いたかどうかを見るためだけに使う。 */
    const spots = () =>
      evaluate(`
        const out = {};
        for (const n of document.querySelectorAll('.react-flow__node')) {
          const r = n.getBoundingClientRect();
          const name = n.querySelector('.task-title')?.textContent
            ?? n.querySelector('.project-name')?.textContent
            ?? n.dataset.id;
          out[name] = [Math.round(r.left), Math.round(r.top)];
        }
        return out;
      `);
    const moved = (before, after, name) =>
      before[name] &&
      after[name] &&
      (before[name][0] !== after[name][0] || before[name][1] !== after[name][1]);
    // Task を1つ作り、名前を確定させておく
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
    );
    await waitFor('Task が現れる', `return document.querySelectorAll('.task').length === 1`);
    await waitForFocus();
    await type('中の作業');
    await key({ key: 'Enter', code: 13 });
    await wait(300);

    // Project を作る。名前は dialog で聞かれる。
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Project')).click(); return 1;`,
    );
    await waitFor('名前を聞く dialog が開く', `return !!document.querySelector('dialog[open]')`);
    await waitForFocus();
    await type('プロジェクトA');
    await key({ key: 'Enter', code: 13 });
    await waitFor('枠が現れる', `return !!document.querySelector('.project-frame')`);

    // 枠を選択する(ラベルを押す)
    await evaluate(`document.querySelector('.project-frame-label').click(); return 1;`);
    await wait(200);

    // Task の中心に何があるか。枠が前面に出ていれば Task には届かない。
    const hit = await evaluate(`
      const rect = document.querySelector('.task-title').getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { hit: el ? el.className : null, insideTask: !!el?.closest('.task') };
    `);
    check('枠を選んでも、その上の Task に手が届く', hit.insideTask, hit);

    // 色パレットは、選ばずに他所を押したら閉じる
    await evaluate(`document.querySelector('.color-swatch').click(); return 1;`);
    await waitFor('パレットが開く', `return !!document.querySelector('.color-picker')`);
    await evaluate(`
      document.querySelector('.react-flow__pane')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return 1;
    `);
    await wait(200);
    const stillOpen = await evaluate(`return !!document.querySelector('.color-picker')`);
    check('色を選ばずに他所を押すとパレットが閉じる', !stillOpen);

    // 名前はワンクリックで改名に入り、そのまま打てる
    await evaluate(`document.querySelector('.project-name').click(); return 1;`);
    await waitFor(
      '入力欄になる',
      `return !!document.querySelector('.project-frame-label .text-input')`,
    );
    const waited = await waitForFocus();
    check('I-4 Project 名はワンクリックで改名に入る', waited >= 0, { waited });
    await type('改名A');
    await key({ key: 'Enter', code: 13 });
    await wait(400);
    const renamed = await evaluate(`return document.querySelector('.project-name')?.textContent`);
    check('I-4b 打った文字がそのまま名前になる', renamed === '改名A', renamed);

    // 枠は内側のどこを掴んでも動く。中の Task も一緒に来る。
    const empty = await evaluate(`
      const frame = document.querySelector('.project-frame').getBoundingClientRect();
      const task = document.querySelector('.task').getBoundingClientRect();
      // Task に当たらない、枠の内側の一点
      return { x: Math.round(frame.left + 40), y: Math.round(task.bottom + 60) };
    `);
    let before = await spots();
    await drag(empty, { x: empty.x + 60, y: empty.y + 40 });
    await wait(500);
    let after = await spots();
    check('P-4a 枠の内側のどこを掴んでも枠が動く', moved(before, after, '改名A'), {
      before,
      after,
    });
    check('P-4b 中の Task も一緒に動く', moved(before, after, '中の作業'), { before, after });

    // 中の Task を掴んだときは、Task だけが動く
    // 名前やボタンには nodrag が付いている。掴めるのは本体の余白。
    const onTask = await evaluate(`
      const r = document.querySelector('.task').getBoundingClientRect();
      const p = { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 3) };
      return { ...p, at: document.elementFromPoint(p.x, p.y)?.className?.toString().slice(0, 30) };
    `);
    before = await spots();
    await drag(onTask, { x: onTask.x + 50, y: onTask.y + 30 });
    await wait(500);
    after = await spots();
    check('P-4c Task を掴んだときは Task だけが動く', moved(before, after, '中の作業'), {
      before,
      after,
    });
    check('P-4d そのとき枠は動かない', !moved(before, after, '改名A'), { before, after });

    /*
      所属は「枠の中に Task があるか」だけで決まる(FR-4)。保存はしない。

      枠を消しても中の Task は残る。 領域であって入れ物ではないため、
      枠が消えれば所属が外れるだけ。
    */
    const dotColour = (title) =>
      evaluate(`
        const wrap = [...document.querySelectorAll('.task-wrap')]
          .find((w) => w.querySelector('.task-title')?.textContent === ${JSON.stringify(title)});
        if (!wrap) return 'ない';
        const dot = wrap.querySelector('.task-grip-dot');
        return dot.classList.contains('is-unassigned') ? '所属なし' : getComputedStyle(dot).backgroundColor;
      `);

    const inFrame = await dotColour('中の作業');
    check('C-1 枠の中に置いた Task は、丸点が枠の色になる', inFrame !== '所属なし', inFrame);

    // 枠の外へ出すと外れる
    const out = await evaluate(`
      const task = [...document.querySelectorAll('.react-flow__node')]
        .find((n) => n.querySelector('.task-title'));
      const frame = document.querySelector('.react-flow__node-projectFrame').getBoundingClientRect();
      const r = task.getBoundingClientRect();
      return {
        from: { x: Math.round(r.left + 6), y: Math.round(r.top + 6) },
        to: { x: Math.round(frame.right + 90), y: Math.round(frame.top + 40) },
      };
    `);
    await drag(out.from, out.to);
    await wait(500);
    check(
      'C-2 枠の外へ出すと所属が外れる',
      (await dotColour('中の作業')) === '所属なし',
      await dotColour('中の作業'),
    );

    // 戻す
    const back = await evaluate(`
      const task = [...document.querySelectorAll('.react-flow__node')]
        .find((n) => n.querySelector('.task-title'));
      const frame = document.querySelector('.react-flow__node-projectFrame').getBoundingClientRect();
      const r = task.getBoundingClientRect();
      return {
        from: { x: Math.round(r.left + 6), y: Math.round(r.top + 6) },
        to: { x: Math.round(frame.left + 60), y: Math.round(frame.top + 60) },
      };
    `);
    await drag(back.from, back.to);
    await wait(500);
    check(
      'C-3 戻すとまた所属する',
      (await dotColour('中の作業')) !== '所属なし',
      await dotColour('中の作業'),
    );

    // 枠を消しても Task は残る
    await evaluate(`
      const label = document.querySelector('.project-frame-label');
      label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      [...label.querySelectorAll('.state-button')].find((b) => b.textContent === '×').click();
      return 1;
    `);
    await waitFor('枠が消える', `return !document.querySelector('.project-frame')`);
    check(
      'C-5a 枠を消しても中の Task は残る',
      await evaluate(
        `return [...document.querySelectorAll('.task-title')].some((t) => t.textContent === '中の作業')`,
      ),
    );
    check(
      'C-5b そのとき所属だけが外れる',
      (await dotColour('中の作業')) === '所属なし',
      await dotColour('中の作業'),
    );

    /*
      2本指スクロールは移動、Cmd 併用で拡大縮小。
      枠の内側がドラッグで動くようになったぶん、パンの手段をここに移している。
    */
    const viewport = () =>
      evaluate(`
        const t = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
        const m = new DOMMatrixReadOnly(t);
        return { x: Math.round(m.e), y: Math.round(m.f), zoom: Number(m.a.toFixed(3)) };
      `);
    const centre = { x: 640, y: 400 };

    let v = await viewport();
    await wheel(centre, { deltaY: 120 });
    await wait(300);
    let next = await viewport();
    check('N-1 2本指スクロールで表示が移動する', next.y !== v.y, { v, next });
    check('N-2 そのとき拡大率は変わらない', next.zoom === v.zoom, { v, next });

    /*
      トラックパッドのピンチは、macOS では ctrlKey 付きの wheel として届く
      (@xyflow/system も「macos sets ctrlKey=true for pinch gesture」と書いている)。
      ピンチそのものは送れないので、同じ形の入力で確かめる。
    */
    v = await viewport();
    // 縮小方向に動かす。この時点の拡大率は上限(maxZoom)に張り付いており、
    // 拡大方向では頭打ちになって変化が出ない。
    await wheel(centre, { deltaY: 120, modifiers: 2 }); // ctrl = ピンチ相当
    await wait(300);
    next = await viewport();
    check('N-3 ピンチ相当の入力では拡大縮小になる', next.zoom !== v.zoom, { v, next });

    // 余白を掴んで引きずっても、表示は動かない(移動はスクロールに一本化した)
    v = await viewport();
    const blank = await evaluate(`
      const task = document.querySelector('.task').getBoundingClientRect();
      return { x: Math.round(task.right + 120), y: Math.round(task.bottom + 120) };
    `);
    await drag(blank, { x: blank.x + 120, y: blank.y + 80 });
    await wait(400);
    next = await viewport();
    check('N-4 余白を掴んで引きずっても表示は動かない', next.x === v.x && next.y === v.y, {
      v,
      next,
    });
  },
};
