import React from 'react';

/**
 * The mark: a play triangle with a spark cut out of it. Rendered as inline SVG
 * rather than an image file so it inherits colour and stays crisp at any size.
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 32, className }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden>
    <path
      d="M12 14.5C12 9.6 17.3 6.6 21.5 9.1l58 34.4c1.9 1.1 1.9 3.9 0 5L21.5 82.9C17.3 85.4 12 82.4 12 77.5V14.5Z"
      fill="currentColor"
    />
    <path
      d="M46.2 24.4c.5-1.3 2.4-1.2 2.7.2 1.4 6.6 3.7 13.6 7.6 17.9 3.9 4.3 10.5 6.9 16.6 8.5 1.3.3 1.4 2.2.1 2.7-6 2.2-12.4 5.2-16 9.6-3.6 4.4-5.5 11.3-6.6 17.7-.2 1.4-2.2 1.5-2.6.2-2-6.2-4.7-12.7-8.6-16.6-3.9-3.9-10-6.1-15.6-7.6-1.3-.4-1.4-2.3-.1-2.8 5.6-2 11.4-4.7 15.1-8.8 3.7-4.1 5.7-11 7.4-17.3Z"
      fill="#0D0D10"
    />
  </svg>
);

export const Logo: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <div className="flex items-center gap-2.5">
    <LogoMark size={size} className="text-violet" />
    <span className="text-[19px] font-extrabold tracking-[-0.035em] text-chalk">EasyCut</span>
  </div>
);
