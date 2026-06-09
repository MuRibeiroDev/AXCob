/* Sidebar de navegação do AxCob — clara e minimalista.
   Sem chrome de template: item ativo = texto ink forte + pílula neutra sutil +
   um ponto accent (#00FD54) como único toque de cor. Colapsável para rail. */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/Icon';

const logoUrl = '/logo-audax.png';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { to: '/visao-geral', label: 'Visão Geral', icon: 'home' },
  { to: '/titulos-vencidos', label: 'Títulos Vencidos', icon: 'alert' },
  { to: '/negativacao-protestos', label: 'Negativação/Protestos', icon: 'gavel' },
  { to: '/pix', label: 'PIX a Identificar', icon: 'bolt' },
  { to: '/relatorios', label: 'Relatórios', icon: 'doc' },
];

const ACTIVE_BG = 'rgba(16,35,27,.06)';
const HOVER_BG = 'rgba(16,35,27,.035)';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  const itemBase = (isActive: boolean): React.CSSProperties => ({
    position: 'relative',
    display: 'flex', alignItems: 'center', gap: 12,
    padding: collapsed ? '11px 0' : '10px 12px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: 10, marginBottom: 4,
    fontSize: 13.5, letterSpacing: '-.006em',
    fontWeight: isActive ? 700 : 600,
    color: isActive ? 'var(--ink-900)' : 'var(--ink-500)',
    background: isActive ? ACTIVE_BG : 'transparent',
    transition: 'background .14s, color .14s',
  });

  const hoverIn = (isActive: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (isActive) return;
    e.currentTarget.style.background = HOVER_BG;
    e.currentTarget.style.color = 'var(--ink-900)';
  };
  const hoverOut = (isActive: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (isActive) return;
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = 'var(--ink-500)';
  };

  const renderItem = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} title={collapsed ? item.label : undefined} style={{ textDecoration: 'none', display: 'block' }}>
      {({ isActive }) => (
        <div onMouseEnter={hoverIn(isActive)} onMouseLeave={hoverOut(isActive)} style={itemBase(isActive)}>
          <Icon name={item.icon} size={18} style={{ color: isActive ? 'var(--ink-900)' : 'var(--ink-400)', flex: '0 0 auto', transition: 'color .14s' }} />
          {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}
          {/* único toque de cor: ponto accent no item ativo (no fluxo, sem sobrepor) */}
          {isActive && !collapsed && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)', flex: '0 0 auto' }} />}
          {isActive && collapsed && <span style={{ position: 'absolute', top: 7, right: 7, width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} />}
        </div>
      )}
    </NavLink>
  );

  return (
    <aside
      style={{
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
        flex: '0 0 auto',
        background: 'var(--white)',
        borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        transition: 'width .16s ease',
      }}
    >
      {/* ---- Marca ---- */}
      <div
        style={{
          height: 64, display: 'flex', alignItems: 'center', gap: 11,
          padding: collapsed ? '0' : '0 18px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 9, background: 'var(--ink-900)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', overflow: 'hidden',
          }}
        >
          <img src={logoUrl} alt="Audax" width={22} height={22} style={{ display: 'block' }} />
        </div>
        {!collapsed && (
          <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.03em', color: 'var(--ink-900)' }}>
            AxCob<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
        )}
      </div>

      {/* ---- Navegação ---- */}
      <nav style={{ flex: 1, padding: collapsed ? '8px 10px' : '8px 14px', overflowY: 'auto' }}>
        {NAV.map(renderItem)}
      </nav>

      {/* ---- Rodapé ---- */}
      <div style={{ padding: collapsed ? '8px 10px 12px' : '8px 14px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavLink to="/configuracoes" title={collapsed ? 'Configurações' : undefined} style={{ textDecoration: 'none', display: 'block' }}>
          {({ isActive }) => (
            <div onMouseEnter={hoverIn(isActive)} onMouseLeave={hoverOut(isActive)} style={itemBase(isActive)}>
              <Icon name="cog" size={18} style={{ color: isActive ? 'var(--ink-900)' : 'var(--ink-400)', flex: '0 0 auto' }} />
              {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Configurações</span>}
              {isActive && !collapsed && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)', flex: '0 0 auto' }} />}
              {isActive && collapsed && <span style={{ position: 'absolute', top: 7, right: 7, width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} />}
            </div>
          )}
        </NavLink>

        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir' : 'Recolher'}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-700)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-400)')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: collapsed ? '10px 0' : '10px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
            borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-400)',
            transition: 'color .14s',
          }}
        >
          <Icon name="panel" size={16} style={{ flex: '0 0 auto' }} />
          {!collapsed && <span>Recolher</span>}
        </button>
      </div>
    </aside>
  );
}
