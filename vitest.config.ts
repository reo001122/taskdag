import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層は外部依存を持たず、永続化層は node:sqlite(Node標準)を使うため、
    // いずれも Node 環境で完結する(design/development-process.md)。
    environment: 'node',
    // renderer は対象外(design/development-process.md)。shared は main と
    // renderer の双方が読むため、ここで担保する。
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
  },
});
