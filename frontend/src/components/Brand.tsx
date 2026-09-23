import { sitePath } from '../urls.js';
import React from 'react';

export function Brand({ className = 'brand' }: { className?: string }) {
  return (
    <a href={sitePath('/')} className={className} aria-label="Бункер — главная">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="m20 2 15.6 9v18L20 38 4.4 29V11Z" fill="currentColor" />
        <circle cx="20" cy="20" r="10" stroke="var(--paper)" strokeWidth="2" />
        <circle cx="20" cy="20" r="3" fill="var(--paper)" />
        <path d="M20 10v7m0 6v7M10 20h7m6 0h7" stroke="var(--paper)" strokeWidth="2" />
      </svg>
      <span>
        БУНКЕР<span className="brand-caption">ВЛАДИВОСТОК</span>
      </span>
    </a>
  );
}
