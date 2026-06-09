/* Regras de dia útil (feriados nacionais BR) — porte do comportamento usado
   nos cards de comissárias (lib holidays do Python → date-holidays no Node). */
import Holidays from 'date-holidays';

const hd = new Holidays('BR');

const isHoliday = (d: Date): boolean => {
  // calendário bancário/cobrança: público + optional (inclui Corpus Christi,
  // Carnaval...) — alinhado ao prev_business_day dos scripts do Power BI.
  const r = hd.isHoliday(d);
  if (!r) return false;
  const arr = Array.isArray(r) ? r : [r];
  return arr.some((h) => h.type === 'public' || h.type === 'optional');
};

/** Sábado, domingo ou feriado nacional. */
export const isNaoUtil = (d: Date): boolean => {
  const w = d.getDay(); // 0=Dom .. 6=Sáb
  return w === 0 || w === 6 || isHoliday(d);
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

export const hojeLocal = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

/** Último dia útil ESTRITAMENTE anterior a `ref`. */
export const ultimoDiaUtil = (ref: Date): Date => {
  let d = addDays(ref, -1);
  while (isNaoUtil(d)) d = addDays(d, -1);
  return d;
};

/** Primeiro dia útil >= d. */
export const proximoDiaUtil = (d: Date): Date => {
  let x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (isNaoUtil(x)) x = addDays(x, 1);
  return x;
};

/** "Hoje" para atraso = último dia útil <= hoje (fds/feriado o relógio para). */
export const hojeEfetivo = (): Date => {
  let h = hojeLocal();
  while (isNaoUtil(h)) h = addDays(h, -1);
  return h;
};

/** Último dia em que o cedente ainda está no prazo: próximo útil de (próximo útil de venc + carência). */
export const deadline = (venc: Date, carencia: number): Date => {
  const pay = proximoDiaUtil(venc);
  const raw = addDays(pay, carencia);
  return proximoDiaUtil(raw);
};

/** Vencimentos cujo pagamento "cai" no último dia útil (o útil + os não-úteis imediatamente anteriores). */
export const vencsNoPrazo = (hoje: Date): Date[] => {
  const last = ultimoDiaUtil(hoje);
  const datas = [last];
  let d = addDays(last, -1);
  while (isNaoUtil(d)) {
    datas.push(d);
    d = addDays(d, -1);
  }
  return datas.sort((a, b) => a.getTime() - b.getTime());
};

export const fmtIso = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
