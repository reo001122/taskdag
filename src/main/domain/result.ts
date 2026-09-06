/**
 * ドメイン層の戻り値表現(design/coding-standards.md §5)
 *
 * 「起こりうる失敗」(循環になる接続、存在しないTaskの参照 等)は例外ではなく
 * Result で返す。呼び出し側(IPC / MCP)が失敗を必ず処理することを型で強制でき、
 * AI に返すエラーメッセージも組み立てやすいため。
 *
 * 「起こってはならない状態」(データ不整合など)は例外を投げる。
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** 値を返さない成功。 */
export const okVoid: Result<void, never> = { ok: true, value: undefined };
