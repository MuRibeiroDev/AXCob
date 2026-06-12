"""Print do report "Abertos — Expandido" (report e5aba942, página f2c60c5e).

A página tem 2 slicers de data (Vencimento e Quitação) e um VISUAL CUSTOMIZADO
(iframe/sandbox) "CEDENTES - TÍTULOS EM ABERTO" com KPIs + tabela PAGINADA:
  - #ftog  ("▼ FILTROS")  esconde a faixa de filtros (a tabela cabe sem rolar)
  - #bN    ("Próximo →")  pagina;  o rodapé mostra "Página X de Y (n cedentes)"

Fluxo (mesma regra dos demais prints):
  1) datas = janela do último dia útil (janela_abertos) em TODOS os slicers
  2) esconde os filtros (#ftog) dentro do iframe
  3) captura 1 PNG por página, clicando "Próximo →" até a última

Saída: <out>_1.png, <out>_2.png, ... (multi-parte, igual aos demais).
Rode HEADED p/ assistir:  ABERTOS_HEADED=1 python -u scripts/powerbi_abertos_expandido.py
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
       "reports/e5aba942-c74c-48fa-bc63-7718013cb721/f2c60c5ea215be0f83e3"
       "?language=pt-BR&experience=power-bi&navContentPaneEnabled=false&filterPaneEnabled=false")

HEADED = os.environ.get("ABERTOS_HEADED", "0") == "1"
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
    txt = ""
    for sel in (".bpg-info", "#pginfo", ".pag-info"):
        el = await frame.query_selector(sel)
        if el:
            txt = (await el.inner_text()).strip()
            break
    if not txt:  # fallback: procura o padrão em qualquer nó
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
    box = await el.bounding_box()
    return box


async def main(out_path: Path | None = None, di: str | None = None, df: str | None = None):
    out_path = out_path or (ROOT_SCRIPTS / "print_abertos_expandido.png")
    hoje = date.today()
    if not (di and df):  # padrão: mesma regra dos demais prints (último dia útil)
        ini, fim = q.janela_abertos(hoje)
        di, df = q.br(ini), q.br(fim)
    print(f"saída={out_path.stem} | hoje={q.br(hoje)} | janela = {di} .. {df}")

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

        print("-> datas = último dia útil (todos os slicers da tela)")
        await a.set_all_date_ranges(page, di, df, "datas")
        await asyncio.sleep(2.5)  # o visual customizado recarrega com as datas

        print("-> localizando o visual customizado (iframe c/ #ftog)…")
        frame = await achar_frame(page, "#ftog")
        if not frame:
            print("   ERRO: visual customizado (#ftog) não encontrado"); return 1

        # esconde os filtros (a tabela passa a caber sem rolagem)
        print("-> escondendo filtros (▼ FILTROS)")
        try:
            await frame.click("#ftog", timeout=5000)
            await asyncio.sleep(1.0)
        except Exception as e:
            print(f"   (aviso: não cliquei no #ftog: {e})")

        # pagina e captura: 1 PNG por página
        partes = 0
        for _ in range(60):  # teto de segurança
            atual, total, txt = await info_paginacao(frame)
            box = await bbox_do_frame(page, frame)
            partes += 1
            alvo = out_path.with_name(f"{out_path.stem}_{partes}.png")
            await page.screenshot(path=str(alvo), clip=box)
            print(f"   página {atual}/{total} capturada -> {alvo.name}  ({txt})")
            if atual >= total:
                break
            try:
                await frame.click("#bN", timeout=5000)
            except Exception as e:
                print(f"   (não consegui clicar Próximo: {e})"); break
            await asyncio.sleep(1.2)

        print(f"-> FIM: {partes} parte(s) capturada(s).")
        if HEADED:
            await asyncio.sleep(12)
        await ctx.close(); await browser.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Print do Abertos — Expandido (tabela paginada do visual customizado)")
    ap.add_argument("--out", default="print_abertos_expandido.png", help="nome base do PNG (em scripts/)")
    ap.add_argument("--inicio", default="", help="data inicial DD/MM/AAAA (default: último dia útil)")
    ap.add_argument("--fim", default="", help="data final DD/MM/AAAA (default: último dia útil)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT_SCRIPTS / out.name
    raise SystemExit(asyncio.run(main(out, args.inicio or None, args.fim or None)))
