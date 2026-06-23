"""Print do report "Quitados — Expandido" (report e8c4f016…, página d6433b74…).

Mesmo visual customizado (iframe) do "Abertos — Expandido", porém de QUITADOS:
tabela por cedente CEDENTE | RATING | QTD TÍTULOS | VALOR QUITADO, com KPIs +
faixa de filtros. Controles do iframe (iguais ao de abertos):
  - fOp(this)  → RAMO: TODOS / AGRO / INDÚSTRIA / ESTRUTURADA   (= "Categoria")
  - fEmp(this) → Empresa: TODOS / FIDC / SECURITIZADORA / FIDC LION
  - #iBol      → busca de Tipo Boleto (digita "C")
  - sC('d3n')  → ordena por VALOR QUITADO
  - cP(1)/#bN ("Próximo →"), cP(-1)/#bP; rodapé "Página X de Y (n cedentes)"

Regra (igual ao quitados antigo):
  1) Data Quitação = último dia útil anterior → hoje (slicer único da tela)
  2) Tipo Boleto = C   (busca #iBol no iframe)
  3) RAMO = categoria (vazio = TODOS) e ordena por VALOR QUITADO (desc)
  4) MANTÉM KPIs + filtros visíveis; captura do topo (cabeçalho + FILTROS) até a
     linha "TOTAL FILTRADO"; se passar de uma página, clica "Próximo →" e tira
     outro print (1 PNG por página).

Rode HEADED:  ABERTOS_HEADED=1 python -u scripts/powerbi_quitados_expandido.py --categoria INDUSTRIA
"""
from __future__ import annotations
import asyncio
import argparse
import os
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

import powerbi_quitados as q
import powerbi_abertos as a
import powerbi_abertos_expandido as ae

URL = ("https://app.powerbi.com/groups/3a380369-2411-47f7-9c7f-d5fa51d75cac/"
       "reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/d6433b74febf3ec8136a"
       "?language=pt-BR&experience=power-bi&navContentPaneEnabled=false&filterPaneEnabled=false")

HEADED = os.environ.get("ABERTOS_HEADED", "0") == "1"
ROOT_SCRIPTS = Path(__file__).resolve().parent


async def set_boleto(frame, valor: str = "C"):
    """Filtra o Tipo Boleto digitando no campo de busca #iBol do iframe."""
    inp = await frame.query_selector("#iBol")
    if not inp:
        print("   [Boleto] #iBol não encontrado — pulando"); return
    try:
        await inp.click()
        await inp.fill("")
        await inp.type(valor, delay=60)
        await asyncio.sleep(1.0)
        # tira o foco do campo p/ FECHAR o autocomplete (senão a caixinha de
        # sugestão sai sobreposta no print). blur + dispatch change aplica o filtro.
        await inp.evaluate("el => { el.dispatchEvent(new Event('change',{bubbles:true})); el.blur(); }")
        await asyncio.sleep(1.0)
        print(f"   [Boleto] #iBol = {valor!r}")
    except Exception as e:
        print(f"   [Boleto] falha: {e}")


async def set_empresa_todos(frame) -> str:
    """Garante Empresa = TODOS (botão fEmp / #ebTodos), com VERIFICAÇÃO e RETRY.
    A página de quitados vem com SECURITIZADORA pressionada por padrão e, em
    headless, o visual assenta depois e REVERTE — então clica, confere a classe
    'on' e repete até TODOS ficar ativo (ou esgotar as tentativas)."""
    estado = "?"
    for _ in range(8):
        estado = await frame.evaluate(r"""() => {
            const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
            const todos = document.getElementById('ebTodos')
                  || [...document.querySelectorAll('.eb')].find(b => norm(b.textContent) === 'TODOS');
            if (!todos) return 'sem-botao';
            if (/\bon\b/.test(todos.className)) return 'TODOS';  // já ativo
            todos.click();
            return 'clicou';
        }""")
        if estado == "TODOS":
            break
        await asyncio.sleep(1.0)
    print(f"   [Empresa] estado final = {estado!r}")
    return estado


async def fechar_sugestao(page, frame):
    """Clica REAL num ponto neutro do iframe (uma KPI) p/ fechar o autocomplete
    customizado do #iBol (blur por JS não fecha; só o 'click-fora' real fecha)."""
    try:
        bx = await ae.bbox_do_frame(page, frame)
        pt = await frame.evaluate(r"""() => {
            const el = [...document.querySelectorAll('*')].find(e =>
                /QUITADO\s+NO\s+PER[ÍI]ODO|TOTAL\s+QUITADO/i.test(e.textContent || '') && e.children.length <= 2);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 14) };
        }""")
        if bx and pt:
            await page.mouse.click(bx["x"] + pt["x"], bx["y"] + pt["y"])
            await asyncio.sleep(0.5)
    except Exception as e:
        print(f"   [sugestão] não consegui fechar: {e}")


