-- =============================================================================
-- sql/upgrade_2026_fecha_confirmacion.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds cotizaciones.fecha_confirmacion (sale-closure timestamp) and backfills
-- it for quotations that were ALREADY 'Confirmada' before this column existed,
-- recovering the real closure moment from cotizacion_historial_estados.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that script
-- DROPs and recreates everything. Run THIS script instead: it is additive only.
--
-- ⚠️  Run ONCE. Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_fecha_confirmacion.sql
--
-- If it was already applied, step 1 will report "Duplicate column name" — that
-- is harmless (it just means the column already exists); step 2 is always safe
-- to re-run because it only touches rows whose fecha_confirmacion is still NULL.
-- =============================================================================

-- ── 1. Add the sale-closure timestamp column ─────────────────────────────────
ALTER TABLE cotizaciones
  ADD COLUMN fecha_confirmacion DATETIME NULL DEFAULT NULL AFTER fecha_aprobacion;

-- ── 2. Backfill historical closures from the state-history table ─────────────
-- For every quotation currently 'Confirmada' (or its legacy alias 'Aceptada')
-- whose fecha_confirmacion is still NULL, recover the real timestamp of the
-- transition into that state. MAX(creado_en) picks the most recent confirmation
-- event in case a quotation was confirmed more than once across its lifecycle.
UPDATE cotizaciones c
JOIN (
  SELECT id_cotizacion, MAX(creado_en) AS ts
    FROM cotizacion_historial_estados
   WHERE estado_nuevo IN ('Confirmada', 'Aceptada')
   GROUP BY id_cotizacion
) h ON h.id_cotizacion = c.id
SET c.fecha_confirmacion = h.ts
WHERE c.estado IN ('Confirmada', 'Aceptada')
  AND c.fecha_confirmacion IS NULL;

-- ── 3. Verification (optional) — review after running ────────────────────────
-- SELECT id, numero_correlativo, estado, fecha_confirmacion
--   FROM cotizaciones
--  WHERE estado IN ('Confirmada', 'Aceptada')
--  ORDER BY fecha_confirmacion DESC;
