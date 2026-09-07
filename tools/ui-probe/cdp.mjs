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

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('CDP へ接続できなかった')));
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');

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

  /** 1文字ずつ本物のキーイベントとして送る。React は本物の DOM イベントを聴いている。 */
  const type = async (text) => {
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  };

  /** 実際のマウス入力。React Flow のドラッグは pointer 系を見ているため click() では代替できない。 */
  const mouse = async (type_, x, y, button = 'left') => {
    await send('Input.dispatchMouseEvent', {
      type: type_,
      x,
      y,
      button,
      buttons: type_ === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  };

  const drag = async (from, to, steps = 10) => {
    await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i += 1) {
      await mouse(
        'mouseMoved',
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      );
      await wait(16);
    }
    await mouse('mouseReleased', to.x, to.y);
  };

  return { evaluate, waitFor, wait, key, type, mouse, drag, close: () => ws.close() };
}
