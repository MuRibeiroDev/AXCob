/* Ícones — SVG stroke, currentColor, viewBox 24. Conjunto fiel ao handoff. */
import type { CSSProperties } from 'react';

const PATHS: Record<string, string> = {
  search:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter:   '<path d="M3 5h18M6 12h12M10 19h4"/>',
  chevron:  '<path d="m6 9 6 6 6-6"/>',
  chevronR: '<path d="m9 6 6 6-6 6"/>',
  phone:    '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  history:  '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  handshake:'<path d="m11 17 2 2a1 1 0 0 0 3-3"/><path d="m14 16 2.5 2.5a1 1 0 0 0 3-3l-4-4-2 1-3-3 3-3 5 5"/><path d="m4 14 4 4 2-1"/><path d="M3 8l4-4 4 3-3 3z"/>',
  gavel:    '<path d="m14 13-7.8 7.8a2 2 0 0 1-2.8-2.8L11.2 10"/><path d="m9 7 8 8"/><path d="m12.5 3.5 8 8"/><path d="m16 3 5 5-3 3-5-5z" transform="translate(-3 1)"/>',
  message:  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.7L3 21l1.3-4A8.4 8.4 0 0 1 21 11.5z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6"/>',
  user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5a3.5 3.5 0 0 1 0 6.5"/><path d="M17 14.5a6.5 6.5 0 0 1 4.5 5.5"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  alert:    '<path d="M12 9v4m0 4h.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/>',
  dots:     '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  doc:      '<path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
  arrowUp:  '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
  trend:    '<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>',
  sort:     '<path d="M8 4v16m0 0-3-3m3 3 3-3M16 20V4m0 0-3 3m3-3 3 3"/>',
  check:    '<path d="m5 12 5 5L20 6"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  whats:    '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5"/>',
  bolt:     '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  home:     '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/>',
  layers:   '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  cog:      '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  panel:    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
};

export interface IconProps {
  name: keyof typeof PATHS | string;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 16, stroke = 1.6, style, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={className}
      style={{ flex: '0 0 auto', display: 'block', ...style }}
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? '' }}
    />
  );
}
