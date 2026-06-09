/* Tela: Títulos Vencidos (split view + matriz de aging) — dados reais via API.
   Carteira = responsável de cobrança. Filtros de aging/busca aplicados no cliente. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ageMeta, tituloEstados } from '@/lib/aging';
import { api } from '@/lib/api';
import { fmtBRL } from '@/lib/format';
import type { CarteiraData, Sacado, StatusKey, TipoBoleto, Titulo } from '@/lib/types';
import { TopBar } from './components/TopBar';
import { KpiStrip } from './components/KpiStrip';
import { FilterBar, EMPTY_FILTERS, type Filters } from './components/FilterBar';
import { CedentesRail } from './components/CedentesRail';
import { AgingMatrix, type AcaoTitulo, type Prioridade } from './components/AgingMatrix';
import { filterCarteira } from './selectors';

function CenterMsg({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: tone === 'error' ? 'var(--age-crit-fg)' : 'var(--ink-400)', fontSize: 14 }}>
      {children}
    </div>
  );
}

// carteira e solicitante persistem entre visitas à aba (localStorage)
const CARTEIRA_KEY = 'axcob.titulos-vencidos.carteira';
const SOLICITANTE_KEY = 'axcob.titulos-vencidos.solicitante';

export function TitulosVencidosPage() {
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [responsavel, setResponsavel] = useState<string>(() => {
    try { return localStorage.getItem(CARTEIRA_KEY) || ''; } catch { return ''; }
  });
  const [tipoBoleto, setTipoBoleto] = useState<TipoBoleto>('C'); // filtro Tipo de Boleto (coluna M)

  // analistas (com webhook próprio) e o último escolhido (default do modal)
  const [usuarios, setUsuarios] = useState<{ id: string; nome: string }[]>([]);
  const [solicitante, setSolicitante] = useState<string>(() => {
    try { return localStorage.getItem(SOLICITANTE_KEY) || ''; } catch { return ''; }
  });
  // modal de solicitação (protestar/negativar) — escolha do analista no clique
  const [pendente, setPendente] = useState<{ acao: AcaoTitulo; sacado: Sacado; titulos: Titulo[]; prioridade: Prioridade } | null>(null);
  const [analistaSel, setAnalistaSel] = useState<string>('');
  const [criando, setCriando] = useState(false);

  const [data, setData] = useState<CarteiraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // estado da tela
  const [sel, setSel] = useState<string>('');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const patchFilters = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setOpenRow(null);
  };

  // carrega lista de carteiras — mantém a carteira salva se ainda existir
  useEffect(() => {
    api.responsaveis()
      .then((rs) => {
        setResponsaveis(rs);
        setResponsavel((cur) => (cur && rs.includes(cur) ? cur : rs[0] || ''));
      })
      .catch((e) => setError(e.message));
  }, []);

  // salva a carteira escolhida p/ persistir ao voltar à aba
  useEffect(() => {
    try { if (responsavel) localStorage.setItem(CARTEIRA_KEY, responsavel); } catch { /* ignore */ }
  }, [responsavel]);

  // carrega analistas (com webhook próprio) p/ escolher quem abre o card; persiste a escolha
  useEffect(() => {
    api.analistas().then(setUsuarios).catch(() => undefined);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(SOLICITANTE_KEY, solicitante); } catch { /* ignore */ }
  }, [solicitante]);

  // trocar de carteira OU de tipo de boleto reseta filtros e linha aberta
  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setOpenRow(null);
  }, [responsavel, tipoBoleto]);

  // carrega/recarrega a carteira (reloadKey força re-busca preservando seleção/filtros)
  useEffect(() => {
    if (!responsavel) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.carteira(responsavel, tipoBoleto)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setSel((cur) => (d.cedentes.some((c) => c.id === cur) ? cur : d.cedentes[0]?.id ?? ''));
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [responsavel, tipoBoleto, reloadKey]);

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

  // Ao clicar em Protestar/Negativar: abre o modal p/ escolher o analista (quem abre o card).
  const handleAction = (acao: AcaoTitulo, sacado: Sacado, titulos: Titulo[], prioridade: Prioridade) => {
    if (titulos.length === 0 || !cedente) return;
    setAnalistaSel(solicitante || '');
    setPendente({ acao, sacado, titulos, prioridade });
  };

  // Confirma no modal: cria as solicitações no Bitrix com o analista escolhido.
  const confirmarSolicitacao = async () => {
    if (!pendente || criando) return;
    const { acao, sacado, titulos, prioridade } = pendente;
    const label = acao === 'protestar' ? 'Protestar' : 'Negativar';
    const etapa = acao === 'protestar' ? 'Solicitações de Protesto' : 'Solicitações de Negativação';
    const sacadoLimpo = sacado.nome.replace(/-\s*sacado\s*$/i, '').trim();

    const itens = titulos.map((t) => ({
      numeroTitulo: t.id,
      valor: t.valorOriginal,
      cnpjSacado: sacado.doc,
      razaoSacado: sacadoLimpo,
      sistema: t.sistema,
      prioridade,
    }));

    setCriando(true);
    try {
      const r = acao === 'protestar'
        ? await api.protestar(itens, analistaSel || undefined)  // analistaSel = id do analista
        : await api.negativar(itens, analistaSel || undefined);
      setSolicitante(analistaSel); // lembra a última escolha como padrão
      setPendente(null);
      if (r.falhas > 0) {
        const err = r.resultados.find((x) => !x.ok)?.erro ?? '';
        window.alert(`${r.ok}/${r.total} criados. ${r.falhas} falha(s). ${err}`);
      } else {
        window.alert(`${r.ok} card(s) criado(s) no Bitrix em "${etapa}".`);
      }
      setReloadKey((k) => k + 1); // re-busca a carteira (status atualizado)
    } catch (e) {
      window.alert(`Erro ao ${label.toLowerCase()}: ${(e as Error).message}`);
    } finally {
      setCriando(false);
    }
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
          Nenhum título vencido nesta carteira ({data.tipo === 'todos' ? 'todos os boletos' : `boleto tipo ${data.tipo}`}).
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
                  tipoBoleto={tipoBoleto}
                  onTipoBoleto={setTipoBoleto}
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

      {pendente && (
        <SolicitarModal
          acao={pendente.acao}
          qtd={pendente.titulos.length}
          sacado={pendente.sacado.nome.replace(/-\s*sacado\s*$/i, '').trim()}
          prioridade={pendente.prioridade}
          analistas={usuarios}
          analistaSel={analistaSel}
          onAnalista={setAnalistaSel}
          criando={criando}
          onCancelar={() => !criando && setPendente(null)}
          onConfirmar={confirmarSolicitacao}
        />
      )}
    </div>
  );
}

