# backend/scripts

Utilitários de linha de comando para inspeção do banco (não fazem parte da API).
Rodam com Node e leem as credenciais do `backend/.env` (mesma base da API).

## Uso

```bash
# Lista as colunas e 1 linha de amostra de uma view/tabela
node scripts/listar-colunas.cjs <schema.objeto>
# ex.: node scripts/listar-colunas.cjs data_core.vw_titulos_abertos

# Executa um SELECT ad-hoc
node scripts/sql.cjs "SELECT TOP 5 * FROM data_core.vw_cedentes"
```

> Apenas ferramentas de diagnóstico — scripts de teste/one-off ficam fora daqui.
