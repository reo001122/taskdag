import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase } from './open';
import { getHideCompleted, setHideCompleted } from './settings';

describe('app_settings', () => {
  it('既定は false', () => {
    expect(getHideCompleted(openInMemoryDatabase())).toBe(false);
  });

  it('保存した値を読み戻せる', () => {
    const db = openInMemoryDatabase();
    setHideCompleted(db, true);
    expect(getHideCompleted(db)).toBe(true);
    setHideCompleted(db, false);
    expect(getHideCompleted(db)).toBe(false);
  });
});
