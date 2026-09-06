import type { IdGenerator } from './ids';

/**
 * テスト用の決定論的なID生成器。
 * `id-1`, `id-2`, ... を順に返す。
 */
export function sequentialIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
