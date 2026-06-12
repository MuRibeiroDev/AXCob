# Pagamentos Parciais — Especificação de implementação (como REALIZAR o relatório)

> Companheiro técnico do `docs/relatorio-pagamentos-parciais.md` (que explica as
> regras de negócio e o porquê de cada decisão). **Este** documento descreve o
> passo a passo completo pra executar/reimplementar o relatório, com todas as
> particularidades e armadilhas conhecidas dos dados.

---

## 1. Visão geral do fluxo

```
[1] Botão "Gerar" do card Títulos Abertos — Geral (tela Relatórios)
        │  worker Playwright roda powerbi_abertos.py --dump-cedentes
        │  → captura o PNG do BI E lê a coluna CEDENTE da tabela (mesmo estado do print)
        ▼
[2] Backend recebe { images, cedentes } do worker
        │  → salva PNG no store · loga "CEDENTES titulos_abertos_geral (N): ..."
        │  → guarda a lista de cedentes EM MEMÓRIA (campo cedentesAbertosGeral)
        ▼
[3] Botão "Enviar relatórios" (WhatsApp)
        │  → monta a sequência fixa (quitados/vencidos por plataforma + comissárias)
        │  → ÚLTIMO passo: textoParciais()
        │       → calcularParciais(cedentes)  ← cruzamento SQL (seção 3)
        │       → mensagem (seção 5) ou null (não envia)
        ▼
[4] WhatsApp do usuário logado (contact_phone da users_qitech)
```

Código:
- `backend/src/relatorios/relatorios.service.ts` → `calcularParciais()`, `textoParciais()`, hooks em `runPngViaWorker()`/`runPngLocal()` e `enviarSequencia()`
- `scripts/powerbi_abertos.py` → flag `--dump-cedentes`
- `scripts/report_worker.py` → devolve `"cedentes"` na resposta do `/run`
- Teste manual (mesma lógica, só leitura): `node backend/scripts/teste-parciais.cjs [--inicio DD/MM/AAAA --fim DD/MM/AAAA]`

## 2. Entradas e pré-requisitos

| Entrada | De onde vem | Particularidade |
|---|---|---|
| Lista de cedentes | coluna CEDENTE do print Geral | extraída do DOM do BI (coluna congelada = `role="rowheader"`); o WORKER devolve na resposta HTTP porque **não há filesystem compartilhado** entre containers |
| Cache da lista | memória do backend (`cedentesAbertosGeral`) | **zera quando o backend reinicia** → é preciso gerar o Geral de novo antes de enviar. Fallback (apenas dev local): `scripts/print_abertos.cedentes.txt` |
| Carência (não usada hoje) | `encargos.juros_multa.flexibilizacao_dias` | a regra de flexibilização foi REMOVIDA por decisão de 12/06/2026 — mantida aqui só como referência histórica |

## 3. O cruzamento SQL, passo a passo

### 3.1 Período (janela do relatório)
- `vencsNoPrazo(hojeLocal())` de `backend/src/relatorios/dias-uteis.ts`:
  **último dia útil anterior a hoje + dias não-úteis "órfãos" imediatamente anteriores**.
  - Ex.: sexta 12/06 → janela = 11/06..11/06.
  - Ex.: segunda após feriado na quinta → janela = quinta(feriado)..sexta.
- Feriados: lib `date-holidays('BR')`, tipos `public` + `optional` (Corpus Christi, Carnaval...) — **igual ao script Python do print** (têm que andar juntos).

### 3.2 Seleção dos títulos em aberto
```sql
SELECT DOCUMENTO, CEDENTE, CPF_CNPJ_SACADO→dígitos, CPF_CNPJ_CEDENTE→dígitos,
       SISTEMA, OP, CAST(VALOR AS float)
FROM data_core.vw_titulos_abertos
WHERE VENCIMENTO BETWEEN @ini AND @fim          -- janela da seção 3.1
  AND M = 'C'                                   -- tipo de boleto C
  AND TIPO IN ('CCB','CTR','DMR','DSR','NCO','NPP','CPR')  -- SEM CHQ
  AND UPPER(LTRIM(RTRIM(CEDENTE))) IN (@c0,@c1,...)         -- cedentes do print
```
Particularidades:
- nomes de cedente casados por **texto** (UPPER/trim) — o BI e a view usam a mesma origem, então bate; cuidado com espaços extras (por isso o TRIM);
- consultas em **lotes** (200 cedentes / 500 documentos por query) — limite de parâmetros do SQL Server;
- `useUTC: false` no pool mssql — sem isso as datas `date` deslocam 1 dia (bug clássico já corrigido no projeto).

### 3.3 Busca das quitações
```sql
SELECT NUMERO, CPF_CNPJ_SACADO→dígitos, CPF_CNPJ_CEDENTE→dígitos, SISTEMA, OP,
       CAST(VALOR_FACE AS float), CAST(LIQUIDADO AS float)
FROM data_core.vw_titulos_quitados
WHERE TIPO IN (mesma whitelist)
  AND SITUACAO NOT LIKE 'Recomprado%'
  AND SITUACAO NOT LIKE 'Repassado%'            -- recompra/repasse NÃO é pagamento
  AND NUMERO IN (@n0,@n1,...)
```

### 3.4 Filtros em código sobre cada recibo de quitação
1. `OP` vazia/nula → **descarta** (sem operação não há como amarrar; linhas de tarifa costumam vir sem OP);
2. **Recibo parcial**: `LIQUIDADO < 99% do VALOR_FACE` → senão **descarta**
   (baixa integral de parcela com o mesmo número não é pagamento parcial — tolerância de 1% evita falso parcial por arredondamento/desconto de centavos).

