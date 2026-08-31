// =============================================================================
// tests/unit/licitacionGastosEspejo.test.js
// Quién puede tocar los gastos de una licitación tiene que decidirse igual en el
// navegador que en el servidor.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// La regla está escrita DOS veces:
//
//   servidor    src/controllers/licitacionGastoController.js       canManageGastos(user, licitacion)
//   navegador   public/js/.../licitacion/permissions.js            canManageGastos(licitacion, user)
//
// Mirá los dos encabezados: se llaman igual y reciben los argumentos AL REVÉS.
// Además cada copia lee campos distintos del usuario — `role`/`userId` en el
// navegador (que es lo que guarda AuthSession) y `rol`/`id` en el servidor (que
// es lo que trae el JWT). Dos funciones con el mismo nombre, la misma regla, y
// ni un solo símbolo en común que un editor de texto pueda vincular. Renombrar
// un campo en una de las dos no rompe nada en la otra: simplemente empiezan a
// contestar distinto.
//
// Esto es exactamente lo mismo que ya pasó con la matriz de transiciones, y se
// resolvió de la misma forma: licitacionTransicionesEspejo.test.js existe porque
// el archivo del navegador decía «Espejo de LicitacionModel» y ese comentario era
// toda la garantía que había. Un comentario no falla cuando alguien edita una
// sola de las dos. Este archivo es el mismo trato para los gastos.
//
// POR QUÉ NO SE UNIFICAN Y YA
// El servidor es CommonJS y el navegador módulos nativos, y el proyecto no tiene
// paso de compilación que pueda compartir un archivo entre los dos. La
// duplicación es deliberada; lo que no puede quedar suelto es que se separen.
//
// LO QUE ESTABA SIN VIGILAR
// tests/unit/licitacionPermissions.test.js ya probaba canManageGastos, pero SOLO
// la copia del navegador — la que decide qué botones se dibujan. La copia del
// servidor, que es la que devuelve el 403 de verdad, no la probaba nadie contra
// la otra. O sea: el lado cosmético tenía red y el lado que manda no.
//
// QUÉ SE SIENTE CUANDO DIVERGEN
// Si el navegador ofrece de más: aparece el botón de cargar gasto, la persona
// escribe concepto y monto, aprieta guardar y recibe un 403. Si ofrece de menos:
// alguien de Administración con derecho a cargar el gasto no ve el formulario, y
// no hay ningún mensaje que se lo explique — el bloque simplemente no está. Los
// gastos son la mitad del cálculo de resultado de una licitación adjudicada, así
// que lo que se pierde ahí no es un botón, es saber si el negocio dejó margen.
//
// CÓMO SE CARGA CADA COPIA
//   • El navegador se importa directo: babel-jest traduce los `import` y el
//     único obstáculo es AuthSession, que se mockea porque acá no hay sesión.
//     Es el mismo arranque que licitacionTransicionesEspejo.test.js.
//   • El servidor NO se puede importar: canManageGastos es privada del módulo,
//     no está en el module.exports. Así que no se la lee — se le PREGUNTA, igual
//     que el cruce de transiciones le pregunta a validateTransitionByRole en vez
//     de comparar dos objetos. Se le pega a deleteGasto con los modelos mockeados
//     (el patrón de draftLockRelease.test.js) y se mira el código que devuelve:
//     403 es «no puede», y 404 «Gasto no encontrado» —el paso siguiente— es
//     «puede». Eso prueba la ruta que realmente produce el 403 en producción,
//     con su controlador y su orden de chequeos incluidos, y no una copia de la
//     regla escrita en el test.
// =============================================================================

'use strict';

// El módulo del navegador importa AuthSession para leer la sesión. Acá no hay
// sesión ni navegador, y no hace falta: canManageGastos es pura y recibe el
// usuario por parámetro. El mock existe solo para que el import no explote.
jest.mock('../../public/js/services/authSession.js', () => ({
  __esModule: true,
  default: { getRole: jest.fn(), getUserId: jest.fn(), canApproveQuotations: jest.fn() },
}));

// Los tres módulos que arrastra el controlador. Se mockean para que requerirlo
// no abra una conexión a MySQL: lo único que se está probando es su decisión de
// permiso, que ocurre en memoria antes de tocar la base.
jest.mock('../../src/models/LicitacionModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/LicitacionGastoModel', () => ({
  findById: jest.fn(), deleteById: jest.fn(), create: jest.fn(), findByLicitacion: jest.fn(),
}));
jest.mock('../../src/utils/auditLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  AuditActions: { AGREGAR_GASTO_LICITACION: 'x', ELIMINAR_GASTO_LICITACION: 'y' },
}));

