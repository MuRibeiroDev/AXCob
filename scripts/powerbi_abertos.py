"""Fluxo do relatório TÍTULOS ABERTOS (report e8c4f016…, página 85d0180a…).

A página nova é de TELA ÚNICA (todos os filtros já visíveis, sem navegação por
botão-imagem nem painel de funil). Mesma REGRA de negócio da versão antiga:
  1) abre o link
  2) período = ÚLTIMO DIA ÚTIL anterior (slicer de data único)
  3) Categoria/Plataforma (AGRO/INDÚSTRIA/ESTRUTURADA ou Todos)
  4) Tipo de Título: marca TODOS menos ADC, CHQ, DES
  5) Tipo de Boleto = C
  6) ordena por VALOR ABERTO (desc) e captura a tabela inteira

Reusa helpers de powerbi_quitados.py (login/sessão, set de datas, combos).
Rode HEADED p/ assistir:  ABERTOS_HEADED=1 python -u scripts/powerbi_abertos.py
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
       "reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/85d0180a26a3b16b5a5b"
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
        # O slicer LIMITA o início ao valor do término (e vice-versa). Se setarmos
        # o início primeiro, ele trava no término ANTIGO (menor). Por isso seta o
        # TÉRMINO primeiro (alarga a janela) e só então o início; depois revalida
        # cada campo até bater no alvo (resolve o clamp em ambos os sentidos).
        await q.set_date_input(page, inputs.nth(1), fim)
        await q.set_date_input(page, inputs.nth(0), inicio)
        iv = fv = "?"
        for _ in range(3):
            try:
                iv, fv = await inputs.nth(0).input_value(), await inputs.nth(1).input_value()
            except Exception:
                break
            if iv == inicio and fv == fim:
                break
            if fv != fim:
                await q.set_date_input(page, inputs.nth(1), fim)
            if iv != inicio:
                await q.set_date_input(page, inputs.nth(0), inicio)
        flag = "" if (iv == inicio and fv == fim) else "  <-- NÃO bateu o alvo!"
        print(f"   [{label}] #{i}: {iv!r}..{fv!r} (alvo {inicio}..{fim}){flag}")
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


# --- Extração da coluna CEDENTE (opcional, --dump-cedentes) -------------------
# CEDENTE é a 1ª coluna CONGELADA do visual de tabela → role="rowheader" (1 por
# linha). Rola a tabela (virtualizada) e acumula por aria-rowindex.
_CEDENTES_JS = r"""() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    let grids = [...document.querySelectorAll('[role="grid"],[role="treegrid"]')];
    let grid = null, best = -1;
    for (const g of grids) { const n = g.querySelectorAll('[role="gridcell"]').length; if (n > best) { best = n; grid = g; } }
    if (!grid || best <= 0) return { error: 'tabela não encontrada' };
    const rowcount = grid.getAttribute('aria-rowcount');
    const rows = {};
    for (const c of grid.querySelectorAll('[role="rowheader"]')) {
        const row = c.closest('[role="row"]');
        const ri = row && row.getAttribute('aria-rowindex');
        const txt = norm(c.innerText);
        if (ri && txt) rows[ri] = txt;
    }
    const r = grid.getBoundingClientRect();
    return { rowcount, rows, box: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
}"""


async def extrair_cedentes(page):
    """Lê a coluna CEDENTE da tabela JÁ FILTRADA (mesmo estado do print), rolando
    o visual. Devolve a lista única, na ordem da tabela, sem a linha de Total."""
    acc: dict[int, str] = {}
    estavel = 0
    for _ in range(400):
        res = await page.evaluate(_CEDENTES_JS)
        if res.get("error"):
            print(f"   [cedentes] {res['error']}")
            break
        rowcount = res.get("rowcount")
        antes = len(acc)
        for ri, txt in res["rows"].items():
            acc[int(ri)] = txt
        ganho = len(acc) - antes
        if rowcount and len(acc) >= int(rowcount):
            break
        estavel = estavel + 1 if ganho == 0 else 0
        if estavel >= 3:
            break
        await page.mouse.move(res["box"]["x"], res["box"]["y"])
        await page.mouse.wheel(0, 650)
        await asyncio.sleep(0.6)
    ignorar = {"total", "totais", "total geral"}
    vistos, unicos = set(), []
    for k in sorted(acc.keys()):
        v = acc[k]
        if v.strip().lower() in ignorar:
            continue
        if v not in vistos:
            vistos.add(v)
            unicos.append(v)
    return unicos


async def main(categoria: str = "", out_path: Path | None = None, dump_cedentes: bool = False):
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

        # Tela única: todos os filtros já estão visíveis (sem navegação/funil).
        print("-> período = último dia útil (slicer de data único)")
        await set_all_date_ranges(page, di, df, "período")
        lap("datas")

        print(f"-> Categoria/Plataforma → {categoria or 'Todos'}")
        await set_categorias(page, categoria)
        lap("categoria")

        print("-> Tipo de Título: todos menos ADC, CHQ, DES")
        await selecionar_tipo_titulo(page, EXCLUIR_TIPO)
        lap("tipo titulo")

        print("-> Tipo de Boleto = C")
        await q.ensure_tipo_boleto_c(page)
        lap("tipo boleto")

        print("-> ordenar tabela por VALOR ABERTO (desc)")
        await q.ordenar_desc(page, "VALOR ABERTO")
        await asyncio.sleep(1.2)

        if dump_cedentes:
            print(f"-> extraindo CEDENTES ({categoria or 'GERAL'}) — mesmo estado do print")
            ceds = await extrair_cedentes(page)
            print(f"\n========== CEDENTES ({categoria or 'GERAL'}) — {len(ceds)} ==========")
            for i, nome in enumerate(ceds, 1):
                print(f"{i:>3}. {nome}")
            print("=" * 52)
            try:
                txt = out_path.with_name(out_path.stem + ".cedentes.txt")
                txt.write_text("\n".join(ceds), encoding="utf-8")
                print(f"   (salvo em {txt})")
            except Exception as e:
                print(f"   (falha ao salvar txt: {e})")
            lap("dump cedentes")

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
    ap.add_argument("--dump-cedentes", action="store_true",
                    help="antes do print, lista a coluna CEDENTE (e salva <out>.cedentes.txt)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT_SCRIPTS / out.name
    asyncio.run(main(args.categoria, out, args.dump_cedentes))
