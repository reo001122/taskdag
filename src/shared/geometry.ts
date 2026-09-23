/**
 * 矩形の重なり判定。main と renderer の両方から使う。
 *
 * ドメイン側は FR-4 の「枠どうしは重ならない」を守るために、表示側は
 * 置けないことを示すためと、新しい枠の置き場所を探すために使う。
 * 別々に持つと、画面では置けるように見えるのに弾かれる、という食い違いが出る。
 */

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * 2つの矩形が重なっているか。
 *
 * 辺が接するだけなら重なりとしない(FR-4)。厳密な不等号で見ているのはそのため。
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 2つの矩形が重なっている部分。重なっていなければ null。
 *
 * 置けない理由は「重なること」であって、どちらか一方の枠ではない。
 * 重なった領域そのものを示すために使う(FR-4)。
 */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}
