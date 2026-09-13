import { describe, expect, it, vi } from 'vitest';
import { createLogger, DEFAULT_LOG_LEVEL, parseLogLevel, toLogLevel } from './log';

describe('parseLogLevel', () => {
  it('--log=<level> を読む', () => {
    expect(parseLogLevel(['electron', '.', '--log=debug'])).toBe('debug');
  });

  it('指定がなければ既定', () => {
    expect(parseLogLevel(['electron', '.'])).toBe(DEFAULT_LOG_LEVEL);
  });

  it('知らない値は既定へ倒す(打ち間違いで起動しなくならないこと)', () => {
    expect(parseLogLevel(['--log=verbose'])).toBe(DEFAULT_LOG_LEVEL);
  });

  it('Chromium の --log-level とは別物として扱う', () => {
    expect(parseLogLevel(['--log-level=3'])).toBe(DEFAULT_LOG_LEVEL);
  });
});

describe('toLogLevel', () => {
  it('null / undefined は既定', () => {
    expect(toLogLevel(null)).toBe(DEFAULT_LOG_LEVEL);
    expect(toLogLevel(undefined)).toBe(DEFAULT_LOG_LEVEL);
  });
});

describe('createLogger', () => {
  it('設定より細かいものは出さない', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const log = createLogger('test', 'warn');
    log.debug('出ない');
    log.warn('出る');

    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[test] 出る');

    debug.mockRestore();
    warn.mockRestore();
  });

  it('silent は何も出さない', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createLogger('test', 'silent').error('出ない');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('detail を省いたときは undefined を並べない', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('test', 'debug');
    log.info('なし');
    log.info('あり', { a: 1 });
    expect(info).toHaveBeenNthCalledWith(1, '[test] なし');
    expect(info).toHaveBeenNthCalledWith(2, '[test] あり', { a: 1 });
    info.mockRestore();
  });
});
