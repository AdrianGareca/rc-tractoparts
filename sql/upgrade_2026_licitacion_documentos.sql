-- =============================================================================
-- sql/upgrade_2026_licitacion_documentos.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds `licitacion_documentos`: multi-file attachments (PDF, Word, Excel,
-- images) that Proyectos uploads to a licitación so the delegated commercial
-- executive (and Jefe/SysAdmin) can review them. Requires the licitaciones
-- module (sql/upgrade_2026_licitaciones.sql) to already be applied — this
-- script's FK targets the `licitaciones` table.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: it is
-- additive only.
--
-- ⚠️  Back up the database first (README §16.7), then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_licitacion_documentos.sql
--
-- IDEMPOTENT — safe to run on every environment, and safe to run twice.
-- =============================================================================

-- ── 1. licitacion_documentos (idempotente vía IF NOT EXISTS) ──────────────────
CREATE TABLE IF NOT EXISTS licitacion_documentos (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_licitacion   INT UNSIGNED NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  ruta_archivo    VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  tamano_bytes    INT UNSIGNED NOT NULL,
  id_usuario      INT UNSIGNED DEFAULT NULL,
  nombre_usuario  VARCHAR(50)  DEFAULT NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_licdoc_licitacion (id_licitacion),
  CONSTRAINT fk_licdoc_licitacion
    FOREIGN KEY (id_licitacion) REFERENCES licitaciones (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_licdoc_usuario
    FOREIGN KEY (id_usuario)    REFERENCES usuarios     (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Verificación ────────────────────────────────────────────────────────────
SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'licitacion_documentos';
