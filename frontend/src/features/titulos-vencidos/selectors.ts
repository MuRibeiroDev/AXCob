/* Aplica os filtros da tela sobre a carteira INTEIRA e recomputa totais + KPIs,
   para que (como no Power BI) os filtros mudem também os valores do rail/KPIs. */
import { agingClass, tituloEstados } from '@/lib/aging';
import type { Buckets, CarteiraData, Cedente, Kpis, Sacado, Titulo } from '@/lib/types';
import { VALOR_FAIXAS, type Filters } from './components/FilterBar';

const emptyBuckets = (): Buckets => ({ fresh: 0, warn: 0, hot: 0, crit: 0 });

function makePredicate(filters: Filters) {
  const q = filters.query.trim().toLowerCase();
  const faixa = VALOR_FAIXAS.find((f) => f.key === filters.valor) ?? VALOR_FAIXAS[0];
  return (t: Titulo, s: Sacado, cedenteNome: string): boolean => {
    const matchAging = filters.aging === 'all' || t.aging === filters.aging;
    const matchStatus = filters.status.length === 0 || tituloEstados(t).some((st) => filters.status.includes(st));
    const matchTipo = filters.tipo.length === 0 || (t.tipo != null && filters.tipo.includes(t.tipo));
    const matchValor = t.valorOriginal >= faixa.min && t.valorOriginal < faixa.max;
    const matchVencDe = !filters.vencDe || (t.vencimento != null && t.vencimento >= filters.vencDe);
    const matchVencAte = !filters.vencAte || (t.vencimento != null && t.vencimento <= filters.vencAte);
    const matchSacado = filters.sacado.length === 0 || filters.sacado.includes(s.nome);
    const matchQuery =
      !q ||
      s.nome.toLowerCase().includes(q) ||
      (s.doc ?? '').toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      cedenteNome.toLowerCase().includes(q);
    return matchAging && matchStatus && matchTipo && matchValor && matchVencDe && matchVencAte && matchSacado && matchQuery;
  };
}

function computeKpis(cedentes: Cedente[]): Kpis {
  const buckets = emptyBuckets();
  const bucketsQtd: Record<string, number> = { fresh: 0, warn: 0, hot: 0, crit: 0 };
  let totalVencido = 0, juros = 0, qtdTitulos = 0, qtdSacados = 0;
  let emProtesto = 0, emNego = 0, emNegativado = 0;

  for (const ced of cedentes) {
    qtdSacados += ced.sacadoQtd;
    for (const s of ced.sacados) {
      for (const t of s.titulos) {
        totalVencido += t.valorOriginal; // Valor Face (base do Power BI)
        juros += t.juros;
        qtdTitulos += 1;
        buckets[t.aging] += t.valorOriginal;
        bucketsQtd[t.aging] += 1;
        if (t.protesto) emProtesto += t.valorOriginal;
        if (t.negativado) emNegativado += t.valorOriginal;
        if (t.status === 'nego') emNego += t.valorOriginal;
      }
    }
  }

  return {
    totalVencido,
    totalOriginal: totalVencido,
    juros,
    qtdTitulos,
    qtdSacados,
    qtdCedentes: cedentes.length,
    buckets,
    bucketsQtd: bucketsQtd as Record<'fresh' | 'warn' | 'hot' | 'crit', number>,
    emProtesto,
    emNego,
    emNegativado,
  };
}

export interface FilteredCarteira {
  cedentes: Cedente[];
  kpis: Kpis;
}

/** Carteira após os filtros, com cedentes/sacados/totais/KPIs recomputados. */
export function filterCarteira(data: CarteiraData, filters: Filters): FilteredCarteira {
  const pass = makePredicate(filters);
  const cedentes: Cedente[] = [];

  for (const ced of data.cedentes) {
    const sacados: Sacado[] = [];
    for (const s of ced.sacados) {
      const titulos = s.titulos.filter((t) => pass(t, s, ced.nome));
      if (titulos.length === 0) continue;
      const total = titulos.reduce((a, t) => a + t.valorOriginal, 0);
      const maxDias = titulos.reduce((a, t) => Math.max(a, t.dias), 0);
      sacados.push({ ...s, titulos, total, qtd: titulos.length, maxDias, aging: agingClass(maxDias) });
    }
    if (sacados.length === 0) continue;
    sacados.sort((a, b) => b.total - a.total);

    const total = sacados.reduce((a, s) => a + s.total, 0);
    const qtd = sacados.reduce((a, s) => a + s.qtd, 0);
    const maxDias = sacados.reduce((a, s) => Math.max(a, s.maxDias), 0);
    const buckets = emptyBuckets();
    sacados.forEach((s) => s.titulos.forEach((t) => { buckets[t.aging] += t.valorOriginal; }));

    cedentes.push({
      ...ced, sacados, total, qtd, sacadoQtd: sacados.length, maxDias,
      aging: agingClass(maxDias), buckets,
    });
  }
  cedentes.sort((a, b) => b.total - a.total);

  return { cedentes, kpis: computeKpis(cedentes) };
}
