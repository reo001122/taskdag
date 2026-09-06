#!/usr/bin/env node
/**
 * 実際に描画されているアプリを操作して、対話が期待どおりに起きるかを見る。
 *
 * 使い方は tools/ui-probe/README.md。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

const port = Number(option('port', '9222'));
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

  let failures = 0;
  for (const scenario of scenarios) {
    failures += await runScenario(scenario);
  }

  console.log(failures === 0 ? '\nすべて期待どおり' : `\n期待と違ったもの: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** 終わるまで待つ。素直に終わらなければ落とす。 */
function stop(child, graceMs = 3000) {
  return new Promise((resolve) => {
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
 * **user-data-dir は必ず使い捨てのものを渡す。** 渡さないと利用者の実データを
 * 触ることになる(DB の場所は app.getPath('userData') から決まる)。
 */
async function runScenario(scenario) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'taskdag-probe-'));
  const electron = spawn(
    electronBinary,
    ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, `--log=${logLevel}`],
    { cwd: repoRoot, stdio: showLogs ? 'inherit' : 'ignore' },
  );

  const checks = [];
  let error = null;
  let cdp = null;
  try {
    cdp = await connect(port, {
      onConsole: showLogs ? (type, text) => console.log(`  renderer.${type} ${text}`) : undefined,
    });
    await cdp.waitFor('画面が描画される', `return !!document.querySelector('.react-flow')`);

    await scenario.run({
      ...cdp,
      check: (label, ok, detail) => checks.push({ label, ok: !!ok, detail }),
    });
  } catch (e) {
    error = e;
  } finally {
    cdp?.close();
    // 終了を待ってから消す。Electron はまだ user-data-dir へ書いており、
    // 待たずに消すと ENOTEMPTY で落ちる。
    await stop(electron);
    rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log(`\n# ${scenario.name} — ${scenario.description}`);
  for (const c of checks) {
    console.log(
      `  ${c.ok ? '✓' : '✗'} ${c.label}${c.ok || c.detail === undefined ? '' : `  → ${JSON.stringify(c.detail)}`}`,
    );
  }
  if (error) console.log(`  ! ${error.message}`);

  return checks.filter((c) => !c.ok).length + (error ? 1 : 0);
}

await main();
