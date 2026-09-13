#!/usr/bin/env node
/**
 * 実際に描画されているアプリを操作して、対話が期待どおりに起きるかを見る。
 *
 * 使い方は tools/ui-probe/README.md。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
import { SCENARIOS } from './scenarios/index.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..');

// 素の Node から読むと、electron パッケージは実行ファイルのパスを返す
// (Electron の中から読んだときだけ API になる)。OS ごとの場所を書かずに済む。
const electronBinary = createRequire(import.meta.url)('electron');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const logLevel = option('log', 'debug');
const showLogs = flag('show-logs');
const wanted = option('scenario', null);

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} が ${code} で終了`)),
    );
  });

async function main() {
  const scenarios = wanted ? SCENARIOS.filter((s) => s.name === wanted) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(
      `知らないシナリオ: ${wanted}\n使えるもの: ${SCENARIOS.map((s) => s.name).join(', ')}`,
    );
    process.exit(2);
  }

  if (!flag('no-build')) {
    console.log('# ビルド');
    await run('node', ['node_modules/electron-vite/bin/electron-vite.js', 'build']);
  }

  /*
    シナリオは並べて走らせる。それぞれ自前のアプリと使い捨ての user-data-dir を
    持ち、CDP のポートも OS が割り当てるので、互いに干渉しない。
    コミットのたびに走らせるものなので、待ち時間は短いほどよい。

    ただし同時に走らせる数は絞る。 一斉に起動すると、立ち上がり直後に送った
    キーがどこにも入らないことがある(実測: 6本同時で再発した)。総時間はほとんど
    変わらないので、取りこぼしのない側を選ぶ。
  */
  const results = await inParallel(scenarios, Number(option('jobs', '3')), runScenario);

  let failures = 0;
  for (const result of results) {
    console.log(`\n# ${result.scenario.name} — ${result.scenario.description}`);
    for (const c of result.checks) {
      const detail = c.ok || c.detail === undefined ? '' : `  → ${JSON.stringify(c.detail)}`;
      console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${detail}`);
    }
    if (result.error) console.log(`  ! ${result.error.message}`);
    if (result.layout) console.log(`  画面の状態: ${JSON.stringify(result.layout)}`);
    if (result.shotPath) console.log(`  画面: ${result.shotPath}`);
    if (result.shotError) console.log(`  画面を撮れなかった: ${result.shotError}`);
    failures += result.checks.filter((c) => !c.ok).length + (result.error ? 1 : 0);
  }

  console.log(failures === 0 ? '\nすべて期待どおり' : `\n期待と違ったもの: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * 起動したプロセス自身が名乗った CDP のポートを読む。
 *
 * 固定のポート番号を決め打ちしてはならない。 既にそのポートが使われていると
 * (開発中のアプリが動いている、前回の probe が残っている)、こちらが起動した
 * プロセスは listen に失敗する一方、接続は先客のほうへ成功してしまう。
 * その先客は利用者の本物のデータを開いており、シナリオがそれを書き換える。
 *
 * `--remote-debugging-port=0` で OS に空きを選ばせ、標準エラーに出る
 * 「DevTools listening on ws://127.0.0.1:<port>/」から読む。名乗るのは
 * 自分が起動したプロセスなので、取り違えようがない。
 */
function readAssignedPort(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    /*
      起動できなかったときは、Electron が stderr に理由を書いている
      (共有ライブラリが無い、サンドボックスの設定が違う、など)。
      それを捨てて「終了した」とだけ伝えると、手元で再現できない環境
      —— CI のような —— で原因に辿り着けない。読んだぶんを添えて返す。
    */
    const withOutput = (message) =>
      new Error(buffer.trim() ? `${message}\n--- アプリの出力 ---\n${buffer.trim()}` : message);

    const timer = setTimeout(
      () => reject(withOutput(`CDP のポートを ${timeoutMs}ms 以内に名乗らなかった`)),
      timeoutMs,
    );
    const onData = (chunk) => {
      buffer += chunk.toString();
      const found = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (!found) return;
      clearTimeout(timer);
      child.stderr.off('data', onData);
      resolve(Number(found[1]));
    };
    child.stderr.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(withOutput(`アプリがポートを名乗る前に終了した(code=${code} signal=${signal})`));
    });
  });
}

