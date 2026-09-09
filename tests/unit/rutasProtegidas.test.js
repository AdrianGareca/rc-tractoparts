// =============================================================================
// tests/unit/rutasProtegidas.test.js
// Toda ruta nueva nace protegida, o esta prueba se pone en rojo.
//
// POR QUÉ EXISTE
// Hay pruebas de autenticación por área —reportes, métricas, usuarios— pero
// ninguna que recorra TODAS las rutas. Si mañana se agrega un endpoint y se
// olvida el `authenticate`, queda abierto a internet y la suite pasa en verde:
// no hay ninguna prueba que sepa que ese endpoint existe.
//
// Es el agujero más caro que puede tener una aplicación con roles, porque el
// costo no aparece hasta que alguien lo encuentra.
//
// CÓMO LO COMPRUEBA
// No lee el código fuente: levanta la aplicación de verdad y recorre el router
// que Express armó. Lo que se mira es lo que el servidor VA A EJECUTAR, no lo
// que parece decir un archivo.
//
// La comparación es por IDENTIDAD de función (`capa.handle === authenticate`),
// no por nombre. Un middleware que se llamara «authenticate» sin serlo pasaría
// un control por nombre; éste no. Y renombrar el middleware de verdad no rompe
// la prueba.
//
// EL ORIGEN DE ESTE ARCHIVO
// Durante la auditoría del 2026-09-08 hice un barrido a mano buscando rutas sin
// guardia y marcó SEIS falsas alarmas: usan guardias declarados en arreglos
// (`...progresoAuth`) que mi patrón de texto no reconocía. Precisamente por eso
// la comprobación tiene que vivir acá y mirar el router armado, en vez de
// improvisarse con un grep cada vez que alguien se acuerda.
// =============================================================================

'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config();

const app = require('../../src/app');
const { authenticate } = require('../../src/middlewares/authMiddleware');

// ---------------------------------------------------------------------------
// LA LISTA BLANCA
//
// Las únicas rutas que pueden no exigir sesión, y por qué. Agregar algo acá
// tiene que ser una decisión consciente: es exactamente lo que esta prueba
// existe para forzar.
// ---------------------------------------------------------------------------
const SIN_SESION = new Map([
  ['POST /api/auth/login', 'es el endpoint que ENTREGA la sesión; exigirla sería circular'],
  ['GET /health',          'lo consulta el monitor de disponibilidad, que no tiene usuario'],
]);

// Los prefijos con los que app.js monta cada router. Se prueban contra el
// matcher de cada capa para reconstruir la ruta completa.
const PREFIJOS = [
  '/api/auth', '/api/cotizaciones', '/api/licitaciones', '/api/usuarios',
  '/api/clientes', '/api/marcas', '/api/origenes-cliente', '/api/reportes',
  '/api/auditoria', '/api-docs',
];

/** El prefijo con el que está montada una capa de router, o '' si no se reconoce. */
function prefijoDe(capa) {
  for (const matcher of capa.matchers || []) {
    for (const p of PREFIJOS) {
      try { if (matcher(p)) return p; } catch { /* el matcher no aplica */ }
    }
  }
  return '';
}

/** ¿Esta ruta pasa por el middleware de autenticación? */
const exigeSesion = (ruta) =>
  (ruta.stack || []).some((capa) => capa.handle === authenticate);

/**
 * Todas las rutas que el servidor tiene montadas, con su ruta completa.
 * @returns {Array<{clave:string, exigeSesion:boolean, middlewares:string[]}>}
 */
function recorrerRutas() {
  const encontradas = [];

  const visitar = (pila, prefijo) => {
    for (const capa of pila) {
      if (capa.route) {
        const metodos = Object.keys(capa.route.methods).map((m) => m.toUpperCase());
        for (const metodo of metodos) {
          // Express registra un HEAD implícito por cada GET; es la misma ruta.
          if (metodo === 'HEAD') continue;
          encontradas.push({
            clave:       `${metodo} ${prefijo}${capa.route.path}`.replace(/\/$/, '') || `${metodo} /`,
            exigeSesion: exigeSesion(capa.route),
            middlewares: (capa.route.stack || []).map((c) => c.name || '(anónimo)'),
          });
        }
        continue;
      }
      if (capa.handle && capa.handle.stack) {
        visitar(capa.handle.stack, prefijo + prefijoDe(capa));
      }
    }
  };

  visitar(app.router.stack, '');
  return encontradas;
}

