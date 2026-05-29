/* Tela: Títulos Vencidos (split view + matriz de aging) — dados reais via API.
   Carteira = responsável de cobrança. Filtros de aging/busca aplicados no cliente. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ageMeta, tituloEstados } from '@/lib/aging';
import { api } from '@/lib/api';
import { fmtBRL } from '@/lib/format';
import type { CarteiraData, StatusKey, Titulo } from '@/lib/types';
import { TopBar } from './components/TopBar';
import { KpiStrip } from './components/KpiStrip';
import { FilterBar, EMPTY_FILTERS, type Filters } from './components/FilterBar';
import { CedentesRail } from './components/CedentesRail';
import { AgingMatrix, type AcaoTitulo } from './components/AgingMatrix';
import { filterCarteira } from './selectors';

function CenterMsg({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: tone === 'error' ? 'var(--age-crit-fg)' : 'var(--ink-400)', fontSize: 14 }}>
      {children}
    </div>
  );
}

export function TitulosVencidosPage() {
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [responsavel, setResponsavel] = useState<string>('');

  const [data, setData] = useState<CarteiraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // estado da tela
  const [sel, setSel] = useState<string>('');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const patchFilters = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setOpenRow(null);
  };

  // carrega lista de carteiras
  useEffect(() => {
    api.responsaveis()
      .then((rs) => {
        setResponsaveis(rs);
        setResponsavel((cur) => cur || rs[0] || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  // carrega a carteira selecionada
  useEffect(() => {
    if (!responsavel) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.carteira(responsavel)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setSel(d.cedentes[0]?.id ?? '');
        setOpenRow(null);
        setFilters(EMPTY_FILTERS);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [responsavel]);

  // carteira filtrada: filtros recalculam KPIs, totais do rail e do cedente (como no BI)
  const filtered = useMemo(() => (data ? filterCarteira(data, filters) : null), [data, filters]);

  // cedente selecionado (já filtrado) p/ header + matriz
  const cedente = useMemo(
    () => filtered?.cedentes.find((c) => c.id === sel) ?? filtered?.cedentes[0] ?? null,
    [filtered, sel],
  );

  const sacados = cedente?.sacados ?? [];

  // intensidade do heatmap normalizada pelo maior título (face) do conjunto filtrado
  const max = useMemo(() => {
    const vals = filtered?.cedentes.flatMap((c) => c.sacados.flatMap((s) => s.titulos.map((t) => t.valorOriginal))) ?? [];
    return vals.length ? Math.max(...vals) : 1;
  }, [filtered]);

  // opções dos filtros vêm da carteira INTEIRA (não filtrada), p/ não sumirem ao filtrar
  const allTitulos = useMemo(
    () => data?.cedentes.flatMap((c) => c.sacados.flatMap((s) => s.titulos)) ?? [],
    [data],
  );
  const statusOptions = useMemo<StatusKey[]>(
    () => [...new Set(allTitulos.flatMap((t) => tituloEstados(t)))],
    [allTitulos],
  );
  const tipoOptions = useMemo<string[]>(
    () => [...new Set(allTitulos.map((t) => t.tipo).filter((x): x is string => !!x))].sort(),
    [allTitulos],
  );
  // sacados selecionáveis = do cedente aberto, na base não filtrada
  const sacadoOptions = useMemo<string[]>(
    () => data?.cedentes.find((c) => c.id === sel)?.sacados.map((s) => s.nome)
      ?? data?.cedentes[0]?.sacados.map((s) => s.nome) ?? [],
    [data, sel],
  );

  const selectCedente = (id: string) => {
    setSel(id);
    setOpenRow(null);
    setFilters((f) => ({ ...f, sacado: [] })); // sacados mudam de cedente p/ cedente
  };

  // TODO: ligar ao endpoint de escrita (cria card no Bitrix pipeline 116/112).
  const handleAction = (acao: AcaoTitulo, titulos: Titulo[]) => {
    if (titulos.length === 0) return;
    const nums = titulos.map((t) => t.id).join(', ');
    const label = acao === 'protestar' ? 'Protestar' : 'Negativar';
    window.alert(
      `${label} ${titulos.length} título(s):\n${nums}\n\n` +
      '(o envio ao Bitrix será ligado quando o endpoint de escrita estiver pronto)',
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      <TopBar
        hoje={data?.hoje ?? new Date().toISOString().slice(0, 10)}
        responsaveis={responsaveis}
        responsavel={responsavel}
        onResponsavel={setResponsavel}
      />

      {error ? (
        <CenterMsg tone="error">
          <Icon name="alert" size={28} />
          <div>Erro ao carregar: {error}</div>
        </CenterMsg>
      ) : loading || !data || !filtered ? (
        <CenterMsg>
          <Icon name="clock" size={26} style={{ color: 'var(--green-500)' }} />
          Carregando carteira…
        </CenterMsg>
      ) : data.cedentes.length === 0 ? (
        <CenterMsg>
          <Icon name="check" size={28} style={{ color: 'var(--green-500)' }} />
          Nenhum título vencido nesta carteira ({data.tipo}).
        </CenterMsg>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <CedentesRail cedentes={filtered.cedentes} kpis={filtered.kpis} sel={sel} onSelect={selectCedente} />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '18px 26px 0', flex: '0 0 auto' }}>
              <div style={{ marginBottom: 16 }}><KpiStrip kpis={filtered.kpis} /></div>
              <div style={{ marginBottom: 16 }}>
                <FilterBar
                  filters={filters}
                  onChange={patchFilters}
                  sacadoOptions={sacadoOptions}
                  statusOptions={statusOptions}
                  tipoOptions={tipoOptions}
                  onReset={() => patchFilters(EMPTY_FILTERS)}
                />
              </div>
            </div>

            {cedente ? (
              <>
                <div style={{ padding: '0 26px 14px', display: 'flex', alignItems: 'center', gap: 14, flex: '0 0 auto' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{cedente.nome}</span>
                      <span className="chip" style={{ background: ageMeta(cedente.aging).bg, color: ageMeta(cedente.aging).fg }}>
                        <span className="dot" />
                        {ageMeta(cedente.aging).risk}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                      {cedente.cnpj ? `CNPJ ${cedente.cnpj} · ` : ''}{cedente.sacadoQtd} sacados · {cedente.qtd} títulos
                    </div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      Total vencido do cedente
                    </div>
                    <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-700)' }}>{fmtBRL(cedente.total)}</div>
                  </div>
                </div>

                <AgingMatrix
                  sacados={sacados}
                  max={max}
                  openRow={openRow}
                  onToggleRow={(i) => setOpenRow((o) => (o === i ? null : i))}
                  onAction={handleAction}
                />
              </>
            ) : (
              <CenterMsg>
                <Icon name="search" size={26} style={{ color: 'var(--ink-300)' }} />
                Nenhum título para os filtros aplicados.
              </CenterMsg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
