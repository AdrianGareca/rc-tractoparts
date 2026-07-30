// =============================================================================
// tests/unit/proformaButtonsWired.test.js
// Todo botón que la proforma dibuja tiene que tener alguien que lo escuche.
//
// EL BUG QUE ORIGINÓ ESTE ARCHIVO
// Al agregar 📦 Archivar se lo habilitó para el Jefe Y para el ejecutivo con
// delegación, pero el addEventListener se escribió sólo en managerStrategy.
// Resultado: el ejecutivo delegado veía el botón, lo clickeaba, y no pasaba
// absolutamente nada. Sin error en consola, sin toast, sin request. La clase de
// falla más molesta de diagnosticar, porque todo "se ve bien".
//
// POR QUÉ PASA FÁCIL
// La plantilla (proformaTemplate.js) decide QUÉ botones existen; las strategies
// deciden QUÉ HACE cada uno. Son archivos distintos y nada los ata: agregar un
// botón en uno y olvidarse del otro no rompe ningún test... hasta este.
//
// CÓMO FUNCIONA
// Se renderiza la proforma en todos los estados y modos de vista, se juntan los
// id="btn-*" que realmente aparecen, y se verifica que la strategy que usa ese
// modo mencione cada uno. Es análisis estático del fuente, igual que
// frontendImports.test.js — no hace falta un DOM.
// =============================================================================

'use strict';

import { buildProformaHTML } from '../../public/js/views/dashboard/modules/proformaTemplate.js';

const fs   = require('fs');
const path = require('path');

const VISTAS = path.resolve(__dirname, '../../public/js/views/dashboard');

const { VALID_STATES } = require('../../src/models/quotation/constants');

const cotizacion = (estado) => ({
  id: 1,
  estado,
  numero_correlativo: 'COT-2026-0001',
  cliente_nombre: 'Agropecuaria del Este S.R.L.',
  ejecutivo_nombre: 'Ana Pérez',
  descripcion: 'Repuestos de tren de rodaje',
  moneda: 'USD',
  fecha_emision: '2026-07-01',
  fecha_validez: '2026-07-31',
  // Con PDF y Excel adjuntos para que esos botones también entren en la cuenta.
  pdf_ruta:   'uploads/cotizaciones/COT-2026-0001.pdf',
  excel_ruta: 'storage/excels/COT-2026-0001.xlsx',
  comentarios_admin: 'Verificar stock con proveedor.',
  detalles: [
    { descripcion_item: 'Rodillo inferior', cantidad: 2, precio_unitario: 150, subtotal: 300 },
  ],
});

/** Los id="btn-…" que la plantilla dibuja en ese modo, en cualquier estado. */
function botonesDe(viewMode) {
  const ids = new Set();
  for (const estado of VALID_STATES) {
    const html = buildProformaHTML(cotizacion(estado), 1, viewMode);
    for (const m of html.matchAll(/id="(btn-[\w-]+)"/g)) ids.add(m[1]);
  }
  return [...ids].sort();
}

const leer = (...p) => fs.readFileSync(path.join(VISTAS, ...p), 'utf8');

// timelineView exporta wirePdfButton / wireExcelButton: las strategies delegan
// ahí el cableado de #btn-ver-pdf y #btn-ver-excel, así que cuenta como fuente.
const timeline = leer('modules', 'timelineView.js');

const ESCENARIOS = [
  {
    nombre:   'ManagerStrategy (Jefe / SysAdmin)',
    // El Jefe se renderiza con `true` desde la Cola de Aprobación y con 'jefe'
    // desde Todas las Cotizaciones: los dos modos tienen que estar cubiertos.
    modos:    [true, 'jefe'],
    fuente:   () => leer('strategies', 'managerStrategy.js') + timeline,
  },
  {
    nombre:   'ExecutiveStrategy (ejecutivo con delegación)',
    modos:    ['delegate'],
    fuente:   () => leer('strategies', 'executiveStrategy.js') + timeline,
  },
  {
    nombre:   'ExecutiveStrategy (ejecutivo sin delegación — sólo lectura)',
    modos:    [false],
    fuente:   () => leer('strategies', 'executiveStrategy.js') + timeline,
  },
  {
    nombre:   'AdminStrategy (Administracion)',
    modos:    ['admin'],
    fuente:   () => leer('strategies', 'adminStrategy.js') + timeline,
  },
];

describe('cada botón de la proforma tiene su handler', () => {
  test.each(ESCENARIOS.map((e) => [e.nombre, e]))('%s', (_nombre, escenario) => {
    const fuente  = escenario.fuente();
    const huerfanos = [];

    for (const modo of escenario.modos) {
      for (const id of botonesDe(modo)) {
        // La strategy tiene que mencionar el selector en alguna parte.
        if (!fuente.includes(`#${id}`)) {
          huerfanos.push(`modo ${JSON.stringify(modo)} → #${id}`);
        }
      }
    }

    if (huerfanos.length > 0) {
      throw new Error(
        `${escenario.nombre} dibuja botones que nadie escucha:\n  ` +
        huerfanos.join('\n  ') +
        '\n\nEl usuario los ve, los clickea y no pasa nada.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// NOTA — la verificación inversa (handlers que apuntan a botones inexistentes)
// se probó y se descartó: cada strategy crea botones propios fuera de la
// proforma (#btn-create-user, #btn-editar-cotizacion, #btn-create-user-admin),
// así que la comprobación sólo pasaba con una lista de excepciones que hay que
// mantener a mano. Una lista así se desactualiza y termina tapando lo que
// debería avisar. El chequeo que importa — botón dibujado sin handler — es el
// de arriba, y ese no necesita excepciones.
// ---------------------------------------------------------------------------

describe('cobertura del propio test', () => {
  test('la proforma dibuja botones en cada modo operativo (si no, el test no probaría nada)', () => {
    expect(botonesDe('jefe').length).toBeGreaterThan(3);
    expect(botonesDe('delegate').length).toBeGreaterThan(3);
    expect(botonesDe('admin').length).toBeGreaterThan(0);
  });

  test('el botón de archivar entra en la cuenta de los dos modos operativos', () => {
    expect(botonesDe('jefe')).toContain('btn-archivar');
    expect(botonesDe('delegate')).toContain('btn-archivar');
  });
});
