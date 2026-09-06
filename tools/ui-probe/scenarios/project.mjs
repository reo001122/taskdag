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

  async run({ evaluate, waitFor, wait, key, type, check }) {
    // Task を1つ作り、名前を確定させておく
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Task')).click(); return 1;`,
    );
    await waitFor('Task が現れる', `return document.querySelectorAll('.task').length === 1`);
    await type('中の作業');
    await key({ key: 'Enter', code: 13 });
    await wait(300);

    // Project を作る。名前は dialog で聞かれる。
    await evaluate(
      `[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('Project')).click(); return 1;`,
    );
    await waitFor('名前を聞く dialog が開く', `return !!document.querySelector('dialog[open]')`);
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
  },
};
