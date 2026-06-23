"""Print do report "Abertos — Expandido" (report e8c4f016…, página f2c60c5e…).

A página tem 2 slicers de data + slicers PBI no topo (Tipo, Tipo Boleto, Cedente,
CR, Grupo Econômico, Cobrança, Gestor) e um VISUAL CUSTOMIZADO (iframe/sandbox)
"CEDENTES - TÍTULOS EM ABERTO" com KPIs + tabela PAGINADA por cedente
(CEDENTE | RATING | QTD TÍTULOS | VALOR ABERTO). Controles do iframe:
  - fOp(this)  → RAMO: TODOS / AGRO / INDÚSTRIA / ESTRUTURADA   (= a "Categoria")
  - fEmp(this) → Empresa: TODOS / FIDC / SECURITIZADORA / FIDC LION
  - sC('d3n')  → ordena por VALOR ABERTO ;  sC('d1') CEDENTE etc.
  - togK()/#ktog ("▼ KPIs")  e  togF()/#ftog ("▼ FILTROS") escondem faixas
  - cP(1)/#bN ("Próximo →"), cP(-1)/#bP ("← Anterior"); rodapé "Página X de Y (n cedentes)"

Fluxo (mesma REGRA dos demais prints):
  1) datas = janela do último dia útil (janela_abertos) em TODOS os slicers
  2) Tipo = todos menos ADC/CHQ/DES ; Tipo Boleto = C   (slicers PBI do topo)
  3) RAMO = categoria (vazio = TODOS) e ordena por VALOR ABERTO (desc), no iframe
  4) esconde KPIs/filtros e captura 1 PNG por página (cP(1) até a última)

Saída: <out>_1.png, <out>_2.png, ... (multi-parte, igual aos demais).
Rode HEADED p/ assistir:  ABERTOS_HEADED=1 python -u scripts/powerbi_abertos_expandido.py --categoria INDUSTRIA
"""
from __future__ import annotations
import asyncio
import argparse
import os
import re
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

import powerbi_quitados as q
import powerbi_abertos as a

URL = ("https://app.powerbi.com/groups/3a380369-2411-47f7-9c7f-d5fa51d75cac/"
       "reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/f2c60c5ea215be0f83e3"
       "?language=pt-BR&experience=power-bi&navContentPaneEnabled=false&filterPaneEnabled=false")

HEADED = os.environ.get("ABERTOS_HEADED", "0") == "1"
EXCLUIR_TIPO = ["ADC", "CHQ", "DES"]   # Tipo de Título: marcar todos MENOS estes
ROOT_SCRIPTS = Path(__file__).resolve().parent


async def achar_frame(page, seletor: str, timeout_s: float = 30):
    """Frame (iframe do visual customizado) que contém o seletor."""
    fim = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < fim:
        for f in page.frames:
            try:
                if await f.query_selector(seletor):
                    return f
            except Exception:
                continue
        await asyncio.sleep(0.5)
    return None


async def info_paginacao(frame) -> tuple[int, int, str]:
    """Lê 'Página X de Y (...)' do rodapé do visual. Devolve (X, Y, texto)."""
    txt = await frame.evaluate(
        r"""() => { const m = document.body.innerText.match(/P[áa]gina\s+\d+\s+de\s+\d+[^\n]*/i);
                    return m ? m[0] : ''; }""")
    m = re.search(r"P[áa]gina\s+(\d+)\s+de\s+(\d+)", txt or "", re.I)
    if not m:
        return (1, 1, txt or "?")
    return (int(m.group(1)), int(m.group(2)), txt)


async def bbox_do_frame(page, frame):
    """Bounding box (na página) do elemento <iframe> dono do frame."""
    el = await frame.frame_element()
    return await el.bounding_box()


async def geo_report(page):
    """Caixa (x, y, width) que engloba TODO o conteúdo do report (cabeçalho
    'Relatório', faixa FILTROS e os visuais) — exclui o chrome do Power BI.
    É o topo/esquerda do print pedido."""
    return await page.evaluate(r"""() => {
        const vcs = document.querySelectorAll('visual-container, .visualContainer');
        let minX = Infinity, minY = Infinity, maxR = -Infinity;
        vcs.forEach(v => { const r = v.getBoundingClientRect();
            if (r.width < 5 || r.height < 5) return;
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxR = Math.max(maxR, r.right); });
        if (!isFinite(minX)) return null;
        return { x: Math.max(0, Math.round(minX)), y: Math.max(0, Math.round(minY)),
                 width: Math.round(maxR - minX) };
    }""")


