-- =============================================================================
-- sql/upgrade_2026_avisos_rechazo_espera.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Agrega dos tipos de aviso a notificaciones.tipo: 'rechazo' y 'en_espera'.
--
-- POR QUE
-- Hasta el 2026-09-28 el ejecutivo recibia aviso cuando el Jefe le aprobaba,
-- le enviaba o le confirmaba una cotizacion, y cuando le pedian cambios. Pero
-- cuando se la RECHAZABAN o la ponian EN ESPERA no le llegaba nada: se enteraba
-- solo si la buscaba en el listado.
--
-- QUE PASA SI EL CODIGO NUEVO CORRE ANTES QUE ESTE SCRIPT
-- Nada grave. Guardar un aviso nunca puede hacer fallar el cambio de estado
-- (stateTransitionEffects.js lo envuelve en try/catch): la cotizacion cambia
-- igual y ese aviso puntual se pierde con un warning en el log. Aun asi,
-- conviene correr este script ANTES o junto con el despliegue.
--
-- ES INSTANTANEO
-- Agregar valores AL FINAL de un ENUM es un cambio solo de metadatos en MySQL 8:
-- no reescribe la tabla ni la bloquea.
--
-- IDEMPOTENTE: si 'rechazo' ya esta en el ENUM, no hace nada.
--
-- Uso:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_avisos_rechazo_espera.sql
-- =============================================================================

SET @add_tipos_aviso := (
  SELECT IF(
    LOCATE('rechazo', COLUMN_TYPE) > 0,
    'SELECT ''notificaciones.tipo ya incluye rechazo y en_espera — omitido'' AS resultado',
    'ALTER TABLE notificaciones
       MODIFY COLUMN tipo ENUM(''correccion'',''aprobacion'',''envio_cliente'',''licitacion'',''rechazo'',''en_espera'')
         NOT NULL DEFAULT ''aprobacion'''
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND COLUMN_NAME  = 'tipo'
);
PREPARE stmt FROM @add_tipos_aviso;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verificacion: debe mostrar los seis valores.
SELECT COLUMN_TYPE AS tipos_de_aviso
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'notificaciones'
   AND COLUMN_NAME  = 'tipo';
