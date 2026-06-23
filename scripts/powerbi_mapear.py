"""Mapeador de FILTROS de uma página do Power BI.

Abre uma URL (reusando a sessão/login dos outros scripts) e despeja o inventário
completo dos controles da tela atual — sem alterar nada:
  - slicers de DATA (.date-slicer-range): nº, aria-label e valor atual de cada input
  - COMBOBOXES ([role=combobox]): aria-label, valor (restatement), aria-controls
  - BOTÕES-IMAGEM clicáveis (.imageContainer cursor:pointer): tamanho e posição
    (são as "âncoras" usadas p/ navegar entre telas — click_image_size)
  - CABEÇALHOS de coluna ([role=columnheader]): texto e aria-sort
  - SLICERS de lista/texto e contagem de visualContainers

Como o report pode ter várias TELAS (clicar num botão-imagem troca a tela), dá
p/ navegar antes de mapear:  --click "21.9x21.0" --click "15.3x17.1"
(clica nos botões mais próximos desses tamanhos, em ordem, e só então mapeia).

Uso:
  python -u scripts/powerbi_mapear.py --url "<link do BI>"
  python -u scripts/powerbi_mapear.py --url "..." --headed
  python -u scripts/powerbi_mapear.py --url "..." --click 21.9x21.0 --headed

Saída: imprime no stdout e salva scripts/mapa_filtros.json (e .txt legível).
"""
from __future__ import annotations
import asyncio
import argparse
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

import powerbi_quitados as q   # login/sessão, helpers de leitura

ROOT_SCRIPTS = Path(__file__).resolve().parent

# JS que varre a tela e devolve o inventário completo de controles.
_MAP_JS = r"""() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const box = el => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };

  // 1) slicers de DATA
  const dateRanges = [...document.querySelectorAll('.date-slicer-range')].map((rng, i) => {
    const inputs = [...rng.querySelectorAll('input.date-slicer-datepicker')].map(inp => ({
      ariaLabel: inp.getAttribute('aria-label') || '',
      value: inp.value || '',
    }));
    return { idx: i, ...box(rng), inputs };
  });

  // 2) COMBOBOXES (slicers dropdown)
  const combos = [...document.querySelectorAll('[role="combobox"]')].map(c => {
    const rest = c.querySelector('.slicer-restatement');
    return {
      ariaLabel: c.getAttribute('aria-label') || '',
      ariaControls: c.getAttribute('aria-controls') || '',
      ariaExpanded: c.getAttribute('aria-expanded') || '',
      valorAtual: rest ? norm(rest.textContent) : '',
      ...box(c),
    };
  });

  // 3) BOTÕES-IMAGEM clicáveis (cursor:pointer) — âncoras de navegação
  const imgBtns = [...document.querySelectorAll('.visual-image .imageContainer, .imageContainer')]
    .map(el => ({ ...box(el), cursor: getComputedStyle(el).cursor,
                  title: el.getAttribute('title') || el.getAttribute('aria-label') || '' }))
    .filter(o => o.w > 3 && o.h > 3)
    .map(o => ({ ...o, clicavel: o.cursor === 'pointer' }));

  // 4) CABEÇALHOS de coluna (p/ ordenação)
  const colHeaders = [...document.querySelectorAll('[role="columnheader"]')]
    .map(h => ({ texto: norm(h.innerText), ariaSort: h.getAttribute('aria-sort') || 'none', ...box(h) }))
    .filter(h => h.w > 0 && h.h > 0 && h.texto);

  // 5) outros slicers (lista/checkbox) — visuais slicer que não são combobox nem data
  const slicerVisuals = [...document.querySelectorAll('[class*="slicer"]')]
    .map(s => ({ cls: s.className, ...box(s) }))
    .filter(s => s.w > 20 && s.h > 10);

  // 6) títulos de visuais (rótulos/cabeçalhos que ajudam a entender a tela)
  const titles = [...document.querySelectorAll('.visualTitle, [class*="title"] text, .preTextWithEllipsis')]
    .map(t => norm(t.textContent)).filter(Boolean).slice(0, 40);

  // 7) CLICÁVEIS GERAIS — botões-visual do PBI (tile/shape), role=button, e
  //    qualquer elemento com cursor:pointer. É aqui que aparecem os botões que
  //    NÃO são .imageContainer (ex.: o botão do card "Títulos Abertos").
  const seen = new Set();
  const clickables = [];
  const sel = '[role="button"], button, .ui-role-button-fill, [data-sub-selection-object-name], '
            + 'visual-container, .visualContainer *';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.width > 400 || r.height > 200) continue;
    const cur = getComputedStyle(el).cursor;
    const role = el.getAttribute && el.getAttribute('role');
    const isBtn = role === 'button' || el.tagName === 'BUTTON'
               || (el.className && /button|ui-role-button/i.test(String(el.className)))
               || el.getAttribute('data-sub-selection-object-name');
    if (!(cur === 'pointer' || isBtn)) continue;
    const key = Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    if (seen.has(key)) continue;
    seen.add(key);
    clickables.push({
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
      cursor: cur,
      texto: norm(el.innerText || '').slice(0, 40),
      title: el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label')
              || el.getAttribute('data-sub-selection-display-name') || '') || '',
      tag: el.tagName.toLowerCase(),
    });
  }
  clickables.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const visualCount = document.querySelectorAll('visual-container, .visualContainer').length;
  return { url: location.href, visualCount, dateRanges, combos, imgBtns, colHeaders,
           slicerVisualsCount: slicerVisuals.length, titles, clickables };
}"""


