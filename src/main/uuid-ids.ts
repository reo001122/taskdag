import { randomUUID } from 'node:crypto';
import type { IdGenerator } from './domain/ids';

/**
 * 本番で使うID生成器(design/persistence-design.md §4)
 *
 * ドメイン層の外に置いている。domain/ 配下に Node の API を持ち込まないため。
 */
export const uuidIds: IdGenerator = () => randomUUID();