async def fundo_total_filtrado(frame):
    """Posição (Y, relativa ao topo do iframe) do FIM da linha 'TOTAL FILTRADO …'.
    Usada p/ recortar o print logo nela (sem o espaço branco abaixo da tabela).
    Devolve None se não achar."""
    return await frame.evaluate(r"""() => {
        const cands = [...document.querySelectorAll('*')].filter(e => {
            const t = e.textContent || '';
            return /TOTAL\s+FILTRADO/i.test(t) && t.length < 140;
        });
        // descarta os CONTAINERS (que contêm outra correspondência) e fica só com a
        // LINHA real — senão o bottom pega o fundo do container da tabela (que sobra
        // alto/com espaço em branco quando há poucas linhas).
        const leaves = cands.filter(e => !cands.some(o => o !== e && e.contains(o)));
        const pool = leaves.length ? leaves : cands;
        let b = 0;
        for (const e of pool) { const r = e.getBoundingClientRect(); if (r.height > 3 && r.bottom > b) b = r.bottom; }
        return b || null;
    }""")


async def expandir_visual(page, frame):
    """Remove o clip interno do visual (.main/.root/.gbody com overflow:hidden e
    altura fixa) que esconde a ÚLTIMA linha quando a página vem 'cheia'. Depois
    estica o <iframe> p/ caber todo o conteúdo, garantindo que tudo seja pintado
    (a linha escondida = cedente que sumia da imagem)."""
    try:
        await frame.evaluate(r"""() => {
            document.querySelectorAll('.main, .root, .gbody, .htmlViewerEntry').forEach(e => {
                e.style.overflow = 'visible'; e.style.maxHeight = 'none';
            });
        }""")
        await asyncio.sleep(0.4)
    except Exception as ex:
        print(f"   [expandir] aviso: {ex}")


async def fundo_conteudo(frame):
    """Posição (Y, relativa ao topo do iframe) do FIM do conteúdo útil, p/ recortar
    o print sem espaço branco. Prioridade: linha 'TOTAL FILTRADO' (última página) →
    barra de paginação (← Anterior / Próximo → / 'Página X de Y') → última linha da
    tabela. Assim TODA página (não só a última) recorta certo. None se não achar."""
    return await frame.evaluate(r"""() => {
        const bottomOf = els => { let b = 0; for (const e of els) { const r = e.getBoundingClientRect();
            if (r.height > 3 && r.bottom > b) b = r.bottom; } return b; };
        // 1) TOTAL FILTRADO — usa só a LINHA real (folha), não o container da tabela
        // (que fica alto/com espaço em branco quando há poucas linhas).
        const tot = [...document.querySelectorAll('*')].filter(e => {
            const t = e.textContent || ''; return /TOTAL\s+FILTRADO/i.test(t) && t.length < 140; });
        const totLeaves = tot.filter(e => !tot.some(o => o !== e && e.contains(o)));
        let b = bottomOf(totLeaves.length ? totLeaves : tot);
        if (b) return b;
        // 2) barra de paginação (botões + texto 'Página X de Y')
        const pag = [...document.querySelectorAll('.bpg, button, *')].filter(e => {
            const t = e.textContent || '';
            return (/←\s*Anterior|Pr[óo]ximo\s*→/i.test(t) || /P[áa]gina\s+\d+\s+de\s+\d+/i.test(t)) && t.length < 60; });
        b = bottomOf(pag);
        if (b) return b;
        // 3) última linha da tabela
        const rows = [...document.querySelectorAll('tbody tr')];
        if (rows.length) return rows[rows.length - 1].getBoundingClientRect().bottom;
        return null;
    }""")


# ─────────── filtros DENTRO do iframe (visual customizado) ───────────
async def set_ramo(frame, categoria: str) -> str:
    """Clica o botão de RAMO (fOp): TODOS / AGRO / INDÚSTRIA / ESTRUTURADA.
    categoria vazia = TODOS. Devolve o texto do botão clicado (ou '?')."""
    alvo = q._norm_cat(categoria) if categoria else "TODOS"
    res = await frame.evaluate(r"""(alvo) => {
        const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
        const btns = [...document.querySelectorAll('.ob')];
        const t = btns.find(b => norm(b.textContent) === alvo);
        if (t) { t.click(); return norm(t.textContent); }
        return null;
    }""", alvo)
    print(f"   [RAMO] alvo={alvo!r} → clicado={res!r}")
    await asyncio.sleep(1.2)
    return res or "?"


async def _valores_aberto(frame):
    """Lê a coluna VALOR ABERTO (última célula de cada linha) como números."""
    return await frame.evaluate(r"""() => {
        const rows = [...document.querySelectorAll('tbody tr')];
        return rows.map(r => {
            const c = [...r.querySelectorAll('td')];
            const t = c.length ? c[c.length-1].textContent : '';
            const n = parseFloat((t||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',', '.'));
            return isNaN(n) ? null : n;
        }).filter(v => v != null);
    }""")