### 3.5 Chave do match (5 campos, todos obrigatórios)
```
numero | cnpjCedente(dígitos) | cnpjSacado(dígitos) | SISTEMA(upper/trim) | OP(dígitos)
```
Recibos que passam nos filtros são **somados por chave** (pagamentos em várias vezes).
Título em aberto é "parcial" se a sua chave existe no índice (dedupe por chave —
várias linhas abertas do mesmo título não contam o liquidado 2×).

### 3.6 Agregação por cedente
- `VENCIDO` = soma da face (`VALOR`) de **todos** os títulos do cedente no escopo (seção 3.2);
- `QUITADO` = soma do liquidado parcial dos títulos com match;
- `qtd` = nº de chaves com pagamento;
- entram na mensagem só cedentes com `QUITADO > 0`, ordenados por `VENCIDO` desc.

## 4. Particularidades dos DADOS (armadilhas reais já encontradas)

| # | Armadilha | Exemplo real | Como a regra trata |
|---|---|---|---|
| 1 | Número de título se repete entre sacados/cedentes (`001`, `245-003`) | SUCATA/MUNDIAL/IBO/CRM | CNPJs na chave |
| 2 | Rolagem entre veículos: quitado no FIDC e relançado na SEC com o mesmo número (recompra com garantia) | SUCATA `13568/04` (R$2,5M) | SISTEMA na chave |
| 3 | Número CPF/parcela reaproveitado em safras (anos) diferentes | IPM `021.967.990-84/5` (quitações de 2024/2025 × título de 2026) | OP na chave |
| 4 | Parcelas/reapresentações com o MESMO número e vencimentos diferentes — pagas integrais + uma em aberto | ARCOLUB `000769833` (3 parcelas) | regra do recibo parcial (3.4.2) |
| 5 | Recompra pelo cedente parece pagamento | ARCOLUB `000771952` | SITUACAO NOT LIKE Recomprado/Repassado |
| 6 | Parcial verdadeiro com saldo RELANÇADO com vencimento novo (match por vencimento mataria) | IMPACTPVA `4029-001` (pagou R$515k de R$1,02M; saldo venc novo) | por isso NÃO se usa vencimento na chave |
| 7 | Parcela paga com atraso tem `LIQUIDADO > FACE` (juros) | ARCOLUB Welton (face 253, liq 268) | continua integral → descartada corretamente |
| 8 | Linhas de tarifa (`TAR`, "Tarifa automatica por atraso") com o mesmo número | IMPACTPVA `4029-001` (R$40,47) | whitelist de TIPO + OP nula |
| 9 | `vw_op_detalhado_por_titulo` parece a "fonte geral", mas o VALOR é a face de ORIGEM e a SITUACAO fica defasada | ARCOLUB parcelas constavam "Aberto" após pagas | NÃO usar essa view p/ posição do dia |
| 10 | Quitação parcial legítima costuma fechar a conta ao centavo: `face_aberta = FACE_quitada − LIQUIDADO` | ESCOLA (5.789−3.689,33=2.099,67), IMPACTPVA | usado como prova de validação (não como filtro) |

## 5. Saída

- **Formato** (um por linha, sem cabeçalho, ordenado por vencido desc):
  ```
  *CEDENTE* - Já estava na cobrança, houve abatimento parcial.
  ```
- **Sem nenhum parcial** → `textoParciais()` retorna `null` e **nada é enviado**.
- Valores detalhados ficam no **log** (`PARCIAIS: período ... | títulos abertos no período: N`,
  `PARCIAIS <id> (N cedente(s)): CEDENTE - TOTAL VENCIDO ... - TOTAL QUITADO ... - N título(s)`)
  e no `scripts/print_abertos.parciais.txt` (gerado na análise pós-print).

## 6. Runbook (operação do dia a dia)

1. Gerar o **Títulos Abertos — Geral** na tela Relatórios (repopula a lista de cedentes — obrigatório após restart do backend).
2. Clicar **Enviar relatórios** → a mensagem de parciais sai por último.
3. Conferência manual a qualquer momento:
   `node backend/scripts/teste-parciais.cjs` (usa o último `print_abertos.cedentes.txt`; aceita `--inicio/--fim` p/ simular outras janelas).

### Troubleshooting — "o cedente X não apareceu, por quê?"
Checar nesta ordem (o script de teste mostra cada etapa):
1. X está na lista do print Geral? (log `CEDENTES titulos_abertos_geral`)
2. O título venceu **dentro da janela** (último dia útil)? Parcial antigo não entra.
3. TIPO está na whitelist (sem CHQ) e boleto é `C`?
4. O recibo em quitados tem **OP**? E os CNPJs/sistema/OP batem com a linha aberta?
5. A quitação é **parcial** (`liq < 99% face`)? Parcela paga inteira não conta.
6. A SITUACAO é Recomprado/Repassado? Então foi o cedente, não conta.

### "Apareceu um cedente que não devia"
Provável nova variação de dado não mapeada — rodar o teste com `--inicio/--fim`
do dia, olhar o bloco DETALHE (mostra doc, OP, face, pago, situação) e comparar
com as armadilhas da seção 4. Documentar o caso novo nos dois .md.

## 7. Dependências/observações de infraestrutura

- **Docker**: backend ↔ worker se falam só por HTTP; a lista de cedentes viaja na resposta do `/run` (campo `cedentes`). Sem volume compartilhado.
- **Cache em memória**: restart do backend exige regenerar o Geral antes do envio (senão a sequência sai SEM a mensagem de parciais + warn no log).
- **Logs**: `docker logs axcob-backend` — procurar por `CEDENTES` e `PARCIAIS`.
- Falha em qualquer ponto da análise **nunca** interrompe a geração do PNG nem a sequência de envio (try/catch com warn).