import { canManageGastos as puedeFront } from '../../public/js/views/dashboard/modules/licitacion/permissions.js';

const LicitacionModel      = require('../../src/models/LicitacionModel');
const LicitacionGastoModel = require('../../src/models/LicitacionGastoModel');
const LicitacionGastoController = require('../../src/controllers/licitacionGastoController');

// Los cinco roles salen de src/config/roles.js y no de una lista escrita a mano
// acá. Si mañana entra un sexto rol a sql/init.sql y a esa constante, el cruce
// de abajo lo empieza a probar solo — que es justo el momento en que alguien se
// va a olvidar de mirar una de las dos copias de canManageGastos.
const { NOMBRES_DE_ROL } = require('../../src/config/roles');

const ID_RESPONSABLE = 7;
const ID_OTRO        = 99;

// ---------------------------------------------------------------------------
// Las dos formas de preguntar lo mismo.
// ---------------------------------------------------------------------------

/** Un `res` de Express que solo se acuerda de lo que le dijeron. */
function crearRes() {
  const res = { statusCode: null, body: null };
  res.status = (codigo) => { res.statusCode = codigo; return res; };
  res.json   = (cuerpo) => { res.body = cuerpo; return res; };
  return res;
}

/**
 * Le pregunta al SERVIDOR, por la puerta de entrada real.
 *
 * deleteGasto es la ruta más limpia para preguntar: a diferencia de addGasto no
 * valida estado ni moneda, así que el chequeo de permiso es lo único que se
 * interpone. Si permite, lo siguiente que hace es buscar el gasto — que acá no
 * existe — y devuelve 404. Ese 404 es la señal de «pasó el permiso»; no hay
 * ningún efecto porque los modelos están mockeados.
 */
async function puedeBack(licitacion, usuario) {
  LicitacionModel.findById.mockResolvedValue(licitacion);
  LicitacionGastoModel.findById.mockResolvedValue(null); // el gasto no existe

  const res = crearRes();
  await LicitacionGastoController.deleteGasto(
    { params: { id: '1', gastoId: '1' }, user: usuario, ip: '127.0.0.1' },
    res
  );

  if (res.statusCode === 403) return false;
  if (res.statusCode === 404 && res.body?.message === 'Gasto no encontrado.') return true;

  // Cualquier otra respuesta significa que la sonda dejó de medir lo que cree
  // medir —cambió el orden de los chequeos del controlador, o se rompió antes de
  // llegar al permiso—. Devolver un booleano acá haría pasar el test mintiendo.
  throw new Error(
    `La sonda del servidor no pudo leer un veredicto de permiso: deleteGasto ` +
    `respondió ${res.statusCode} «${res.body?.message}». Se esperaba 403 (no puede) ` +
    `o 404 «Gasto no encontrado.» (puede). Revisá el orden de los chequeos en ` +
    `src/controllers/licitacionGastoController.js.`
  );
}

/**
 * El cruce en sí. Toda la traducción entre las dos copias vive acá y en un solo
 * lugar: el orden invertido de los argumentos y los dos juegos de nombres de
 * campo. Cada caso de la tabla se escribe una vez y se prueba contra las dos.
 */
async function exigirMismaRespuesta({ nombre, licitacion, rol, idUsuario, canApprove = false }) {
  // El navegador lee `role`/`userId` (lo que guarda AuthSession) y recibe la
  // licitación PRIMERO.
  const front = puedeFront(licitacion, { role: rol, userId: idUsuario, canApprove });

  // El servidor lee `rol`/`id` (lo que viene en el JWT) y recibe el usuario
  // PRIMERO. Mismo caso, otra forma.
  const back = await puedeBack(licitacion, { rol, id: idUsuario, nombre_usuario: 'test' });

  if (front !== back) {
    throw new Error(
      `Las dos copias de canManageGastos NO coinciden.\n\n` +
      `  Caso        ${nombre}\n` +
      `  Licitación  ${JSON.stringify(licitacion)}\n` +
      `  Usuario     rol=${JSON.stringify(rol)} id=${JSON.stringify(idUsuario)}\n\n` +
      `  navegador   public/js/views/dashboard/modules/licitacion/permissions.js\n` +
      `              canManageGastos(licitacion, user) → ${front}   ${front ? '(dibuja el botón)' : '(esconde el botón)'}\n` +
      `  servidor    src/controllers/licitacionGastoController.js\n` +
      `              canManageGastos(user, licitacion) → ${back}   ${back ? '(acepta)' : '(devuelve 403)'}\n\n` +
      (front && !back
        ? `  El navegador ofrece de más: la persona ve el botón, carga el gasto y come un 403.`
        : `  El navegador ofrece de menos: la persona tiene el derecho y no ve el formulario, sin ninguna explicación.`) +
      `\n  Arreglá la copia equivocada; NO relajes este test.`
    );
  }

  expect(back).toBe(front);
  return front;
}

