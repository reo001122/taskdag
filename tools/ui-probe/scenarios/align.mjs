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

  async run({ evaluate, waitFor, waitForFocus, wait, key, type, drag, check }) {
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
          const dot = wrap.querySelector('.task-grip-dot');
          out[wrap.querySelector('.task-title')?.textContent ?? '?'] =
            dot.classList.contains('is-unassigned') ? '' : getComputedStyle(dot).backgroundColor;
        }
        return out;
      `);

    /**
     * Task を枠の中へ運ぶ。
     *
     * **掴む場所は左上に寄せる。** 所属は Task の左上の点で決まる(FR-4)ので、
     * 中央を掴むと、狙った場所に落としても左上は枠の外に出ていることがある。
     */
    const assign = async (title, projectName) => {
      const points = await evaluate(`
        const find = (sel, text) => [...document.querySelectorAll('.react-flow__node')]
          .find((n) => n.querySelector(sel)?.textContent === text);
        const task = find('.task-title', ${JSON.stringify(title)});
        const frame = find('.project-name', ${JSON.stringify(projectName)});
        const t = task.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        return {
          from: { x: Math.round(t.left + 6), y: Math.round(t.top + 6) },
          to: { x: Math.round(f.left + 70), y: Math.round(f.top + 70) },
        };
      `);
      await drag(points.from, points.to);
      await wait(450);
    };

    await addProject('設計');
    await addProject('実装');
    await addTask('要件を洗う');
    // 子タスクで背を伸ばす。**低い Task では見積もりの誤差が余白に吸われて
    // 表に出ない。** 枠が実寸で張られていることを確かめるには、余白より
    // 大きくずれるだけの高さが要る。
    await addTask('画面を作る', ['一覧', '詳細', '編集', '削除', '検索']);
    await addTask('横断の作業');

    /*
      新しい枠は少しずつずらして置かれるだけなので、作った直後は互いに重なっている。
      重なった場所へ落とすと、どちらに属するかは面積と id で決まる(FR-4)。
      **狙った所属を作れないので、まず整列で引き離してから割り当てる。**
    */
    await click('整列');
    await wait(700);
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click(); return 1;`);
    await wait(500);

    await assign('要件を洗う', '設計');
    await assign('画面を作る', '実装');

    const belongsBefore = await belongs();
    check(
      'D-0 前提: 狙った2つの Task が、別々の Project に属している',
      belongsBefore['要件を洗う'] !== '' &&
        belongsBefore['画面を作る'] !== '' &&
        belongsBefore['要件を洗う'] !== belongsBefore['画面を作る'],
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
