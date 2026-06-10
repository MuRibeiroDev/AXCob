"""Fluxo do relatório TÍTULOS ABERTOS (report d81022c743c5a5ca976f).

Passos:
  1) abre o link
  2) TELA 1: período = ÚLTIMO DIA ÚTIL anterior nas DUAS partes (início e término)
  3) clica no botão-imagem (~21.9 x 21.0)  -> vai p/ a outra tela
  4) TELA 2: a outra data também = ÚLTIMO DIA ÚTIL nas duas partes
  5) clica no botão de filtro (~15.3 x 17.1)
  6) Tipo de Título: marca TODOS menos ADC, CHQ, DES
  7) Tipo de Boleto = C
  8) (HEADED) pausa p/ inspeção

Reusa helpers de powerbi_quitados.py (login/sessão, set de datas, combos).
Rode HEADED p/ assistir:  python -u scripts/powerbi_abertos.py
"""
from __future__ import annotations
import asyncio
import argparse
import os
from datetime import date
from pathlib import Path
from playwright.async_api import async_playwright

import powerbi_quitados as q

URL = ("https://app.powerbi.com/groups/3a380369-2411-47f7-9c7f-d5fa51d75cac/"
       "reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/d81022c743c5a5ca976f"
       "?language=pt-BR&experience=power-bi&navContentPaneEnabled=false&filterPaneEnabled=false")

HEADED = os.environ.get("ABERTOS_HEADED", "0") == "1"   # 1 = janela aberta p/ assistir
EXCLUIR_TIPO = ["ADC", "CHQ", "DES"]   # Tipo de Título: marcar todos MENOS estes
ROOT_SCRIPTS = Path(__file__).resolve().parent   # pasta scripts/ (saída do PNG)


async def set_all_date_ranges(page, inicio, fim, label):
    """Seta TODOS os .date-slicer-range da tela com início e término (datas em DD/MM/AAAA)."""
    ranges = page.locator(".date-slicer-range")
    n = await ranges.count()
    print(f"   [{label}] date-slicer-range na tela: {n}")
    if n == 0:
        print(f"   [{label}] NENHUM slicer de data encontrado!"); return 0
    for i in range(n):
        rng = ranges.nth(i)
        inputs = rng.locator("input.date-slicer-datepicker")
        if await inputs.count() < 2:
            print(f"   [{label}] #{i} sem 2 inputs (pulando)"); continue
        await q.set_date_input(page, inputs.nth(0), inicio)
        await q.set_date_input(page, inputs.nth(1), fim)
        try:
            iv, fv = await inputs.nth(0).input_value(), await inputs.nth(1).input_value()
            print(f"   [{label}] #{i}: {iv!r}..{fv!r} (alvo {inicio}..{fim})")
        except Exception:
            pass
    await asyncio.sleep(1.2)
    return n


async def click_image_size(page, label, w, h):
    """Clica no .imageContainer clicável (cursor pointer) mais próximo do tamanho (w,h)."""
    target = await page.evaluate(r"""(args) => {
        const {w,h} = args;
        let c = [...document.querySelectorAll('.visual-image .imageContainer, .imageContainer')]
          .map(el => { const r = el.getBoundingClientRect();
            return { x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height, cur:getComputedStyle(el).cursor }; })
          .filter(o => o.cur === 'pointer' && o.w > 3 && o.h > 3);
        if (!c.length) return null;
        c.sort((a,b) => (Math.abs(a.w-w)+Math.abs(a.h-h)) - (Math.abs(b.w-w)+Math.abs(b.h-h)));
        return { best: c[0], todos: c };
    }""", {"w": w, "h": h})
    if not target:
        print(f"   [{label}] nenhum botão-imagem clicável encontrado"); return False
    t = target["best"]
    outros = ", ".join(f"{o['w']:.0f}x{o['h']:.0f}" for o in target["todos"])
    print(f"   [{label}] clicáveis: [{outros}] -> escolhido {t['w']:.1f}x{t['h']:.1f} em ({t['x']:.0f},{t['y']:.0f})")
    await page.mouse.click(t["x"], t["y"])
    # settle curto: o passo seguinte (datas/categoria/captura) auto-espera o elemento
    await asyncio.sleep(1.8)
    return True


