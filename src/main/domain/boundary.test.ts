import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ドメイン層の境界を機械的に守る(CLAUDE.md「レイヤー境界」)
 *
 * このレイヤーは UI 経由の操作と AI 経由の操作の唯一の合流点であり、外部への依存を
 * 持たないことが要件由来の制約になっている(FR-7.5)。規約に書くだけでは、
 * import を1行足すだけで静かに破れる。テストで落とす。
 */

const DOMAIN_DIR = join(import.meta.dirname);

/** ドメイン層が import してはならないもの。 */
const FORBIDDEN = [
  'electron',
  'node:sqlite',
  'react',
  '@xyflow',
  'better-sqlite3',
  // Node の標準モジュール全般。純粋な TypeScript として保つため
  'node:fs',
  'node:path',
  'node:crypto',
];

function importsOf(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null = pattern.exec(source);
  while (m !== null) {
    if (m[1] !== undefined) found.push(m[1]);
    m = pattern.exec(source);
  }
  return found;
}

describe('ドメイン層の境界', () => {
  // テストファイル自身は vitest を import するため対象外。
  // 守りたいのは実装モジュールが外部に依存しないこと。
  const implFiles = readdirSync(DOMAIN_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('test-'),
  );

  it('検査対象の実装ファイルが存在する(グロブが空振りしていない)', () => {
    expect(implFiles.length).toBeGreaterThan(5);
  });

  for (const file of implFiles) {
    it(`${file} は外部モジュールを import しない`, () => {
      const source = readFileSync(join(DOMAIN_DIR, file), 'utf8');
      const external = importsOf(source).filter(
        (spec) => !spec.startsWith('.') && !spec.startsWith('/'),
      );

      expect(external).toEqual([]);
    });
  }

  it('禁止リストのモジュール名がソースに現れない', () => {
    for (const file of implFiles) {
      const source = readFileSync(join(DOMAIN_DIR, file), 'utf8');
      for (const spec of importsOf(source)) {
        expect(FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))).toBe(false);
      }
    }
  });
});
