// =============================================================================
// src/controllers/catalogoSimple.js
// Los catálogos de nombre único, una sola vez.
//
// QUÉ ES UN "CATÁLOGO SIMPLE"
// Una lista de nombres únicos que crece desde un "+" adentro de otro
// formulario, sin pantalla propia de gestión. Hay dos:
//
//   marcas             Caterpillar, Komatsu, Hitachi...   (columna Marca de cada ítem)
//   origenes_cliente   Feria comercial, Recomendación...  (clasificación del cliente)
//
// Los dos tienen exactamente el mismo contrato: listar todo, y crear uno nuevo
// con nombre único sin distinguir mayúsculas, devolviendo 409 con la fila que ya
// existía para que el navegador la seleccione en lugar de dejar a la persona
// con un rechazo.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// brandController.js y origenClienteController.js eran gemelos de 104 y 99
// líneas. La cabecera del segundo lo decía sin rodeos: "Mirrors
// brandController.js — same validation/uniqueness/audit contract". Y ya habían
// divergido en tres cosas, ninguna de las cuales daba error:
//
//   1. uno registraba la auditoría con AuditActions.CREAR_ORIGEN_CLIENTE y el
//      otro con la cadena suelta 'CREAR_MARCA', que no estaba en esa lista — asi
//      que el evento quedaba guardado y a la vez era imposible de filtrar
//   2. los mensajes de error del GET estaban en INGLÉS en los dos
//      ("Error retrieving brands."), en una aplicación toda en castellano
//   3. el 409 del catch de respaldo devolvía el nombre TECLEADO en vez del
//      nombre YA GUARDADO: quien escribía "caterpillar" leía
//      'La marca "caterpillar" ya existe', en minúscula, sin parecerse al
//      "Caterpillar" real del catálogo
//
// Ese es el costo real de un gemelo: no es escribir dos veces, es que los dos se
// separan de a poco y nadie se entera.
//
// EL GÉNERO ES UN PARÁMETRO, Y NO ES UN CAPRICHO
// "La marca" pero "el origen". "El nombre de la marca" pero "el nombre del
// origen". En castellano no alcanza con interpolar el sustantivo: hay que saber
// su género para elegir el artículo y para contraer "de el" en "del". Pedirlo
// es lo que evita que los mensajes suenen a traducción automática.
//
// Cubierto por tests/unit/catalogoSimple.test.js.
// =============================================================================

'use strict';

const { logEvent } = require('../utils/auditLog');

/** Lo que aguanta la columna `nombre` en las dos tablas. */
const LARGO_MAXIMO = 100;

/**
 * Arma un controlador de catálogo.
 *
 * @param {object}   opts
 * @param {object}   opts.modelo      con getAll(), findByNombre(n) y create(n)
 * @param {string}   opts.tabla       nombre de la tabla, para la bitácora
 * @param {string}   opts.accion      código de AuditActions — NUNCA una cadena suelta
 * @param {string}   opts.sustantivo  'marca', 'origen'
 * @param {'f'|'m'}  opts.genero      género de ese sustantivo
 * @param {string}   [opts.plural]    para el mensaje de error del listado
 * @returns {{ listar: Function, crear: Function }}
 */
