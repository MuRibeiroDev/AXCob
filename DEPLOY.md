# Deploy do AxCob (Docker)

Sobe a stack na porta **2555** (frontend nginx serve o SPA e proxia `/api`):

```
[browser] →:2555→ [frontend nginx]  ─/────→ SPA estático
                        └─/api──────→ [backend NestJS] ──HTTP /run──→ [worker Playwright]
                                           │                                 │
                                     Azure SQL                         axcob-session
                                  (schema axcob)                       (sessão Power BI)
```

> Relatórios (PNG) e conciliação PIX são persistidos no **Azure SQL** (schema `axcob`),
> não em SQLite local. O único volume é `axcob-session` (sessão do Power BI no worker).

## Pré-requisitos no servidor

- **Docker + Docker Compose v2** (`docker compose version`).
- **Rede**: o servidor precisa alcançar os bancos configurados no `.env`:
  - Azure SQL (`DB_HOST`, público) e o banco interno `SMART_HOST` (IP de rede interna —
    confirme que o servidor está na mesma rede/VPN, senão o login falha).
- Acesso à internet para baixar as imagens base (Node, nginx, Playwright).

## 1. Obter o código

```bash
git clone <repo> AxCob   # ou: cd AxCob && git pull
cd AxCob
```

## 2. Criar o `.env` (NÃO vem pelo git)

O `.env` tem segredos e está no `.gitignore` — ele **não** é versionado. No servidor:

```bash
cp .env.example .env
# edite .env e preencha credenciais reais (DB, SMART/JWT, Bitrix, OpenAI, Evolution,
# POWERBI_USERNAME/POWERBI_PASSWORD)
```

Alternativa: transferir o `.env` da máquina de origem por canal seguro (ex.: `scp`),
nunca por git/e-mail/chat.

## 3. Subir

```bash
docker compose up -d --build
```

O frontend só sobe depois que o backend fica **healthy**. Acesse: `http://<servidor>:2555`

## 4. Power BI (relatórios)

Na primeira geração de relatório, o worker faz **login automático** no Power BI usando
`POWERBI_USERNAME`/`POWERBI_PASSWORD` e **persiste a sessão** no volume `axcob-session`.
As execuções seguintes reaproveitam a sessão (renovada a cada run) — não reloga a cada
relatório. Conta sem MFA.

> Se a conta passar a exigir MFA, o login automático não conclui; nesse caso, gere a
> sessão manualmente numa máquina e copie para o volume:
> `docker cp .powerbi_session.json axcob-worker:/app/session/.powerbi_session.json`

## Comandos úteis

```bash
docker compose logs -f frontend   # SPA + proxy /api (entrada na 2555)
docker compose logs -f backend    # API NestJS
docker compose logs -f worker     # geração de PNG / login Power BI
docker compose ps                 # status + health
docker compose up -d --build      # rebuild após pull
docker compose down               # derruba (mantém volumes/dados)
docker compose down -v            # derruba E APAGA volumes (perde a sessão do Power BI)
```

## Persistência

- **Relatórios (PNG) e conciliação PIX** → **Azure SQL**, schema `axcob`
  (tabelas `axcob.relatorio_png` e `axcob.pix_conciliacao`). Nada em disco local.
- **`axcob-session`** (volume) → `/app/session` no worker: sessão do Power BI.
  Sobrevive a `down`/rebuild; só some com `docker compose down -v`.

> O schema/tabelas em `axcob` precisam existir no banco. SQL em
> [backend/scripts/axcob-schema.sql](backend/scripts/axcob-schema.sql) (rodar como DBA),
> ou via `node backend/scripts/create-axcob-schema.cjs` com um usuário que tenha DDL.

## Atualizar uma versão já no ar

```bash
git pull
docker compose up -d --build      # rebuilda só o que mudou e recria os containers
```