/** 最大 limit 本まで同時に走らせ、入力の順で結果を返す。 */
async function inParallel(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 終わるまで待つ。素直に終わらなければ落とす。 */
function stop(child, graceMs = 3000) {
  return new Promise((resolve) => {
    // 起動に失敗すると child が無いまま後片付けに来る。ここで落ちると、
    // 起動できなかった本当の理由が TypeError に置き換わって見えなくなる。
    if (!child) return resolve();
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

/**
 * シナリオごとにアプリを起動し直す。
 *
 * user-data-dir は必ず使い捨てのものを渡す。 渡さないと利用者の実データを
 * 触ることになる(DB の場所は app.getPath('userData') から決まる)。
 */
async function runScenario(scenario) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'taskdag-probe-'));

  /**
   * アプリを起動して繋ぐ。同じ user-data-dir で呼び直せる ——
   * 再起動後もデータが残っていることを見る検査(FR-7)に要る。
   */
  const launch = async () => {
    const electron = spawn(
      electronBinary,
      [
        '.',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        `--log=${logLevel}`,
        // 既定では画面に出さない。シナリオを書いている最中だけ --show-window で出す。
        ...(flag('show-window') ? [] : ['--hidden']),
      ],
      { cwd: repoRoot, stdio: ['ignore', showLogs ? 'inherit' : 'ignore', 'pipe'] },
    );
    if (showLogs) electron.stderr.pipe(process.stderr);

    const port = await readAssignedPort(electron);
    const connected = await connect(port, {
      expectedUrlPrefix: `file://${join(repoRoot, 'out', 'renderer')}`,
      onConsole: showLogs ? (type, text) => console.log(`  renderer.${type} ${text}`) : undefined,
    });
    await connected.waitFor('画面が描画される', `return !!document.querySelector('.react-flow')`);
    return { electron, cdp: connected };
  };

  const checks = [];
  let error = null;
  let cdp = null;
  let shotPath = null;
  let shotError = null;
  let layout = null;
  let app = null;
  try {
    ({ electron: app, cdp } = await launch());

    const check = (label, ok, detail) => checks.push({ label, ok: !!ok, detail });

    /** アプリを閉じて開き直し、新しい操作口を返す。データはそのまま残る。 */
    const restart = async () => {
      cdp?.close();
      await stop(app);
      ({ electron: app, cdp } = await launch());
      return { ...cdp, check, restart };
    };

    await scenario.run({ ...cdp, check, restart });
  } catch (e) {
    error = e;
  } finally {
    /*
      落ちたときだけ画面を残す。DOM を読むだけでは分からないことがある ——
      要素は在るのに重なって読めない、色が背景と同化している。原因を探る前に
      まず見られるようにしておく。人が見るためのもので、自動判定はしない。
    */
    if (cdp && (error || checks.some((c) => !c.ok))) {
      /*
        画面から読める数値も残す。

        画像は取りに行く手間がかかるうえ、撮れないこともある(実際 CI で
        撮れなかった)。窓の大きさとノードの位置はログにそのまま出るので、
        手元と違う環境で何が起きたかを、これだけで絞り込めることがある。
      */
      try {
        layout = await cdp.evaluate(`
          const round = (n) => Math.round(n);
          return {
            窓: [innerWidth, innerHeight, devicePixelRatio],
            ノード: [...document.querySelectorAll('.react-flow__node')].map((n) => {
              const r = n.getBoundingClientRect();
              return {
                名: n.querySelector('.task-title,.project-name')?.textContent ?? '?',
                位置: [round(r.left), round(r.top), round(r.width), round(r.height)],
              };
            }),
            矢印: document.querySelectorAll('.react-flow__edge').length,
          };
        `);
      } catch (e) {
        layout = { 読めなかった: e.message };
      }

      try {
        const png = await cdp.screenshot();
        shotPath = join(repoRoot, `ui-probe-${scenario.name}.png`);
        writeFileSync(shotPath, Buffer.from(png, 'base64'));
      } catch (e) {
        shotPath = null;
        shotError = e.message;
      }
    }
    cdp?.close();
    // 終了を待ってから消す。Electron はまだ user-data-dir へ書いており、
    // 待たずに消すと ENOTEMPTY で落ちる。
    await stop(app);
    rmSync(userDataDir, { recursive: true, force: true });
  }

  return { scenario, checks, error, shotPath, shotError, layout };
}

await main();