def _print_mapa(m: dict, tela: str) -> None:
    print(f"\n{'='*70}\nMAPA DA TELA [{tela}]  —  visuais: {m['visualCount']}")
    print(f"URL: {m['url']}")

    print(f"\n-- SLICERS DE DATA (.date-slicer-range): {len(m['dateRanges'])}")
    for d in m["dateRanges"]:
        labs = " | ".join(f"{i['ariaLabel']!r}={i['value']!r}" for i in d["inputs"])
        print(f"   #{d['idx']}  pos({d['x']},{d['y']}) {d['w']}x{d['h']}  inputs: {labs}")

    print(f"\n-- COMBOBOXES ([role=combobox]): {len(m['combos'])}")
    for c in m["combos"]:
        print(f"   aria-label={c['ariaLabel']!r}  valor={c['valorAtual']!r}  "
              f"expanded={c['ariaExpanded']}  pos({c['x']},{c['y']}) {c['w']}x{c['h']}")

    clic = [b for b in m["imgBtns"] if b["clicavel"]]
    print(f"\n-- BOTÕES-IMAGEM clicáveis (cursor:pointer): {len(clic)} (de {len(m['imgBtns'])} imagens)")
    for b in clic:
        t = f" title={b['title']!r}" if b["title"] else ""
        print(f"   {b['w']}x{b['h']}  pos({b['x']},{b['y']}){t}")

    print(f"\n-- CABEÇALHOS DE COLUNA ([role=columnheader]): {len(m['colHeaders'])}")
    for h in m["colHeaders"]:
        print(f"   {h['texto']!r}  sort={h['ariaSort']}")

    if m.get("clickables"):
        print(f"\n-- CLICÁVEIS (botões-visual / role=button / cursor:pointer): {len(m['clickables'])}")
        for c in m["clickables"]:
            extra = f" texto={c['texto']!r}" if c["texto"] else ""
            extra += f" title={c['title']!r}" if c["title"] else ""
            print(f"   <{c['tag']}> {c['w']}x{c['h']} centro({c['cx']},{c['cy']}) cur={c['cursor']}{extra}")

    if m["titles"]:
        print(f"\n-- RÓTULOS/TÍTULOS na tela: {m['titles']}")
    print(f"\n-- outros slicers (lista/checkbox) na tela: {m['slicerVisualsCount']}")


