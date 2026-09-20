import { describe, expect, it } from 'vitest';
import {
  TOUCH_CLICK_MOVE_THRESHOLD_PX,
  hasExceededMoveThreshold,
  isTouchLikePointer
} from './touchClickGuard';

describe('touch click guard', () => {
  it('treats touch and pen pointers as touch-like input', () => {
    expect(isTouchLikePointer('touch')).toBe(true);
    expect(isTouchLikePointer('pen')).toBe(true);
    expect(isTouchLikePointer('mouse')).toBe(false);
  });

  it('keeps small tap movement within the click threshold', () => {
    expect(hasExceededMoveThreshold(0, 0, TOUCH_CLICK_MOVE_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it('flags movement beyond the click threshold as a scroll gesture', () => {
    expect(hasExceededMoveThreshold(0, 0, TOUCH_CLICK_MOVE_THRESHOLD_PX + 1, 0)).toBe(true);
  });
});
