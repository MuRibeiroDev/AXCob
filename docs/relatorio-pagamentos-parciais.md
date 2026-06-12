# Relatório "Títulos Pagos Parcialmente"

> Mensagem enviada por WhatsApp como **último passo** da sequência do botão
> **"Enviar relatórios"** (depois das comissárias em atraso).
> Código: `backend/src/relatorios/relatorios.service.ts` → `calcularParciais()` / `textoParciais()`.
> Teste manual (mesma lógica, sem mexer em nada): `node backend/scripts/teste-parciais.cjs`.

## Objetivo

Mostrar, para os cedentes do relatório **Títulos Abertos — Geral**, quais títulos
vencidos no período tiveram **pagamento parcial do sacado** — ou seja, o devedor
está pagando aos poucos e ainda resta saldo vencido. É insumo de priorização de
cobrança: quem paga parte é perfil diferente de quem não paga nada.

## Formato da mensagem

Uma linha por cedente (sem cabeçalho), frase fixa, cedente em negrito,
ordenado por valor vencido desc:

```
*CEDENTE A* - Já estava na cobrança, houve abatimento parcial.
*CEDENTE B* - Já estava na cobrança, houve abatimento parcial.
```

Sem nenhum parcial no dia → **a mensagem não é enviada** (a sequência segue
direto). Os valores (vencido/quitado por cedente) continuam disponíveis no log
do backend (`PARCIAIS ...`) e no `scripts/print_abertos.parciais.txt`.

## Regras (fechadas com a operação em 12/06/2026)

| # | Regra | Detalhe |
|---|-------|---------|
| 1 | **Cedentes** | somente os que aparecem no print do "Títulos Abertos — Geral" (lista extraída do BI na geração, via `--dump-cedentes`) |
| 2 | **Período** | título precisa ter **vencimento dentro da janela do relatório** (último dia útil + dias não-úteis órfãos imediatamente anteriores). Parciais com vencimento antigo NÃO entram |
| 3 | **Filtros de título** | boleto `M = 'C'`; tipos: `CCB, CTR, DMR, DSR, NCO, NPP, CPR` (sem CHQ, sem ADC/DES/TAR etc.) |
| 4 | **Sem flexibilização** | a carência do cedente NÃO é considerada — em carência ou não, aparece |
| 5 | **Chave do match** | `número + CNPJ cedente + CNPJ sacado + sistema + OP` (tudo normalizado por dígitos). Quitação sem OP não casa |
| 6 | **Quitação parcial** | só contam recibos de quitação onde **`LIQUIDADO < VALOR_FACE`** (ver "A regra do recibo parcial" abaixo) — pagamento integral de parcela não conta |
| 7 | **Recompra/repasse fora** | quitações com `SITUACAO LIKE 'Recomprado%'` ou `'Repassado%'` são ignoradas — é o **cedente** cobrindo o título, não o sacado pagando |
| 8 | **Soma** | todas as quitações parciais da mesma chave são somadas (pagamentos em várias vezes) |

Fontes: `data_core.vw_titulos_abertos` × `data_core.vw_titulos_quitados`.

---

## Por que cada pedaço da chave existe (histórico de falsos positivos)

O match ingênuo ("número em aberto + número em quitados = parcial") quebra de
várias formas que encontramos em dados reais. Cada componente da regra mata um
padrão específico:

### CNPJ do sacado + cedente
Números de título se repetem entre sacados/cedentes diferentes (ex.: `001`,
`245-003`). Sem os CNPJs, quitação de um sacado casava com título aberto de outro.

### Sistema (FIDC / Securitizadora / FIDC Agro)
**Rolagem de veículo**: título quitado "manualmente" no FIDC e relançado na
Securitizadora com o mesmo número (caso SUCATA OUTLET, R$2,5M — recompra com
garantia de imóvel). O fundo recebeu do **grupo**, não do sacado. Sistema na
chave impede o cruzamento entre veículos.

### OP (operação)
Números tipo **CPF/parcela** (caso IPM Educação — mensalidades): o mesmo aluno
foi descontado em **safras diferentes** (out/2024, mai/2025, dez/2025). A
quitação da mensalidade de 2024 casava com o título de 2026 e parecia parcial.
A OP amarra o título à mesma operação de desconto.

### SITUACAO sem Recomprado/Repassado
`Recomprado` = o **cedente** recomprou o título vencido do fundo (obrigação de
recompra). O fundo recebeu, mas o **sacado não pagou nada** — não é recuperação
de crédito do devedor. Por decisão da operação (12/06/2026), recompra **não**
conta como pagamento parcial.

---

## A regra do "recibo parcial" (`LIQUIDADO < VALOR_FACE`) — regra 6

