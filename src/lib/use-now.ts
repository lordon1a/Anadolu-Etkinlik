import { useEffect, useState } from 'react';

/**
 * A `Date` that re-renders on an interval, so countdown labels and "now"
 * comparisons stay honest without a timer per component. The interval is
 * deliberately coarse: the labels never show less than a minute.
 */
export function useNow(intervalMs = 30 * 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