async def ordenar_coluna_desc(frame, padrao: str = r"VALOR\s+ABERTO", rotulo: str = "VALOR ABERTO"):
    """Clica o cabeçalho cujo texto casa com `padrao` (ex.: VALOR ABERTO / VALOR
    QUITADO) e garante ordem DECRESCENTE (clica de novo se vier crescente).
    A coluna de valor é sempre a ÚLTIMA da tabela."""
    async def clicar():
        await frame.evaluate(r"""(pat) => {
            const re = new RegExp(pat, 'i');
            const th = [...document.querySelectorAll('th')].find(h => re.test(h.textContent));
            if (th) th.click();
        }""", padrao)
        await asyncio.sleep(1.0)

    await clicar()
    vals = await _valores_aberto(frame)
    if len(vals) >= 2 and vals[0] < vals[-1]:   # veio crescente → inverte
        print(f"   [ordenar] {rotulo} crescente → clicando de novo p/ desc")
        await clicar()
        vals = await _valores_aberto(frame)
    ok = len(vals) < 2 or vals[0] >= vals[-1]
    print(f"   [ordenar] {rotulo} desc={'OK' if ok else 'FALHOU'} "
          f"(1ª={vals[0] if vals else '?'} … última={vals[-1] if vals else '?'})")


# compat: nome antigo usado no fluxo de abertos
async def ordenar_valor_aberto_desc(frame):
    await ordenar_coluna_desc(frame, r"VALOR\s+ABERTO", "VALOR ABERTO")


async def esconder_faixas(frame):
    """Esconde KPIs (#ktog/togK) e a faixa de filtros (#ftog/togF) p/ a tabela
    caber sem rolagem. Clica só nas que existirem e estiverem ativas."""
    for sel, nome in (("#ktog", "KPIs"), ("#ftog", "FILTROS")):
        try:
            el = await frame.query_selector(sel)
            if el:
                await el.click(timeout=3000)
                print(f"   [layout] {nome} escondido ({sel})")
                await asyncio.sleep(0.6)
        except Exception as e:
            print(f"   [layout] não cliquei {sel}: {e}")


async def extrair_cedentes_iframe(page, frame, out_path: Path, label: str = "GERAL"):
    """Lê a coluna CEDENTE da tabela do iframe (todas as páginas), imprime o bloco
    '===== CEDENTES (...) =====' no stdout (o backend faz PARSE deste formato p/ a
    análise de parciais) e salva <out>.cedentes.txt (lido pelo worker)."""
    nomes, vistos = [], set()
    for _ in range(60):
        page_nomes = await frame.evaluate(r"""() => {
            const norm = s => (s||'').replace(/\s+/g,' ').trim();
            return [...document.querySelectorAll('tbody tr')].map(r => {
                const c = r.querySelector('td'); return c ? norm(c.textContent) : '';
            }).filter(Boolean);
        }""")
        for nm in page_nomes:
            if nm.lower() in ("total", "totais", "total geral"):
                continue
            if nm not in vistos:
                vistos.add(nm); nomes.append(nm)
        atual, total, _ = await info_paginacao(frame)
        if atual >= total:
            break
        try:
            await frame.click("#bN", timeout=5000); await asyncio.sleep(1.0)
        except Exception:
            break
    # bloco no stdout — o backend (modo local-dev) extrai os cedentes deste formato
    print(f"\n========== CEDENTES ({label or 'GERAL'}) — {len(nomes)} ==========")
    for i, nm in enumerate(nomes, 1):
        print(f"{i:>3}. {nm}")
    print("=" * 52)
    try:
        txt = out_path.with_name(out_path.stem + ".cedentes.txt")
        txt.write_text("\n".join(nomes), encoding="utf-8")
        print(f"   (salvo em {txt.name})")
    except Exception as e:
        print(f"   [cedentes] falha ao salvar: {e}")
    # volta p/ a 1ª página antes de capturar
    for _ in range(60):
        atual, _t, _ = await info_paginacao(frame)
        if atual <= 1:
            break
        try:
            await frame.click("#bP", timeout=5000); await asyncio.sleep(0.8)
        except Exception:
            break
    return nomes


