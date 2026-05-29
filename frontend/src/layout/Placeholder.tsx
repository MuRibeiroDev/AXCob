/* Página placeholder para módulos ainda não implementados. */
import { Icon } from '@/components/Icon';

export function Placeholder({ title }: { title: string }) {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 14, color: 'var(--ink-400)', background: 'var(--paper)',
      }}
    >
      <div
        style={{
          width: 54, height: 54, borderRadius: 'var(--r-md)', background: 'var(--white)',
          border: '1px solid var(--line)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'var(--green-500)', boxShadow: 'var(--sh-sm)',
        }}
      >
        <Icon name="layers" size={24} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-900)' }}>{title}</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>Módulo em construção.</div>
      </div>
    </div>
  );
}
