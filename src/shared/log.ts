/**
 * ログ
 *
 * 出力先はコンソール。main はターミナル、renderer は DevTools に出る。
 *
 * 既定は warn。実行時の様子を見たいときだけ、起動引数で下げる。
 *
 *   taskdag --log=debug
 *   npm run dev -- -- --log=debug      (前の -- は npm、後の -- は electron-vite の分)
 *
 * **debug は「起きなかったこと」を残すために置いている。** 追加した入力欄に
 * フォーカスが移らない、目印が届かない —— この種の不具合は画面を見ても
 * 何が起きなかったのかが分からず、型チェックもテストも素通りする。
 *
 * Chromium 自身の `--log-level` と紛れないよう、名前は `--log` にしてある。
 */

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'warn';

const RANK: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value);

/** 不正な値は既定へ倒す。起動引数の打ち間違いで起動しなくなるより、既定で動くほうがよい。 */
export function toLogLevel(
  value: string | null | undefined,
  fallback = DEFAULT_LOG_LEVEL,
): LogLevel {
  return value != null && isLogLevel(value) ? value : fallback;
}

/** 起動引数から `--log=<level>` を読む。main と renderer の双方が同じ argv の形を見る。 */
export function parseLogLevel(argv: readonly string[], fallback = DEFAULT_LOG_LEVEL): LogLevel {
  const prefix = '--log=';
  const found = argv.find((arg) => arg.startsWith(prefix));
  return toLogLevel(found?.slice(prefix.length), fallback);
}

export type Logger = {
  error: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  debug: (message: string, detail?: unknown) => void;
};

/**
 * scope は「どこから出たログか」。`[renderer/edit]` のように、
 * 追いたい経路の単位で付ける。ファイル名と一致させる必要はない。
 */
export function createLogger(scope: string, level: LogLevel): Logger {
  const write =
    (want: LogLevel, sink: (...args: unknown[]) => void) =>
    (message: string, detail?: unknown): void => {
      if (RANK[level] < RANK[want]) return;
      // detail を省いたときに undefined が並ばないようにする
      if (detail === undefined) sink(`[${scope}] ${message}`);
      else sink(`[${scope}] ${message}`, detail);
    };

  return {
    error: write('error', (...args) => console.error(...args)),
    warn: write('warn', (...args) => console.warn(...args)),
    info: write('info', (...args) => console.info(...args)),
    debug: write('debug', (...args) => console.debug(...args)),
  };
}
