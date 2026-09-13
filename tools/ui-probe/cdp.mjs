/**
 * Chrome DevTools Protocol の薄いラッパ。
 *
 * 依存は足さない。Node 24 の組み込み WebSocket と fetch だけで足りる。
 */

const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/**
 * page ターゲットが現れるまで待つ。起動直後は一覧が空で返る。
 *
 * expectedUrlPrefix を渡すと、その配下を開いている page 以外は掴まない。
 * 掴む相手が本当にこちらの起動したアプリかを、ポート以外でも確かめるため。
 */
async function findPage(port, timeoutMs, expectedUrlPrefix) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find(
        (t) =>
          t.type === 'page' &&
          t.webSocketDebuggerUrl &&
          (!expectedUrlPrefix || (t.url ?? '').startsWith(expectedUrlPrefix)),
      );
      if (page) return page;
    } catch {
      // まだ listen していない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`期待した page target が ${timeoutMs}ms 以内に現れなかった`);
}

export async function connect(port, { onConsole, expectedUrlPrefix, timeoutMs = 15000 } = {}) {
  const page = await findPage(port, timeoutMs, expectedUrlPrefix);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  /** 応答を待っている呼び出しを、接続が閉じたときに起こすための控え。 */
  const pendingRejects = new Map();
  let nextId = 0;

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && onConsole) {
      const text = message.params.args
        .map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? {}))
        .join(' ');
      onConsole(message.params.type, text);
    }
  });

  /*
    待ち続けない。

    CDP は、応答が返らないことがある —— 対象のページが消えた、描画側が
    止まっている、そもそも繋がっていない。時間切れを置かないと、その場合に
    プロセスが黙って止まったままになる。実際に CI で起き、job が終わらなかった。
    落ちるのは構わない。何を待っていたかが分かる形で落ちればよい。
  */
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CDP の接続が ${timeoutMs}ms 以内に開かなかった`)),
      timeoutMs,
    );
    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    ws.addEventListener('open', () => settle(resolve));
    ws.addEventListener('error', () => settle(reject, new Error('CDP へ接続できなかった')));
    ws.addEventListener('close', () => settle(reject, new Error('CDP の接続が開く前に閉じた')));
  });

  // 接続が閉じたら、応答を待っているものをすべて起こす。
  ws.addEventListener('close', () => {
    for (const [id, reject] of pendingRejects) {
      pending.delete(id);
      reject(new Error('CDP の接続が閉じた(アプリが終了した可能性がある)'));
    }
    pendingRejects.clear();
  });

  const send = (method, params = {}, callTimeoutMs = timeoutMs) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        pendingRejects.delete(id);
        reject(new Error(`${method} の応答が ${callTimeoutMs}ms 以内に返らなかった`));
      }, callTimeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pendingRejects.delete(id);
        resolve(message);
      });
      pendingRejects.set(id, (e) => {
        clearTimeout(timer);
        reject(e);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');

  /*
    ページを常にフォーカスされている扱いにする。

    画面に出していない窓は OS から見て前面ではなく、**起動直後に送ったキーが
    どこにも入らないことがある**(並列で起動するようになってから顕在化した)。
    実際に人が使うときは窓が前面にあるので、そちらへ寄せるほうが本番に近い。
  */
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  /** renderer 内で式を評価して値を持ち帰る。本文は async 関数の中身として書く。 */
  const evaluate = async (body) => {
    const response = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = response.result?.exceptionDetails;
    if (details) {
      throw new Error(`renderer で例外: ${details.exception?.description ?? details.text}`);
    }
    return response.result?.result?.value;
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 条件が満たされるまで待つ。sleep を並べるより、落ちたときに理由が残る。 */
  const waitFor = async (label, body, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(body)) return true;
      await wait(50);
    }
    throw new Error(`条件が満たされないまま ${timeout}ms 経過: ${label}`);
  };

  /**
   * 入力欄にフォーカスが移るまで待ち、待った時間(ms)を返す。移らなければ -1。
   *
   * 打つ前に必ず通すこと。 入力欄が現れてから実際にフォーカスが着くまでには
   * 間がある(React Flow がノードを測り終えるまで待つため、実測で初回 70ms 前後)。
   * 着く前に打つと、最初の文字が黙って落ちる。
   */
  const waitForFocus = (timeout = 2000) =>
    evaluate(`
      const t0 = performance.now();
      return await new Promise((resolve) => {
        const tick = () => {
          if (document.activeElement?.classList?.contains('text-input')) {
            return resolve(Math.round(performance.now() - t0));
          }
          if (performance.now() - t0 > ${timeout}) return resolve(-1);
          requestAnimationFrame(tick);
        };
        tick();
      });
    `);

  const key = async ({ key: name, code, shift = false, meta = false }) => {
    const modifiers = (shift ? MODIFIER.shift : 0) | (meta ? MODIFIER.meta : 0);
    const base = {
      key: name,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };

  /**
   * 1文字ずつ本物のキーイベントとして送り、入ったことを確かめる。
   *
   * フォーカスが着いた直後でも、まれに打鍵がどこにも入らないことがある
   * (名前が既定のまま残り、後続の検査がまとめて落ちる形で出た)。
   * 入っていなければ、入力欄を空にしてから打ち直す。
   *
   * 入力欄は編集に入った時点で全選択されているので、1回で入れば値は text と
   * 一致する。部分的に入った状態を「入った」と見なさないよう、一致で判定する。
   */
  const type = async (text, attempts = 3) => {
    const valueOfFocused = () =>
      evaluate(`
        const el = document.activeElement;
        return el && 'value' in el ? el.value : null;
      `);
    const clearFocused = () =>
      evaluate(`
        const el = document.activeElement;
        if (!el || !('value' in el)) return 0;
        const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
        set.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 1;
      `);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
      if ((await valueOfFocused()) === text) return;
      await clearFocused();
    }
    throw new Error(`打った文字が入力欄に入らなかった: ${text}`);
  };

  /**
   * 実際のマウス入力。React Flow のドラッグは pointer 系を見ているため
   * click() では代替できない。
   *
   * buttons を型から決めつけない。 何も押していない移動を「押したままの移動」
   * として送ると、ホバーが立たない(× が出ない、といった形で出た)。
   * 押している間の移動だけ、呼ぶ側が 1 を渡す。
   */
  const mouse = async (type_, x, y, { button = 'left', buttons = 0 } = {}) => {
    await send('Input.dispatchMouseEvent', { type: type_, x, y, button, buttons, clickCount: 1 });
  };

  /** 2本指スクロール。deltaY だけ渡せば縦、modifiers に 4 を渡すと Cmd 併用。 */
  const wheel = async (at, { deltaX = 0, deltaY = 0, modifiers = 0 } = {}) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: at.x,
      y: at.y,
      deltaX,
      deltaY,
      modifiers,
    });
  };

  const drag = async (from, to, steps = 10) => {
    await mouse('mousePressed', from.x, from.y, { buttons: 1 });
    for (let i = 1; i <= steps; i += 1) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await mouse('mouseMoved', x, y, { buttons: 1 });
      await wait(16);
    }
    await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
  };

  /**
   * 明暗のテーマを切り替える。'light' | 'dark' | null(端末の設定に戻す)。
   * 配色は両方定義してあるので、片方だけ見て済ませない。
   */
  const emulateColorScheme = async (scheme) => {
    await send('Emulation.setEmulatedMedia', {
      features: scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : [],
    });
  };

  /** 窓の大きさを変える。狭いところでの見え方を確かめる用。 */
  const setViewportSize = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    });
  };

  /** 画面をそのまま撮る。見た目の判断は人に渡すためのもので、自動判定はしない。 */
  const screenshot = async (clip) =>
    (await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })).result
      ?.data;

  return {
    evaluate,
    waitFor,
    waitForFocus,
    wait,
    key,
    type,
    mouse,
    drag,
    wheel,
    emulateColorScheme,
    setViewportSize,
    screenshot,
    close: () => ws.close(),
  };
}
