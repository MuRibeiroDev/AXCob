# Deploy do AxCob (Docker)

Sobe a stack completa atrás de um proxy nginx na porta **2555**:

```
[browser] →:2555→ [proxy nginx] ─/────→ [frontend SPA]
                       └─/api──→ [backend NestJS] ──HTTP /run──→ [worker Playwright]
                                      │                                 │
                                 axcob-data                       axcob-session
                                 (SQLite)                         (sessão Power BI)
```

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

O compose só dá "up" do proxy depois que backend, frontend e worker ficam **healthy**.
Acesse: `http://<servidor>:2555`

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
docker compose logs -f proxy      # tráfego do proxy
docker compose logs -f backend    # API NestJS
docker compose logs -f worker     # geração de PNG / login Power BI
docker compose ps                 # status + health
docker compose up -d --build      # rebuild após pull
docker compose down               # derruba (mantém volumes/dados)
docker compose down -v            # derruba E APAGA volumes (perde SQLite e sessão PBI)
```

## Dados persistentes (volumes)

- **`axcob-data`** → `/app/data` no backend: SQLite da conciliação PIX e dos relatórios.
- **`axcob-session`** → `/app/session` no worker: sessão do Power BI.

Sobrevivem a `down`/rebuild. Só são apagados com `docker compose down -v`.

## Atualizar uma versão já no ar

```bash
git pull
docker compose up -d --build      # rebuilda só o que mudou e recria os containers
```
