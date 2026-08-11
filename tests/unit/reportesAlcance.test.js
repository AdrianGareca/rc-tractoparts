// =============================================================================
// tests/unit/reportesAlcance.test.js
// Todo reporte que pueda filtrar por ejecutivo decide el alcance en el servidor.
//
// EL AGUJERO QUE ORIGINÓ ESTE ARCHIVO
// `/api/reportes/cliente-item` se agregó después que /progreso, /advanced y
// /mis-metricas, y quedó afuera de `resolveEjecutivoScope`: tomaba
// `id_ejecutivo` directo de la consulta. Resultado: cualquier ejecutivo pedía
// el reporte y recibía qué le cotizó CADA vendedor a CADA cliente de la
// empresa, con precios.
//
// LA LECCIÓN, QUE ES LO QUE ESTE TEST CONVIERTE EN REGLA
// Un helper de autorización sólo protege lo que lo llama. Que exista, esté bien
// escrito y tenga un comentario diciendo «el ÚNICO lugar donde se toma esta
// decisión» no impide que la ruta siguiente se olvide de usarlo — y nada avisa,
// porque el endpoint funciona perfecto: devuelve datos, con 200.
//
// Por eso el guardia no mira la implementación: mira que TODO manejador que
// toque `id_ejecutivo` pase por el helper.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const CONTROLADOR = path.resolve(__dirname, '../../src/controllers/reportesController.js');
const RUTAS       = path.resolve(__dirname, '../../src/routes/reportesRoutes.js');

const src    = fs.readFileSync(CONTROLADOR, 'utf8');
const rutas  = fs.readFileSync(RUTAS, 'utf8');
const lineas = src.split(String.fromCharCode(10));

/** Las líneas de código, sin comentarios: acá se documenta el bug nombrándolo. */
const esComentario = (l) => {
  const t = l.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

// ---------------------------------------------------------------------------
describe('el helper de alcance existe y es el único que decide', () => {
  test('resolveEjecutivoScope está definido', () => {
    expect(src).toMatch(/function resolveEjecutivoScope\s*\(/);
  });

  test('un rol que no es de gestión recibe SIEMPRE su propio id', () => {
    // La línea que hace todo el trabajo. Si alguien la invierte o la borra, el
    // helper deja de proteger y ningún otro test lo notaría.
    const cuerpo = /function resolveEjecutivoScope[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(cuerpo).toMatch(/MANAGER_ROLES\.has\(req\.user\.rol\)/);
    expect(cuerpo).toMatch(/ejecutivoId:\s*req\.user\.id/);
  });
});

// ---------------------------------------------------------------------------
describe('ningún manejador lee id_ejecutivo de la consulta por su cuenta', () => {
  test('req.query.id_ejecutivo sólo se toca dentro del helper', () => {
    const culpables = [];

    // Dónde empieza y termina el helper: adentro, leer la consulta es su trabajo.
    const inicio = lineas.findIndex((l) => /function resolveEjecutivoScope\s*\(/.test(l));
    // El cierre de la funcion es la llave en la COLUMNA 0. Buscar `trim() === '}'`
    // encontraba primero el cierre de un `if` anidado y dejaba media funcion
    // fuera del rango, acusando a su propia linea 94 de leer la consulta.
    // Se recorta el fin de linea antes de comparar: el archivo esta en CRLF,
    // y la linea de cierre trae un retorno de carro al final, asi que
    // compararla exactamente contra la llave sola nunca coincidia.
    const fin = lineas.findIndex(
      (l, i) => i > inicio && l.replace(/\s+$/, '') === '}'
    );

    lineas.forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (i >= inicio && i <= fin) return;          // el helper mismo
      if (/req\.query\.id_ejecutivo/.test(linea)) {
        culpables.push(`reportesController.js:${i + 1}  ${linea.trim().slice(0, 90)}`);
      }
    });

    if (culpables.length > 0) {
      throw new Error(
        `Estos lugares leen id_ejecutivo directo de la consulta:\n  ${culpables.join('\n  ')}\n\n` +
        'Usá resolveEjecutivoScope(req). Saltearlo deja que un ejecutivo pida la ' +
        'cartera de un compañero pasando su id — que es exactamente el agujero ' +
        'que tenía /cliente-item: devolvía 200 con los datos de toda la empresa.'
      );
    }
  });

  test('cada manejador que arma un filtro con id_ejecutivo usa el alcance resuelto', () => {
    // El patrón correcto es `id_ejecutivo: alcance.ejecutivoId` o equivalente.
    // Se busca lo contrario: una asignación que NO venga del helper.
    const culpables = [];

    lineas.forEach((linea, i) => {
      if (esComentario(linea)) return;
      const m = /id_ejecutivo:\s*([^,\n]+)/.exec(linea);
      if (!m) return;

      const valor = m[1].trim();

      // LA REGLA, Y POR QUÉ ES SUFICIENTE ASÍ
      // El valor tiene que MENCIONAR `ejecutivoId`, que es el nombre del campo
      // que devuelve el helper. Los tres manejadores lo escriben distinto
      // —`scope.ejecutivoId`, `alcance.ejecutivoId`, o desestructurado— y
      // perseguir cada forma volvía este test una heurística sobre nombres de
      // variable, que es exactamente lo que no se quiere vigilando permisos.
      //
      // Alcanza porque va EN PAR con el test de arriba: nadie fuera del helper
      // puede leer `req.query.id_ejecutivo`. Si el único origen posible del
      // dato es el helper, y el filtro nombra el campo que el helper produce,
      // no queda camino por donde entre un id de la consulta sin revisar.
      //
      // Un solo test de los dos sería falsa seguridad. Los dos juntos cierran.
      const vieneDelHelper = /\bejecutivoId\b/.test(valor);

      if (!vieneDelHelper) {
        culpables.push(`reportesController.js:${i + 1}  id_ejecutivo: ${valor.slice(0, 60)}`);
      }
    });

    if (culpables.length > 0) {
      throw new Error(
        `Estos filtros arman id_ejecutivo sin pasar por el helper:\n  ${culpables.join('\n  ')}\n\n` +
        'El valor tiene que salir de resolveEjecutivoScope(req).'
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('las rutas de reportes declaran su autorización', () => {
  // No todas necesitan `authorize`: /cliente-item y /mis-metricas son para
  // cualquier rol, y su acotamiento lo hace el helper adentro. Lo que NO puede
  // pasar es que una ruta no tenga ni lo uno ni lo otro.
  test('toda ruta de reportes lleva authenticate', () => {
    const sinAuth = [];

    for (const m of rutas.matchAll(/router\.get\(\s*'([^']+)'\s*,\s*([^)]*)\)/g)) {
      const [, ruta, resto] = m;
      // Los arreglos de middleware (progresoAuth, advancedAuth) ya lo incluyen.
      if (!/authenticate|Auth\b/.test(resto)) sinAuth.push(ruta);
    }

    expect(sinAuth).toEqual([]);
  });
});
