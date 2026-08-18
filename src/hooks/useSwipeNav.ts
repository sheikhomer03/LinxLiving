import { useCallback, useRef } from "react";

/** Minimum horizontal travel (px) before a touch counts as a swipe. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * Horizontal swipe-to-navigate for hand-built carousels (crossfade/index
 * based, not native scroll-snap — those already get touch scrolling for
 * free). Attach `onTouchStart`/`onTouchEnd` to the swipeable element.
 *
 * A swipe that lands on a `<Link>`/`onClick` element still fires a
 * synthetic click on touch-end — call `consumeSwipeClick()` at the top of
 * that handler and bail out (or `e.preventDefault()`) when it returns true,
 * so a swipe never also triggers navigation.
 */
export function useSwipeNav(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const didSwipe = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0]?.clientX ?? null;
    startY.current = e.touches[0]?.clientY ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (startX.current == null || startY.current == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? startX.current) - startX.current;
      const dy = (e.changedTouches[0]?.clientY ?? startY.current) - startY.current;
      startX.current = null;
      startY.current = null;
      // A mostly-vertical drag is a page scroll, not a swipe.
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) {
        return;
      }
      didSwipe.current = true;
      if (dx < 0) onSwipeLeft();
      else onSwipeRight();
    },
    [onSwipeLeft, onSwipeRight],
  );

  const consumeSwipeClick = useCallback(() => {
    if (!didSwipe.current) return false;
    didSwipe.current = false;
    return true;
  }, []);

  return { onTouchStart, onTouchEnd, consumeSwipeClick };
}
