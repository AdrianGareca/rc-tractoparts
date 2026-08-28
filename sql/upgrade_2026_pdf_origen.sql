-- =============================================================================
-- sql/upgrade_2026_pdf_origen.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds cotizaciones.pdf_origen ENUM('sistema', 'manual') NOT NULL DEFAULT
-- 'sistema' — distinguishes a PDF that PDFKit generated/regenerated
-- automatically from one an Ejecutivo uploaded by hand (POST /:id/upload or
-- /:id/pdf).
--
-- EL BUG QUE ESTO ARREGLA
-- PUT /api/cotizaciones/:id (updateQuotation) siempre llamaba a
-- regenerateQuotationPdf(), que purga incondicionalmente el pdf_ruta anterior
-- y genera uno nuevo con PDFKit. Sin una forma de distinguir el origen, esto
-- borraba en silencio el PDF corporativo que un ejecutivo había subido a
-- mano cada vez que editaba la cotización — el Excel, en cambio, sí
-- sobrevivía intacto (excel_ruta nunca se toca en el update). Encontrado en
-- la ronda de estrés del 2026-08-26.
--
-- Con esta columna, updateQuotation deja el PDF intacto cuando pdf_origen =
-- 'manual', y sigue regenerando como siempre cuando es 'sistema' (o no hay
-- PDF todavía).
--
-- DEFAULT 'sistema': todas las filas existentes en una base ya en producción
-- tenían su pdf_ruta puesto por regeneración automática (esta columna no
-- existía antes, así que ningún flujo pudo haber marcado nada como
-- 'manual' todavía) — 'sistema' es el valor correcto para el histórico
-- completo, no una aproximación.
--
-- WHY THIS IS NEEDED: sql/init.sql only auto-runs on a FIRST boot (empty
-- db_data volume). A database initialised before this change is missing this
-- column, and the new writeRepository/readRepository queries name it
-- explicitly — MySQL would reject every quotation query with
-- "Unknown column 'pdf_origen' in 'field list'" (ER_BAD_FIELD_ERROR).
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: additive only.
--
-- ⚠️  Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_pdf_origen.sql
--
-- IDEMPOTENT — safe to run on every environment without checking first: the
-- step probes information_schema and only executes the ALTER when the column
-- is absent, so a second run is a no-op.
--
-- ⚠️  Do NOT "simplify" this to `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
-- that clause is a MariaDB extension and is a SYNTAX ERROR (ER_PARSE_ERROR
-- 1064) on real MySQL, which this project runs (`image: mysql:8.0` in
-- docker-compose.yml). The information_schema + PREPARE dance below is the
-- portable MySQL equivalent.
-- =============================================================================

-- ── 1. pdf_origen (idempotent) ────────────────────────────────────────────────
SET @add_pdf_origen := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''pdf_origen ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD COLUMN pdf_origen ENUM(''sistema'', ''manual'') NOT NULL DEFAULT ''sistema''
         COMMENT ''"sistema" = generado/regenerado automaticamente por PDFKit; "manual" = subido a mano via POST /:id/upload o /:id/pdf. Un PDF "manual" nunca se purga ni se regenera automaticamente al editar la cotizacion.''
         AFTER pdf_ruta'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'pdf_origen'
);
PREPARE stmt FROM @add_pdf_origen;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Verificación ───────────────────────────────────────────────────────────
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'cotizaciones'
   AND COLUMN_NAME  = 'pdf_origen';
