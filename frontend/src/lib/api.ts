/* Cliente HTTP da API do AxCob. */
import type { CarteiraData, TipoCarteira } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'omit' });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  responsaveis: () => get<string[]>('/titulos-vencidos/responsaveis'),
  carteira: (responsavel: string, tipo: TipoCarteira = 'todos') =>
    get<CarteiraData>(`/titulos-vencidos?responsavel=${encodeURIComponent(responsavel)}&tipo=${tipo}`),
};