function crearControladorDeCatalogo({ modelo, tabla, accion, sustantivo, genero, plural }) {
  // Las tres formas que el castellano necesita. Se calculan una vez, acá, en
  // lugar de repetir el ternario en cada mensaje.
  const El     = genero === 'f' ? 'La' : 'El';    // "La marca ..." / "El origen ..."
  const del    = genero === 'f' ? 'de la' : 'del'; // "... de la marca" / "... del origen"
  const el     = genero === 'f' ? 'la' : 'el';     // "Error al crear la marca."
  const listado = plural || `${sustantivo}s`;

  /** El mismo cuerpo de 409 en los dos caminos que lo devuelven. */
  const yaExiste = (fila) => ({
    success: false,
    message: `${El} ${sustantivo} "${fila.nombre}" ya existe en el catálogo.`,
    // `data` no es decorativo: el navegador lo usa para SELECCIONAR la fila que
    // ya existía en lugar de dejar a la persona con un rechazo y sin salida.
    // Sin esto, alguien termina registrando "HITACHI 2".
    data: fila,
  });

  return {
    // -------------------------------------------------------------------------
    // listar — GET. Todo el catálogo, alfabético. Cualquier rol autenticado.
    // -------------------------------------------------------------------------
    async listar(req, res) {
      try {
        return res.status(200).json({ success: true, data: await modelo.getAll() });
      } catch (err) {
        console.error(`[catalogo:${tabla}.listar]`, err);
        return res.status(500).json({
          success: false,
          message: `No se pudo obtener el listado de ${listado}.`,
        });
      }
    },

    // -------------------------------------------------------------------------
    // crear — POST. Nombre único sin distinguir mayúsculas.
    // -------------------------------------------------------------------------
    async crear(req, res) {
      const { nombre } = req.body;
      const clientIp = req.ip || req.socket?.remoteAddress || null;

      // ── Validación de entrada ──────────────────────────────────────────────
      if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
        return res.status(422).json({
          success: false,
          message: `El nombre ${del} ${sustantivo} es requerido.`,
        });
      }

      const limpio = nombre.trim();
      if (limpio.length > LARGO_MAXIMO) {
        return res.status(422).json({
          success: false,
          message: `El nombre ${del} ${sustantivo} no puede superar ${LARGO_MAXIMO} caracteres.`,
        });
      }

      try {
        // ── Duplicado, sin distinguir mayúsculas ─────────────────────────────
        const existente = await modelo.findByNombre(limpio);
        if (existente) return res.status(409).json(yaExiste(existente));

        const creado = await modelo.create(limpio);

        // ── Bitácora ─────────────────────────────────────────────────────────
        // En su propio try: la fila YA se creó. Devolver un error sobre algo que
        // sí se guardó hace que la persona lo intente de nuevo y reciba un 409
        // que no puede explicarse.
        try {
          await logEvent({
            id_usuario:     req.user?.id ?? null,
            nombre_usuario: req.user?.nombre_usuario ?? null,
            accion,
            entidad:        tabla,
            id_entidad:     creado.id,
            detalle:        { nombre: creado.nombre },
            ip_origen:      clientIp,
            resultado:      'exito',
          });
        } catch (auditErr) {
          console.warn(`[catalogo:${tabla}.crear] Auditoría fallida (no fatal):`, auditErr.message);
        }

        return res.status(201).json({ success: true, data: creado });

      } catch (err) {
        // ── La carrera ───────────────────────────────────────────────────────
        // Dos personas mandan el mismo nombre a la vez: la comprobación de
        // arriba pasa en las dos, y MySQL rechaza la segunda por índice único.
        // No es un error de quien escribió — es el mismo caso de duplicado, y se
        // responde igual.
        if (err.code === 'ER_DUP_ENTRY') {
          // Se vuelve a buscar para nombrar la fila REAL. Antes acá se devolvía
          // el texto tecleado, así que quien escribía "caterpillar" leía
          // 'La marca "caterpillar" ya existe' — en minúscula, sin parecerse al
          // "Caterpillar" del catálogo, y sin el `data` que el navegador
          // necesita para seleccionarla.
          const existente = await modelo.findByNombre(limpio).catch(() => null);
          if (existente) return res.status(409).json(yaExiste(existente));

          // Si ni siquiera se la puede releer, se responde con lo que hay.
          return res.status(409).json({
            success: false,
            message: `${El} ${sustantivo} "${limpio}" ya existe en el catálogo.`,
          });
        }

        console.error(`[catalogo:${tabla}.crear]`, err);
        return res.status(500).json({
          success: false,
          message: `Error al crear ${el} ${sustantivo}.`,
        });
      }
    },
  };
}

module.exports = { crearControladorDeCatalogo, LARGO_MAXIMO };
