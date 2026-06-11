"""Lista os CEDENTES da tabela de Títulos Abertos (por categoria), SEM tirar print.

Reaproveita TODO o fluxo do powerbi_abertos.py (login/sessão, datas, filtro de
Categoria/Plataforma, Tipo de Título, Tipo de Boleto). No fim, em vez de capturar
a imagem, ROLA a tabela (visual virtualizado) e coleta o texto da coluna CEDENTE,
deduplicando por aria-rowindex. Imprime a lista no terminal.

Uso:
  python -u scripts/powerbi_listar_cedentes.py --categoria INDUSTRIA
  python -u scripts/powerbi_listar_cedentes.py --categoria INDUSTRIA --coluna CEDENTE
  (vazio = Geral/Todos).  ABERTOS_HEADED=1 p/ assistir.

NÃO mexe no powerbi_abertos.py/print. Evite rodar junto com a automação do print
(ambos gravam a mesma sessão .powerbi_session.json).
"""
from __future__ import annotations
import asyncio
import argparse
import os
import re
from datetime import date
from playwright.async_api import async_playwright

import powerbi_quitados as q
import powerbi_abertos as a

HEADED = os.environ.get("ABERTOS_HEADED", "0") == "1"


# JS: localiza a tabela (grid com mais células), acha a coluna alvo (CEDENTE) pela
# POSIÇÃO do header e devolve o texto das linhas por aria-rowindex. Vários fallbacks
# porque o visual de tabela do Power BI varia (role=grid/gridcell ou .tableEx/.bodyCells).
_COLLECT_JS = r"""(args) => {
    const alvo = (args.coluna || 'CEDENTE').toUpperCase();
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();

    // 1) escolhe o grid "real" = o que tem mais gridcells
    let grids = [...document.querySelectorAll('[role="grid"],[role="treegrid"]')];
    let grid = null, best = -1;
    for (const g of grids) {
        const n = g.querySelectorAll('[role="gridcell"]').length;
        if (n > best) { best = n; grid = g; }
    }

    const diag = {};
    if (grid && best > 0) {
        // headers na ordem visual (por aria-colindex se houver, senão DOM)
        let hs = [...grid.querySelectorAll('[role="columnheader"]')];
        hs.sort((a, b) => (+a.getAttribute('aria-colindex') || 0) - (+b.getAttribute('aria-colindex') || 0));
        const headerTexts = hs.map(h => norm(h.innerText));
        diag.headers = headerTexts;
        let target = hs.find(h => norm(h.innerText).toUpperCase().includes(alvo));
        if (!target) return { error: 'header não encontrado', headers: headerTexts };
        const colidx = target.getAttribute('aria-colindex');
        const pos = hs.indexOf(target);  // posição (0-based) p/ fallback
        const rowcount = grid.getAttribute('aria-rowcount');
        const rows = {};
        // (a) por aria-colindex — inclui rowheader (1ª coluna CONGELADA = role=rowheader)
        if (colidx) {
            const sel = '[role="gridcell"][aria-colindex="' + colidx + '"],[role="rowheader"][aria-colindex="' + colidx + '"]';
            for (const c of grid.querySelectorAll(sel)) {
                const row = c.closest('[role="row"]');
                const ri = row && row.getAttribute('aria-rowindex');
                const txt = norm(c.innerText);
                if (ri && txt) rows[ri] = txt;
            }
        }
        // (b) coluna congelada na 1ª posição → há 1 rowheader por linha
        if (Object.keys(rows).length === 0 && pos === 0) {
            for (const c of grid.querySelectorAll('[role="rowheader"]')) {
                const row = c.closest('[role="row"]');
                const ri = row && row.getAttribute('aria-rowindex');
                const txt = norm(c.innerText);
                if (ri && txt) rows[ri] = txt;
            }
        }
        // (c) último fallback: Nth célula (gridcell+rowheader) de cada row
        if (Object.keys(rows).length === 0) {
            for (const row of grid.querySelectorAll('[role="row"]')) {
                const ri = row.getAttribute('aria-rowindex');
                const cs = row.querySelectorAll('[role="gridcell"],[role="rowheader"]');
                if (ri && cs[pos]) { const t = norm(cs[pos].innerText); if (t) rows[ri] = t; }
            }
        }
        diag.rowheaders = grid.querySelectorAll('[role="rowheader"]').length;
        const r = grid.getBoundingClientRect();
        return { mode: 'grid', colidx, pos, rowcount, rows, headers: headerTexts,
                 box: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
    }

    // 2) fallback .tableEx (.columnHeaders + .bodyCells por coluna)
    const tex = document.querySelector('.tableEx, .pivotTable');
    if (tex) {
        const heads = [...tex.querySelectorAll('.columnHeaders .pivotTableCellWrap, .columnHeaders [class*="column"]')]
            .map(e => norm(e.innerText)).filter(Boolean);
        const colDivs = [...tex.querySelectorAll('.bodyCells > div, .bodyCells [class*="rowCellContainer"]')];
        diag.tableEx_heads = heads; diag.colDivs = colDivs.length;
        let pos = heads.findIndex(h => h.toUpperCase().includes(alvo));
        const col = (pos >= 0 && colDivs[pos]) ? colDivs[pos] : null;
        const rows = {};
        if (col) {
            [...col.children].forEach((cell, i) => { const t = norm(cell.innerText); if (t) rows[i] = t; });
        }
        const r = tex.getBoundingClientRect();
        return { mode: 'tableEx', pos, rows, headers: heads,
                 box: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
    }

    return { error: 'tabela não encontrada', gridCount: grids.length };
}"""