async def main(categoria: str = "", out_path: Path | None = None,
               dump_cedentes: bool = False, di: str | None = None, df: str | None = None):
    out_path = out_path or (ROOT_SCRIPTS / "print_quitados_expandido.png")
    hoje = date.today()
    if not (di and df):  # REGRA quitados: último dia útil anterior → hoje
        di, df = q.br(q.prev_business_day(hoje)), q.br(hoje)
    print(f"categoria={categoria or 'GERAL'} | saída={out_path.stem} | hoje={q.br(hoje)} | Data Quitação = {di} .. {df}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not HEADED, args=q.LAUNCH_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1500},
            device_scale_factor=q.DSF,
            storage_state=str(q.SESSION_PATH) if q.SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        print("-> abrindo report Quitados — Expandido…")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        await q.ensure_logged_in(page)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=60_000)
        except Exception:
            print("   (aviso: slicer de data não apareceu no tempo esperado)")
        await asyncio.sleep(1.5)
        await q.save_session(ctx)

        # 1) Data Quitação = último dia útil → hoje (slicer único da tela)
        print("-> Data Quitação = último dia útil → hoje")
        await a.set_all_date_ranges(page, di, df, "Data Quitação")
        await asyncio.sleep(2.5)  # o visual customizado recarrega após mudar a data

        # 2) localiza o iframe
        print("-> localizando o visual customizado (iframe)…")
        frame = await ae.achar_frame(page, ".ob, #bN, #ktog")
        if not frame:
            print("   ERRO: visual customizado não encontrado"); return 1

        # 3) Empresa = TODOS (a página vem com SECURITIZADORA por padrão),
        #    Tipo Boleto = C, RAMO/Categoria, ordenação por VALOR QUITADO
        print("-> Empresa = TODOS")
        await set_empresa_todos(frame)
        print("-> Tipo de Boleto = C")
        await set_boleto(frame, "C")
        await fechar_sugestao(page, frame)   # fecha o autocomplete (clique real fora)
        print(f"-> RAMO/Categoria → {categoria or 'TODOS'}")
        await ae.set_ramo(frame, categoria)
        print("-> ordenar por VALOR QUITADO (desc)")
        await ae.ordenar_coluna_desc(frame, r"VALOR\s+QUITADO", "VALOR QUITADO")

        # 4) (opcional) dump de cedentes
        if dump_cedentes:
            print("-> extraindo CEDENTES (todas as páginas)")
            await ae.extrair_cedentes_iframe(page, frame, out_path, categoria or "GERAL")
            frame = await ae.achar_frame(page, ".ob, #bN, #ktog") or frame

        # reassegura Empresa = TODOS (pode ter revertido durante RAMO/ordenação)
        print("-> reassegurando Empresa = TODOS")
        await set_empresa_todos(frame)

        # 4.5) ESCONDE as faixas de FILTROS (#ftog) e KPIs (#ktog) do visual — só no
        # quitados, p/ a linha de busca (Cedente/Tipo Boleto/Classe…) e os cards de
        # KPI NÃO saírem no print. O filtro de Tipo Boleto já foi aplicado acima e
        # continua valendo com a barra oculta.
        for sel, nome in (("#ftog", "FILTROS"), ("#ktog", "KPIs")):
            try:
                el = await frame.query_selector(sel)
                if el:
                    await el.click(timeout=3000)
                    print(f"   [layout] {nome} escondido ({sel})")
                    await asyncio.sleep(0.8)
                else:
                    print(f"   [layout] {sel} não encontrado ({nome} não escondido)")
            except Exception as e:
                print(f"   [layout] não escondi {nome}: {e}")

        # 5) captura 1 PNG por página — topo (cabeçalho + FILTROS) → 'TOTAL FILTRADO'
        # rede de segurança: garante que nenhum campo de busca esteja com foco
        # (autocomplete aberto sairia sobreposto no print).
        try:
            await frame.evaluate("() => { const a = document.activeElement; if (a && a.blur) a.blur(); }")
            await asyncio.sleep(0.4)
        except Exception:
            pass
        partes = 0
        for _ in range(60):
            atual, total, txt = await ae.info_paginacao(frame)
            await ae.expandir_visual(page, frame)   # despinta o clip que esconde a última linha
            box = await ae.bbox_do_frame(page, frame)
            geo = await ae.geo_report(page)
            fim_y = await ae.fundo_conteudo(frame)   # fim do conteúdo (vale em qualquer página)
            if geo:   # SEMPRE do topo do report (cabeçalho + datas) até o fim do conteúdo
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
            print(f"   página {atual}/{total} capturada -> {alvo.name}  (h={round(clip['height'])}px, {txt})")
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
    ap = argparse.ArgumentParser(description="Print do Quitados — Expandido (visual customizado paginado)")
    ap.add_argument("--categoria", default="", help="AGRO | INDUSTRIA | ESTRUTURADA (vazio = Todos)")
    ap.add_argument("--out", default="print_quitados_expandido.png", help="nome base do PNG (em scripts/)")
    ap.add_argument("--dump-cedentes", action="store_true",
                    help="antes do print, lista a coluna CEDENTE (e salva <out>.cedentes.txt)")
    ap.add_argument("--inicio", default="", help="data inicial DD/MM/AAAA (default: último dia útil)")
    ap.add_argument("--fim", default="", help="data final DD/MM/AAAA (default: hoje)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT_SCRIPTS / out.name
    raise SystemExit(asyncio.run(main(args.categoria, out, args.dump_cedentes, args.inicio or None, args.fim or None)))
