-- ============================================================================
-- AxCob — schema `axcob` no Azure SQL (banco audaxcapitalfree)
-- Move p/ o SQL Server o que hoje vive em SQLite local:
--   axcob.relatorio_png   (era relatorios.db / relatorio_png)
--   axcob.pix_conciliacao (era pix-conciliacao.db / pix_conciliacao)
--
-- RODAR COMO ADMIN/DBA (os usuários do app não têm permissão de DDL).
-- Ao final, concede CRUD ao usuário da aplicação ("axcob").
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'axcob')
    EXEC('CREATE SCHEMA axcob AUTHORIZATION dbo');
GO

IF OBJECT_ID('axcob.relatorio_png', 'U') IS NULL
CREATE TABLE axcob.relatorio_png (
    id         NVARCHAR(64)   NOT NULL,
    parte      INT            NOT NULL,
    dia        CHAR(10)       NOT NULL,   -- yyyy-mm-dd
    png        VARBINARY(MAX) NOT NULL,
    criado_em  VARCHAR(40)    NOT NULL,   -- ISO 8601
    CONSTRAINT PK_axcob_relatorio_png PRIMARY KEY (id, parte)
);
GO

IF OBJECT_ID('axcob.pix_conciliacao', 'U') IS NULL
CREATE TABLE axcob.pix_conciliacao (
    card_id    NVARCHAR(64)  NOT NULL,
    titulo     NVARCHAR(400) NOT NULL,
    resultado  NVARCHAR(MAX) NOT NULL,   -- JSON do resultado da conciliação
    criado_em  VARCHAR(40)   NOT NULL,
    CONSTRAINT PK_axcob_pix_conciliacao PRIMARY KEY (card_id)
);
GO

-- Permissões do usuário da aplicação (ajuste o nome se o login do app for outro).
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::axcob TO [axcob];
GO