async def extrair_coluna(page, coluna: str):
    """Rola a tabela e acumula os valores da coluna (por aria-rowindex)."""
    acc: dict[int, str] = {}
    box = None
    rowcount = None
    estavel = 0
    for passo in range(400):
        res = await page.evaluate(_COLLECT_JS, {"coluna": coluna})
        if res.get("error"):
            print(f"   [extrair] {res['error']}. Headers vistos: {res.get('headers')}")
            return [], res.get("headers", [])
        if passo == 0:
            print(f"   [extrair] modo={res.get('mode')} pos={res.get('pos')} headers={res.get('headers')}")
        box = res["box"]
        rowcount = res.get("rowcount")
        antes = len(acc)
        for ri, txt in res["rows"].items():
            acc[int(ri)] = txt
        ganho = len(acc) - antes
        alvo_total = f"/{rowcount}" if rowcount else ""
        print(f"   [extrair] passo {passo}: +{ganho} (total {len(acc)}{alvo_total})")
        # condição de parada: já temos todas as linhas, ou nada novo por 3 passos
        if rowcount and len(acc) >= int(rowcount):
            break
        estavel = estavel + 1 if ganho == 0 else 0
        if estavel >= 3:
            break
        # rola a tabela: roda a wheel sobre o centro do visual
        await page.mouse.move(box["x"], box["y"])
        await page.mouse.wheel(0, 650)
        await asyncio.sleep(0.6)
    # devolve na ordem das linhas (aria-rowindex)
    ordenado = [acc[k] for k in sorted(acc.keys())]
    return ordenado, []


# JS: captura a TABELA INTEIRA (todas as colunas) por aria-rowindex, p/ diagnóstico.
_FULL_JS = r"""() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    let grids = [...document.querySelectorAll('[role="grid"],[role="treegrid"]')];
    let grid = null, best = -1;
    for (const g of grids) { const n = g.querySelectorAll('[role="gridcell"]').length; if (n > best) { best = n; grid = g; } }
    if (!grid || best <= 0) return { error: 'no grid' };
    let hs = [...grid.querySelectorAll('[role="columnheader"]')];
    hs.sort((a, b) => (+a.getAttribute('aria-colindex') || 0) - (+b.getAttribute('aria-colindex') || 0));
    const headers = hs.map(h => norm(h.innerText));
    const rowcount = grid.getAttribute('aria-rowcount');
    const rows = {};
    for (const row of grid.querySelectorAll('[role="row"]')) {
        const ri = row.getAttribute('aria-rowindex');
        if (!ri) continue;
        let cells = [...row.querySelectorAll('[role="rowheader"],[role="gridcell"]')];
        cells.sort((a, b) => (+a.getAttribute('aria-colindex') || 0) - (+b.getAttribute('aria-colindex') || 0));
        const arr = cells.map(c => norm(c.innerText));
        if (arr.some(x => x)) rows[ri] = arr;
    }
    const r = grid.getBoundingClientRect();
    return { headers, rowcount, rows, box: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
}"""


