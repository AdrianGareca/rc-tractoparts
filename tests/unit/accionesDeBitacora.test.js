// =============================================================================
// tests/unit/accionesDeBitacora.test.js
// Todo lo que se escribe en la bitácora se puede volver a encontrar.
//
// EL BUG
// Dos acciones se registraban con una cadena escrita a mano en vez de salir de
// AuditActions:
//
//   brandController.js:79       accion: 'CREAR_MARCA'
//   quotationController.js:538  accion: 'ACTUALIZAR_COMENTARIO_ADMIN'
//
// La columna `accion` es VARCHAR(80) sin validación, así que los eventos SE
// GUARDAN perfectamente. El problema es lo que pasa después:
//
//   const VALID_ACCIONES = Object.values(AuditActions);
//
// Esa lista es la que arma el desplegable «Acción» del panel de auditoría, y es
// también contra la que el endpoint valida el filtro. Como esos dos códigos no
// están en AuditActions:
//
//   • no aparecen en el desplegable — no se pueden elegir
//   • y si alguien los pide por la API, contesta 422 diciendo que el código NO
//     EXISTE, mientras las filas están ahí guardadas
//
// O sea: la bitácora registra quién agregó marcas al catálogo y quién editó el
// comentario administrativo de una cotización, y después niega que esas
// acciones existan. Es la peor combinación posible en un registro de auditoría:
// el dato está, y el sistema dice que no.
//
// POR QUÉ UNA GUARDIA Y NO DOS ARREGLOS SUELTOS
// Porque el error se comete al escribir un logEvent nuevo, y en ese momento
// nada avisa: la acción se guarda, la pantalla no falla, y el agujero recién se
// nota meses después cuando alguien intenta filtrar por eso y no lo encuentra.
// Este archivo recorre todo el código y exige que cada acción registrada esté
// en la lista.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { AuditActions } = require('../../src/utils/auditLog');

const RAIZ = path.resolve(__dirname, '../../src');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}

const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(path.resolve(RAIZ, '..'), p).split(path.sep).join('/');

/** Toda acción escrita como cadena literal en un logEvent, con su ubicación. */
function accionesEscritasAMano() {
  const encontradas = [];

  for (const archivo of archivos) {
    // El propio archivo DEFINE las cadenas; nombrarlas ahí es su trabajo.
    if (rel(archivo) === 'src/utils/auditLog.js') continue;

    fs.readFileSync(archivo, 'utf8').split(String.fromCharCode(10)).forEach((linea, i) => {
      const t = linea.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;

      // `accion: 'ALGO'` — el literal, no `accion: AuditActions.ALGO`.
      const m = linea.match(/accion:\s*'([^']+)'/);
      if (m) encontradas.push({ codigo: m[1], donde: `${rel(archivo)}:${i + 1}` });
    });
  }

  return encontradas;
}

// ---------------------------------------------------------------------------
describe('las acciones salen de una sola lista', () => {
  test('ninguna se escribe a mano en un logEvent', () => {
    const aMano = accionesEscritasAMano();

    if (aMano.length > 0) {
      throw new Error(
        'Estas acciones se registran con una cadena escrita a mano:\n  ' +
        aMano.map((a) => `${a.codigo}  en  ${a.donde}`).join('\n  ') +
        '\n\nUsá AuditActions de src/utils/auditLog.js. Una cadena suelta se guarda ' +
        'igual —la columna es VARCHAR sin validación— pero no entra en VALID_ACCIONES, ' +
        'así que el evento queda registrado y a la vez es imposible de filtrar: el ' +
        'desplegable no la ofrece y la API contesta 422 diciendo que no existe.'
      );
    }

    expect(aMano).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('las dos que faltaban están en la lista', () => {
  // Se fijan por nombre porque son las que originaron el archivo: se
  // registraban desde hacía tiempo y nadie podía encontrarlas.
  test('CREAR_MARCA — quién agregó marcas al catálogo', () => {
    expect(AuditActions.CREAR_MARCA).toBe('CREAR_MARCA');
  });

  test('ACTUALIZAR_COMENTARIO_ADMIN — quién editó el comentario de una cotización', () => {
    expect(AuditActions.ACTUALIZAR_COMENTARIO_ADMIN).toBe('ACTUALIZAR_COMENTARIO_ADMIN');
  });
});

// ---------------------------------------------------------------------------
describe('la lista y el filtro no se pueden separar', () => {
  // VALID_ACCIONES del controlador es literalmente Object.values(AuditActions),
  // así que agregar una acción a la lista la habilita en el filtro y en la API
  // al mismo tiempo. Este test fija esa relación para que nadie la corte.
  test('cada clave de AuditActions vale igual que su nombre', () => {
    // Si una clave y su valor se separaran ('CREAR_MARCA': 'CREAR_MARCAS'), el
    // código escrito en la base y el que acepta el filtro dejarían de coincidir
    // — el mismo bug con otra cara.
    for (const [clave, valor] of Object.entries(AuditActions)) {
      expect(valor).toBe(clave);
    }
  });

  test('no hay dos acciones con el mismo código', () => {
    const valores = Object.values(AuditActions);
    expect(new Set(valores).size).toBe(valores.length);
  });
});

// ---------------------------------------------------------------------------
describe('el panel de auditoría sabe nombrar lo que registra', () => {
  test('toda acción tiene un rótulo en castellano', () => {
    // El panel cae con elegancia a mostrar el código crudo si no conoce una
    // acción, así que esto no rompe nada — pero «CREAR_MARCA» en mayúsculas y
    // con guión bajo, en una pantalla que lee el Jefe, es una fuga del código
    // fuente hacia el producto.
    const vista = fs.readFileSync(
      path.resolve(RAIZ, '../public/js/views/dashboard/modules/auditView.js'), 'utf8');

    const sinRotulo = Object.values(AuditActions).filter(
      (codigo) => !new RegExp(`\\b${codigo}:`).test(vista)
    );

    expect(sinRotulo).toEqual([]);
  });
});
