import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, BrowserWindow, ipcMain } from 'electron';
import { AppService } from './app-service';
import { openDatabase } from './db/open';
import { registerIpc } from './ipc/handlers';

let db: DatabaseSync | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'taskdag.db');
  db = openDatabase(dbPath);
  const service = new AppService(db);

  registerIpc(ipcMain, service, db, dbPath);
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