def _num(br: str) -> float:
    """'R$ 155.700,00' -> 155700.0"""
    s = (br or "").replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except Exception:
        return 0.0


async def extrair_tabela(page):
    """Rola e acumula a tabela inteira (rowindex -> [colunas]) p/ diagnóstico."""
    acc: dict[int, list[str]] = {}
    headers: list[str] = []
    rowcount = None
    estavel = 0
    for _ in range(400):
        res = await page.evaluate(_FULL_JS)
        if res.get("error"):
            return headers, acc, rowcount
        headers = res.get("headers", headers)
        rowcount = res.get("rowcount")
        antes = len(acc)
        for ri, arr in res["rows"].items():
            acc[int(ri)] = arr
        ganho = len(acc) - antes
        if rowcount and len(acc) >= int(rowcount):
            break
        estavel = estavel + 1 if ganho == 0 else 0
        if estavel >= 3:
            break
        await page.mouse.move(res["box"]["x"], res["box"]["y"])
        await page.mouse.wheel(0, 650)
        await asyncio.sleep(0.6)
    return headers, acc, rowcount


async def set_categorias_all(page, valor):
    """Igual ao set_categorias do print, MAS sem `break`: fixa o alvo em TODOS os
    slicers de Categoria (o que filtra a tabela é o 2º, não o 1º visível)."""
    combos = page.locator('[role="combobox"][aria-label="Categoria"]')
    n = await combos.count()
    print(f"   [Categoria*] {n} slicer(s) → {valor} (em TODOS, sem break)")
    for i in range(n):                       # 1) limpa tudo p/ Todos
        await q._set_one_categoria(page, combos.nth(i), "")
    combos = page.locator('[role="combobox"][aria-label="Categoria"]')
    n = await combos.count()
    for i in range(n):                       # 2) seleciona o alvo em TODOS
        fin = await q._set_one_categoria(page, combos.nth(i), valor)
        print(f"      Categoria #{i}: {fin!r}")
    await q.fechar_dropdowns(page)


async def ler_categoria_aplicada(page):
    """Texto que cada slicer de Categoria está mostrando (restatement)."""
    combos = page.locator('[role="combobox"][aria-label="Categoria"]')
    n = await combos.count()
    out = []
    for i in range(n):
        try:
            t = (await combos.nth(i).locator(".slicer-restatement").first.text_content() or "").strip()
        except Exception:
            t = "?"
        out.append(t)
    return out


