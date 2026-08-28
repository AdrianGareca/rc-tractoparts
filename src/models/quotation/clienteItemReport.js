// =============================================================================
// src/models/quotation/clienteItemReport.js
// Reporte cliente x codigo de item x cantidad.
//
// QUE RESPONDE
// Que repuestos consume cada cliente y en que cantidad. Sirve para stockear con
// criterio y para ir a buscar al cliente antes de que pida.
//
// POR QUE VA EN UN ARCHIVO APARTE
// Es el primer reporte que baja al nivel de LINEA. Todo lo que hay en
// analyticsRepository.js agrega sobre la cabecera de la cotizacion (montos por
// ejecutivo, por cliente, por estado); esto agrupa cotizacion_detalles, con sus
// propias reglas de negocio. Meterlo ahi habria mezclado dos niveles de
// agregacion en un archivo que ya es largo.
//
// LAS TRES REGLAS QUE HACEN QUE LOS NUMEROS SEAN CORRECTOS
//
//   1. UN CODIGO, NO DOS. El codigo del repuesto vive en dos lados: el catalogo
//      (id_producto -> productos.codigo) o escrito a mano en la linea
//      (codigo_parte). El mismo repuesto entra por un camino o por el otro
//      segun como lo cargo cada ejecutivo. Se unifican con COALESCE, igual que
//      hace el PDF de la proforma. Sin eso, el mismo repuesto sale partido en
//      dos filas y las dos cantidades estan mal.
//
//   2. SUMAR TAMBIEN DENTRO DE LA COTIZACION. El esquema de cotizacion_detalles
//      dice explicitamente que no hay restriccion unica sobre codigo_parte y
//      que juntar lineas iguales es una regla que se aplica del lado del
//      navegador. O sea: el mismo codigo PUEDE estar repetido en la misma
//      cotizacion, y hay que sumarlo.
//
//   3. NO SUMAR ENTRE UNIDADES. Sumar 5 UND con 3 KG da 8 de nada. Se agrupa
//      tambien por unidad: en el caso normal (un codigo, una unidad) no cambia
//      nada, y cuando los datos vienen sucios lo muestra en vez de esconderlo.
//
// LO QUE DELIBERADAMENTE NO HACE: sumar plata. Un cliente puede tener
// cotizaciones en USD y en Bs., y un SUM(subtotal) sobre las dos daria un
// numero sin significado. Es el mismo error que ya se corrigio en el calculo de
// gastos de licitaciones. Si alguna vez hace falta el monto, tiene que ir
// desglosado por moneda, nunca sumado.
// =============================================================================

'use strict';

const { pool } = require('../../config/db');

// Columnas por las que se puede ordenar. Whitelist estricta: el valor entra
// concatenado en el ORDER BY (no se puede parametrizar), asi que cualquier
// cosa fuera de esta lista es inyeccion.
// Hay DOS vistas sobre los mismos datos, y cada una admite ordenes distintos:
//
//   'detalle' — una fila por (ejecutivo, cliente, codigo, marca, unidad).
//               Contesta «que le cotizo cada vendedor a cada cliente».
//
//   'item'    — una fila por (codigo, marca, unidad), sumando entre TODOS los
//               clientes y vendedores. Contesta la pregunta de compras:
//               «¿este repuesto se pide lo suficiente como para traer un lote?».
//               Ahi «cuantos clientes distintos lo pidieron» importa tanto como
//               la cantidad: 20 unidades entre 5 clientes es mejor candidato a
//               stock que 20 que pidio uno solo y quizas no repita.
//
// ORDEN POR DEFECTO: LA FECHA, NO LA CANTIDAD.
// Ordenar por cantidad ordena por importancia, pero la gente BUSCA por cuando
// («esto lo cotice la semana pasada»). Con el orden por cantidad, lo recien
// cotizado cae en cualquier lugar de la lista y parece que no esta — que fue
// literalmente lo que reporto ventas al probarlo. La cantidad queda a un clic
// de distancia y desempata dentro de una misma fecha.
const SORTABLE = {
  detalle: {
    fecha:     'ultima_vez',
    cantidad:  'cantidad_total',
    cliente:   'cliente_nombre',
    ejecutivo: 'ejecutivo_nombre',
    codigo:    'codigo',
    marca:     'marca_nombre',
    items:     'cotizaciones',
  },
  item: {
    fecha:    'ultima_vez',
    cantidad: 'cantidad_total',
    codigo:   'codigo',
    marca:    'marca_nombre',
    items:    'cotizaciones',
    clientes: 'clientes',
  },
};

