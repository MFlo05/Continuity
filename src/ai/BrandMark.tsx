import React from 'react';
import { assetUrl } from './asset-utils';
import type { ProviderId } from './provider-config';

interface BrandMarkProps {
  provider: ProviderId;
  size: number;
  isDark?: boolean;
  className?: string;
}

/** Renders the correct logo for each provider. Local AI gets a neutral SVG glyph — no third-party brand. */
export function BrandMark({ provider, size, isDark = false, className }: BrandMarkProps) {
  const s = size;

  if (provider === 'claude') {
    return (
      <img
        src={assetUrl('claude-mark.png')}
        alt="Claude"
        width={s} height={s}
        className={className}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  if (provider === 'gemini') {
    return (
      <img
        src={assetUrl('gemini-mark.png')}
        alt="Gemini"
        width={s} height={s}
        className={className}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  if (provider === 'openai') {
    return (
      <img
        src={assetUrl('openai-mark.png')}
        alt="OpenAI"
        width={s} height={s}
        className={className}
        style={{ display: 'block', objectFit: 'contain', filter: isDark ? 'invert(1)' : 'none' }}
      />
    );
  }

  // Local AI — neutral server-rack glyph, no brand asset
  return (
    <svg
      width={s} height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Local AI"
      role="img"
    >
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}
