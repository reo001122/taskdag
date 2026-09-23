/**
 * 整列(FR-6)— QA チェックリスト D に対応
 *
 * 所属は位置から導かれる(FR-4)。**枠から Task がはみ出すことは、そのまま
 * 所属が消えることを意味する。** 見た目の粗さではなく、データが変わる。
 * 枠どうしの重なりも同じで、重なった領域に置かれた Task の所属が入れ替わる。
 */
export default {
  name: 'align',
  description: 'D. 整列しても所属が壊れないこと(はみ出さない・枠が重ならない)',

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, mouse, drag, check }) {
    const click = (text) =>
      evaluate(
        `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes(${JSON.stringify(text)})).click(); return 1;`,
      );

    /** Task を1つ作る。children を渡すと子タスクも足す(背が伸びる)。 */
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

    const addProject = async (name) => {
      await click('Project');
      await waitFor('dialog', `return !!document.querySelector('dialog[open]')`);
      await waitForFocus();
      await type(name);
      await key({ key: 'Enter', code: 13 });
      await wait(350);
    };

    /** 整列のあと、Task と枠の当たり具合を読む。 */
    const geometry = () =>
      evaluate(`
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const tasks = [...document.querySelectorAll('.react-flow__node-task')].map((n) => ({
          title: n.querySelector('.task-title')?.textContent ?? '(入力中)',
          ...rect(n.querySelector('.task')),
        }));
        const frames = [...document.querySelectorAll('.react-flow__node-projectFrame')].map((n) => ({
          name: n.querySelector('.project-name')?.textContent ?? '?',
          ...rect(n),
        }));
        return { tasks, frames };
      `);

    const inside = (task, frame) =>
      task.left >= frame.left &&
      task.right <= frame.right &&
      task.top >= frame.top &&
      task.bottom <= frame.bottom;

    const overlaps = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    /** どの Project に属しているか。丸点の色で見分ける(所属なしは空)。 */
    const belongs = () =>
      evaluate(`
        const out = {};
        for (const wrap of document.querySelectorAll('.task-wrap')) {
          const dot = wrap.querySelector('.task-project-dot');
          out[wrap.querySelector('.task-title')?.textContent ?? '?'] =
            dot.classList.contains('is-unassigned') ? '' : getComputedStyle(dot).backgroundColor;
        }
        return out;
      `);

    /**
     * Task を枠の中へ運ぶ。
     *
     * 掴む場所は左上に寄せる。 所属は Task の左上の点で決まる(FR-4)ので、
     * 中央を掴むと、狙った場所に落としても左上は枠の外に出ていることがある。
     */
    const assign = async (title, projectName) => {
      const points = await evaluate(`
        const find = (sel, text) => [...document.querySelectorAll('.react-flow__node')]
          .find((n) => n.querySelector(sel)?.textContent === text);
        const task = find('.task-title', ${JSON.stringify(title)});
        const frame = find('.project-name', ${JSON.stringify(projectName)});
        // 掴めるのは見出しの取っ手だけ(FR-6)
        const g = task.querySelector('.task-grip').getBoundingClientRect();
        const t = task.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        return {
          from: { x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) },
          // 掴んだ点と Task の左上のずれ。所属は左上で決まるので、そのぶん戻す。
          to: {
            x: Math.round(f.left + 70 + (g.left + g.width / 2 - t.left)),
            y: Math.round(f.top + 70 + (g.top + g.height / 2 - t.top)),
          },
        };
      `);
      await drag(points.from, points.to);
      await wait(450);
    };

    /** 名前は何度も使うので名前付きで持つ(添字に文字列をそのまま書かない)。 */
    const NAME = { spec: '要件を洗う', screen: '画面を作る', shared: '横断の作業' };

    await addProject('設計');
    await addProject('実装');
    await addTask(NAME.spec);
    // 子タスクで背を伸ばす。**低い Task では見積もりの誤差が余白に吸われて
    // 表に出ない。** 枠が実寸で張られていることを確かめるには、余白より
    // 大きくずれるだけの高さが要る。
    await addTask(NAME.screen, ['一覧', '詳細', '編集', '削除', '検索']);
    await addTask(NAME.shared);

    /*
      新しい枠は少しずつずらして置かれるだけなので、作った直後は互いに重なっている。
      重なった場所へ落とすと、どちらに属するかは面積と id で決まる(FR-4)。
      狙った所属を作れないので、まず整列で引き離してから割り当てる。
    */
    await click('整列');
    await wait(700);
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(500);

    await assign(NAME.spec, '設計');
    await assign(NAME.screen, '実装');

    const belongsBefore = await belongs();
    check(
      'D-0 前提: 狙った2つの Task が、別々の Project に属している',
      belongsBefore[NAME.spec] !== '' &&
        belongsBefore[NAME.screen] !== '' &&
        belongsBefore[NAME.spec] !== belongsBefore[NAME.screen],
      belongsBefore,
    );

    await click('整列');
    await wait(700);
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(500);

    const { tasks, frames } = await geometry();

    // 枠のある Project の中に置かれた Task は、完全に枠の中へ収まること
    const stickingOut = tasks.filter((task) =>
      frames.some((frame) => overlaps(task, frame) && !inside(task, frame)),
    );
    check(
      'D-1 整列後、枠に掛かった Task は枠から食み出さない',
      stickingOut.length === 0,
      stickingOut.map((t) => t.title),
    );

    // 枠どうしが重ならないこと
    const collisions = [];
    for (let i = 0; i < frames.length; i += 1) {
      for (let j = i + 1; j < frames.length; j += 1) {
        if (overlaps(frames[i], frames[j])) collisions.push([frames[i].name, frames[j].name]);
      }
    }
    check('D-2 整列後、枠どうしが重ならない', collisions.length === 0, collisions);

    const belongsAfter = await belongs();
    check(
      'D-3 整列しても所属が変わらない',
      JSON.stringify(belongsAfter) === JSON.stringify(belongsBefore),
      { belongsBefore, belongsAfter },
    );

    /*
      枠の大きさを変えたら、それも Undo で戻る(FR-8)。

      所属は枠の中に入っているかで決まる(FR-4)ので、**大きさが戻らないことは
      所属が戻らないこと**を意味する。見た目の話ではない。
    */
    const frameSize = () =>
      evaluate(`
        const n = document.querySelector('.react-flow__node-projectFrame');
        return n ? [Math.round(n.offsetWidth), Math.round(n.offsetHeight)] : null;
      `);
    const beforeResize = await frameSize();
    const grip = await evaluate(`
      const h = document.querySelector('.react-flow__resize-control.top.right.handle');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    `);
    if (grip) {
      await drag(grip, { x: grip.x - 80, y: grip.y + 60 });
      await wait(600);
      const afterResize = await frameSize();
      check('D-5 枠の大きさを変えられる', String(afterResize) !== String(beforeResize), {
        beforeResize,
        afterResize,
      });

      await evaluate(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
        return 1;
      `);
      await wait(700);
      check(
        'D-6 枠の大きさは Undo で元に戻る',
        String(await frameSize()) === String(beforeResize),
        {
          beforeResize,
          afterUndo: await frameSize(),
        },
      );
    }

    /*
      枠どうしは重ねられない(FR-4)。

      重ねられると、動かさなかったほうの Task の所属が入れ替わる。整列の直後は
      枠が離れているので、ここで確かめられる。
    */
    const frameGeom = () =>
      evaluate(`
        return [...document.querySelectorAll('.react-flow__node-projectFrame')].map((n) => {
          const r = n.getBoundingClientRect();
          return {
            name: n.querySelector('.project-name')?.textContent ?? '?',
            blocked: n.classList.contains('is-blocked'),
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
          };
        });
      `);

    const [frameA, frameB] = await frameGeom();
    if (frameA && frameB) {
      // A の内側を掴んで、B の内側へ運ぶ。離さずに途中で見る。
      const from = { x: frameA.rect[0] + 30, y: frameA.rect[1] + 60 };
      const onto = { x: frameB.rect[0] + 60, y: frameB.rect[1] + 60 };
      await mouse('mousePressed', from.x, from.y, { buttons: 1 });
      for (let i = 1; i <= 10; i += 1) {
        await mouse(
          'mouseMoved',
          from.x + ((onto.x - from.x) * i) / 10,
          from.y + ((onto.y - from.y) * i) / 10,
          { buttons: 1 },
        );
        await wait(16);
      }
      const midDrag = await frameGeom();
      check(
        'D-7 重なる位置へ運んでいる間、置けないことが枠に出る',
        midDrag.some((f) => f.blocked),
        midDrag.map((f) => [f.name, f.blocked]),
      );

      await mouse('mouseReleased', onto.x, onto.y, { buttons: 0 });
      await wait(600);

      const dropped = await frameGeom();
      check(
        'D-8 離すと元の位置に戻る(枠は重ならない)',
        String(dropped[0]?.rect) === String(frameA.rect),
        { before: frameA.rect, after: dropped[0]?.rect },
      );
      check(
        'D-9 戻ったあと、置けない印は消えている',
        dropped.every((f) => !f.blocked),
        dropped.map((f) => [f.name, f.blocked]),
      );
      check(
        'D-10 弾かれても所属は変わらない',
        JSON.stringify(await belongs()) === JSON.stringify(belongsBefore),
        { belongsBefore, after: await belongs() },
      );
    }

    // 整列は1回の Undo で戻る(FR-8)
    await evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      return 1;
    `);
    await wait(600);
    const afterUndo = await geometry();
    check(
      'D-4 整列は1回の Undo で戻る',
      afterUndo.tasks.some((t, i) => t.left !== tasks[i]?.left || t.top !== tasks[i]?.top),
      {
        before: tasks.map((t) => Math.round(t.left)),
        after: afterUndo.tasks.map((t) => Math.round(t.left)),
      },
    );
  },
};
