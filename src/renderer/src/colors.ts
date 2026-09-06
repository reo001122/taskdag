/**
 * Project に割り当てる色。
 *
 * 保存しない。色そのものに意味はなく、隣り合う Project を見分けられればよい。
 * 作成順に固定の並びから配る —— 乱数やハッシュだと、少数の Project でも
 * 似た色が隣り合ってしまうことがある。
 *
 * 枠線・枠の塗り・その Project に属する Task の左上の点が、すべてこの色になる。
 * 点を見れば、枠を目で追わなくてもどこに属しているか分かる。
 */
export const PROJECT_COLORS: readonly string[] = [
  'hsl(212 62% 52%)', // 青
  'hsl(160 52% 42%)', // 青緑
  'hsl(36 72% 50%)', // 琥珀
  'hsl(344 62% 56%)', // 赤紫
  'hsl(268 52% 58%)', // 紫
  'hsl(96 42% 44%)', // 緑
  'hsl(18 68% 54%)', // 橙
];

export const PROJECT_COLOR_COUNT = PROJECT_COLORS.length;

/** 作成順の index から色を決める。7 を超えたら先頭へ戻る。 */
export function projectColorAt(index: number): string {
  return PROJECT_COLORS[index % PROJECT_COLORS.length] ?? 'hsl(212 62% 52%)';
}
