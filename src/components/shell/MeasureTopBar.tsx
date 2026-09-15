'use client';

import { useEffect } from 'react';

/**
 * Publishes the topbar's real height as `--topbar`.
 *
 * Three layout rules depend on it: the sidebar's sticky offset and height, and
 * the studio's full-height column. They were written against a guessed 57px
 * when the bar actually measures around 60 — six pixels of error, which is
 * exactly enough to push the timeline dock below the fold where nobody can
 * reach it. Measuring costs one ResizeObserver and removes the whole class of
 * bug.
 */
export function MeasureTopBar() {
  useEffect(() => {
    const bar = document.querySelector('[data-topbar]');
    if (!(bar instanceof HTMLElement)) return;

    const apply = () => {
      const h = Math.round(bar.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--topbar', `${h}px`);
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return null;
}