const MODOS = ['detalle', 'item'];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT     = 200;

// El codigo efectivo de la linea: catalogo primero, escrito a mano despues.
// NULLIF descarta los strings vacios, que no son un codigo aunque no sean NULL.
const CODIGO_SQL = "COALESCE(NULLIF(p.codigo, ''), NULLIF(d.codigo_parte, ''))";

// ---------------------------------------------------------------------------
// LA CLAVE DE AGRUPACION, Y POR QUE NO ES EL TEXTO TAL CUAL
//
// Ventas reporto que «los items salen 1x1»: el mismo repuesto repartido en
// varias filas. Agrupar por el texto crudo lo provoca de tres maneras:
//
//   1. ZZ-500, zz 500 y ZZ.500 son el MISMO repuesto para cualquiera que
//      trabaje en el mostrador, y tres cadenas distintas para un GROUP BY.
//      Cada ejecutivo teclea el numero de parte a su manera.
//   2. El mismo codigo cargado una vez CON marca y otra SIN marca daba dos
//      filas, porque la marca formaba parte de la clave.
//   3. Las lineas sin codigo se agrupaban por la descripcion EXACTA, y una
//      descripcion escrita a mano casi nunca sale igual dos veces
//      («Manguera hidraulica 1/2» contra «MANGUERA  HIDRAULICA 1/2»).
//
// LA NORMALIZACION, Y SU LIMITE
// Del codigo se descarta TODO lo que no sea letra o numero: separadores,
// espacios y puntuacion son ruido de tecleo, no informacion. Lo que queda
// (ZZ500) es el numero de parte de verdad.
//
// Es deliberadamente conservador con lo demas: NO junta por descripcion
// parecida ni por prefijo. Dos codigos genuinamente distintos siguen en filas
// distintas — mezclar repuestos que no son el mismo seria mucho peor que
// mostrarlos separados, porque llevaria a comprar stock equivocado.
//
// El codigo que se MUESTRA es el original mas largo del grupo, no la version
// normalizada: en pantalla tiene que verse el numero de parte como se escribe,
// no ZZ500.
// ---------------------------------------------------------------------------
const CODIGO_NORM_SQL = `UPPER(REGEXP_REPLACE(${CODIGO_SQL}, '[^a-zA-Z0-9]', ''))`;

// Para las lineas sin codigo: la descripcion sirve de clave, pero colapsando
// espacios repetidos y sin distinguir mayusculas.
const DESC_NORM_SQL = "UPPER(TRIM(REGEXP_REPLACE(d.descripcion_item, '[[:space:]]+', ' ')))";

