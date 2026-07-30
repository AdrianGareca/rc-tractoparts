// =============================================================================
// tests/unit/proformaTemplateActions.test.js
// Los botones de acción de la proforma (buildProformaHTML).
//
// EL BUG QUE ORIGINÓ ESTE ARCHIVO
// El backend le permitía al Jefe y al SysAdmin archivar una cotización desde
// cualquier estado, pero la plantilla NUNCA dibujó un botón de archivar. Peor:
// con la cotización en 'Confirmada' las siete condiciones del panel daban false,
// así que el bloque "Decisión del Jefe" se renderizaba vacío — el usuario abría
// la proforma y no veía ninguna acción disponible.
//
// La ironía era que el Ejecutivo (el rol de menor privilegio) sí tenía un
// selector libre de estados, y el Jefe no.
//
// Acá se pin-ea que cada capacidad real del rol tenga su botón, y que la llave
// de reapertura aparezca SÓLO donde corresponde.
// =============================================================================

import { buildProformaHTML } from '../../public/js/views/dashboard/modules/proformaTemplate.js';

/** Cotización mínima para la plantilla. */
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
  detalles: [
    { descripcion_item: 'Rodillo inferior', cantidad: 2, precio_unitario: 150, subtotal: 300 },
  ],
});

const ESTADOS_ACTIVOS = [
  'Pendiente', 'En revision', 'En espera',
  'Aprobada internamente', 'Enviada al cliente', 'Rechazada',
];

// ---------------------------------------------------------------------------
describe('botón Archivar — la capacidad existía en el back y no en la pantalla', () => {
  test.each([...ESTADOS_ACTIVOS, 'Confirmada', 'Aceptada'])(
    'el Jefe lo ve con la cotización en %s',
    (estado) => {
      const html = buildProformaHTML(cotizacion(estado), 1, 'jefe');
      expect(html).toContain('id="btn-archivar"');
    }
  );

  test('no aparece si ya está Archivada (no hay a dónde ir)', () => {
    const html = buildProformaHTML(cotizacion('Archivada'), 1, 'jefe');
    expect(html).not.toContain('id="btn-archivar"');
  });

  test('el ejecutivo delegado también lo ve: archivar sí le corresponde', () => {
    const html = buildProformaHTML(cotizacion('Confirmada'), 1, 'delegate');
    expect(html).toContain('id="btn-archivar"');
  });

  test('la vista de sólo lectura del ejecutivo no muestra acciones', () => {
    const html = buildProformaHTML(cotizacion('Confirmada'), 1, false);
    expect(html).not.toContain('id="btn-archivar"');
    expect(html).not.toContain('id="btn-reabrir"');
  });
});

// ---------------------------------------------------------------------------
describe('el panel del Jefe nunca queda vacío', () => {
  test.each([...ESTADOS_ACTIVOS, 'Confirmada', 'Aceptada'])(
    '%s ofrece al menos una acción',
    (estado) => {
      const html = buildProformaHTML(cotizacion(estado), 1, 'jefe');
      expect(html).toMatch(/<button[^>]+id="btn-/);
    }
  );
});

// ---------------------------------------------------------------------------
describe('la llave del jefe', () => {
  test.each(['Confirmada', 'Aceptada'])('aparece con la cotización en %s', (estado) => {
    const html = buildProformaHTML(cotizacion(estado), 1, 'jefe');
    expect(html).toContain('id="btn-reabrir"');
  });

  test('el bloque explica que la acción queda registrada', () => {
    const html = buildProformaHTML(cotizacion('Confirmada'), 1, 'jefe');
    expect(html).toMatch(/registr/i);
  });

  test.each(ESTADOS_ACTIVOS)('no aparece con la cotización en %s', (estado) => {
    const html = buildProformaHTML(cotizacion(estado), 1, 'jefe');
    expect(html).not.toContain('id="btn-reabrir"');
  });

  test('no aparece sobre una Archivada — la llave abre la caja, no resucita lo archivado', () => {
    const html = buildProformaHTML(cotizacion('Archivada'), 1, 'jefe');
    expect(html).not.toContain('id="btn-reabrir"');
  });

  // Reabrir una venta cerrada NO se delega: mismo criterio que revertir un
  // rechazo. El backend lo rechaza aunque el delegado opere con la matriz del
  // Jefe, así que ofrecerle el botón sería ofrecerle un 403.
  test('el ejecutivo delegado NO la ve', () => {
    const html = buildProformaHTML(cotizacion('Confirmada'), 1, 'delegate');
    expect(html).not.toContain('id="btn-reabrir"');
  });
});

// ---------------------------------------------------------------------------
describe('sin regresiones en los botones que ya estaban', () => {
  test('Pendiente sigue ofreciendo aprobar y rechazar', () => {
    const html = buildProformaHTML(cotizacion('Pendiente'), 1, 'jefe');
    expect(html).toContain('id="btn-aprobar"');
    expect(html).toContain('id="btn-rechazar"');
  });

  test('Aprobada internamente sigue ofreciendo confirmar el cierre de venta', () => {
    const html = buildProformaHTML(cotizacion('Aprobada internamente'), 1, 'jefe');
    expect(html).toContain('id="btn-aceptar"');
  });

  test('Rechazada sigue ofreciendo revertir', () => {
    const html = buildProformaHTML(cotizacion('Rechazada'), 1, 'jefe');
    expect(html).toContain('id="btn-revertir-pendiente"');
  });

  test('una Confirmada no ofrece rechazar ni poner en espera', () => {
    const html = buildProformaHTML(cotizacion('Confirmada'), 1, 'jefe');
    expect(html).not.toContain('id="btn-rechazar"');
    expect(html).not.toContain('id="btn-en-espera"');
  });
});
