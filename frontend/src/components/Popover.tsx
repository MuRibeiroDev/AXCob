/* Popover genérico: trigger + painel flutuante. Fecha em clique fora / Esc. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface PopoverProps {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  minWidth?: number;
  align?: 'left' | 'right';
}

export function Popover({ trigger, children, minWidth = 220, align = 'left' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)',
            [align]: 0, zIndex: 50, minWidth,
            background: 'var(--white)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-lg)', padding: 8,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