function SolicitarModal({ acao, qtd, sacado, prioridade, analistas, analistaSel, onAnalista, criando, onCancelar, onConfirmar }: {
  acao: AcaoTitulo; qtd: number; sacado: string; prioridade: Prioridade;
  analistas: { id: string; nome: string }[]; analistaSel: string; onAnalista: (id: string) => void;
  criando: boolean; onCancelar: () => void; onConfirmar: () => void;
}) {
  const label = acao === 'protestar' ? 'Protestar' : 'Negativar';
  const cor = acao === 'protestar' ? '#6D28D9' : 'var(--age-crit-fg)';
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 24 }}
    >
      <div className="fade-in" style={{ width: 'min(460px, 100%)', maxHeight: '86vh', background: 'var(--white)', borderRadius: 14, boxShadow: 'var(--sh-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name={acao === 'protestar' ? 'gavel' : 'alert'} size={17} style={{ color: cor }} />
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{label} {qtd} título(s)</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 3 }}>
            {sacado} · prioridade {prioridade === 'URGENTE' ? 'URGENTE' : 'Padrão'}
          </div>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)', marginBottom: 10 }}>
            Quem está abrindo o card?
          </div>
          {analistas.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-500)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px' }}>
              Nenhum analista configurado — o card será criado pela <b>integração</b>.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[{ id: '', nome: 'Integração (padrão)' }, ...analistas].map((a) => {
                const on = analistaSel === a.id;
                return (
                  <button
                    key={a.id || '_'}
                    type="button"
                    onClick={() => onAnalista(a.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      font: 'inherit', fontSize: 13, cursor: 'pointer',
                      padding: '9px 11px', borderRadius: 9,
                      border: `1.5px solid ${on ? 'var(--green-500)' : 'var(--line)'}`,
                      background: on ? 'var(--green-50)' : 'var(--white)',
                      color: a.id ? 'var(--ink-900)' : 'var(--ink-500)', fontWeight: on ? 700 : 500,
                    }}
                  >
                    <span style={{ width: 16, height: 16, borderRadius: 999, flex: '0 0 auto', border: `1.5px solid ${on ? 'var(--green-500)' : 'var(--ink-300)'}`, background: on ? 'var(--green-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
                    </span>
                    {a.nome}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '0 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancelar} disabled={criando}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={onConfirmar} disabled={criando}>
            <Icon name={criando ? 'history' : 'check'} size={14} className={criando ? 'spin' : undefined} />
            {criando ? 'Criando…' : label}
          </button>
        </div>
      </div>
    </div>
  );
}