async def main(categoria: str = "", out_path: Path | None = None,
               dump_cedentes: bool = False, di: str | None = None, df: str | None = None):
    out_path = out_path or (ROOT_SCRIPTS / "print_abertos_expandido.png")
    hoje = date.today()
    if not (di and df):  # padrão: mesma regra dos demais prints (último dia útil)
        ini, fim = q.janela_abertos(hoje)
        di, df = q.br(ini), q.br(fim)
    print(f"categoria={categoria or 'GERAL'} | saída={out_path.stem} | hoje={q.br(hoje)} | janela = {di} .. {df}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not HEADED, args=q.LAUNCH_ARGS)
        # viewport ALTO: o canvas do Power BI escala p/ caber — mais altura =
        # visual maior = todas as linhas + rodapé da paginação visíveis no print
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1500},
            device_scale_factor=q.DSF,
            storage_state=str(q.SESSION_PATH) if q.SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        print("-> abrindo report Abertos — Expandido…")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        await q.ensure_logged_in(page)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=60_000)
        except Exception:
            print("   (aviso: slicer de data não apareceu no tempo esperado)")
        await asyncio.sleep(1.5)
        await q.save_session(ctx)

        # 1) datas (todos os slicers da tela) — REGRA: último dia útil
        print("-> datas = último dia útil (todos os slicers da tela)")
        await a.set_all_date_ranges(page, di, df, "datas")

        # 2) Tipo (≠ ADC/CHQ/DES) e Tipo Boleto = C — slicers PBI do topo
        print("-> Tipo de Título: todos menos ADC, CHQ, DES")
        await a.selecionar_tipo_titulo(page, EXCLUIR_TIPO)
        print("-> Tipo de Boleto = C")
        await q.ensure_tipo_boleto_c(page)
        await asyncio.sleep(2.5)  # o visual customizado recarrega após mexer nos slicers

        # 3) localiza o iframe e aplica RAMO + ordenação
        print("-> localizando o visual customizado (iframe)…")
        frame = await achar_frame(page, ".ob, #bN, #ktog")
        if not frame:
            print("   ERRO: visual customizado não encontrado"); return 1

        print(f"-> RAMO/Categoria → {categoria or 'TODOS'}")
        await set_ramo(frame, categoria)

        print("-> ordenar por VALOR ABERTO (desc)")
        await ordenar_valor_aberto_desc(frame)

        # 4) (opcional) dump de cedentes p/ o relatório de parciais
        if dump_cedentes:
            print("-> extraindo CEDENTES (todas as páginas)")
            await extrair_cedentes_iframe(page, frame, out_path, categoria or "GERAL")
            frame = await achar_frame(page, ".ob, #bN, #ktog") or frame

        # 5) captura 1 PNG por página — MANTÉM KPIs + filtros visíveis (como o layout
        #    pedido) e RECORTA na linha 'TOTAL FILTRADO' (sem espaço branco abaixo).
        partes = 0
        for _ in range(60):  # teto de segurança
            atual, total, txt = await info_paginacao(frame)
            await expandir_visual(page, frame)              # despinta o clip que esconde a última linha
            box = await bbox_do_frame(page, frame)          # iframe (visual custom)
            geo = await geo_report(page)                    # report inteiro (topo + FILTROS)
            fim_y = await fundo_conteudo(frame)             # fim do conteúdo (vale em QUALQUER página)
            if geo:   # SEMPRE do topo do report (cabeçalho + FILTROS) até o fim do conteúdo
                bottom = (box["y"] + fim_y + 8) if fim_y else (box["y"] + box["height"])
                clip = {"x": geo["x"], "y": geo["y"], "width": geo["width"],
                        "height": max(1.0, bottom - geo["y"])}
            elif fim_y:
                clip = {"x": box["x"], "y": box["y"], "width": box["width"],
                        "height": min(box["height"], fim_y + 8)}
            else:
                clip = box
            partes += 1
            alvo = out_path.with_name(f"{out_path.stem}_{partes}.png")
            await page.screenshot(path=str(alvo), clip=clip)
            print(f"   página {atual}/{total} capturada -> {alvo.name}  "
                  f"(h={round(clip['height'])}px, {txt})")
            if atual >= total:
                break
            try:
                await frame.click("#bN", timeout=5000)
            except Exception as e:
                print(f"   (não consegui clicar Próximo: {e})"); break
            await asyncio.sleep(1.2)

        print(f"-> FIM: {partes} parte(s) capturada(s).")
        if HEADED:
            print("   janela aberta 15s p/ inspeção…")
            await asyncio.sleep(15)
        await ctx.close(); await browser.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Print do Abertos — Expandido (visual customizado paginado)")
    ap.add_argument("--categoria", default="", help="AGRO | INDUSTRIA | ESTRUTURADA (vazio = Todos)")
    ap.add_argument("--out", default="print_abertos_expandido.png", help="nome base do PNG (em scripts/)")
    ap.add_argument("--dump-cedentes", action="store_true",
                    help="antes do print, lista a coluna CEDENTE (e salva <out>.cedentes.txt)")
    ap.add_argument("--inicio", default="", help="data inicial DD/MM/AAAA (default: último dia útil)")
    ap.add_argument("--fim", default="", help="data final DD/MM/AAAA (default: último dia útil)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT_SCRIPTS / out.name
    raise SystemExit(asyncio.run(main(args.categoria, out, args.dump_cedentes, args.inicio or None, args.fim or None)))
