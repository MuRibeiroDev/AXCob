"""Fluxo do relatório TÍTULOS QUITADOS (report ba6001c1...):
  1) abre o link
  2) período = último dia útil anterior → hoje ; Tipo Boleto = C (mantém se já)
  3) clica no botão-imagem (abre o detalhamento)
  4) vencimento = só o último dia útil anterior (data única)
  5) clica no botão-imagem (final)
  6) tira o print

Roda HEADED e salva screenshots de depuração após cada passo (q_stepN.png),
mais o print final (print_quitados.png). Datas calculadas dinamicamente.
"""
from __future__ import annotations
import asyncio
import io
import os
import argparse
from datetime import date, timedelta
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

HIDE_JS = r"""() => {
  const HIDE = ['.appBar','#globalNav','tri-header','.o365sx-waffle','.commandBarParent',
    '.actionBarContainer','#leftNavPane','.scenes-pane','.section-rail','.report-page-list',
    '.pages-pane','pbi-tabs','.filter-pane','#filterPaneContainer','.statusBar',
    '.slicer-dropdown-popup'];   // popup de slicer aberto não deve sair no print
  HIDE.forEach(s => document.querySelectorAll(s).forEach(e => e.remove()));
  document.body.style.overflow = 'hidden';
}"""
DSF = 3           # device scale factor: 3x renderiza em resolução maior → texto mais nítido
SCALE = 1.0       # upscale final opcional
N_PARTS = 2       # (legado) — divisão agora é adaptativa por altura
MAX_PART_H = 5200 # altura máx. (device px) por print; acima disso divide em mais partes
MAX_PARTS = 4     # teto de partes
OVERLAP_PX = 60   # (legado)
ZOOM_OUT = 1.0    # (zoom CSS não muda a virtualização do PBI — mantido em 1.0)
CAP_VPH = 1500    # altura da viewport DURANTE a captura. NÃO ALTERAR: o PBI usa "ajustar à
                  # página" e escala o conteúdo conforme a viewport — mudar isso muda a
                  # largura/escala da tabela (contentW) e, portanto, o PNG. 1500 → contentW=994.

ROOT = Path(__file__).resolve().parent.parent
# Caminho da sessão: configurável via env (no container vai p/ um volume persistente);
# no dev local cai no default scripts/.powerbi_session.json.
SESSION_PATH = Path(os.environ.get("POWERBI_SESSION_PATH") or (ROOT / "scripts" / ".powerbi_session.json"))
URL = ("https://app.powerbi.com/groups/3a380369-2411-47f7-9c7f-d5fa51d75cac/"
       "reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/ba6001c1c04ad8303134"
       "?language=pt-BR&experience=power-bi&navContentPaneEnabled=false&filterPaneEnabled=false")

HEADED = False  # headless: roda sem janela (evita fechamento acidental no meio da captura)
import sys
import time

# Args do Chromium. Em container (root, sem namespaces) o sandbox falha → liga
# --no-sandbox via env. --disable-dev-shm-usage evita crash com /dev/shm pequeno.
LAUNCH_ARGS = ["--start-maximized"]
if os.environ.get("PLAYWRIGHT_NO_SANDBOX") == "1":
    LAUNCH_ARGS += ["--no-sandbox", "--disable-dev-shm-usage"]

# Console do Windows às vezes usa cp1252 (não tem '→', '…' etc.) e os prints
# do script quebram com UnicodeEncodeError. Força UTF-8 na saída.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
CAT_DEBUG = os.environ.get("CAT_DEBUG", "0") == "1"  # logging detalhado da seleção de Categoria
TIMING = os.environ.get("TIMING", "0") == "1"        # imprime tempo por fase (diagnóstico)
DEBUG_SHOTS = os.environ.get("DEBUG_SHOTS", "0") == "1"  # salva q_stepN.png (debug; fora do PNG final)