// ---------------------------------------------------------------------------
// _where — construye el WHERE parametrizado.
// ---------------------------------------------------------------------------
function _where(filtros = {}) {
  const cond   = [];
  const params = [];

  if (filtros.fecha_desde) {
    cond.push('c.fecha_emision >= ?');
    params.push(filtros.fecha_desde);
  }
  if (filtros.fecha_hasta) {
    cond.push('c.fecha_emision <= ?');
    params.push(filtros.fecha_hasta);
  }
  if (filtros.estado) {
    cond.push('c.estado = ?');
    params.push(filtros.estado);
  }
  if (filtros.id_cliente) {
    cond.push('c.id_cliente = ?');
    params.push(parseInt(filtros.id_cliente, 10));
  }
  // Un ejecutivo mirando "lo mio": mismo reporte, acotado a sus cotizaciones.
  if (filtros.id_ejecutivo) {
    cond.push('c.id_ejecutivo = ?');
    params.push(parseInt(filtros.id_ejecutivo, 10));
  }
  // Busqueda libre: alcanza con escribir el codigo O el nombre del cliente.
  if (filtros.q && String(filtros.q).trim()) {
    const like = `%${String(filtros.q).trim()}%`;
    cond.push(`(cl.razon_social LIKE ? OR ${CODIGO_SQL} LIKE ? OR d.descripcion_item LIKE ?)`);
    params.push(like, like, like);
  }

  return { clause: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

// ---------------------------------------------------------------------------
// La proyeccion linea por linea, ANTES de agrupar.
//
// POR QUE HAY UNA SUBCONSULTA Y NO UN SOLO SELECT
// MySQL corre con sql_mode=only_full_group_by, que exige que cada columna no
// agregada del SELECT este LITERALMENTE en el GROUP BY — no le alcanza con que
// sea equivalente. Agrupar por COALESCE(codigo, descripcion) y a la vez
// seleccionar `codigo` a secas lo rechaza, porque no puede demostrar que una
// determine a la otra.
//
// Resolviendo el codigo aca abajo, el nivel de arriba agrupa por columnas
// simples y la condicion se cumple sola. De paso la consulta se lee mejor: una
// capa resuelve "cual es el codigo de esta linea" y la otra "cuanto suma".
//
// `clave` es lo que define una fila del reporte: el codigo cuando existe, y la
// descripcion cuando no. Sin ella, TODAS las lineas sin codigo de un cliente
// caerian en un mismo monton.
// ---------------------------------------------------------------------------
const LINEAS_SQL = (clause) => `
  SELECT
    cl.id            AS id_cliente,
    cl.razon_social  AS cliente_nombre,
    cl.nit           AS cliente_nit,
    u.id             AS id_ejecutivo,
    u.nombre_completo AS ejecutivo_nombre,
    -- La marca importa para comprar: un filtro John Deere y uno CAT no son el
    -- mismo repuesto aunque la descripcion se parezca.
    mk.nombre        AS marca_nombre,
    ${CODIGO_SQL}    AS codigo,
    -- La clave usa la version NORMALIZADA; la columna codigo conserva el
    -- original para mostrarlo tal como se escribe.
    COALESCE(NULLIF(${CODIGO_NORM_SQL}, ''), CONCAT('SINCOD::', ${DESC_NORM_SQL})) AS clave,
    d.descripcion_item,
    d.unidad,
    d.cantidad,
    c.id             AS id_cotizacion,
    c.fecha_emision
  FROM cotizacion_detalles d
  INNER JOIN cotizaciones c  ON c.id  = d.id_cotizacion
  INNER JOIN clientes      cl ON cl.id = c.id_cliente
  INNER JOIN usuarios      u  ON u.id  = c.id_ejecutivo
  LEFT  JOIN productos     p  ON p.id  = d.id_producto
  LEFT  JOIN marcas        mk ON mk.id = d.marca_id
  ${clause}
`;

// El GROUP BY se repite en la consulta de datos y en la de conteo: si se
// separaran, el total podria dejar de coincidir con las filas.
//
// `marca_nombre` entra en los dos: si el mismo codigo se cargo con dos marcas
// distintas salen dos filas, que es correcto y ademas hace visible el dato
// sucio en vez de esconderlo detras de una suma.
// La marca NO entra en la clave. El mismo codigo cargado una vez con marca y
// otra sin marca daba dos filas — y en la practica pasa seguido, porque elegir
// la marca es opcional al cotizar. La marca no se pierde: se agrega con
// GROUP_CONCAT y se muestran todas las que aparecieron.
//
// `codigo` tampoco entra: la clave normalizada ya determina el grupo, y meter
// el original volveria a partir la fila por la forma de tecleo.
const GROUP_BY = {
  detalle: 'l.id_ejecutivo, l.ejecutivo_nombre, l.id_cliente, l.cliente_nombre, ' +
           'l.cliente_nit, l.clave, l.unidad',
  item:    'l.clave, l.unidad',
};

// ---------------------------------------------------------------------------
// find — una fila por (cliente, codigo, unidad).
//
// @param {Object} filtros     fecha_desde, fecha_hasta, estado, q, id_cliente, id_ejecutivo
// @param {Object} paginacion  { page, limit }
// @param {Object} orden       { by, order }
// @returns {Promise<Array<Object>>}
// ---------------------------------------------------------------------------
// find — una fila por grupo, segun el modo.
//
// @param {Object} filtros     fecha_desde, fecha_hasta, estado, q, id_cliente, id_ejecutivo
// @param {Object} paginacion  { page, limit }
// @param {Object} orden       { by, order }
// @param {string} modo        'detalle' | 'item'
// @returns {Promise<Array<Object>>}
// ---------------------------------------------------------------------------
async function find(filtros = {}, paginacion = {}, orden = {}, modo = 'detalle') {
  const m      = MODOS.includes(modo) ? modo : 'detalle';
  const page   = Math.max(1, parseInt(paginacion.page, 10) || 1);
  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(paginacion.limit, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  const columna = SORTABLE[m][orden.by] || SORTABLE[m].fecha;
  const sentido = String(orden.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const { clause, params } = _where(filtros);

  // Columnas propias de cada vista. En 'item' no hay un cliente ni un ejecutivo
  // que nombrar (se sumo entre todos), pero si interesa CUANTOS distintos
  // hubo — para compras, un repuesto repartido entre varios clientes es mejor
  // candidato a stock que el mismo volumen concentrado en uno solo.
  const columnasPropias = m === 'item'
    ? `
      COUNT(DISTINCT l.id_cliente)   AS clientes,
      COUNT(DISTINCT l.id_ejecutivo) AS ejecutivos,`
    : `
      l.id_cliente,
      l.cliente_nombre,
      l.cliente_nit,
      l.id_ejecutivo,
      l.ejecutivo_nombre,`;

  // LIMIT/OFFSET van como literales ya validados: mysql2 v3 los tipa como
  // DOUBLE si se pasan como parametros y MySQL rechaza la sentencia (mismo
  // motivo documentado en QuotationModel.findAll y AuditLogModel.findAll).
  const sql = `
    SELECT
      ${columnasPropias}
      -- El codigo que se MUESTRA es el original mas largo del grupo: en
      -- pantalla tiene que verse el numero de parte como se escribe, no su
      -- version normalizada sin separadores.
      SUBSTRING_INDEX(
        GROUP_CONCAT(DISTINCT l.codigo ORDER BY CHAR_LENGTH(l.codigo) DESC SEPARATOR '||'),
        '||', 1
      )                                AS codigo,
      -- Todas las marcas que aparecieron para este repuesto. Con una sola se ve
      -- igual que antes; con varias, el dato queda a la vista en vez de
      -- esconderse detras de una suma.
      GROUP_CONCAT(DISTINCT l.marca_nombre ORDER BY l.marca_nombre SEPARATOR ', ') AS marca_nombre,
      -- Descripcion representativa: la mas frecuente exigiria otra agregacion,
      -- asi que se toma la mas larga, que en la practica es la mas completa.
      SUBSTRING_INDEX(
        GROUP_CONCAT(l.descripcion_item ORDER BY CHAR_LENGTH(l.descripcion_item) DESC SEPARATOR '||'),
        '||', 1
      )                                AS descripcion,
      l.unidad,
      SUM(l.cantidad)                  AS cantidad_total,
      COUNT(DISTINCT l.id_cotizacion)  AS cotizaciones,
      MIN(l.fecha_emision)             AS primera_vez,
      MAX(l.fecha_emision)             AS ultima_vez,
      -- Bandera para la UI: estas filas se agrupan por descripcion, no por
      -- codigo, y no hay que confundirlas con un repuesto catalogado.
      CASE WHEN MAX(l.codigo) IS NULL THEN 1 ELSE 0 END AS sin_codigo
    FROM (${LINEAS_SQL(clause)}) AS l
    GROUP BY ${GROUP_BY[m]}
    -- «La cantidad esta bien pero tendria que ser secundario»: cuando el orden
    -- principal es la fecha, muchas filas comparten dia, y ahi manda la
    -- cantidad. El tercer criterio hace el orden estable entre paginas.
    ORDER BY ${columna} ${sentido}${columna === 'cantidad_total' ? '' : ', cantidad_total DESC'}, l.clave ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ---------------------------------------------------------------------------
// count — cuantas filas agrupadas hay en total (para la paginacion).
// Se cuenta sobre la MISMA agrupacion, envuelta en una subconsulta: un
// COUNT(*) plano contaria lineas de detalle, no filas del reporte.
// ---------------------------------------------------------------------------
async function count(filtros = {}, modo = 'detalle') {
  const m = MODOS.includes(modo) ? modo : 'detalle';
  const { clause, params } = _where(filtros);

  const sql = `
    SELECT COUNT(*) AS total FROM (
      SELECT 1
        FROM (${LINEAS_SQL(clause)}) AS l
       GROUP BY ${GROUP_BY[m]}
    ) AS agrupado
  `;

  const [rows] = await pool.execute(sql, params);
  return rows[0].total;
}


// ---------------------------------------------------------------------------
// ejecutivos — quienes aparecen en el reporte, para poblar el filtro.
//
// POR QUE NO SE USA /api/usuarios
// Ese endpoint esta restringido a Jefe/Administracion/SysAdmin, asi que un
// Ejecutivo abriendo el reporte recibia un 403 y el desplegable le quedaba
// vacio. Y aunque tuviera permiso, devuelve TODOS los usuarios — SysAdmin,
// Proyectos, Administracion — que no cotizan y no tienen nada que hacer en un
// filtro de ventas.
//
// Sacar la lista de los propios datos da exactamente los nombres correctos: los
// que efectivamente tienen cotizaciones en el periodo filtrado. Si alguien no
// cotizo nada este mes, elegirlo solo mostraria una tabla vacia.
//
// El filtro id_ejecutivo se IGNORA a proposito PARA UN ROL DE GESTION: si no,
// al elegir a alguien el desplegable se colapsaria a esa sola persona y no
// habria forma de volver.
//
// PERO ESO SOLO VALE PARA QUIEN ELIGE. Para un rol no-gestion (Ejecutivo,
// Proyectos) el id_ejecutivo de `filtros` no es una eleccion: es el alcance
// que `resolveEjecutivoScope` le FORZO en el controller, el mismo que ya
// acota `find()` y `count()`. Ignorarlo tambien aca filtraba el roster
// completo de la empresa por esta puerta trasera — un Ejecutivo no veia los
// DATOS de sus companeros, pero si sus NOMBRES en el desplegable, que en una
// empresa donde compiten por comision ya es informacion que no les toca.
//
// `alcanceForzado` es lo que distingue los dos casos: lo decide el
// controller (sabe si el rol es de gestion), no este modulo.
// ---------------------------------------------------------------------------
async function ejecutivos(filtros = {}, alcanceForzado = false) {
  const { id_ejecutivo, ...resto } = filtros;
  // Rol de gestion: se descarta el filtro, como siempre, para no colapsar el
  // desplegable. Rol forzado: se mantiene, así que _where() lo aplica y el
  // resultado queda acotado a un único id_ejecutivo — el propio.
  const filtrosEfectivos = alcanceForzado ? filtros : resto;
  const { clause, params } = _where(filtrosEfectivos);

  const sql = `
    SELECT DISTINCT l.id_ejecutivo AS id, l.ejecutivo_nombre AS nombre
      FROM (${LINEAS_SQL(clause)}) AS l
     ORDER BY l.ejecutivo_nombre ASC
  `;

  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { find, count, ejecutivos, SORTABLE, MODOS, DEFAULT_LIMIT, MAX_LIMIT };