// ---------------------------------------------------------------------------
// La tabla de casos: rol × relación con la licitación, más los bordes.
// ---------------------------------------------------------------------------

/** Las tres relaciones posibles entre un usuario y una licitación. */
const RELACIONES = [
  {
    etiqueta:   'es el responsable',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    idUsuario:  ID_RESPONSABLE,
  },
  {
    etiqueta:   'NO es el responsable',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    idUsuario:  ID_OTRO,
  },
  {
    // Pasa de verdad: la licitación se crea y el responsable se asigna después.
    // El riesgo es que las dos copias comparen `undefined` de formas distintas.
    etiqueta:   'la licitación todavía no tiene responsable',
    licitacion: { estado: 'Adjudicada', id_responsable: null },
    idUsuario:  ID_RESPONSABLE,
  },
];

const MATRIZ = [];
for (const rol of NOMBRES_DE_ROL) {
  for (const rel of RELACIONES) {
    MATRIZ.push({
      nombre:     `${rol} — ${rel.etiqueta}`,
      licitacion: rel.licitacion,
      rol,
      idUsuario:  rel.idUsuario,
    });
  }
}

// Los bordes que salen de leer las dos implementaciones una al lado de la otra.
// Ninguno es hipotético: cada uno es una forma concreta en que un `===` puede
// contestar distinto de lo que uno espera.
const BORDES = [
  {
    // La trampa más fea de las dos: si el usuario no trae id Y la licitación no
    // trae responsable, `undefined === undefined` da true en las DOS copias y un
    // Proyectos cualquiera queda habilitado. Coinciden —que es lo que este
    // archivo vigila— pero el caso queda anotado acá para que se vea.
    nombre:     'Proyectos sin id, licitación sin responsable (undefined === undefined)',
    licitacion: { estado: 'Adjudicada' },
    rol:        'Proyectos',
    idUsuario:  undefined,
  },
  {
    // MySQL devuelve el id como número, pero un JOIN o un JSON intermedio lo
    // puede volver texto. Las dos copias comparan con === y ninguna convierte.
    nombre:     'Proyectos con id numérico contra un id_responsable de texto',
    licitacion: { estado: 'Adjudicada', id_responsable: '7' },
    rol:        'Proyectos',
    idUsuario:  ID_RESPONSABLE,
  },
  {
    // Los nombres de rol se comparan literales en los dos lados. Una mayúscula
    // de más no da error: devuelve false y el permiso no se da, sin síntoma.
    nombre:     'un rol con otra capitalización no es el rol',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    rol:        'jefe',
    idUsuario:  ID_RESPONSABLE,
  },
  {
    nombre:     'un rol que no existe en el sistema',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    rol:        'Contabilidad',
    idUsuario:  ID_RESPONSABLE,
  },
  {
    nombre:     'un usuario sin rol',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    rol:        null,
    idUsuario:  ID_RESPONSABLE,
  },
  {
    // La delegación para aprobar cotizaciones es otro eje y no debe filtrarse
    // acá: el navegador ni siquiera lee canApprove en canManageGastos, y el
    // servidor no tiene ese dato. Se prueba para que siga siendo así.
    nombre:     'un Ejecutivo delegado sigue sin poder tocar gastos',
    licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
    rol:        'Ejecutivo',
    idUsuario:  ID_RESPONSABLE,
    canApprove: true,
  },
  {
    // El estado no entra en la regla de PERMISO —eso lo decide aparte
    // GASTO_ALLOWED_STATES— y ninguna de las dos copias lo mira. Un caso en un
    // estado previo confirma que ninguna se lo agregó por su cuenta.
    nombre:     'el estado de la licitación no cambia quién tiene permiso',
    licitacion: { estado: 'En preparacion', id_responsable: ID_RESPONSABLE },
    rol:        'Proyectos',
    idUsuario:  ID_RESPONSABLE,
  },
];

const CASOS = [...MATRIZ, ...BORDES];

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('las dos copias de canManageGastos contestan lo mismo', () => {
  test.each(CASOS)('$nombre', async (caso) => {
    await exigirMismaRespuesta(caso);
  });
});