async def main(url: str, headed: bool, clicks: list[str]) -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headed, args=q.LAUNCH_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=1,
            storage_state=str(q.SESSION_PATH) if q.SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        print(f"-> abrindo: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        await q.ensure_logged_in(page)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=30_000)
        except Exception:
            print("   (aviso: nenhum slicer de data apareceu — pode ser tela sem datas)")
        await asyncio.sleep(2.5)
        await q.save_session(ctx)

        try:
            shot_path = ROOT_SCRIPTS / "mapa_tela.png"
            await page.screenshot(path=str(shot_path), full_page=False)
            print(f"   (screenshot salvo em {shot_path})")
        except Exception as e:
            print(f"   (falha screenshot: {e})")

        # Dump dos controles DENTRO de iframes (visuais customizados: botões/inputs
        # com id/onclick — ex.: filtros internos do "Abertos — Expandido").
        for fr in page.frames:
            if fr == page.main_frame:
                continue
            try:
                ctrls = await fr.evaluate(r"""() => {
                    const norm = s => (s||'').replace(/\s+/g,' ').trim();
                    const btns = [...document.querySelectorAll('button, [onclick], .btn, [role=button]')]
                      .map(b => ({ tag:b.tagName.toLowerCase(), id:b.id||'', cls:(b.getAttribute('class')||'').slice(0,40),
                                   onclick:(b.getAttribute('onclick')||'').slice(0,60), texto:norm(b.innerText).slice(0,30) }))
                      .filter(b => b.texto || b.id || b.onclick);
                    const inputs = [...document.querySelectorAll('input, select, textarea')]
                      .map(i => ({ tag:i.tagName.toLowerCase(), id:i.id||'', type:i.type||'',
                                   placeholder:i.placeholder||'', value:(i.value||'').slice(0,30) }));
                    const footer = norm(document.body.innerText).match(/P[áa]gina\s+\d+\s+de\s+\d+[^\n]*/i);
                    return { url: location.href.slice(0,80), btns, inputs, footer: footer?footer[0]:'' };
                }""")
                if ctrls["btns"] or ctrls["inputs"]:
                    print(f"\n{'='*70}\nIFRAME: {ctrls['url']}")
                    print(f"-- BOTÕES no iframe: {len(ctrls['btns'])}")
                    for b in ctrls["btns"]:
                        print(f"   <{b['tag']}> id={b['id']!r} onclick={b['onclick']!r} texto={b['texto']!r} cls={b['cls']!r}")
                    print(f"-- INPUTS no iframe: {len(ctrls['inputs'])}")
                    for i in ctrls["inputs"]:
                        print(f"   <{i['tag']}> id={i['id']!r} type={i['type']!r} ph={i['placeholder']!r} val={i['value']!r}")
                    if ctrls["footer"]:
                        print(f"-- rodapé paginação: {ctrls['footer']!r}")
            except Exception as e:
                print(f"   (iframe probe falhou: {e})")

        mapas = []
        m0 = await page.evaluate(_MAP_JS)
        _print_mapa(m0, "inicial")
        mapas.append({"tela": "inicial", "clicks_antes": [], **m0})

        # navega clicando nos botões-imagem pedidos, mapeando após cada clique
        feitos = []
        for spec in clicks:
            try:
                w, h = (float(x) for x in spec.lower().split("x"))
            except Exception:
                print(f"   [--click {spec!r}] formato inválido (use LxA, ex.: 21.9x21.0)"); continue
            target = await page.evaluate(r"""(args) => {
                const {w,h} = args;
                let c = [...document.querySelectorAll('.visual-image .imageContainer, .imageContainer')]
                  .map(el => { const r = el.getBoundingClientRect();
                    return { x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height, cur:getComputedStyle(el).cursor }; })
                  .filter(o => o.cur === 'pointer' && o.w > 3 && o.h > 3);
                if (!c.length) return null;
                c.sort((a,b)=>(Math.abs(a.w-w)+Math.abs(a.h-h))-(Math.abs(b.w-w)+Math.abs(b.h-h)));
                return c[0];
            }""", {"w": w, "h": h})
            if not target:
                print(f"   [--click {spec}] nenhum botão-imagem clicável encontrado"); continue
            print(f"\n-> clicando botão ~{spec} → {target['w']:.1f}x{target['h']:.1f} em ({target['x']:.0f},{target['y']:.0f})")
            await page.mouse.click(target["x"], target["y"])
            await asyncio.sleep(2.5)
            feitos.append(spec)
            m = await page.evaluate(_MAP_JS)
            _print_mapa(m, f"após cliques {feitos}")
            mapas.append({"tela": f"apos:{'+'.join(feitos)}", "clicks_antes": list(feitos), **m})

        out_json = ROOT_SCRIPTS / "mapa_filtros.json"
        out_json.write_text(json.dumps({"url": url, "mapas": mapas}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n   (JSON salvo em {out_json})")

        if headed:
            print("   janela aberta 25s p/ inspeção…")
            await asyncio.sleep(25)
        await ctx.close(); await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Mapeia os filtros de uma página do Power BI (sem alterar nada)")
    ap.add_argument("--url", required=True, help="link completo do report/página do Power BI")
    ap.add_argument("--headed", action="store_true", help="abre janela visível (p/ assistir)")
    ap.add_argument("--click", action="append", default=[], metavar="LxA",
                    help="antes de mapear, clica no botão-imagem ~LxA (repetível, em ordem). Ex.: --click 21.9x21.0")
    args = ap.parse_args()
    asyncio.run(main(args.url, args.headed, args.click))
