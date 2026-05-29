/* Sidebar de navegação do AxCob.
   Marca (logo leão + wordmark com accent #00FD54), módulos e rodapé.
   Colapsável para rail de ícones. */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/Icon';

// Asset servido a partir de /public
const logoUrl = '/logo-audax.png';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: string;
}

const NAV: NavItem[] = [
  { to: '/visao-geral', label: 'Visão Geral', icon: 'home' },
  { to: '/titulos-vencidos', label: 'Títulos Vencidos', icon: 'alert' },
  { to: '/negativacao-protestos', label: 'Negativação/Protestos', icon: 'gavel' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      style={{
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
        flex: '0 0 auto',
        background: 'var(--white)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width .16s ease',
      }}
    >
      {/* ---- Marca ---- */}
      <div
        style={{
          height: 60, display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '0' : '0 16px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: 9, background: 'var(--ink-900)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
            boxShadow: 'var(--sh-sm)', overflow: 'hidden',
          }}
        >
          <img src={logoUrl} alt="Audax" width={26} height={26} style={{ display: 'block' }} />
        </div>
        {!collapsed && (
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.02em' }}>
              AxCob<span style={{ color: 'var(--accent)' }}>.</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 500 }}>
              Gestão de Cobrança
            </div>
          </div>
        )}
      </div>

      {/* ---- Navegação ---- */}
      <nav style={{ flex: 1, padding: collapsed ? '12px 10px' : '12px', overflowY: 'auto' }}>
        {!collapsed && (
          <div
            style={{
              fontSize: 10, color: 'var(--ink-400)', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.06em', padding: '4px 10px 8px',
            }}
          >
            Operação
          </div>
        )}
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            style={({ isActive }) => ({
              position: 'relative',
              display: 'flex', alignItems: 'center', gap: 11,
              padding: collapsed ? '10px 0' : '9px 11px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 9, marginBottom: 2,
              textDecoration: 'none',
              fontSize: 13, fontWeight: 600,
              color: isActive ? 'var(--green-800)' : 'var(--ink-700)',
              background: isActive ? 'var(--green-50)' : 'transparent',
              boxShadow: isActive ? 'inset 0 0 0 1px var(--green-200)' : 'none',
              transition: 'background .12s, color .12s',
            })}
          >
            {({ isActive }) => (
              <>
                {/* indicador accent (detalhe) */}
                {isActive && (
                  <span
                    style={{
                      position: 'absolute', left: collapsed ? 6 : -1, top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3, height: 18, borderRadius: 3, background: 'var(--accent)',
                    }}
                  />
                )}
                <Icon
                  name={item.icon}
                  size={18}
                  style={{ color: isActive ? 'var(--green-700)' : 'var(--ink-400)' }}
                />
                {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ---- Rodapé ---- */}
      <div style={{ borderTop: '1px solid var(--line)', padding: collapsed ? '10px' : '10px 12px' }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="btn btn-quiet btn-sm"
          style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start' }}
          title={collapsed ? 'Expandir' : 'Recolher'}
        >
          <Icon name="panel" size={16} />
          {!collapsed && <span>Recolher</span>}
        </button>
        <NavLink
          to="/configuracoes"
          title={collapsed ? 'Configurações' : undefined}
          style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 11, marginTop: 2,
            padding: collapsed ? '9px 0' : '9px 11px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 9, textDecoration: 'none', fontSize: 13, fontWeight: 600,
            color: isActive ? 'var(--green-800)' : 'var(--ink-500)',
            background: isActive ? 'var(--green-50)' : 'transparent',
          })}
        >
          <Icon name="cog" size={18} style={{ color: 'var(--ink-400)' }} />
          {!collapsed && <span>Configurações</span>}
        </NavLink>
      </div>
    </aside>
  );
}
