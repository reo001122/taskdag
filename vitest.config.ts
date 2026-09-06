import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ドメイン層は外部依存を持たず、永続化層は node:sqlite(Node標準)を使うため、
    // いずれも Node 環境で完結する(design/development-process.md)。
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
  },
});
