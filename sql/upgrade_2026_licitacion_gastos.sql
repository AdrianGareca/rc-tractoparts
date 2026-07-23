-- =============================================================================
-- sql/upgrade_2026_licitacion_gastos.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds `licitacion_gastos`: operating expenses (transport, shipping, travel…)
-- charged to an ADJUDICATED licitación for the profit/loss analysis:
--   Resultado = Σ(linked approved/confirmed cotizaciones)  −  Σ(gastos)
-- Recorded by Administracion + the Proyectos responsable (and Jefe/SysAdmin).
-- Requires the licitaciones module (sql/upgrade_2026_licitaciones.sql) applied.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: additive only.
--
-- ⚠️  Back up first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_licitacion_gastos.sql
--
-- IDEMPOTENT — safe to run on every environment, and safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS licitacion_gastos (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  id_licitacion   INT UNSIGNED  NOT NULL,
  concepto        VARCHAR(200)  NOT NULL,
  monto           DECIMAL(15,2) NOT NULL,
  moneda          CHAR(3)       NOT NULL DEFAULT 'BOB',
  id_usuario      INT UNSIGNED  DEFAULT NULL,
  nombre_usuario  VARCHAR(50)   DEFAULT NULL,
  creado_en       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_licgasto_licitacion (id_licitacion),
  CONSTRAINT fk_licgasto_licitacion
    FOREIGN KEY (id_licitacion) REFERENCES licitaciones (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_licgasto_usuario
    FOREIGN KEY (id_usuario)    REFERENCES usuarios     (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Verificación ────────────────────────────────────────────────────────────
SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'licitacion_gastos';
