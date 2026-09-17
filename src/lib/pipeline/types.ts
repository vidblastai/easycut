import type { DirectorPlan } from '@/lib/director/schema';
import type { LayerName } from '@/lib/edl/layers';
import type { Edl } from '@/lib/edl/types';
import type { FormatMode, StylePreset } from '@/lib/styles/presets';
import type { Transcript } from '@/lib/transcribe/types';
import type { CleanupFinding } from '@/lib/timeline/cleanup';
import type { Interval } from '@/lib/timeline/silence';
import type { MediaInfo } from '@/lib/media/ffmpeg';
import type { CostLedger } from '@/lib/pricing/cost';

/** The twelve stages, in order. A job records the last one it finished. */
export const STAGES = [
  'ingest',
  'transcribe',
  'silence',
  'cleanup',
  'direct',
  'timeline',
  'reframe',
  'assets',
  'edl',
  'render',
  'deliver',
  'done',
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  ingest: 'Reading your footage',
  transcribe: 'Listening to what you said',
  silence: 'Finding the dead air',
  cleanup: 'Cutting the ums and restarts',
  direct: 'Planning the edit',
  timeline: 'Building the timeline',
  reframe: 'Keeping you in frame',
  assets: 'Gathering B-roll, icons and music',
  edl: 'Assembling the edit',
  render: 'Rendering your video',
  deliver: 'Finishing up',
  done: 'Done',
};

/** Roughly how much of the total wall-clock each stage takes, for the progress bar. */
export const STAGE_WEIGHTS: Record<Stage, number> = {
  ingest: 0.08,
  transcribe: 0.1,
  silence: 0.02,
  cleanup: 0.02,
  direct: 0.16,
  timeline: 0.02,
  reframe: 0.06,
  assets: 0.1,
  edl: 0.02,
  render: 0.36,
  deliver: 0.06,
  done: 0,
};

export interface PipelineRequest {
  projectId: string;
  mode: FormatMode;
  styleId: string;
  /** The caption look, when the user chose one. Null takes the edit style's. */
  captionPreset?: string | null;
  inputMode: 'raw' | 'roughcut';
  userNote?: string;
  /**
   * Layers the person declined at upload.
   *
   * Applied where the document is built rather than where it is rendered, so a
   * refused layer is absent from the timeline, the editor and the cost report
   * — not present everywhere and merely hidden at paint time.
   */
  layersOff?: readonly LayerName[];
  /** Storage key of the uploaded source file. */
  sourceKey: string;
  /** Resume from this stage instead of the beginning. */
  resumeFrom?: Stage;
}

export interface StageLogEntry {
  stage: Stage;
  status: 'ok' | 'degraded' | 'failed';
  ms: number;
  message: string;
}

/** Everything the stages read from and write to. Stages are pure-ish: in, out. */
export interface PipelineContext {
  request: PipelineRequest;
  style: StylePreset;
  ledger: CostLedger;
  /** Temp working directory for this run. */
  workDir: string;

  sourcePath?: string;
  proxyPath?: string;
  asrAudioPath?: string;
  mixAudioPath?: string;
  media?: MediaInfo;

  transcript?: Transcript;
  acousticSilence?: Interval[];
  silenceRemovals?: Interval[];
  cleanupFindings?: CleanupFinding[];
  cleanupRemovals?: Interval[];
  plan?: DirectorPlan;
  edl?: Edl;

  /** Layers skipped because a provider was missing or failed. */
  degraded: string[];
  log: StageLogEntry[];
}

export type ProgressReporter = (stage: Stage, fraction: number, label?: string) => void | Promise<void>;
