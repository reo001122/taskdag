/**
 * 新しいエンティティのID生成方法を、ドメイン層から見た「型」としてのみ定義する。
 *
 * 実体(crypto.randomUUID を使う実装)はドメイン層の外に置いている
 * (src/main/uuid-ids.ts)。ドメイン層に Node の API を持ち込まないため。
 * これにより domain/ 配下は実行時の外部依存を一切持たず、Vitest だけで完結する。
 *
 * テストでは決定論的な生成器を注入する(test-ids.ts)。
 */
export type IdGenerator = () => string;
