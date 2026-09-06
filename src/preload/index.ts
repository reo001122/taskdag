import { contextBridge, ipcRenderer } from 'electron';
import type { Command, CommandResult, DeletePlan, GraphSnapshot } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { type LogLevel, parseLogLevel } from '../shared/log';

/**
 * renderer から main への唯一の到達経路。
 * contextIsolation: true / sandbox: true のもとで動く。
 *
 * ここに判断を書かないこと。main 側の検証(ipc/validate.ts)が唯一の関門であり、
 * preload で弾いても AI 経由の操作は通らないため意味がない。
 */
const api = {
  /** main が additionalArguments で渡した値。renderer 側のログの詳しさを決める。 */
  logLevel: parseLogLevel(process.argv) as LogLevel,
  getGraph: (): Promise<GraphSnapshot> => ipcRenderer.invoke(IPC.getGraph),
  send: (command: Command): Promise<CommandResult> => ipcRenderer.invoke(IPC.command, command),
  validTargets: (from: string): Promise<string[]> => ipcRenderer.invoke(IPC.validTargets, from),
  planDelete: (id: string): Promise<DeletePlan | null> => ipcRenderer.invoke(IPC.planDelete, id),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