### O problema que ela resolve

**Parcelas/reapresentações com o mesmo número** (caso ARCOLUB — duplicatas DMR):

```
nº 000769833 — venc 14/05 → PAGA INTEIRA (face 1.003,57 | liq 1.003,57) → QUITADOS
nº 000769833 — venc 27/05 → PAGA INTEIRA (face 1.003,57 | liq 1.003,57) → QUITADOS
nº 000769833 — venc 11/06 → NÃO PAGA   (face 1.003,58)                  → ABERTOS
```

Toda a chave (número, cedente, sacado, sistema e até a **OP**) é igual nas três
linhas — são parcelas da mesma operação. O cruzamento achava o número nas duas
views e concluía "parcial", somando R$2.007 "pagos" do título de 11/06. Falso:
o sacado pagou **duas parcelas inteiras**; a terceira é outra obrigação.

### As alternativas avaliadas (e por que foram descartadas)

| Alternativa | Resultado |
|---|---|
| exigir **vencimento igual** nas duas views | mata as parcelas ✓, mas mata também o parcial verdadeiro **relançado** (caso IMPACTPVA abaixo, em que o saldo reaberto ganha vencimento novo) ✗ |
| exigir **valor igual** | inverte o problema: parciais verdadeiros têm faces **diferentes** (aberto = resto; quitado = original), e parcelas têm faces **iguais** — selecionaria exatamente os falsos ✗ |
| **olhar o recibo de quitação** (`LIQUIDADO < VALOR_FACE`) | ✅ escolhida — ver abaixo |

### Como funciona

Cada linha de `vw_titulos_quitados` é um "recibo" com `VALOR_FACE` (quanto o
título valia) e `LIQUIDADO` (quanto entrou). **O próprio recibo diz se a baixa
foi integral ou parcial** — sem depender de vencimento nem de valor do lado aberto:

```
LIQUIDADO ≥ VALOR_FACE → baixa INTEGRAL (parcela paga inteira, c/ ou s/ juros) → ignora
LIQUIDADO < VALOR_FACE → baixa PARCIAL (entrou menos que o título valia)       → conta
```

Validação nos casos reais:

| Caso | Recibo (face → liq) | Classificação |
|---|---|---|
| ARCOLUB `000769833` (parcelas) | 1.003,57 → 1.003,57 | integral → **fora** ✓ |
| ARCOLUB `000771956` (parcela paga c/ juros) | 253,00 → 268,16 | integral → **fora** ✓ |
| ESCOLA BILINGUE `157228` | 5.789,00 → 3.689,33 | parcial → **entra** ✓ |
| IMPACTPVA `4029-001` (R$1M, saldo relançado c/ venc novo) | 1.019.780,00 → 514.988,90 | parcial → **entra** ✓ |

Prova aritmética nos verdadeiros: `face em aberto = face quitada − liquidado`
ao centavo (IMPACTPVA: 1.019.780 − 514.988,90 = 504.791,10 = saldo em aberto).

### Tolerância

Para não classificar como "parcial" um pagamento integral com arredondamento ou
desconto de centavos, o recibo só é considerado parcial se
**`LIQUIDADO < 99% do VALOR_FACE`** (tolerância de 1%).

### Limitação conhecida (aceita)

Baixa integral **com desconto comercial** (ex.: face 1.000, liquidado 950,
título encerrado) tem cara de recibo parcial — mas como o título encerrado **não
está mais em abertos**, a regra 2 (estar em aberto no período) já o exclui.

---

## Linha do tempo das decisões

| Data | Decisão |
|---|---|
| 11/06/2026 | criação do relatório (match número+cedente+sacado), formato da mensagem, whitelist de tipos |
| 11/06/2026 | sistema na chave (rolagem FIDC→SEC da SUCATA) |
| 12/06/2026 | soma de múltiplas quitações da mesma chave (parcelas subcontadas) |
| 12/06/2026 | OP na chave (safras antigas da IPM) |
| 12/06/2026 | escopo = só vencidos do período do relatório ("apenas vencidos de ontem") |
| 12/06/2026 | SEM filtro de flexibilização (decisão revertida — aparece mesmo em carência) |
| 12/06/2026 | recompra NÃO conta (decisão final, após ida e volta) |
| 12/06/2026 | CHQ removido da whitelist |
| 12/06/2026 | regra do recibo parcial `LIQUIDADO < VALOR_FACE` (parcelas da ARCOLUB) |
| 12/06/2026 | formato final: 1 linha por cedente — `*CEDENTE* - Já estava na cobrança, houve abatimento parcial.` (sem cabeçalho; sem parcial → não envia) |