# ─────────────────────── .env + login automático ───────────────────────
def _load_env() -> None:
    """Carrega o .env ÚNICO da raiz em os.environ (sem sobrescrever o que já existe).
    Evita depender do python-dotenv: parser simples KEY=VALUE."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception as e:
        print(f"   (aviso: não consegui ler o .env: {e})")


_load_env()


_VISUAL_SEL = '[class*="visualContainer"]'   # report carregado (logado)
_SSO_EMAIL = '#email'                         # página /singleSignOn do Power BI
_SSO_SUBMIT = '#submitBtn'                    # botão "Enviar" do SSO
_MS_EMAIL = 'input[type="email"], input[name="loginfmt"]'      # login da Microsoft
_MS_PWD = 'input[type="password"], input[name="passwd"]'
_MS_NEXT = '#idSIButton9, input[type="submit"]'               # Avançar/Entrar/Sim


async def ensure_logged_in(page, *, timeout: int = 60_000) -> bool:
    """Garante a autenticação no Power BI. Retorna True se efetuou login.

    Com sessão válida em cache, o report abre direto e isto é no-op (False).
    Sem sessão, o fluxo é: página de SSO do Power BI (digita e-mail → "Enviar")
    → login da Microsoft (e-mail, se pedido, + senha) → "Continuar conectado?"
    → volta ao report.

    Conta SEM MFA. Se aparecer 2º fator, o wait_for_url estoura e levanta erro.
    """
    async def _visivel(sel: str) -> bool:
        try:
            return await page.locator(sel).first.is_visible()
        except Exception:
            return False

    # (1) Espera ~25s a página assentar num estado conhecido.
    estado = None
    for _ in range(25):
        if await _visivel(_VISUAL_SEL):
            estado = "logado"; break
        if await _visivel(_SSO_EMAIL):
            estado = "sso"; break
        if ("login.microsoftonline.com" in page.url or "login.live.com" in page.url
                or await _visivel(_MS_PWD) or await _visivel(_MS_EMAIL)):
            estado = "ms"; break
        await asyncio.sleep(1)

    if estado == "logado":
        return False              # sessão do cache ainda válida → nada a fazer
    if estado is None:
        return False              # nem report nem login → deixa o wait_for visual reportar

    user = os.environ.get("POWERBI_USERNAME", "").strip()
    pwd = os.environ.get("POWERBI_PASSWORD", "").strip()
    if not (user and pwd):
        raise RuntimeError(
            "Sessão do Power BI ausente/expirada e POWERBI_USERNAME/POWERBI_PASSWORD "
            "não estão no .env — impossível logar automaticamente."
        )

    print("-> sessão ausente/expirada: efetuando login automático…")
    # (2) Página de SSO do Power BI: e-mail + "Enviar" → redireciona p/ a Microsoft.
    if estado == "sso":
        print("   SSO do Power BI: enviando e-mail…")
        await page.fill(_SSO_EMAIL, user)
        await page.click(_SSO_SUBMIT)
        try:
            await page.wait_for_selector(f'{_MS_PWD}, {_MS_EMAIL}', state="visible", timeout=timeout)
        except Exception:
            pass

    # (3) Login da Microsoft: e-mail (se ainda for pedido) + senha.
    if await _visivel(_MS_EMAIL):
        await page.fill(_MS_EMAIL, user)
        await page.click(_MS_NEXT)
    await page.wait_for_selector(_MS_PWD, state="visible", timeout=timeout)
    await page.fill(_MS_PWD, pwd)
    await page.click(_MS_NEXT)
    # "Continuar conectado?" → Sim (faz a sessão durar mais, menos relogins)
    try:
        await page.wait_for_selector(_MS_NEXT, timeout=15_000)
        await page.click(_MS_NEXT)
    except Exception:
        pass
    # (4) Espera voltar ao Power BI (deixa a tela de login).
    try:
        await page.wait_for_url("**app.powerbi.com/**", timeout=timeout)
    except Exception:
        raise RuntimeError(
            "Login não concluiu (credencial inválida ou 2º fator inesperado). "
            "Refaça o login manualmente p/ regenerar a sessão."
        )
    print("   login OK")
    return True


async def save_session(ctx) -> None:
    """Persiste a sessão (cookies renovados) em SESSION_PATH — vira cache p/ as
    próximas execuções, evitando relogar a cada relatório."""
    try:
        await ctx.storage_state(path=str(SESSION_PATH))
    except Exception as e:
        print(f"   (aviso: não consegui salvar a sessão: {e})")


try:
    import holidays as _holidays
except Exception:
    _holidays = None
_FERIADOS_CACHE: dict = {}

def _feriados(ano: int):
    """Feriados BR do ano (público + optional = calendário bancário: inclui
    Corpus Christi, Carnaval, Sexta-feira Santa...). Vazio se a lib faltar."""
    if _holidays is None:
        return set()
    if ano not in _FERIADOS_CACHE:
        try:
            _FERIADOS_CACHE[ano] = _holidays.Brazil(years=ano, categories=("public", "optional"))
        except Exception:
            try:
                _FERIADOS_CACHE[ano] = _holidays.Brazil(years=ano)
            except Exception:
                _FERIADOS_CACHE[ano] = set()
    return _FERIADOS_CACHE[ano]

def _e_util(x: date) -> bool:
    return x.weekday() < 5 and x not in _feriados(x.year)  # nem fds nem feriado

def prev_business_day(d: date) -> date:
    """Último dia útil ESTRITAMENTE anterior a `d` (pula fim de semana E feriados)."""
    x = d - timedelta(days=1)
    while not _e_util(x):
        x -= timedelta(days=1)
    return x


def janela_abertos(d: date):
    """Janela (início, fim) do relatório de ABERTOS.
    fim = último dia útil anterior a `d`. início = volta a partir de `fim` incluindo
    os dias NÃO-úteis (fds/feriado) imediatamente anteriores, p/ não deixar de fora
    um feriado órfão. Ex.: seg 08/06 com qui 04/06 (Corpus Christi) feriado → (04/06, 05/06);
    sem feriado/fds antes → (fim, fim) [um dia só]."""
    fim = prev_business_day(d)
    inicio = fim
    x = inicio - timedelta(days=1)
    while not _e_util(x):
        inicio = x
        x -= timedelta(days=1)
    return inicio, fim


def br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


async def close_overlays(page):
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass
    try:
        await page.evaluate("() => document.querySelectorAll('.cdk-overlay-backdrop, .cdk-overlay-pane')"
                            ".forEach(e => { try { e.remove(); } catch(_){} })")
    except Exception:
        pass
    await asyncio.sleep(0.2)


async def fechar_dropdowns(page):
    """Recolhe qualquer dropdown de slicer aberto. O slicer do PBI ignora Escape;
    fecha clicando no header (toggle). Faz isso ANTES de capturar p/ o popup não
    aparecer sobreposto à tabela. O filtro já aplicado não muda ao fechar."""
    for _ in range(3):
        try:
            abertos = page.locator('[role="combobox"][aria-expanded="true"]')
            n = await abertos.count()
        except Exception:
            n = 0
        if not n:
            break
        for i in range(n):
            try:
                await abertos.nth(i).click(timeout=2000)
                await asyncio.sleep(0.35)
            except Exception:
                pass
    # rede de segurança: esconde popups remanescentes (não altera o filtro)
    try:
        await page.evaluate("() => document.querySelectorAll('.slicer-dropdown-popup')"
                            ".forEach(e => { try { e.style.display='none'; } catch(_){} })")
    except Exception:
        pass
    await asyncio.sleep(0.2)


async def set_date_input(page, loc, value):
    try:
        if (await loc.input_value(timeout=1500)).strip() == value:
            return  # já está no valor — não re-digita (economiza tempo, não muda nada)
    except Exception:
        pass
    await close_overlays(page)
    await loc.click(force=True, timeout=8000)
    await asyncio.sleep(0.2)
    await loc.press("Control+a")
    await loc.press("Delete")
    await asyncio.sleep(0.1)
    await page.keyboard.type(value, delay=20)
    await asyncio.sleep(0.2)
    await loc.press("Tab")
    await asyncio.sleep(0.45)
    await close_overlays(page)


async def set_date_range(page, marker_inicio, start, end, label):
    """Localiza o .date-slicer-range que contém o input de início com `marker_inicio`
    no aria-label e seta início depois término."""
    rng = page.locator(".date-slicer-range", has=page.locator(f'input[aria-label*="{marker_inicio}"]')).first
    inicio = rng.locator("input.date-slicer-datepicker").nth(0)
    fim = rng.locator("input.date-slicer-datepicker").nth(1)
    await set_date_input(page, inicio, start)
    await set_date_input(page, fim, end)
    try:
        iv, fv = await inicio.input_value(), await fim.input_value()
        print(f"   [{label}] início={iv!r} término={fv!r} (alvo {start}..{end})")
    except Exception:
        pass
    await asyncio.sleep(1.5)


async def ensure_tipo_boleto_c(page):
    combo = page.locator('[role="combobox"][aria-label="Tipo Boleto"]').first
    if await combo.count() == 0:
        print("   [Tipo Boleto] combobox não encontrado"); return
    cur = (await combo.locator(".slicer-restatement").first.text_content() or "").strip()
    if cur == "C":
        print("   [Tipo Boleto] já = C (mantém)"); return
    print(f"   [Tipo Boleto] atual={cur!r} → selecionando C")
    await combo.click(force=True); await asyncio.sleep(0.8)
    ctrl = await combo.get_attribute("aria-controls")
    await page.evaluate(r"""(id) => {
        const root = id ? document.getElementById(id) : document.querySelector('[role="listbox"]');
        if (!root) return;
        const opts = [...root.querySelectorAll('[role="option"]')];
        const t = opts.find(o => (o.textContent||'').trim() === 'C') || opts.find(o => (o.textContent||'').trim().includes('C'));
        if (t) t.click();
    }""", ctrl)
    await asyncio.sleep(1.0); await close_overlays(page)


def _norm_cat(s):
    return (s or "").upper().replace("Ú", "U").replace("Ó", "O").replace("Ã", "A").replace("Á", "A").replace("Í", "I").replace("É", "E").replace("Â", "A").replace("Ê", "E").strip()


async def _open_combo(page, combo):
    """Tenta abrir o dropdown do combo (clique real; fallbacks). Devolve True se expandiu."""
    try:
        if (await combo.get_attribute("aria-expanded")) == "true":
            return True
    except Exception:
        pass
    try:
        await combo.scroll_into_view_if_needed(timeout=3000)
        await combo.click(timeout=3000)
    except Exception:
        try:
            await combo.click(force=True, timeout=2000)
        except Exception:
            try:
                await combo.evaluate("el => el.focus()")
                await page.keyboard.press("Enter")
            except Exception:
                return False
    await asyncio.sleep(0.9)
    try:
        return (await combo.get_attribute("aria-expanded")) == "true"
    except Exception:
        return False


_ALL_LABELS = ("SELECIONAR TUDO", "SELECT ALL", "TODOS", "TODAS", "")


async def _read_options(page, combo):
    """Lê as opções do popup do combo: [{text, norm, checked, isAll, x, y}].
    isAll marca a opção 'Selecionar tudo'/'Todos' (não é um valor real)."""
    ctrl = await combo.get_attribute("aria-controls")
    return await page.evaluate(r"""(id) => {
        const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
        let root = id ? document.getElementById(id) : null;
        let opts = root ? [...root.querySelectorAll('[role="option"]')] : [];
        if (!opts.length) for (const c of document.querySelectorAll('[role="listbox"],.slicer-dropdown-popup,.dropdownContent')) {
            const o=[...c.querySelectorAll('[role="option"]')]; if(o.length){opts=o;break;} }
        const ALL = ['SELECIONAR TUDO','SELECT ALL','TODOS','TODAS',''];
        return opts.map(o => {
            const r = o.getBoundingClientRect();
            const chk = o.querySelector('input[type=checkbox],[role=checkbox],.checkbox');
            let checked = o.getAttribute('aria-selected')==='true';
            if (chk) { const a = chk.getAttribute('aria-checked'); if (a!=null) checked=(a==='true'); else if (typeof chk.checked==='boolean') checked=chk.checked; }
            const t = (o.textContent||'').trim(); const nz = norm(t);
            return { text:t, norm:nz, checked, isAll: ALL.includes(nz), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), vis:(r.width>0&&r.height>0) };
        });
    }""", ctrl)


async def _restatement(combo):
    try:
        return (await combo.locator(".slicer-restatement").first.text_content(timeout=1500) or "").strip()
    except Exception:
        return ""


async def _set_one_categoria(page, combo, valor):
    """Ajusta UM combobox 'Categoria' (multi-select com cross-filter).
    Quando um valor está selecionado, o popup colapsa para mostrar SÓ esse valor
    (cross-filter) — então não dá p/ clicar direto no alvo: é preciso DESMARCAR o
    atual primeiro (a lista re-expande p/ todos os valores) e então marcar o alvo.
    A opção 'Selecionar tudo' é IGNORADA (só causa oscilação). Loop convergente:
    abre → lê → 1 clique real num valor real → repete até o restatement bater."""
    want = _norm_cat(valor)
    quer_todos = not valor
    ctrl = await combo.get_attribute("aria-controls")
    def lg(*a):
        if CAT_DEBUG: print("        [cat]", *a)
    for it in range(14):
        # done-check pelo restatement (verdade): alvo isolado ou Todos
        rest = _norm_cat(await _restatement(combo))
        lg(f"it{it} rest={rest!r}")
        if quer_todos and (rest in ("", "TODOS", "TODAS")):
            break
        if not quer_todos and rest == want:
            break
        if not await _open_combo(page, combo):
            return await _restatement(combo) or "?"  # não abriu (slicer sobreposto)
        opts = await _read_options(page, combo)             # ordem == optloc.nth(i)
        popup = page.locator(f'[id="{ctrl}"]') if ctrl else page.locator('.slicer-dropdown-popup')
        optloc = popup.get_by_role("option")
        val_idx = [i for i, o in enumerate(opts) if not o["isAll"]]
        if not val_idx:
            await asyncio.sleep(0.6); continue
        checked_idx = [i for i in val_idx if opts[i]["checked"]]
        lg("opts=", [(opts[i]["norm"], opts[i]["checked"]) for i in val_idx])
        if quer_todos:
            if not checked_idx:
                break
            tgt = checked_idx[0]                            # desmarca tudo até Todos
        else:
            present = next((i for i in val_idx if opts[i]["norm"] == want), None)
            extra = [i for i in checked_idx if opts[i]["norm"] != want]
            if present is not None and opts[present]["checked"] and not extra:
                break                                       # só o alvo marcado
            if present is not None and not opts[present]["checked"] and not extra:
                tgt = present                               # Todos → marca o alvo
            elif extra:
                tgt = extra[0]                              # desmarca quem não é o alvo
            elif checked_idx:
                tgt = checked_idx[0]                        # alvo ausente (cross-filter) → limpa
            else:
                await asyncio.sleep(0.6); continue
        # clique via locator (scroll + espera + ponteiro real); SEM Escape depois,
        # p/ não cancelar a seleção recém-feita.
        lg("clicando idx", tgt, opts[tgt]["norm"])
        try:
            await optloc.nth(tgt).scroll_into_view_if_needed(timeout=2500)
            await optloc.nth(tgt).click(timeout=3000)
        except Exception as e:
            lg("click err", str(e)[:80])
            try: await page.mouse.click(opts[tgt]["x"], opts[tgt]["y"])
            except Exception: pass
        await asyncio.sleep(1.3)
    await asyncio.sleep(0.6); await close_overlays(page)
    return await _restatement(combo) or "?"


async def select_categoria(page, valor):
    """Seleciona a Categoria/Plataforma na view final. Há 2 slicers no mesmo
    campo; só o 'mestre' (clicável) precisa ser ajustado — o outro espelha via
    cross-filter. valor='' = Geral (limpa para Todos)."""
    combos = page.locator('[role="combobox"][aria-label="Categoria"]')
    n = await combos.count()
    if n == 0:
        print("   [Categoria] nenhum combobox encontrado"); return
    alvo = _norm_cat(valor); quer_todos = not valor
    print(f"   [Categoria] {n} slicer(s) → alvo={valor or 'TODOS'}")
    ok_any = False
    for i in range(n):
        fin = await _set_one_categoria(page, combos.nth(i), valor)
        print(f"      slicer #{i}: agora = {fin!r}")
        fin_ok = (fin == "" or fin.lower() in ("todos", "todas")) if quer_todos else (_norm_cat(fin) == alvo)
        if fin_ok:
            ok_any = True
            break  # mestre ajustado; os demais espelham via cross-filter
    if not ok_any:
        print("   [Categoria] AVISO: nenhum slicer confirmou o alvo")
    await fechar_dropdowns(page)   # recolhe o popup p/ não sobrepor a tabela no print


async def click_image_pointer(page, label, prefer_small=False):
    """Clica no .visual-image .imageContainer clicável (cursor pointer).
    prefer_small=True escolhe o menor (passo 5); senão o maior (passo 3)."""
    target = await page.evaluate(r"""(small) => {
        let c = [...document.querySelectorAll('.visual-image .imageContainer')]
            .map(el => { const r = el.getBoundingClientRect();
                return { x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height, cur:getComputedStyle(el).cursor }; })
            .filter(o => o.cur === 'pointer' && o.w > 3 && o.h > 3);
        if (!c.length) return null;
        c.sort((a,b) => (a.w*a.h) - (b.w*b.h));     // menor → maior
        const t = small ? c[0] : c[c.length-1];
        return t;
    }""", prefer_small)
    if not target:
        print(f"   [{label}] nenhum botão-imagem clicável encontrado"); return False
    print(f"   [{label}] clicando em ({target['x']:.0f},{target['y']:.0f}) size {target['w']:.0f}x{target['h']:.0f}")
    await page.mouse.click(target["x"], target["y"])
    # settle menor: o próximo passo (set_date_range / select_categoria) auto-espera o
    # elemento específico (por marcador/aria-label), então não dependemos deste tempo fixo.
    await asyncio.sleep(2.0)
    return True


async def dbg(page, name):
    if not DEBUG_SHOTS:   # screenshots de depuração não entram no PNG final — pulados por padrão
        return
    (ROOT / "scripts" / name).write_bytes(await page.screenshot(type="png"))
    print(f"   debug: {name}")


async def _shot(page, clip):
    # clampa o clip aos limites da viewport (1600 x CAP_VPH) e garante dimensões
    # positivas — evita 'tile cannot extend outside image' e clips fora da tela
    # quando a tabela é minúscula/vazia.
    x = max(0.0, float(clip["x"])); y = max(0.0, float(clip["y"]))
    w = min(float(clip["width"]), 1600.0 - x)
    h = min(float(clip["height"]), float(CAP_VPH) - y)
    w = max(1.0, w); h = max(1.0, h)
    png = await page.screenshot(type="png", clip={"x": x, "y": y, "width": w, "height": h})
    return Image.open(io.BytesIO(png)).convert("RGB")


async def capturar_limpo(page, out_path):
    """Esconde o chrome do PBI, costura a tabela inteira (rolando o .mid-viewport)
    e recorta justo no conteúdo (sem borda). Salva PNG."""
    await page.evaluate(HIDE_JS)
    await asyncio.sleep(0.6)
    await page.set_viewport_size({"width": 1600, "height": CAP_VPH})
    await asyncio.sleep(0.6)
    # ZOOM OUT: linhas menores → mais linhas cabem na tabela por vez → destrava
    # o carregamento das últimas (ideia do usuário). Coords via getBoundingClientRect
    # já refletem o zoom, então o recorte por linha continua consistente.
    if ZOOM_OUT and ZOOM_OUT != 1.0:
        await page.evaluate(f"() => {{ document.documentElement.style.zoom = '{ZOOM_OUT}'; }}")
        await asyncio.sleep(1.5)

    geo = await page.evaluate(r"""() => {
        const vcs = document.querySelectorAll('visual-container, .visualContainer');
        let minX=Infinity,minY=Infinity,maxR=-Infinity;
        vcs.forEach(v=>{const r=v.getBoundingClientRect(); if(r.width<5||r.height<5)return;
            minX=Math.min(minX,r.x);minY=Math.min(minY,r.y);maxR=Math.max(maxR,r.right);});
        // maior .mid-viewport = a tabela principal
        let mv=null,best=0;
        document.querySelectorAll('.mid-viewport').forEach(el=>{const r=el.getBoundingClientRect();
            if(r.width*r.height>best){best=r.width*r.height;mv=el;}});
        const mb=mv?mv.getBoundingClientRect():null;
        return { contentX:Math.max(0,Math.round(minX)), contentTop:Math.max(0,Math.round(minY)),
                 contentW:Math.round(maxR-minX),
                 tableTop: mb?Math.round(mb.top):null, clientH: mv?Math.round(mv.clientHeight):null };
    }""")
    # Se a tabela veio com altura implausível (render ainda não assentou após trocar
    # o filtro), espera e re-mede uma vez.
    if geo.get("clientH") is not None and geo["clientH"] < 400:
        await asyncio.sleep(1.5)
        geo2 = await page.evaluate(r"""() => {
            const vcs = document.querySelectorAll('visual-container, .visualContainer');
            let minX=Infinity,minY=Infinity,maxR=-Infinity;
            vcs.forEach(v=>{const r=v.getBoundingClientRect(); if(r.width<5||r.height<5)return;
                minX=Math.min(minX,r.x);minY=Math.min(minY,r.y);maxR=Math.max(maxR,r.right);});
            let mv=null,best=0;
            document.querySelectorAll('.mid-viewport').forEach(el=>{const r=el.getBoundingClientRect();
                if(r.width*r.height>best){best=r.width*r.height;mv=el;}});
            const mb=mv?mv.getBoundingClientRect():null;
            return { contentX:Math.max(0,Math.round(minX)), contentTop:Math.max(0,Math.round(minY)),
                     contentW:Math.round(maxR-minX),
                     tableTop: mb?Math.round(mb.top):null, clientH: mv?Math.round(mv.clientHeight):null };
        }""")
        if geo2.get("clientH") and geo2["clientH"] >= geo.get("clientH", 0):
            geo = geo2
    print("   geo:", geo)
    cx, cw = geo["contentX"], geo["contentW"]

    # cabeçalho/filtros (do topo do conteúdo até o topo da tabela)
    header = None
    if geo["tableTop"] is not None and geo["tableTop"] > geo["contentTop"]:
        header = await _shot(page, {"x": cx, "y": geo["contentTop"], "width": cw,
                                    "height": geo["tableTop"] - geo["contentTop"]})

    row_imgs = []   # uma imagem por LINHA (recortada no limite exato da linha)
    if geo["tableTop"] is not None and geo["clientH"]:
        clientH, tableTop = geo["clientH"], geo["tableTop"]

        async def get_scrolltop():
            return await page.evaluate(
                "()=>{const els=[...document.querySelectorAll('.mid-viewport')].sort((a,b)=>"
                "b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);return els[0]?Math.round(els[0].scrollTop):0;}")

        async def rowcount():
            return await page.evaluate(
                "()=>{const g=document.querySelector('[role=\"grid\"][aria-rowcount], [role=\"treegrid\"][aria-rowcount]');"
                "return g?parseInt(g.getAttribute('aria-rowcount')):null;}")

        # rolagem por RODA do mouse (dispara o lazy-load do PBI; scrollTop via JS não dispara)
        cxc, cyc = cx + cw / 2, tableTop + clientH / 2
        await page.mouse.move(cxc, cyc)

        async def wheel_down(px):
            before = await get_scrolltop()
            await page.mouse.wheel(0, px)
            await asyncio.sleep(0.6)
            return await get_scrolltop(), before

        async def get_rows():
            return await page.evaluate(r"""(args)=>{
                const {tableTop, clientH} = args;
                const els=[...document.querySelectorAll('.mid-viewport')]
                    .sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
                const mv=els[0]; if(!mv) return [];
                return [...mv.querySelectorAll('[role="row"]')].map(r=>{
                    const b=r.getBoundingClientRect();
                    // idx único da linha: aria-rowindex (PBI) com fallback no texto
                    const ri = r.getAttribute('aria-rowindex');
                    const txt = (r.textContent||'').replace(/\s+/g,' ').trim();
                    return { idx: ri!=null ? ('r'+ri) : ('t'+txt), key: txt,
                             top:b.top-tableTop, bottom:b.bottom-tableTop, h:b.height };
                }).filter(o => o.h>3 && o.key && o.top>=-1 && o.bottom<=clientH+1);  // só linhas INTEIRAS
            }""", {"tableTop": tableTop, "clientH": clientH})

        STEP = max(50, int(clientH * 0.5))  # meia tela por passo (rápido); a cauda pega o overscan final
        total = await rowcount()
        print(f"   aria-rowcount (total de linhas reportado): {total}")
        seen = set()
        capturadas = []   # (idx, imagem) na ordem de aparição
        async def forcar_fundo():
            """OSCILA perto do fundo (sobe um pouco, desce forte) repetidas vezes.
            Isso gera eventos de scroll REAIS no rodapé — é o que dispara o
            carregamento do próximo lote do servidor (que um humano provoca rolando)."""
            await page.mouse.move(cxc, tableTop + clientH - 30)  # cursor no rodapé da tabela
            for _ in range(4):
                await page.mouse.wheel(0, -900)   # sobe um pouco
                await asyncio.sleep(0.35)
                await page.mouse.wheel(0, 3500)    # desce forte (gera delta de scroll no fundo)
                await asyncio.sleep(0.7)

        async def scroll_h():
            return await page.evaluate(
                "()=>{const e=[...document.querySelectorAll('.mid-viewport')].sort((a,b)=>"
                "b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];return e?Math.round(e.scrollHeight):0;}")

        async def max_rowindex():
            return await page.evaluate(
                "()=>{const e=[...document.querySelectorAll('.mid-viewport')].sort((a,b)=>"
                "b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];if(!e)return 0;"
                "let m=0;e.querySelectorAll('[role=\"row\"]').forEach(r=>{const i=parseInt(r.getAttribute('aria-rowindex')||'0');if(i>m)m=i;});return m;}")

        # (pré-carga Ctrl+End removida: criava placeholders vazios travados no fundo.
        #  Em vez disso, fazemos um CRAWL LENTO de cima p/ baixo — o PBI popula cada
        #  segmento naturalmente conforme as linhas entram em vista, como um humano.)

        await page.mouse.move(cxc, cyc)
        await asyncio.sleep(1.0)
        forced = 0
        for _ in range(1000):
            await asyncio.sleep(0.45)  # respiro: garante que o texto da linha já renderizou
            await page.mouse.move(cxc, cyc)  # garante o cursor sobre a tabela (p/ a roda agir nela)
            shot = await _shot(page, {"x": cx, "y": tableTop, "width": cw, "height": clientH})
            added = 0
            for r in await get_rows():
                if r["idx"] in seen:
                    continue
                seen.add(r["idx"])
                y0 = max(0, round(r["top"] * DSF)); y1 = min(shot.height, round(r["bottom"] * DSF))
                if y1 > y0:
                    capturadas.append((r["idx"], r["key"], shot.crop((0, y0, shot.width, y1))))
                    added += 1
            cur, before = await wheel_down(STEP)   # rola com a roda do mouse
            moveu = cur > before + 2
            if added == 0 and not moveu:
                # fim aparente — 1 nudge no fundo p/ disparar lazy-load; a fase de CAUDA
                # (clip alto) é quem realmente captura as últimas linhas. (Era 4 rodadas;
                # reduzido p/ 1 — ganho de tempo sem mudar as linhas capturadas.)
                if forced < 1:
                    forced += 1
                    await forcar_fundo()
                    continue
                break
            else:
                forced = 0  # voltou a progredir/aparecer linha nova

        # ---- CAUDA: as últimas linhas renderizam ABAIXO do clientH (overscan).
        # Captura com clip ALTO (limitado pela viewport) e filtro relaxado, recortando
        # cada linha pela sua posição real. (Não era lazy-load — era clip curto.)
        try:
            VPH = CAP_VPH  # altura da viewport setada antes
            big_h = min(VPH - tableTop - 4, clientH + 320)  # clip alto, mas dentro da viewport
            for tentativa in range(6):
                await page.mouse.move(cxc, tableTop + clientH - 30)
                for _ in range(6):
                    await page.mouse.wheel(0, 2500)
                    await asyncio.sleep(0.3)
                await asyncio.sleep(1.8)
                shotf = await _shot(page, {"x": cx, "y": tableTop, "width": cw, "height": big_h})
                rows_t = await page.evaluate(r"""(args)=>{
                    const {tableTop, lim} = args;
                    const mv=[...document.querySelectorAll('.mid-viewport')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
                    if(!mv) return [];
                    return [...mv.querySelectorAll('[role="row"]')].map(r=>{const b=r.getBoundingClientRect();
                        const ri=r.getAttribute('aria-rowindex'); const txt=(r.textContent||'').replace(/\s+/g,' ').trim();
                        return {idx: ri!=null?('r'+ri):('t'+txt), key:txt, top:b.top-tableTop, bottom:b.bottom-tableTop, h:b.height};
                    }).filter(o=>o.h>3 && o.key && o.top>=-1 && o.top<lim-2);
                }""", {"tableTop": tableTop, "lim": big_h})
                novas = 0
                for r in rows_t:
                    if r["idx"] in seen: continue
                    seen.add(r["idx"])
                    y0 = max(0, round(r["top"]*DSF)); y1 = min(shotf.height, round(min(r["bottom"], big_h)*DSF))
                    if y1 > y0:
                        capturadas.append((r["idx"], r["key"], shotf.crop((0, y0, shotf.width, y1)))); novas += 1
                mi_dom = await max_rowindex()
                ris_now = sorted(int(i[1:]) for i,_k,_ in capturadas if i.startswith("r"))
                topo = ris_now[-1] if ris_now else 0
                print(f"   [cauda t{tentativa}] novas={novas} | maior capturado=r{topo} | maxRowindex DOM=r{mi_dom} | clip_h={big_h}")
                if topo >= mi_dom:
                    break
        except Exception as ex:
            print("   captura da cauda falhou:", ex)

        # ordena pelo aria-rowindex numérico (garante ordem visual correta) e detecta lacunas
        def _ri(idx):
            try:
                return int(idx[1:]) if idx.startswith("r") else None
            except Exception:
                return None
        ris = sorted([v for v in (_ri(i) for i, _k, _ in capturadas) if v is not None])
        if ris:
            esperado = set(range(ris[0], ris[-1] + 1))
            faltando = sorted(esperado - set(ris))
            capturadas.sort(key=lambda t: (_ri(t[0]) is None, _ri(t[0]) if _ri(t[0]) is not None else 0))
            print(f"   linhas capturadas: {len(capturadas)} | rowindex {ris[0]}..{ris[-1]} | faltando: {faltando}")
        else:
            print(f"   linhas capturadas: {len(capturadas)} (sem aria-rowindex)")
        # dump da lista de cedentes capturados (p/ conferência) — só em modo debug
        if DEBUG_SHOTS:
            lst = out_path.with_name("cedentes_capturados.txt")
            with open(lst, "w", encoding="utf-8") as fh:
                for j, (idx, key, _img) in enumerate(capturadas, 1):
                    fh.write(f"{j:3d}. [{idx}] {key}\n")
            print(f"   lista salva: {lst.name}")

        # ---- TOTAL (rodapé): linha de soma fica FORA do mid-viewport (um [role=row]
        # cujo texto começa com 'Total'), por isso o crawl não pega. Captura à parte,
        # alinhada pela largura da tabela, e anexa como última "linha".
        try:
            await page.mouse.move(cxc, tableTop + clientH - 30)
            await page.mouse.wheel(0, 4000)        # garante o rodapé visível
            await asyncio.sleep(0.9)
            tot = await page.evaluate(r"""() => {
                const rows=[...document.querySelectorAll('[role="row"]')]
                    .filter(r=>/^\s*total/i.test(r.textContent||''));
                if(!rows.length) return null;
                rows.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width);
                const r=rows[0].getBoundingClientRect();
                return { top:r.top, h:r.height, text:(rows[0].textContent||'').replace(/\s+/g,' ').trim().slice(0,90) };
            }""")
            if tot and tot["h"] > 3:
                img = await _shot(page, {"x": cx, "y": max(0, tot["top"] - 1),
                                         "width": cw, "height": tot["h"] + 2})
                capturadas.append(("total", tot["text"], img))
                print(f"   total capturado: {tot['text']!r}")
            else:
                print("   total: linha não encontrada")
        except Exception as ex:
            print("   captura do total falhou:", ex)

        row_imgs = [img for _, _k, img in capturadas]

    # Fallback: tabela vazia/degenerada (categoria sem dados no dia) — captura a área
    # do relatório como UMA imagem e salva 1 parte, evitando imagem de altura 0.
    if not row_imgs:
        ct = geo.get("contentTop") or 0
        base = geo.get("tableTop") or ct
        ch = geo.get("clientH") or 240
        full = await _shot(page, {"x": cx, "y": ct, "width": cw, "height": (base - ct) + ch + 40})
        for old in out_path.parent.glob(f"{out_path.stem}_*{out_path.suffix}"):
            meio = old.name[len(out_path.stem) + 1: -len(out_path.suffix)]
            if meio.isdigit():
                try: old.unlink()
                except Exception: pass
        p = out_path.with_name(f"{out_path.stem}_1{out_path.suffix}")
        full.save(p)
        print(f"   (sem linhas) salvo {p.name} ({full.width}x{full.height}px) — área do relatório")
        return

    W = (header.width if header else 1)
    if row_imgs:
        W = max(W, max(r.width for r in row_imgs))

    # limpa prints antigos desta base (evita _2/_3 órfãos). Só remove partes desta
    # MESMA base — {stem}_<N>.png — para não apagar variações de outra categoria
    # (ex.: gerar 'print_abertos' não pode apagar 'print_abertos_agro_1.png').
    for old in out_path.parent.glob(f"{out_path.stem}_*{out_path.suffix}"):
        meio = old.name[len(out_path.stem) + 1: -len(out_path.suffix)]
        if meio.isdigit():
            try: old.unlink()
            except Exception: pass

    # distribui as LINHAS em N grupos de altura ~igual (corte sempre ENTRE linhas).
    # N é ADAPTATIVO: 1 print quando cabe; só divide se a tabela for muito alta.
    total_h = sum(r.height for r in row_imgs) or 1
    n = max(1, min(MAX_PARTS, -(-total_h // MAX_PART_H)))  # ceil(total_h / MAX_PART_H)
    alvo = total_h / n
    grupos, atual, acc = [], [], 0
    for r in row_imgs:
        atual.append(r); acc += r.height
        if acc >= alvo and len(grupos) < n - 1:
            grupos.append(atual); atual, acc = [], 0
    if atual:
        grupos.append(atual)
    if not grupos:
        grupos = [[]]

    salvos = []
    for i, grupo in enumerate(grupos):
        gh = sum(r.height for r in grupo)
        hh = header.height if header else 0
        out = Image.new("RGB", (max(1, W), max(1, hh + gh)), "white"); y = 0
        if header:
            out.paste(header, (0, 0)); y = header.height
        for r in grupo:
            out.paste(r, (0, y)); y += r.height
        if SCALE != 1.0:
            out = out.resize((round(out.width * SCALE), round(out.height * SCALE)), Image.LANCZOS)
        p = out_path.with_name(f"{out_path.stem}_{i+1}{out_path.suffix}")
        out.save(p); salvos.append((p.name, out.width, out.height, len(grupo)))
    for nome, w, h, nl in salvos:
        print(f"   salvo {nome} ({w}x{h}px, {nl} linhas)")


async def main(categoria: str = "", out_path: Path | None = None):
    out_path = out_path or (ROOT / "scripts" / "print_quitados.png")
    hoje = date.today()
    ult = prev_business_day(hoje)
    print(f"hoje={br(hoje)}  último dia útil anterior={br(ult)} | categoria={categoria or 'GERAL'} | saída={out_path.stem}")
    print(f"periodo: {br(ult)} -> {br(hoje)} | vencimento: {br(ult)} -> {br(ult)}")

    _t = {"last": time.perf_counter(), "ini": time.perf_counter()}
    def lap(nome):
        agora = time.perf_counter()
        if TIMING:
            print(f"   ⏱ {nome}: {agora - _t['last']:.1f}s (total {agora - _t['ini']:.1f}s)")
        _t["last"] = agora

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not HEADED, args=LAUNCH_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=DSF,
            storage_state=str(SESSION_PATH) if SESSION_PATH.exists() else None,
        )
        page = await ctx.new_page()
        lap("launch+context")
        print("-> abrindo report…")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60_000)
        await ensure_logged_in(page)  # loga só se a sessão caiu (ausente/expirada)
        await page.wait_for_selector('[class*="visualContainer"]', timeout=120_000)
        # espera o slicer de data (o que o passo 2 usa) ficar pronto, em vez de sleep fixo;
        # se a tela já está pronta, segue na hora — sem mudar o que é capturado.
        try:
            await page.wait_for_selector("input.date-slicer-datepicker", state="visible", timeout=60_000)
        except Exception:
            pass
        await asyncio.sleep(2)
        await save_session(ctx)  # persiste a sessão (renovada) p/ as próximas execuções
        lap("load+wait_slicer")

        print("-> passo 2: período + Tipo Boleto C")
        await set_date_range(page, "01/01/2015", br(ult), br(hoje), "período")
        await ensure_tipo_boleto_c(page)
        await dbg(page, "q_step2.png")
        lap("passo2")

        print("-> passo 3: clique no botão-imagem")
        await click_image_pointer(page, "passo3", prefer_small=False)
        await dbg(page, "q_step3.png")
        lap("passo3")

        print("-> passo 4: vencimento (dia único)")
        await set_date_range(page, "30/07/2015", br(ult), br(ult), "vencimento")
        # Limpa o slicer de Categoria da VIEW DE DETALHE p/ Todos. Isso é essencial:
        # os 2 slicers de Categoria se cross-filtram (cada um colapsa a lista do outro
        # ao valor selecionado). Com o de detalhe em Todos, a lista do slicer da view
        # final (Plataforma) re-expande p/ TODOS os valores, permitindo trocar o filtro.
        print("   limpando Categoria (detalhe) p/ Todos")
        await select_categoria(page, "")
        await dbg(page, "q_step4.png")
        lap("passo4+limpa categoria")

        print("-> passo 5: clique no botão-imagem (final)")
        await click_image_pointer(page, "passo5", prefer_small=True)
        await dbg(page, "q_step5.png")
        lap("passo5")

        # Categoria/Plataforma na VIEW FINAL: com o slicer de detalhe em Todos, a lista
        # do slicer da view final está completa → seleciona o alvo (vazio = Geral/Todos).
        print("-> Categoria/Plataforma (view final)")
        await select_categoria(page, categoria)
        await asyncio.sleep(2)
        lap("select categoria final")

        print("-> passo 6: print final (limpo, tabela inteira)")
        await capturar_limpo(page, out_path)  # select_categoria já aguardou o settle
        lap("passo6 capturar_limpo")

        if HEADED:
            print("janela aberta 15s p/ inspeção…"); await asyncio.sleep(15)
        await ctx.close(); await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Captura Títulos Quitados do Power BI (com filtro de Categoria opcional)")
    ap.add_argument("--categoria", default="", help="AGRO | INDÚSTRIA | ESTRUTURADA (vazio = Geral)")
    ap.add_argument("--out", default="print_quitados.png", help="nome base do PNG de saída (em scripts/)")
    args = ap.parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / "scripts" / out.name
    asyncio.run(main(args.categoria, out))
