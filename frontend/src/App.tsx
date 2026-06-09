import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { getToken } from '@/lib/auth';
import { AppShell } from '@/layout/AppShell';
import { TitulosVencidosPage } from '@/features/titulos-vencidos/TitulosVencidosPage';
import { KanbanPage } from '@/features/cobranca-kanban/KanbanPage';
import { PixPage } from '@/features/pix/PixPage';
import { VisaoGeralPage } from '@/features/visao-geral/VisaoGeralPage';
import { RelatoriosPage } from '@/features/relatorios/RelatoriosPage';
import { ConfiguracoesPage } from '@/features/configuracoes/ConfiguracoesPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/titulos-vencidos" replace /> },
      { path: 'titulos-vencidos', element: <TitulosVencidosPage /> },
      { path: 'negativacao-protestos', element: <KanbanPage /> },
      { path: 'pix', element: <PixPage /> },
      { path: 'relatorios', element: <RelatoriosPage /> },
      { path: 'visao-geral', element: <VisaoGeralPage /> },
      { path: 'configuracoes', element: <ConfiguracoesPage /> },
      { path: '*', element: <Navigate to="/titulos-vencidos" replace /> },
    ],
  },
]);

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());

  // 401 em qualquer chamada → volta pro login
  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener('axcob:unauthorized', onUnauth);
    return () => window.removeEventListener('axcob:unauthorized', onUnauth);
  }, []);

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  return <RouterProvider router={router} />;
}
