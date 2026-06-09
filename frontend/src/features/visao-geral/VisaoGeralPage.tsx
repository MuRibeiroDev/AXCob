/* Visão Geral — painel da carteira: Aging, Recebimentos no tempo e Exposição por UF.
   Dados: títulos abertos/quitados + UF do cedente. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { toPng } from 'html-to-image';
import { Icon } from '@/components/Icon';
import { api, type AgingData } from '@/lib/api';
import { fmtBRL, fmtBRLshort, fmtDate } from '@/lib/format';

const BR_GEOJSON = '/br-estados.geojson'; // estados do Brasil (servido de /public)

const CORES = ['#16A34A', '#84CC16', '#F59E0B', '#F97316', '#EF4444']; // rampa de severidade
type Base = 'face' | 'total';
type ExpView = 'lista' | 'mapa';

// escala de cor (verde claro → escuro) por intensidade t∈[0,1]
function corMapa(t: number): { bg: string; fg: string } {
  const lo = [232, 247, 238], hi = [10, 122, 53];
  const m = (i: number) => Math.round(lo[i] + (hi[i] - lo[i]) * t);
  return { bg: `rgb(${m(0)},${m(1)},${m(2)})`, fg: t > 0.45 ? '#fff' : 'var(--ink-700)' };
}

interface RecMes { mes: string; liquidado: number; qtd: number }
interface ExpUf { uf: string; valor: number; qtd: number }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesLabel = (m: string) => { const [a, mm] = m.split('-'); return `${MESES[Number(mm) - 1] ?? mm}/${a.slice(2)}`; };

// Card = o RETÂNGULO do relatório que será exportado (sem botões dentro).
function Card({ children, style, cardRef }: { children: React.ReactNode; style?: React.CSSProperties; cardRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={cardRef} style={{ width: '100%', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: '22px 24px', boxShadow: 'var(--sh-sm)', boxSizing: 'border-box', ...style }}>
      {children}
    </div>
  );
}

// Bloco = botão "Exportar PNG" (fora da captura) + o Card. Centralizado.
function ReportBlock({ onExport, loading, children }: { onExport: () => void; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="fade-in" style={{ maxWidth: 880, width: '100%', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onExport} disabled={loading}>
          <Icon name={loading ? 'history' : 'download'} size={13} className={loading ? 'spin' : undefined} />
          {loading ? 'Gerando…' : 'Exportar PNG'}
        </button>
      </div>
      {children}
    </div>
  );
}

export function VisaoGeralPage() {
  const [aging, setAging] = useState<AgingData | null>(null);
  const [rec, setRec] = useState<RecMes[] | null>(null);
  const [exp, setExp] = useState<{ ufs: ExpUf[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<Base>('face');
  const [expView, setExpView] = useState<ExpView>('lista');
  const [hoverUf, setHoverUf] = useState<string | null>(null);

  // exportar card como PNG (captura o DOM, igual ao que aparece na tela)
  const agingRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<HTMLDivElement>(null);
  const expRef = useRef<HTMLDivElement>(null);
  const [exportando, setExportando] = useState<string | null>(null);
  const exportar = useCallback(async (ref: React.RefObject<HTMLDivElement>, nome: string) => {
    const node = ref.current;
    if (!node) return;
    setExportando(nome);
    try {
      if (document.fonts?.ready) await document.fonts.ready; // garante a fonte certa no print
      const url = await toPng(node, {
        pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff',
        width: node.offsetWidth, height: node.offsetHeight,
      });
      const a = document.createElement('a');
      a.href = url; a.download = `${nome}.png`; a.click();
    } catch (e) {
      window.alert('Falha ao exportar imagem: ' + (e as Error).message);
    } finally {
      setExportando(null);
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.agingCarteira(), api.recebimentos(), api.exposicaoUf()])
      .then(([a, r, e]) => { setAging(a); setRec(r.meses); setExp(e); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const valor = useCallback((f: { face: number; total: number }) => (base === 'face' ? f.face : f.total), [base]);
  const totalBase = aging ? valor(aging.totais) : 0;
  const maxFaixa = useMemo(() => (aging ? Math.max(1, ...aging.faixas.map((f) => valor(f))) : 1), [aging, valor]);

  const maxRec = useMemo(() => (rec ? Math.max(1, ...rec.map((m) => m.liquidado)) : 1), [rec]);
  const mesAtual = new Date().toISOString().slice(0, 7);

  // exposição: top 10 UFs + "Outros"
  const expRows = useMemo(() => {
    if (!exp) return [] as ExpUf[];
    const top = exp.ufs.slice(0, 10);
    const restoVal = exp.ufs.slice(10).reduce((a, u) => a + u.valor, 0);
    const restoQtd = exp.ufs.slice(10).reduce((a, u) => a + u.qtd, 0);
    return restoVal > 0 ? [...top, { uf: 'Outros', valor: restoVal, qtd: restoQtd }] : top;
  }, [exp]);
  const maxUf = useMemo(() => Math.max(1, ...expRows.map((u) => u.valor)), [expRows]);
  // p/ o mapa: lookup por UF + maior valor entre todos os estados (escala de cor)
  const expByUf = useMemo(() => new Map((exp?.ufs ?? []).map((u) => [u.uf, u] as const)), [exp]);
  const maxUfAll = useMemo(() => Math.max(1, ...(exp?.ufs ?? []).map((u) => u.valor)), [exp]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ---- Top bar ---- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', height: 60, background: 'var(--white)', borderBottom: '1px solid var(--line)', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="home" size={17} style={{ color: 'var(--green-600)' }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>Visão Geral</div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>Aging · recebimentos · exposição geográfica</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {aging && <span style={{ fontSize: 11, color: 'var(--ink-400)' }} className="tnum">Posição em {fmtDate(aging.posicao)}</span>}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <Icon name="history" size={14} className={loading ? 'spin' : undefined} />
            {loading ? 'Carregando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* ---- Conteúdo ---- */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 26px' }}>
        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--age-crit-fg)', fontSize: 14 }}>
            <Icon name="alert" size={22} /> Erro ao carregar: {error}
          </div>
        ) : loading || !aging || !rec || !exp ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-400)', fontSize: 14, padding: '60px 0' }}>
            <Icon name="history" size={28} className="spin" style={{ color: 'var(--green-500)' }} />
            Carregando painel…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* ============ AGING ============ */}
            <ReportBlock onExport={() => exportar(agingRef, `aging-carteira-${aging.posicao}`)} loading={exportando === `aging-carteira-${aging.posicao}`}>
            <Card cardRef={agingRef}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>Aging da Carteira</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 2 }}>
                    Quanto mais envelhecida a dívida, maior o risco. {aging.totais.qtd.toLocaleString('pt-BR')} títulos vencidos.
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: 3, gap: 2, marginBottom: 8 }}>
                    {(['face', 'total'] as Base[]).map((b) => {
                      const on = base === b;
                      return (
                        <button key={b} onClick={() => setBase(b)} title={b === 'face' ? 'Valor de face (principal)' : 'Total com encargos'}
                          style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: 12, padding: '4px 12px', borderRadius: 5, background: on ? 'var(--green-50)' : 'transparent', color: on ? 'var(--green-700)' : 'var(--ink-500)' }}>
                          {b === 'face' ? 'Face' : 'Com encargos'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Total vencido</div>
                  <div className="tnum" style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink-900)' }}>{fmtBRL(totalBase)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {aging.faixas.map((f, i) => {
                  const v = valor(f); const pct = totalBase > 0 ? (v / totalBase) * 100 : 0; const w = (v / maxFaixa) * 100; const cor = CORES[i] ?? 'var(--ink-400)';
                  return (
                    <div key={f.faixa}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink-800)' }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: cor, flex: '0 0 auto' }} />
                          {f.faixa}
                          <span style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>· {f.qtd.toLocaleString('pt-BR')} títulos</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span className="tnum" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{fmtBRL(v)}</span>
                          <span className="tnum" style={{ fontSize: 11.5, color: 'var(--ink-400)', minWidth: 38, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div style={{ height: 12, borderRadius: 7, background: 'var(--paper)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${w}%`, background: cor, borderRadius: 7, transition: 'width .3s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            </ReportBlock>

            {/* ============ RECEBIMENTOS NO TEMPO ============ */}
            <ReportBlock onExport={() => exportar(recRef, `recebimentos-${aging.posicao}`)} loading={exportando === `recebimentos-${aging.posicao}`}>
            <Card cardRef={recRef}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>Recebimentos ao longo do tempo</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 2 }}>Valor liquidado por mês (últimos 12).</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, paddingTop: 18 }}>
                {rec.map((m) => {
                  const h = Math.max(2, (m.liquidado / maxRec) * 150);
                  const parcial = m.mes === mesAtual;
                  return (
                    <div key={m.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}
                      title={`${mesLabel(m.mes)}: ${fmtBRL(m.liquidado)} · ${m.qtd.toLocaleString('pt-BR')} títulos${parcial ? ' (mês atual, parcial)' : ''}`}>
                      <span className="tnum" style={{ fontSize: 9.5, color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>{fmtBRLshort(m.liquidado).replace('R$ ', '')}</span>
                      <div style={{ width: '100%', maxWidth: 40, height: h, borderRadius: '5px 5px 0 0', background: parcial ? 'var(--green-200)' : 'var(--green-500)', transition: 'height .3s ease' }} />
                      <span style={{ fontSize: 10.5, color: 'var(--ink-500)', fontWeight: 600 }}>{mesLabel(m.mes)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)', fontSize: 11.5, color: 'var(--ink-400)' }}>
                Barra clara = mês atual (parcial). Base: valor liquidado dos títulos quitados.
              </div>
            </Card>
            </ReportBlock>

            {/* ============ EXPOSIÇÃO POR UF ============ */}
            <ReportBlock onExport={() => exportar(expRef, `exposicao-uf-${expView}-${aging.posicao}`)} loading={exportando === `exposicao-uf-${expView}-${aging.posicao}`}>
            <Card cardRef={expRef}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>Exposição por UF</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 2 }}>Carteira em aberto por estado do cedente.</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: 3, gap: 2, marginBottom: 8 }}>
                    {(['lista', 'mapa'] as ExpView[]).map((v) => {
                      const on = expView === v;
                      return (
                        <button key={v} onClick={() => setExpView(v)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: 12, padding: '4px 12px', borderRadius: 5, background: on ? 'var(--green-50)' : 'transparent', color: on ? 'var(--green-700)' : 'var(--ink-500)' }}>
                          <Icon name={v === 'lista' ? 'sort' : 'layers'} size={12} />{v === 'lista' ? 'Lista' : 'Mapa'}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Total em aberto</div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-900)' }}>{fmtBRL(exp.total)}</div>
                </div>
              </div>
              {expView === 'lista' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {expRows.map((u) => {
                    const pct = exp.total > 0 ? (u.valor / exp.total) * 100 : 0; const w = (u.valor / maxUf) * 100;
                    return (
                      <div key={u.uf} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 44, fontSize: 12.5, fontWeight: 700, color: u.uf === 'Outros' ? 'var(--ink-400)' : 'var(--ink-800)', flex: '0 0 auto' }}>{u.uf}</span>
                        <div style={{ flex: 1, height: 14, borderRadius: 7, background: 'var(--paper)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${w}%`, background: u.uf === 'Outros' ? 'var(--ink-300)' : 'var(--green-500)', borderRadius: 7, transition: 'width .3s ease' }} />
                        </div>
                        <span className="tnum" style={{ width: 130, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)', flex: '0 0 auto' }}>{fmtBRL(u.valor)}</span>
                        <span className="tnum" style={{ width: 44, textAlign: 'right', fontSize: 11.5, color: 'var(--ink-400)', flex: '0 0 auto' }}>{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  {/* caption do hover */}
                  {(() => {
                    const u = hoverUf ? expByUf.get(hoverUf) : null;
                    const pct = u && exp.total > 0 ? (u.valor / exp.total) * 100 : 0;
                    return (
                      <div style={{ height: 22, fontSize: 13, color: 'var(--ink-700)' }}>
                        {hoverUf
                          ? (u
                            ? <span><b>{hoverUf}</b> · {fmtBRL(u.valor)} · {pct.toFixed(1)}% · {u.qtd.toLocaleString('pt-BR')} títulos</span>
                            : <span><b>{hoverUf}</b> · sem títulos em aberto</span>)
                          : <span style={{ color: 'var(--ink-400)' }}>Passe o mouse sobre um estado</span>}
                      </div>
                    );
                  })()}

                  {/* mapa real (react-simple-maps) */}
                  <ComposableMap projection="geoMercator" projectionConfig={{ center: [-54, -15], scale: 720 }} width={520} height={460} style={{ width: '100%', maxWidth: 520, height: 'auto' }}>
                    <Geographies geography={BR_GEOJSON}>
                      {({ geographies }) => geographies.map((geo) => {
                        const uf = (geo.properties as { sigla?: string }).sigla ?? '';
                        const v = expByUf.get(uf)?.valor ?? 0;
                        const fill = v > 0 ? corMapa(v / maxUfAll).bg : 'var(--paper)';
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill={fill}
                            stroke="#fff"
                            strokeWidth={0.6}
                            onMouseEnter={() => setHoverUf(uf)}
                            onMouseLeave={() => setHoverUf(null)}
                            style={{
                              default: { outline: 'none' },
                              hover: { outline: 'none', fill: 'var(--green-700)', cursor: 'default' },
                              pressed: { outline: 'none' },
                            }}
                          />
                        );
                      })}
                    </Geographies>
                  </ComposableMap>

                  {/* legenda */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-400)' }}>
                    menor
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[0.05, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} style={{ width: 22, height: 10, borderRadius: 2, background: corMapa(t).bg, border: '1px solid var(--line)' }} />)}
                    </div>
                    maior
                  </div>
                </div>
              )}
            </Card>
            </ReportBlock>
          </div>
        )}
      </div>
    </div>
  );
}
