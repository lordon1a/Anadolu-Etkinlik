import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up to its next value: the hero strip reads as a live figure
 * instead of a static label. Values are integers; the animation is skipped when
 * the visitor asked for less motion.
 */
export function useCountUp(value: number, durationMs = 600): number {
  const [shown, setShown] = useState(value);
  const frame = useRef(0);
  const from = useRef(value);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduced || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (value - start) * eased);
      setShown(current);
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, durationMs]);

  return shown;
}
