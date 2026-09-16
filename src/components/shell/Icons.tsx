import React from 'react';

/**
 * The icon set, drawn at a single weight.
 *
 * Icons are inline rather than an icon font or a package: there are eleven of
 * them, they all share one stroke width and one 24-unit grid, and a dependency
 * that ships a thousand would still need this wrapper to keep them consistent.
 */

type IconProps = { className?: string };

const Svg: React.FC<React.PropsWithChildren<IconProps & { fill?: boolean }>> = ({
  className,
  fill = false,
  children,
}) => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

export const IconGrid: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </Svg>
);

export const IconPlus: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const IconSparkle: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3c.9 3.7 1.7 5.4 5 6.4-3.3 1-4.1 2.7-5 6.4-.9-3.7-1.7-5.4-5-6.4 3.3-1 4.1-2.7 5-6.4Z" />
    <path d="M18.5 15.5c.4 1.6.7 2.3 2.2 2.8-1.5.5-1.8 1.2-2.2 2.8-.4-1.6-.7-2.3-2.2-2.8 1.5-.5 1.8-1.2 2.2-2.8Z" />
  </Svg>
);

export const IconCaptions: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M9.5 10.5a2.3 2.3 0 1 0 0 3M16.5 10.5a2.3 2.3 0 1 0 0 3" />
  </Svg>
);

export const IconSettings: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3 1.1Z" />
  </Svg>
);

export const IconHelp: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8v.1" />
  </Svg>
);

export const IconPlay: React.FC<IconProps> = (p) => (
  <Svg {...p} fill><path d="M6 3.7v16.6L20 12 6 3.7Z" /></Svg>
);

export const IconDownload: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4 17.5v1.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-1.2" /></Svg>
);

export const IconArrowRight: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5" /></Svg>
);

export const IconCheck: React.FC<IconProps> = (p) => (
  <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7" /></Svg>
);

/**
 * Upload: a solid arrow over a bar.
 *
 * Solid rather than stroked because it sits inside a disc at a size where a
 * 1.7px stroke reads as a thin scratch — every other icon here is chrome, this
 * one is the subject.
 */
export const IconUpload: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" className={className} aria-hidden>
    <path d="M12 4.4a.9.9 0 0 1 .66.29l6.1 6.55a.8.8 0 0 1-.58 1.34h-3.06v3.5a.9.9 0 0 1-.9.9h-4.44a.9.9 0 0 1-.9-.9v-3.5H5.82a.8.8 0 0 1-.58-1.34l6.1-6.55A.9.9 0 0 1 12 4.4Z" />
    <rect x="5.4" y="18.7" width="13.2" height="2.6" rx="1.3" />
  </svg>
);

export const IconFilm: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M8 4.5v15M16 4.5v15M3 12h18M3 8.2h5M3 15.8h5M16 8.2h5M16 15.8h5" />
  </Svg>
);
