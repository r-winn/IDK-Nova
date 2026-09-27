import type { CSSProperties } from 'react';
import type { Config } from '../types';

export function BrandMark({ config, className = '' }: { config: Config; className?: string }) {
  const custom = Boolean(config.branding.logoDataUrl);
  return (
    <span
      className={`brand-mark ${custom ? 'custom-mark' : 'default-mark'} ${className}`}
      style={{ '--brand-accent': config.branding.accent } as CSSProperties}
      aria-hidden="true"
    >
      <img src={config.branding.logoDataUrl || `${import.meta.env.BASE_URL}brand/nova-mark-white-256.png`} alt="" />
    </span>
  );
}
