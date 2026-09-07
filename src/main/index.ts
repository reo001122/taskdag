import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLogger, type LogLevel, parseLogLevel } from '../shared/log';
import { AppService } from './app-service';
import { openDatabase } from './db/open';
import { registerIpc } from './ipc/handlers';

let db: DatabaseSync | null = null;

const logLevel: LogLevel = parseLogLevel(process.argv);
const log = createLogger('main', logLevel);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    /*
      自動チェック(tools/ui-probe)用。描画は普通に行われ、CDP からも触れるが、
      画面には出ない。コミットのたびにウィンドウが割り込んでフォーカスを
      奪うのでは、確認を常時走らせられない。
    */
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // renderer は起動引数を直接読めない。ここで渡した分が
      // renderer 側の process.argv に足される。
      additionalArguments: [`--log=${logLevel}`],
    },
  });

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('画面の読み込みに失敗した', { code, description, url });
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    log.debug('開発サーバから読み込む', devServerUrl);
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'taskdag.db');
  log.info('データベース', dbPath);
  db = openDatabase(dbPath);
  const service = new AppService(db);

  registerIpc(ipcMain, service, db, dbPath, log);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  db?.close();
});
