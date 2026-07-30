-- =============================================================================
-- sql/upgrade_2026_indices_bitacora.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Agrega dos índices a bitacora_auditoria. La tabla se creó con PRIMARY KEY (id)
-- y nada más (el índice de id_usuario lo puso sola la foreign key), así que las
-- dos consultas que la leen hacían un escaneo COMPLETO de la tabla:
--
--   1. La pestaña "Registros de Auditoría"
--        ... ORDER BY creado_en DESC, id DESC LIMIT 25
--      Sin índice por fecha, MySQL lee la tabla entera y la ordena en memoria
--      (o en disco) para mostrar 25 filas.
--
--   2. La línea de tiempo de CADA cotización y CADA licitación
--        WHERE entidad = 'cotizaciones' AND id_entidad = ?
--          AND accion = 'CREAR_COTIZACION' AND resultado = 'exito' LIMIT 1
--      Un escaneo completo para encontrar UNA fila, cada vez que alguien abre
--      el detalle de una cotización.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE
-- bitacora_auditoria es de sólo-agregar y NUNCA se purga: escribe una fila en
-- cada login, cada login fallido, cada cambio de estado, cada PDF generado o
-- descargado, cada alta y cada edición. Hoy son miles de filas y no se nota.
-- El costo de un escaneo completo crece en línea recta con el uso, así que el
-- problema aparece solo, de a poco, y el día que moleste va a ser el día en que
-- la tabla ya sea grande — justo cuando agregar un índice cuesta más.
--
-- POR QUÉ SÓLO DOS ÍNDICES
-- Cada índice hace más lento cada INSERT, y en esta tabla se inserta todo el
-- tiempo. Estos dos cubren las dos consultas reales que existen. Filtrar por
-- acción o por usuario en la pestaña de auditoría es ocasional y se resuelve
-- bien apoyándose en el índice de fecha, así que no se agregan más.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: it is
-- additive only.
--
-- ⚠️  Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_indices_bitacora.sql
--
-- IDEMPOTENT — cada índice consulta information_schema antes y sólo se crea si
-- falta, así que correrlo dos veces no hace nada la segunda.
--
-- ⚠️  Do NOT "simplify" this to `CREATE INDEX IF NOT EXISTS`: esa cláusula es
-- una extensión de MariaDB y en MySQL real (`image: mysql:8.0` en
-- docker-compose.yml) es un ERROR DE SINTAXIS 1064. El baile con
-- information_schema + PREPARE de abajo es el equivalente portable.
-- =============================================================================

-- ── 1. Listado de la pestaña de auditoría ────────────────────────────────────
-- (creado_en, id) en ese orden: MySQL recorre el índice HACIA ATRÁS para
-- resolver `ORDER BY creado_en DESC, id DESC` sin ordenar nada, y `id` como
-- segunda columna desempata dos eventos del mismo segundo de forma estable
-- (sin eso, dos filas con el mismo DATETIME pueden alternar de orden entre
-- páginas y hacer que un registro aparezca dos veces o ninguna al paginar).
SET @idx_creado := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_bitacora_creado ya existe — omitido'' AS resultado',
    'ALTER TABLE bitacora_auditoria
       ADD INDEX idx_bitacora_creado (creado_en, id)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bitacora_auditoria'
    AND INDEX_NAME   = 'idx_bitacora_creado'
);
PREPARE stmt FROM @idx_creado;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Evento de creación en la línea de tiempo ──────────────────────────────
-- (entidad, id_entidad, accion) sigue el orden de la consulta y es muy
-- selectivo: de un escaneo de la tabla entera se pasa a leer una o dos filas.
-- `resultado` queda afuera a propósito — con las tres primeras ya se llega a
-- un puñado de filas, y sumar una cuarta columna de dos valores posibles
-- engorda el índice sin descartar prácticamente nada.
SET @idx_entidad := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_bitacora_entidad ya existe — omitido'' AS resultado',
    'ALTER TABLE bitacora_auditoria
       ADD INDEX idx_bitacora_entidad (entidad, id_entidad, accion)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bitacora_auditoria'
    AND INDEX_NAME   = 'idx_bitacora_entidad'
);
PREPARE stmt FROM @idx_entidad;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Verificación (opcional, para correr a mano) ───────────────────────────────
-- SHOW INDEX FROM bitacora_auditoria;
--
-- EXPLAIN SELECT id FROM bitacora_auditoria
--   ORDER BY creado_en DESC, id DESC LIMIT 25;
--   -- esperado: type=index, key=idx_bitacora_creado, SIN "Using filesort"
--
-- EXPLAIN SELECT id FROM bitacora_auditoria
--   WHERE entidad='cotizaciones' AND id_entidad=1
--     AND accion='CREAR_COTIZACION' AND resultado='exito' LIMIT 1;
--   -- esperado: type=ref, key=idx_bitacora_entidad
