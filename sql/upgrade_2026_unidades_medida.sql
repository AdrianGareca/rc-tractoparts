-- =============================================================================
-- sql/upgrade_2026_unidades_medida.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Alinea el DEFAULT de la columna `unidad` con la lista de unidades de medida
-- que la empresa pidio el 2026-09-01. El desplegable del formulario paso de
-- cuatro opciones a siete:
--
--     JGOS (JUEGOS)   PZA (PIEZAS)   KIT (KITS)   LTS (LITRO)
--     KG (KILO)       UNI (UNIDAD)   MTS (METROS)
--
-- Dos codigos CAMBIARON, no solo se agregaron: los juegos pasaron de `GGO` a
-- `JGOS`, y la unidad de `UND` a `UNI`. El DEFAULT del esquema seguia diciendo
-- 'UND'.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTE SCRIPT NO ES URGENTE (pero conviene correrlo igual)
--
-- La aplicacion NUNCA deja que este DEFAULT actue: el INSERT de
-- cotizacion_detalles nombra `unidad` explicitamente y writeRepository.js
-- garantiza un valor no vacio ('UNI' como respaldo). La tabla `productos` hoy
-- solo se lee, nunca se le inserta. O sea: con o sin este script la aplicacion
-- se comporta igual.
--
-- Se corre igual para que la base de produccion y sql/init.sql no queden
-- diciendo cosas distintas. Esa clase de diferencia no molesta hoy y muerde
-- dentro de un ano, cuando alguien escriba un INSERT que omita la columna y
-- obtenga un resultado en el servidor y otro en una instalacion nueva.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTE SCRIPT NO HACE, A PROPOSITO: tocar las filas ya guardadas
--
-- Las cotizaciones anteriores tienen 'GGO' y 'UND' escritos en la base. Seria
-- facil agregar aca un UPDATE que los reescriba a 'JGOS' y 'UNI' y dejar todo
-- prolijo. NO SE HACE, por dos razones concretas:
--
--   1. Esas cotizaciones ya se enviaron al cliente con un PDF que dice "UND".
--      Si se reescribe la fila, el dia que alguien regenere ese PDF va a decir
--      "UNI" y no va a coincidir con la copia que el cliente tiene en la mano.
--      Es un sistema de documentos comerciales: el historial no se reescribe.
--
--   2. Los reportes agrupan por unidad. Cambiar el dato historico cambia
--      numeros de informes que ya se miraron y se discutieron.
--
-- La columna es VARCHAR libre y no un ENUM justamente para que esos valores
-- viejos sigan siendo validos. El formulario los reconoce: cuando una fila
-- trae una unidad que ya no esta en la lista, la ofrece como opcion propia y
-- marcada, rotulada "(unidad anterior)" — asi se conserva al editar en vez de
-- que se le cambie sola por la primera de la lista. Ver unidadesParaFila() en
-- public/js/views/quotationForm/lineItemsComponent.js.
--
-- ---------------------------------------------------------------------------
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: additivo.
--
-- No reescribe ni una fila y no reconstruye la tabla: ALTER COLUMN ... SET
-- DEFAULT es un cambio de metadatos, instantaneo aun con la tabla llena.
--
-- Back up first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_unidades_medida.sql
--
-- IDEMPOTENT — safe to run on every environment, and safe to run twice
-- (fijar el mismo DEFAULT dos veces es un no-op).
-- =============================================================================

ALTER TABLE cotizacion_detalles
  ALTER COLUMN unidad SET DEFAULT 'UNI';

ALTER TABLE productos
  ALTER COLUMN unidad SET DEFAULT 'UNI';

-- ── Verificacion ────────────────────────────────────────────────────────────
-- Las dos filas deben mostrar COLUMN_DEFAULT = UNI.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME  = 'unidad'
 ORDER BY TABLE_NAME;

-- Cuantas filas conservan los codigos anteriores. NO es un problema: es lo
-- esperado, y el formulario las respeta. Sirve para saber que tan seguido se
-- va a ver el rotulo "(unidad anterior)" al editar.
SELECT unidad, COUNT(*) AS filas
  FROM cotizacion_detalles
 GROUP BY unidad
 ORDER BY filas DESC;
