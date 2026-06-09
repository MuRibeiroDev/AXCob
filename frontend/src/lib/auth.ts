/* Sessão do AxCob — token JWT + usuário no localStorage. */
const TOKEN_KEY = 'axcob.token';
const USER_KEY = 'axcob.user';

export interface SessaoUser {
  id: number;
  username: string;
  email: string;
  nome: string;
  role: string;
  phone?: string | null;
}

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function getUser(): SessaoUser | null {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

export function setAuth(token: string, user: SessaoUser): void {
  try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* */ }
}

export function clearAuth(): void {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* */ }
}

/** Dispara logout global (a App ouve e volta pra tela de login). */
export function logout(): void {
  clearAuth();
  window.dispatchEvent(new Event('axcob:unauthorized'));
}