const rutas = recorrerRutas();

// ---------------------------------------------------------------------------
describe('el recorrido encuentra lo que hay', () => {
  // Si el recorrido se rompiera —porque Express cambió la forma de su router,
  // por ejemplo— devolvería una lista vacía y TODAS las comprobaciones de abajo
  // pasarían sin mirar nada. Es el mismo motivo por el que
  // licitacionTransicionesEspejo comprueba que su comparador compara.
  test('encuentra una cantidad razonable de rutas', () => {
    if (rutas.length < 25) {
      throw new Error(
        `El recorrido del router encontró sólo ${rutas.length} rutas.\n\n` +
        'La aplicación tiene bastantes más. Lo más probable es que Express haya ' +
        'cambiado la forma de su router y este archivo esté mirando el lugar ' +
        'equivocado — con lo cual TODAS las comprobaciones de abajo estarían ' +
        'pasando sin revisar nada.'
      );
    }
  });

  test('encuentra rutas conocidas, con su prefijo completo', () => {
    const claves = rutas.map((r) => r.clave);
    expect(claves).toContain('POST /api/auth/login');
    expect(claves).toContain('GET /health');
    expect(claves.some((c) => c.startsWith('GET /api/cotizaciones'))).toBe(true);
  });

  test('sabe distinguir una ruta protegida de una que no lo está', () => {
    // El control positivo del control: si `exigeSesion` devolviera siempre
    // true, la prueba principal pasaría con todo abierto.
    const login = rutas.find((r) => r.clave === 'POST /api/auth/login');
    expect(login.exigeSesion).toBe(false);

    const protegidas = rutas.filter((r) => r.exigeSesion);
    expect(protegidas.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
describe('ninguna ruta queda abierta por accidente', () => {
  test('toda ruta exige sesión, salvo las de la lista blanca', () => {
    const abiertas = rutas
      .filter((r) => !r.exigeSesion && !SIN_SESION.has(r.clave));

    if (abiertas.length > 0) {
      throw new Error(
        `Estas rutas NO exigen sesión:\n` +
        abiertas.map((r) => `  ${r.clave}\n      middlewares: ${r.middlewares.join(' → ')}`).join('\n') +
        '\n\nCualquiera con la URL puede llamarlas sin haber iniciado sesión.\n\n' +
        'Si falta el guardia: agregá `authenticate` de src/middlewares/authMiddleware.js ' +
        'a esa ruta (mirá cómo lo hacen las de al lado, normalmente con un arreglo ' +
        'tipo `...managerOnly`).\n\n' +
        'Si la ruta DEBE ser pública, agregala a SIN_SESION en este archivo con el ' +
        'motivo escrito. Que cueste un renglón es el punto.'
      );
    }
  });

  test('la lista blanca no tiene entradas de más', () => {
    // Una excepción que ya no corresponde a ninguna ruta es una puerta que
    // quedó autorizada para algo que no existe — y que el día que vuelva a
    // existir entra sin que nadie lo note.
    const claves = new Set(rutas.map((r) => r.clave));
    const sobrantes = [...SIN_SESION.keys()].filter((c) => !claves.has(c));

    expect(sobrantes).toEqual([]);
  });

  test.each([...SIN_SESION.entries()])('%s es pública a propósito: %s', (clave) => {
    const ruta = rutas.find((r) => r.clave === clave);
    expect(ruta).toBeDefined();
    expect(ruta.exigeSesion).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('el trinquete', () => {
  // Cuántas rutas pueden estar sin sesión. Puede bajar, nunca subir.
  const TOPE_ABIERTAS = 2;

  test(`no hay más de ${TOPE_ABIERTAS} rutas públicas`, () => {
    const abiertas = rutas.filter((r) => !r.exigeSesion);
    expect(abiertas.map((r) => r.clave).sort())
      .toEqual([...SIN_SESION.keys()].sort());
    expect(abiertas.length).toBeLessThanOrEqual(TOPE_ABIERTAS);
  });
});