async def _scroll_popup(page, ctrl, dy):
    """Rola o container rolável do popup do slicer em dy px. Devolve se moveu + posição."""
    return await page.evaluate(r"""(args) => {
        const {id, dy} = args;
        let root = id ? document.getElementById(id) : null;
        let cands = [];
        if (root) { cands.push(root); cands.push(...root.querySelectorAll('*')); }
        if (!cands.length) for (const c of document.querySelectorAll('.slicer-dropdown-popup'))
            { cands.push(c); cands.push(...c.querySelectorAll('*')); }
        for (const el of cands) {
            if (el.scrollHeight > el.clientHeight + 4) {
                const before = el.scrollTop;
                el.scrollTop = before + dy;
                return { moved: Math.abs(el.scrollTop - before) > 1, top: el.scrollTop,
                         max: el.scrollHeight - el.clientHeight };
            }
        }
        return { moved: false, top: 0, max: 0 };
    }""", {"id": ctrl, "dy": dy})


async def selecionar_tipo_titulo(page, excluir):
    """Tipo de Título (combobox aria-label='Tipo'): marca TODOS menos `excluir`.
    A lista é VIRTUALIZADA (só ~5 opções no DOM por vez), então ROLA o popup:
    em cada janela visível corrige o que estiver errado (clique real) e desce até o fim."""
    excl = {q._norm_cat(x) for x in excluir}
    combo = page.locator('[role="combobox"][aria-label="Tipo"]').first
    if await combo.count() == 0:
        print("   [Tipo] combobox 'Tipo' não encontrado"); return
    ctrl = await combo.get_attribute("aria-controls")

    if not await q._open_combo(page, combo):
        print("   [Tipo] não abriu o dropdown"); return
    await _scroll_popup(page, ctrl, -100000)  # começa do topo
    await asyncio.sleep(0.4)

    vistos, estavel = set(), 0
    for _ in range(120):
        if not await q._open_combo(page, combo):  # garante aberto (clique pode fechar)
            await asyncio.sleep(0.3); continue
        opts = await q._read_options(page, combo)
        vals = [(i, o) for i, o in enumerate(opts) if not o["isAll"]]
        if not vals:
            await asyncio.sleep(0.4); continue
        alvo = None
        for i, o in vals:
            desejado = q._norm_cat(o["text"]) not in excl
            if o["checked"] != desejado:
                alvo = (i, o); break
        if alvo is not None:
            i, o = alvo
            popup = page.locator(f'[id="{ctrl}"]') if ctrl else page.locator('.slicer-dropdown-popup')
            optloc = popup.get_by_role("option")
            acao = "marcar" if not o["checked"] else "desmarcar"
            print(f"   [Tipo] {acao} {o['text']!r}")
            # Ctrl+clique: o slicer está em multi-seleção com CTRL — clique simples
            # selecionaria SÓ este item (limpando os demais) e o filtro nunca convergiria.
            try:
                await optloc.nth(i).scroll_into_view_if_needed(timeout=2500)
                await optloc.nth(i).click(timeout=3000, modifiers=["Control"])
            except Exception:
                try:
                    await page.keyboard.down("Control")
                    await page.mouse.click(o["x"], o["y"])
                    await page.keyboard.up("Control")
                except Exception:
                    try: await page.keyboard.up("Control")
                    except Exception: pass
            await asyncio.sleep(0.9)
            continue  # re-lê a mesma janela
        # janela toda correta → registra e rola p/ baixo
        for _i, o in vals:
            vistos.add(q._norm_cat(o["text"]))
        r = await _scroll_popup(page, ctrl, 220)
        await asyncio.sleep(0.4)
        if not r["moved"]:
            estavel += 1
        else:
            estavel = 0
        if estavel >= 2:
            break

    await q.fechar_dropdowns(page)
    try:
        rest = (await combo.locator(".slicer-restatement").first.text_content() or "").strip()
    except Exception:
        rest = "?"
    print(f"   [Tipo] opções vistas: {sorted(vistos)}")
    print(f"   [Tipo] final = {rest!r} (alvo: todos menos {', '.join(excluir)})")


async def set_categorias(page, valor):
    """Ajusta os slicers 'Categoria' (Plataforma). Sempre LIMPA todos p/ Todos
    primeiro (remove o cross-filter/INDÚSTRIA persistido e expande as listas);
    se `valor` for específico (AGRO/INDUSTRIA/ESTRUTURADA), seleciona em todos."""
    combos = page.locator('[role="combobox"][aria-label="Categoria"]')
    n = await combos.count()
    print(f"   [Categoria] {n} slicer(s) → alvo={valor or 'TODOS'}")
    for i in range(n):                      # 1) limpa tudo p/ Todos
        await q._set_one_categoria(page, combos.nth(i), "")
    if valor:                               # 2) seleciona o alvo; para no que confirmar
        combos = page.locator('[role="combobox"][aria-label="Categoria"]')
        n = await combos.count()
        alvo = q._norm_cat(valor)
        for i in range(n):
            fin = await q._set_one_categoria(page, combos.nth(i), valor)
            print(f"      Categoria #{i}: agora = {fin!r}")
            if q._norm_cat(fin) == alvo:
                break  # esse slicer filtra a tabela; os demais espelham/não importam
    else:
        print("      (todas em Todos)")
    await q.fechar_dropdowns(page)