async def main(categoria: str, coluna: str):
    hoje = date.today()
    ini, fim = q.janela_abertos(hoje)
    di, df = q.br(ini), q.br(fim)
    print(f"categoria={categoria or 'GERAL'} | coluna={coluna}")
    print(f"hoje={q.br(hoje)} | janela abertos = {di} .. {df}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not HEADED, args=q.LAUNCH_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=q.DSF,
            storage_state=str(q.SESSION_PATH) if q.SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        print("-> abrindo report Títulos Abertos…")
        await page.goto(a.URL, wait_until="domcontentloaded", timeout=60_000)
        await q.ensure_logged_in(page)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=60_000)
        except Exception:
            print("   (aviso: slicer de data não apareceu no tempo esperado)")
        await asyncio.sleep(1.5)
        await q.save_session(ctx)

        print("-> TELA 1: período = último dia útil")
        await a.set_all_date_ranges(page, di, df, "período")
        print("-> botão-imagem (~21.9 x 21.0)")
        await a.click_image_size(page, "btn1", 21.9, 21.0)
        print("-> TELA 2: 2ª data = último dia útil")
        await a.set_all_date_ranges(page, di, df, "data2")
        print("-> abrir painel de filtros")
        await a.click_image_size(page, "abrir-filtros", 15.3, 17.1)
        print("-> Tipo de Título: todos menos ADC, CHQ, DES")
        await a.selecionar_tipo_titulo(page, a.EXCLUIR_TIPO)
        print("-> Tipo de Boleto = C")
        await q.ensure_tipo_boleto_c(page)
        print("-> revalida datas (último dia útil) — ANTES da categoria")
        await a.set_all_date_ranges(page, di, df, "revalida")

        # Categoria POR ÚLTIMO e com o PAINEL ABERTO (assim a revalida de datas não
        # a reseta). Reaplica até o restatement confirmar o alvo (combos flaky).
        if categoria:
            alvo = q._norm_cat(categoria)
            for tent in range(4):
                print(f"-> Categoria/Plataforma → {categoria} (tentativa {tent+1}, painel aberto)")
                await set_categorias_all(page, categoria)
                await asyncio.sleep(1.0)
                cat_aplicada = await ler_categoria_aplicada(page)
                print(f"   restatement: {cat_aplicada}")
                if cat_aplicada and all(q._norm_cat(c) == alvo for c in cat_aplicada if c and c != '?'):
                    break
        else:
            cat_aplicada = await ler_categoria_aplicada(page)

        print("-> ordenar tabela por VALOR ABERTO (desc)")
        await q.ordenar_desc(page, "VALOR ABERTO")
        await asyncio.sleep(1.2)
        print(f"-> Categoria aplicada (restatement final): {await ler_categoria_aplicada(page)}")

        print("-> extraindo TABELA INTEIRA…")
        headers, linhas, rowcount = await extrair_tabela(page)
        print(f"   headers={headers} | aria-rowcount={rowcount} | linhas lidas={len(linhas)}")

        # índices das colunas
        def idx(nome):
            for i, h in enumerate(headers):
                if nome.upper() in h.upper():
                    return i
            return -1
        iC, iQ, iV = idx("CEDENTE"), idx("QTD"), idx("VALOR")

        ignorar = {"total", "totais", "total geral"}
        cedentes, soma_qtd, soma_val, total_row = [], 0, 0.0, None
        for k in sorted(linhas.keys()):
            arr = linhas[k]
            ced = arr[iC] if iC >= 0 and iC < len(arr) else ""
            qtd = arr[iQ] if iQ >= 0 and iQ < len(arr) else ""
            val = arr[iV] if iV >= 0 and iV < len(arr) else ""
            if ced.strip().lower() in ignorar:
                total_row = (qtd, val)
                continue
            if not ced:
                continue
            cedentes.append((ced, qtd, val))
            try: soma_qtd += int(re.sub(r"\D", "", qtd) or 0)
            except Exception: pass
            soma_val += _num(val)

        print("\n================= CEDENTES (" + (categoria or "GERAL") + ") =================")
        for i, (ced, qtd, val) in enumerate(cedentes, 1):
            print(f"{i:>3}. {ced:<55} {qtd:>4}  {val}")
        print(f"----- {len(cedentes)} cedentes | soma QTD={soma_qtd} | soma VALOR=R$ {soma_val:,.2f}")
        if total_row:
            print(f"----- linha TOTAL da tabela: QTD={total_row[0]} VALOR={total_row[1]}")
        print("================================================================\n")

        if HEADED:
            await asyncio.sleep(15)
        await ctx.close(); await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Lista cedentes da tabela de Títulos Abertos (Power BI)")
    ap.add_argument("--categoria", default="", help="AGRO | INDUSTRIA | ESTRUTURADA (vazio = Geral/Todos)")
    ap.add_argument("--coluna", default="CEDENTE", help="nome (parcial) da coluna a extrair")
    args = ap.parse_args()
    asyncio.run(main(args.categoria, args.coluna))
