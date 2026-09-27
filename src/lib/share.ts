// One place for the shareable event link: the event dialog and the map card
// both build the same URL and fall back the same way when the Web Share API is
// missing or refuses. Kept free of React so it can be unit-tested.

export type ShareOutcome = 'shared' | 'copied' | 'cancelled';

/** Public URL that reopens an event: the current page plus `?etkinlik=<id>`. */
export function eventShareUrl(eventId: string, href: string): string {
  const url = new URL(href);
  url.searchParams.set('etkinlik', eventId);
  return url.toString();
}

/**
 * Shares the link through the device sheet when the browser has one, and copies
 * it to the clipboard otherwise. A dismissed share sheet is not a failure, so
 * the caller only shows the "copied" notice when the clipboard took the link.
 */
export async function shareEventUrl(url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined') return 'cancelled';
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      if ((error as DOMException | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'cancelled';
  }
}