async def main(categoria: str = "", out_path: Path | None = None):
    out_path = out_path or (ROOT_SCRIPTS / "print_abertos.png")
    hoje = date.today()
    ini, fim = q.janela_abertos(hoje)
    di, df = q.br(ini), q.br(fim)
    print(f"categoria={categoria or 'GERAL'} | saída={out_path.stem}")
    print(f"hoje={q.br(hoje)} | janela abertos = {di} .. {df}"
          + (f"  (inclui {di} — não-útil órfão antes de {df})" if ini != fim else ""))

    import time as _t
    _m = {"last": _t.perf_counter(), "ini": _t.perf_counter()}
    def lap(nome):
        agora = _t.perf_counter()
        if q.TIMING:
            print(f"   ⏱ {nome}: {agora - _m['last']:.1f}s (total {agora - _m['ini']:.1f}s)")
        _m["last"] = agora

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not HEADED, args=q.LAUNCH_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=q.DSF,
            storage_state=str(q.SESSION_PATH) if q.SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        lap("launch+context")
        print("-> abrindo report Títulos Abertos…")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        await q.ensure_logged_in(page)  # loga só se a sessão caiu (ausente/expirada)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=60_000)
        except Exception:
            print("   (aviso: slicer de data não apareceu no tempo esperado)")
        await asyncio.sleep(1.5)
        await q.save_session(ctx)  # persiste a sessão (renovada) p/ as próximas execuções
        lap("load")

        print("-> TELA 1: período = último dia útil (todas as datas da tela)")
        await set_all_date_ranges(page, di, df, "período")
        lap("tela1 datas")

        print("-> clique no botão-imagem (~21.9 x 21.0)")
        await click_image_size(page, "btn1", 21.9, 21.0)
        lap("btn1")

        print("-> TELA 2: preencher a 2ª data também = último dia útil (todas as datas)")
        await set_all_date_ranges(page, di, df, "data2")
        lap("tela2 datas")

        print("-> abrir painel de filtros (botão funil ~15.3 x 17.1)")
        await click_image_size(page, "abrir-filtros", 15.3, 17.1)
        lap("abrir filtros")

        print(f"-> Categoria/Plataforma → {categoria or 'Todos'}")
        await set_categorias(page, categoria)
        lap("categoria")

        print("-> Tipo de Título: todos menos ADC, CHQ, DES")
        await selecionar_tipo_titulo(page, EXCLUIR_TIPO)
        lap("tipo titulo")

        print("-> Tipo de Boleto = C")
        await q.ensure_tipo_boleto_c(page)
        lap("tipo boleto")

        print("-> fechar painel de filtros (funil de novo) p/ sumir os filtros")
        await click_image_size(page, "fechar-filtros", 15.3, 17.1)
        await asyncio.sleep(1)   # capturar_limpo ainda faz HIDE_JS + settle
        lap("fechar filtros")

        # Revalida TODAS as datas no último dia útil: selecionar Plataforma/Tipo
        # reseta o início do 2º slicer de período (ficava 02/06..05/06 em vez de
        # 05/06..05/06). Refazer aqui, já com os filtros aplicados, garante o print certo.
        print("-> revalida datas (todas = último dia útil) antes do print")
        await set_all_date_ranges(page, di, df, "revalida")
        lap("revalida datas")

        print("-> ordenar tabela por VALOR ABERTO (desc)")
        await q.ordenar_desc(page, "VALOR ABERTO")
        await asyncio.sleep(1.2)

        print("-> passo final: print (tabela inteira, limpo)")
        await q.capturar_limpo(page, out_path)
        lap("capturar_limpo")

        print("-> FIM dos passos.")
        if HEADED:
            print("   janela aberta 20s p/ inspeção…")
            await asyncio.sleep(20)
        await ctx.close(); await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Captura Títulos Abertos do Power BI (por plataforma)")
    ap.add_argument("--categoria", default="", help="AGRO | INDUSTRIA | ESTRUTURADA (vazio = Geral/Todos)")
    ap.add_argument("--out", default="print_abertos.png", help="nome base do PNG (em scripts/)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT_SCRIPTS / out.name
    asyncio.run(main(args.categoria, out))
