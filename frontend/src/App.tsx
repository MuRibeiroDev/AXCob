import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { getToken, getUser, setAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { canAccess, primeiraTelaPermitida } from '@/lib/screens';
import { AppShell } from '@/layout/AppShell';
import { TitulosVencidosPage } from '@/features/titulos-vencidos/TitulosVencidosPage';
import { KanbanPage } from '@/features/cobranca-kanban/KanbanPage';
import { PixPage } from '@/features/pix/PixPage';
import { VisaoGeralPage } from '@/features/visao-geral/VisaoGeralPage';
import { RelatoriosPage } from '@/features/relatorios/RelatoriosPage';
import { ConfiguracoesPage } from '@/features/configuracoes/ConfiguracoesPage';

/** Bloqueia o acesso direto (URL) a uma tela sem permissão → manda p/ a 1ª permitida. */
function Guarded({ screen, children }: { screen: string; children: ReactNode }) {
  const user = getUser();
  if (!canAccess(user, screen)) return <Navigate to={primeiraTelaPermitida(user)} replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to={primeiraTelaPermitida(getUser())} replace /> },
      { path: 'titulos-vencidos', element: <Guarded screen="titulos-vencidos"><TitulosVencidosPage /></Guarded> },
      { path: 'negativacao-protestos', element: <Guarded screen="negativacao-protestos"><KanbanPage /></Guarded> },
      { path: 'pix', element: <Guarded screen="pix"><PixPage /></Guarded> },
      { path: 'relatorios', element: <Guarded screen="relatorios"><RelatoriosPage /></Guarded> },
      { path: 'visao-geral', element: <Guarded screen="visao-geral"><VisaoGeralPage /></Guarded> },
      { path: 'configuracoes', element: <Guarded screen="configuracoes"><ConfiguracoesPage /></Guarded> },
      { path: '*', element: <Navigate to={primeiraTelaPermitida(getUser())} replace /> },
    ],
  },
]);

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  // só renderiza o app depois de revalidar a sessão (atualiza isAdmin/permissões/foto)
  const [pronto, setPronto] = useState(() => !getToken());

  // 401 em qualquer chamada → volta pro login
  useEffect(() => {
    const onUnauth = () => { setAuthed(false); setPronto(true); };
    window.addEventListener('axcob:unauthorized', onUnauth);
    return () => window.removeEventListener('axcob:unauthorized', onUnauth);
  }, []);

  // revalida via /auth/me no load: pega isAdmin/permissões atualizados sem relogar
  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then((u) => setAuth(getToken(), { ...(getUser() ?? {}), ...u }))
      .catch(() => undefined) // 401 já dispara axcob:unauthorized
      .finally(() => setPronto(true));
  }, []);

  if (!authed) return <LoginPage onLogin={() => { setAuthed(true); setPronto(true); }} />;
  if (!pronto) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-400)', fontSize: 14, background: 'var(--paper)' }}>
        Carregando…
      </div>
    );
  }
  return <RouterProvider router={router} />;
}
