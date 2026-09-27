import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // Electron 本体と node の組み込みモジュールはバンドルせず、外部依存として扱う
    // (DB は node:sqlite。native モジュールは使っていない。D-9)
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
  },
});
