'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Pulls the preview copy of the footage into the browser BEFORE anything plays.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * A cut in the edit is a seek in the file. Even with a keyframe every 0.4s,
 * a seek on a streamed file is a round trip to the server: the element asks
 * for the byte range around the new position and waits. On a good connection
 * that is a couple of hundred milliseconds — which is exactly the freeze you
 * see at every cut, and it is paid at every cut, forever, because the browser
 * only holds a window of the file around wherever it has been playing.
 *
 * So the whole file comes down once, into memory, and the preview plays from a
 * `blob:` URL. After that a seek is a memory offset: no network, no wait, and
 * every clip in the edit shares the same bytes instead of fetching its own.
 *
 * The preview copy is small — a couple of megabytes for a short, tens for a
 * long one — which is what makes this reasonable. Anything above the cap below
 * keeps streaming, because holding a quarter-gigabyte in memory to smooth out
 * a seek is the wrong trade.
 */

/** Above this, stream it instead. */
const MAX_PRELOAD_BYTES = 180 * 1024 * 1024;

/**
 * Object URLs survive the component, keyed by their source.
 *
 * Leaving and re-entering the editor is something people do constantly, and
 * downloading the same file again each time would undo the point of this.
 * Revoking on unmount would too. The map is the size of the videos somebody
 * opened in one session, and the tab reclaims all of it on close.
 */
const cache = new Map<string, string>();

export interface PreloadedVideo {
  /** The URL to play: the local copy when it is ready, otherwise the original. */
  url: string | null;
  /** 0–1 while downloading; 1 once it is playable. */
  progress: number;
  ready: boolean;
  /** Why it is streaming rather than preloaded, if it came to that. */
  streaming: boolean;
}

export function usePreloadedVideo(source: string | null): PreloadedVideo {
  const [state, setState] = useState<PreloadedVideo>(() => ({
    url: source && cache.has(source) ? cache.get(source)! : source,
    progress: !source || cache.has(source) ? 1 : 0,
    ready: !source || cache.has(source),
    streaming: !source,
  }));
  const forSource = useRef<string | null>(null);

  useEffect(() => {
    if (!source) {
      /*
       * Nothing to preload, so nothing to wait for.
       *
       * A project whose preview copy is still being built has no URL yet, and
       * an editor held behind a progress bar that can never fill is worse than
       * one that plays the original for a minute.
       */
      forSource.current = null;
      setState({ url: null, progress: 1, ready: true, streaming: true });
      return;
    }
    if (forSource.current === source) return;
    forSource.current = source;

    const cached = cache.get(source);
    if (cached) {
      setState({ url: cached, progress: 1, ready: true, streaming: false });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setState({ url: source, progress: 0, ready: false, streaming: false });

    (async () => {
      try {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const total = Number(response.headers.get('content-length') ?? 0);
        if (total > MAX_PRELOAD_BYTES) {
          controller.abort();
          // Too big to hold. Streaming is worse at the cuts, and still correct.
          if (!cancelled) setState({ url: source, progress: 1, ready: true, streaming: true });
          return;
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            if (!cancelled && total) {
              setState((was) => ({ ...was, progress: Math.min(0.99, received / total) }));
            }
          }
        }
        if (cancelled) return;

        const blob = new Blob(chunks as BlobPart[], {
          type: response.headers.get('content-type') ?? 'video/mp4',
        });
        const local = URL.createObjectURL(blob);
        cache.set(source, local);
        setState({ url: local, progress: 1, ready: true, streaming: false });
      } catch {
        // A failed preload must never cost somebody their editor: play the
        // original over the network, exactly as before this existed.
        if (!cancelled) setState({ url: source, progress: 1, ready: true, streaming: true });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source]);

  return state;
}
