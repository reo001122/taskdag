import { createLogger, type Logger, toLogLevel } from '../../shared/log';

/**
 * renderer 側のログ。
 *
 * 詳しさは main が起動引数から決め、preload 経由で届く(`shared/log.ts`)。
 * 出力先は DevTools のコンソール。
 */
const level = toLogLevel(window.api?.logLevel);

/** scope は追いたい経路の単位で付ける(`edit`, `graph` など)。 */
export const logger = (scope: string): Logger => createLogger(`renderer/${scope}`, level);
