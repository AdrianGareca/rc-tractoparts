-- =============================================================================
-- sql/upgrade_2026_delegacion_ampliada.sql
-- COSMETIC-ONLY upgrade for an ALREADY-RUNNING database. No data change.
--
-- Documents the widened semantics of usuarios.can_approve_quotations:
-- the flag now grants a delegated Ejecutivo the FULL quotation lifecycle
-- (aprobar, enviar, confirmar, solicitar cambios, en espera, rechazar) using
-- the Jefe's transition matrix — quotations only, no admin access.
--
-- The column itself already exists with the right type/default; this MODIFY
-- only rewrites its COMMENT. Safe to run multiple times.
--
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_delegacion_ampliada.sql
-- =============================================================================

ALTER TABLE usuarios
  MODIFY COLUMN can_approve_quotations TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Delegación de Funciones AMPLIADA: 1 = un Ejecutivo opera el ciclo de vida completo de cotizaciones con la matriz del Jefe (aprobar, enviar, confirmar, solicitar cambios, en espera, rechazar). No otorga acceso administrativo (usuarios/auditoría). Settable only by Jefe/Administracion/SysAdmin.';