// ---------------------------------------------------------------------------
describe('el cruce cruza algo', () => {
  // Un comparador que nunca encuentra un true, o nunca un false, pasaría el
  // bloque de arriba sin vigilar nada. Ya pasó en este proyecto: un trinquete de
  // colores reportaba 0 sobre 29 reales y la prueba pasaba, porque cero es menor
  // que veintinueve.
  test('hay casos donde las dos dicen que SÍ', async () => {
    const admin = await exigirMismaRespuesta({
      nombre: 'control — Administracion',
      licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
      rol: 'Administracion', idUsuario: ID_OTRO,
    });
    expect(admin).toBe(true);
  });

  test('y casos donde las dos dicen que NO', async () => {
    const ajeno = await exigirMismaRespuesta({
      nombre: 'control — Proyectos ajeno',
      licitacion: { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE },
      rol: 'Proyectos', idUsuario: ID_OTRO,
    });
    expect(ajeno).toBe(false);
  });

  test('la sonda del servidor distingue de verdad un 403 de un permiso dado', async () => {
    // Sin esto, una sonda que devolviera siempre lo mismo haría pasar todo.
    const lic = { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE };
    expect(await puedeBack(lic, { rol: 'Jefe', id: ID_OTRO })).toBe(true);
    expect(await puedeBack(lic, { rol: 'Ejecutivo', id: ID_OTRO })).toBe(false);
  });

  test('invertir los argumentos da otra respuesta — por eso el orden se traduce en un solo lugar', () => {
    // Prueba de la prueba, y del bug que motivó el archivo: las dos firmas son
    // incompatibles en silencio. Llamar a la del navegador con el orden del
    // servidor no explota, devuelve false y el botón desaparece para todos.
    const lic = { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE };
    const usr = { role: 'Proyectos', userId: ID_RESPONSABLE, canApprove: false };

    expect(puedeFront(lic, usr)).toBe(true);   // orden correcto
    expect(puedeFront(usr, lic)).toBe(false);  // orden del servidor: falla mudo
  });
});

// ---------------------------------------------------------------------------
describe('los bordes donde las dos NO se pueden comparar', () => {
  // Estos casos quedan fuera de la tabla de arriba a propósito: no es que las
  // dos copias coincidan, es que una de las dos ni siquiera llega a contestar.
  // Se documentan acá con su comportamiento actual para que un cambio se note.

  test('sin usuario: el navegador dice que no, el servidor no llega a preguntarse', async () => {
    const lic = { estado: 'Adjudicada', id_responsable: ID_RESPONSABLE };

    // El navegador tiene `user ?? {}` y contesta false sin drama.
    expect(puedeFront(lic, undefined)).toBe(false);
    expect(puedeFront(lic, null)).toBe(false);

    // El servidor hace `user.rol` sin guarda: revienta y el catch lo convierte
    // en 500. No es una divergencia de PERMISO —un 500 tampoco deja cargar el
    // gasto— y en producción no se alcanza, porque el middleware de
    // autenticación rechaza antes de llegar al controlador. Se fija igual: si
    // alguna vez esa ruta queda sin auth, esto lo dice.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    LicitacionModel.findById.mockResolvedValue(lic);
    const res = crearRes();
    await LicitacionGastoController.deleteGasto({ params: { id: '1', gastoId: '1' }, user: null }, res);
    expect(res.statusCode).toBe(500);
    jest.restoreAllMocks();
  });

  test('sin licitación: el navegador dice que no, el servidor corta con 404 antes del permiso', async () => {
    // El navegador usa `licitacion?.id_responsable`, así que una licitación que
    // todavía no cargó no habilita a nadie salvo a quien lo está por su rol.
    expect(puedeFront(null, { role: 'Proyectos', userId: ID_RESPONSABLE })).toBe(false);
    expect(puedeFront(null, { role: 'Jefe', userId: ID_RESPONSABLE })).toBe(true);

    // En el servidor la licitación inexistente se responde 404 ANTES de mirar el
    // permiso, así que canManageGastos nunca recibe un null. Ese orden es lo que
    // vuelve inofensivo el `licitacion.id_responsable` sin `?.` del controlador,
    // y por eso se fija: si alguien mueve el chequeo de permiso más arriba, la
    // ruta pasa a tirar 500 en vez de 404.
    LicitacionModel.findById.mockResolvedValue(null);
    const res = crearRes();
    await LicitacionGastoController.deleteGasto(
      { params: { id: '1', gastoId: '1' }, user: { rol: 'Proyectos', id: ID_RESPONSABLE } },
      res
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain('No se encontró la licitación');
  });
});
