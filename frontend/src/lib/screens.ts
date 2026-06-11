/* Telas controláveis por permissão. Fonte única usada pela Sidebar, pelas rotas
   e pela tela de Administração (Configurações). As chaves espelham as rotas e o
   backend (admin.controller TELAS). */
import type { SessaoUser } from './auth';

export interface ScreenDef {
  key: string;
  label: string;
  to: string;
  icon: string;
}

export const SCREENS: ScreenDef[] = [
  { key: 'visao-geral', label: 'Visão Geral', to: '/visao-geral', icon: 'home' },
  { key: 'titulos-vencidos', label: 'Títulos Vencidos', to: '/titulos-vencidos', icon: 'alert' },
  { key: 'negativacao-protestos', label: 'Negativação/Protestos', to: '/negativacao-protestos', icon: 'gavel' },
  { key: 'pix', label: 'PIX a Identificar', to: '/pix', icon: 'bolt' },
  { key: 'relatorios', label: 'Relatórios', to: '/relatorios', icon: 'doc' },
  { key: 'configuracoes', label: 'Configurações', to: '/configuracoes', icon: 'cog' },
];

export const SCREEN_BY_PATH: Record<string, ScreenDef> = Object.fromEntries(
  SCREENS.map((s) => [s.to.replace(/^\//, ''), s]),
);

/** O usuário pode acessar a tela `key`?
 *  - admin: sempre pode;
 *  - permissoes null/ausente: vê tudo (padrão, não quebra antes de configurar);
 *  - caso contrário: só as telas listadas. */
export function canAccess(user: SessaoUser | null, key: string): boolean {
  if (!user) return false;
  if (user.isAdmin) return true; // admin DO AxCob (lista própria; role é compartilhado)
  const p = user.permissoes;
  if (p == null) return true;
  return p.includes(key);
}

/** Primeira tela que o usuário pode acessar (p/ redirecionar). */
export function primeiraTelaPermitida(user: SessaoUser | null): string {
  const s = SCREENS.find((sc) => canAccess(user, sc.key));
  return s ? s.to : '/configuracoes';
}
