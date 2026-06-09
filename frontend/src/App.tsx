import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/layout/AppShell';
import { Placeholder } from '@/layout/Placeholder';
import { TitulosVencidosPage } from '@/features/titulos-vencidos/TitulosVencidosPage';
import { KanbanPage } from '@/features/cobranca-kanban/KanbanPage';
import { PixPage } from '@/features/pix/PixPage';
import { VisaoGeralPage } from '@/features/visao-geral/VisaoGeralPage';
import { RelatoriosPage } from '@/features/relatorios/RelatoriosPage';

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
      { path: 'configuracoes', element: <Placeholder title="Configurações" /> },
      { path: '*', element: <Navigate to="/titulos-vencidos" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
