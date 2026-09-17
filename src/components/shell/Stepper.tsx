import React from 'react';
import { clsx } from 'clsx';
import { IconCheck } from './Icons';

/**
 * The four steps of making a video, and where you are in them.
 *
 * Dropping the file in is not one of them. It is how you start, not a decision
 * you make — and numbering it pushed the first real choice to position two,
 * which made the whole thing read as longer than it is.
 *
 * What is left is four things a person actually does: choose the shape, choose
 * what goes in it, let it run, take the result. Fine-tuning lives on the last
 * one rather than being a step of its own, because by then the video exists and
 * adjusting it is something you may or may not want.
 *
 * Numbering is used because this genuinely is a sequence — you cannot apply an
 * edit you have not chosen — not as decoration.
 *
 * On a phone only the step you are on is named. Four labels sharing 430px
 * truncated every one of them, which tells you less than a numbered circle does
 * in more space. The numbers still say how many steps there are and which one
 * this is.
 */

export const PIPELINE_STEPS = [
  { key: 'style', label: 'Style', hint: 'Pick the shape' },
  { key: 'edits', label: 'Edits', hint: "What's in it" },
  { key: 'apply', label: 'Apply', hint: 'We cut it' },
  { key: 'export', label: 'Export', hint: 'Post or adjust' },
] as const;

export type StepKey = (typeof PIPELINE_STEPS)[number]['key'];

export function Stepper({
  current,
  onStepClick,
  className,
}: {
  current: StepKey;
  /** Only passed where going back is real; without it, past steps are not links. */
  onStepClick?: (key: StepKey) => void;
  className?: string;
}) {
  const index = PIPELINE_STEPS.findIndex((s) => s.key === current);

  return (
    <ol className={clsx('flex items-stretch gap-1 sm:gap-2', className)}>
      {PIPELINE_STEPS.map((step, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'todo';
        const reachable = state === 'done' && Boolean(onStepClick);
        const Tag = reachable ? 'button' : 'div';

        return (
          <li
            key={step.key}
            className={clsx('min-w-0 sm:flex-1', state === 'current' ? 'flex-1' : 'flex-none')}
          >
            <Tag
              {...(reachable ? { type: 'button' as const, onClick: () => onStepClick?.(step.key) } : {})}
              aria-current={state === 'current' ? 'step' : undefined}
              className={clsx(
                'flex w-full items-center rounded-xl py-2.5 text-left transition-colors sm:gap-2.5 sm:px-3.5',
                state === 'current' ? 'gap-2.5 px-2.5' : 'justify-center px-2 sm:justify-start',
                reachable && 'hover:bg-charcoal',
                state === 'current' && 'bg-violet-dim',
              )}
            >
              <span
                className={clsx(
                  'grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[11px] font-bold tabular-nums',
                  state === 'done' && 'bg-violet/20 text-violet',
                  state === 'current' && 'bg-violet text-ink',
                  state === 'todo' && 'border border-line text-faint',
                )}
              >
                {state === 'done' ? <IconCheck className="h-3 w-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={clsx(
                    'truncate text-[13px] font-semibold leading-tight',
                    state === 'current' ? 'block' : 'hidden sm:block',
                    state === 'todo' ? 'text-faint' : 'text-chalk',
                  )}
                >
                  {step.label}
                </span>
                <span className="hidden truncate text-[11px] leading-tight text-faint sm:block">
                  {step.hint}
                </span>
              </span>
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}
