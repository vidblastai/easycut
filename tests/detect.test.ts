import { describe, expect, it } from 'vitest';
import { detectFormat, LONG_FORM_MIN_SEC } from '@/lib/styles/detect';

describe('working out the format from the footage', () => {
  it('calls vertical footage a short, however long it runs', () => {
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 20 }).mode).toBe('short');
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 3600 }).mode).toBe('short');
  });

  it('calls square footage a short', () => {
    expect(detectFormat({ width: 1080, height: 1080, durationSec: 600 }).mode).toBe('short');
  });

  it('calls a brief widescreen clip a short, because there is nothing to cut down from', () => {
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 47 }).mode).toBe('short');
    expect(detectFormat({ width: 1920, height: 1080, durationSec: LONG_FORM_MIN_SEC - 1 }).mode).toBe('short');
  });

  it('calls a long widescreen recording long form', () => {
    expect(detectFormat({ width: 1920, height: 1080, durationSec: LONG_FORM_MIN_SEC + 1 }).mode).toBe('long');
    expect(detectFormat({ width: 3840, height: 2160, durationSec: 1800 }).mode).toBe('long');
  });

  it('says why, in words somebody would use', () => {
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 30 }).reason).toMatch(/vertical/);
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 47 }).reason).toMatch(/47s/);
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 620 }).reason).toMatch(/10:20/);
  });

  it('admits when it is guessing', () => {
    expect(detectFormat(null).confident).toBe(false);
    expect(detectFormat({ width: 0, height: 0, durationSec: 0 }).confident).toBe(false);
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 12 }).confident).toBe(true);
  });

  it('never leaves the format unset', () => {
    for (const probe of [null, { width: 1, height: 1, durationSec: 0 }, { width: 4000, height: 10, durationSec: 1e6 }]) {
      expect(['short', 'long']).toContain(detectFormat(probe).mode);
    }
  });
});
