import type { Edl } from '../src/lib/edl/types';

/**
 * A hand-written EDL so `npm run remotion:studio` opens something real without
 * needing a rendered project. It exercises every layer — captions, B-roll slot,
 * a stat card, an icon, a transition, a punch-in, overlays — which makes it the
 * fastest way to iterate on the look of the renderer.
 *
 * The source URL points at Remotion's public sample clip so the Studio works on
 * a fresh clone; swap it for any project's EDL to debug a real edit.
 */
export const SAMPLE_EDL: Edl = {
  version: '1.0',
  projectId: 'sample',
  styleId: 'punchy',
  format: { aspect: '9:16', width: 1080, height: 1920, fps: 30, durationSec: 10 },
  source: {
    assetId: 'sample',
    url: 'https://remotion-assets.s3.eu-central-1.amazonaws.com/example-videos/bigbuckbunny.mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 60,
    hasAudio: true,
  },
  segments: [
    { id: 'seg-0', sourceStartSec: 2, sourceEndSec: 7, outStartSec: 0, outEndSec: 5, speed: 1, reason: 'hook', text: 'Most people get this completely backwards.' },
    { id: 'seg-1', sourceStartSec: 14, sourceEndSec: 19, outStartSec: 5, outEndSec: 10, speed: 1, reason: 'keep', text: 'Here is what actually works, and it takes about 30 seconds.' },
  ],
  captions: [
    {
      id: 'cue-0',
      startSec: 0.2,
      endSec: 2.1,
      words: [
        { text: 'MOST', startSec: 0.2, endSec: 0.62, emphasis: false },
        { text: 'PEOPLE', startSec: 0.62, endSec: 1.1, emphasis: false },
        { text: 'GET THIS', startSec: 1.1, endSec: 2.1, emphasis: false },
      ],
    },
    {
      id: 'cue-1',
      startSec: 2.1,
      endSec: 4.6,
      words: [
        { text: 'COMPLETELY', startSec: 2.1, endSec: 3.1, emphasis: false },
        { text: 'BACKWARDS', startSec: 3.1, endSec: 4.6, emphasis: true },
      ],
    },
    {
      id: 'cue-2',
      startSec: 5.1,
      endSec: 7.4,
      words: [
        { text: 'HERE IS', startSec: 5.1, endSec: 5.8, emphasis: false },
        { text: 'WHAT', startSec: 5.8, endSec: 6.2, emphasis: false },
        { text: 'WORKS', startSec: 6.2, endSec: 7.4, emphasis: true },
      ],
    },
    {
      id: 'cue-3',
      startSec: 7.5,
      endSec: 9.6,
      words: [
        { text: 'IN', startSec: 7.5, endSec: 7.8, emphasis: false },
        { text: '30', startSec: 7.8, endSec: 8.3, emphasis: true },
        { text: 'SECONDS', startSec: 8.3, endSec: 9.6, emphasis: false },
      ],
    },
  ],
  captionStyle: {
    animation: 'bounce',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: 800,
    fontSizeRatio: 0.068,
    maxWordsPerCue: 3,
    color: '#FFFFFF',
    emphasisColor: '#9B7BFF',
    positionY: 0.7,
    uppercase: true,
    stroke: { width: 14, color: '#000000' },
    shadow: true,
    background: null,
  },
  broll: [],
  graphics: [
    {
      id: 'graphic-0',
      type: 'stat',
      outStartSec: 7.6,
      outEndSec: 9.8,
      animation: 'count-up',
      x: 0.5,
      y: 0.24,
      scale: 1,
      text: '30s',
      subtext: 'to fix it',
      items: [],
      assetUrl: null,
      iconQuery: '',
      imagePrompt: '',
      color: '#9B7BFF',
    },
  ],
  overlays: [
    { id: 'overlay-progress', type: 'progress-bar', outStartSec: 0, outEndSec: 10, text: '', subtext: '', color: '#9B7BFF', opacity: 0.9 },
  ],
  transitions: [{ id: 'transition-0', atSec: 5, type: 'whip-pan', durationSec: 0.24 }],
  punchIns: [{ id: 'punch-0', outStartSec: 2.6, outEndSec: 4.8, scale: 1.2, x: 0.5, y: 0.4, easing: 'snap' }],
  reframe: {
    method: 'face-track',
    keyframes: [
      { outSec: 0, cx: 0.48, cy: 0.42, w: 0.5625 },
      { outSec: 5, cx: 0.52, cy: 0.44, w: 0.5625 },
      { outSec: 10, cx: 0.5, cy: 0.42, w: 0.5625 },
    ],
  },
  sfx: [
    { id: 'sfx-0', atSec: 5, sound: 'whoosh', gainDb: -15, url: '/audio/sfx/whoosh.wav' },
    { id: 'sfx-1', atSec: 7.6, sound: 'pop', gainDb: -17, url: '/audio/sfx/pop.wav' },
  ],
  music: null,
  audio: { targetLufs: -14, denoise: true, highPassHz: 80, compress: true },
  deliverable: {
    title: 'Most people get this backwards',
    socialCaption: 'The 30-second fix nobody talks about.',
    hashtags: ['#tips', '#howto'],
    thumbnailAtSec: 3,
    chapters: [],
  },
  degraded: [],
};
