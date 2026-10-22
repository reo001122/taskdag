import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層は外部依存を持たず、永続化層は node:sqlite(Node標準)を使うため、
    // いずれも Node 環境で完結する(design/development-process.md)。
    environment: 'node',
    // renderer は対象外(design/development-process.md)。shared は main と
    // renderer の双方が読むため、ここで担保する。
    // 例外は keymap.test.ts だけ。画面に触れない純粋関数で、過去に漏れが出た場所
    // のため(design/decisions.md D-14)。
    include: [
      'src/main/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/renderer/src/keymap.test.ts',
    ],
  },
});
