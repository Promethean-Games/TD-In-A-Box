import { useCallback, useRef } from 'react';

export const TOUCH_CLICK_MOVE_THRESHOLD_PX = 10;
export const TOUCH_CLICK_SUPPRESSION_WINDOW_MS = 700;

export function isTouchLikePointer(pointerType: string) {
  return pointerType === 'touch' || pointerType === 'pen';
}

export function hasExceededMoveThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = TOUCH_CLICK_MOVE_THRESHOLD_PX
) {
  const deltaX = currentX - startX;
  const deltaY = currentY - startY;
  return deltaX * deltaX + deltaY * deltaY > threshold * threshold;
}

type ActivePointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  movedTooFar: boolean;
};

export function useTouchClickGuard() {
  const activePointerRef = useRef<ActivePointerGesture | null>(null);
  const suppressClickUntilRef = useRef(0);

  const onPointerDownCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || !isTouchLikePointer(event.pointerType)) {
      return;
    }

    activePointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      movedTooFar: false
    };
  }, []);

  const onPointerMoveCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const activePointer = activePointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId || activePointer.movedTooFar) {
      return;
    }

    if (hasExceededMoveThreshold(activePointer.startX, activePointer.startY, event.clientX, event.clientY)) {
      activePointer.movedTooFar = true;
    }
  }, []);

  const endPointerGesture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const activePointer = activePointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return;
    }

    if (activePointer.movedTooFar) {
      suppressClickUntilRef.current = Date.now() + TOUCH_CLICK_SUPPRESSION_WINDOW_MS;
    }

    activePointerRef.current = null;
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.detail === 0) {
      return;
    }

    if (Date.now() > suppressClickUntilRef.current) {
      suppressClickUntilRef.current = 0;
      return;
    }

    suppressClickUntilRef.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: endPointerGesture,
    onPointerCancelCapture: endPointerGesture,
    onClickCapture
  };
}
