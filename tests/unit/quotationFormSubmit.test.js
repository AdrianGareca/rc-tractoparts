// =============================================================================
// tests/unit/quotationFormSubmit.test.js
// Red de seguridad del armado del payload de la cotización.
//
// Esto es lo que efectivamente se guarda en la base. Un error acá no rompe la
// pantalla: guarda mal y nadie se entera hasta que el cliente recibe una
// proforma con un ítem de menos o una cantidad equivocada.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), upload: jest.fn() },
  showToast: jest.fn(),
}));

import {
  validateHeaderFields,
  findInvalidDetalle,
  buildDetalles,
  collectFormaPago,
  DEFAULT_ENTIDAD_EMISORA,
} from '../../public/js/views/quotationForm/submitPayload.js';

const item = (over = {}) => ({
  descripcion_item: 'Filtro de aceite',
  codigo: '', codigo_alternativo: '', unidad: 'UND',
  cantidad: 1, precio_unitario: 0, marca_id: null, tiempo_entrega: '',
  ...over,
});

/** Contenedor falso donde cada selector devuelve el valor configurado. */
const fakeContainer = (valores) => ({
  querySelector: (sel) => (sel in valores ? valores[sel] : null),
});

describe('validateHeaderFields', () => {
  const ok = { id_cliente: 5, descripcion: 'Repuestos', fecha_emision: '2026-07-26', fecha_validez: null };

  test('una cabecera completa no da error', () => {
    expect(validateHeaderFields(ok)).toBeNull();
  });

  test('exige elegir un cliente de la lista y le devuelve el foco', () => {
    const r = validateHeaderFields({ ...ok, id_cliente: NaN });
    expect(r.errorId).toBe('err-cliente');
    expect(r.focusId).toBe('cliente-search');
  });

  test('rechaza un id_cliente inválido', () => {
    expect(validateHeaderFields({ ...ok, id_cliente: 0 }).errorId).toBe('err-cliente');
    expect(validateHeaderFields({ ...ok, id_cliente: -3 }).errorId).toBe('err-cliente');
  });

  test('exige descripción', () => {
    expect(validateHeaderFields({ ...ok, descripcion: '' }).errorId).toBe('err-descripcion');
  });

  test('exige fecha de emisión', () => {
    expect(validateHeaderFields({ ...ok, fecha_emision: '' }).errorId).toBe('err-fecha');
  });

  test('la validez no puede ser anterior a la emisión', () => {
    const r = validateHeaderFields({ ...ok, fecha_validez: '2026-07-25' });
    expect(r.errorId).toBe('err-validez');
  });

  test('la validez puede ser el MISMO día que la emisión', () => {
    expect(validateHeaderFields({ ...ok, fecha_validez: '2026-07-26' })).toBeNull();
  });

  test('la validez posterior es válida', () => {
    expect(validateHeaderFields({ ...ok, fecha_validez: '2026-08-30' })).toBeNull();
  });

  test('valida en orden: cliente antes que descripción', () => {
    const r = validateHeaderFields({ id_cliente: 0, descripcion: '', fecha_emision: '' });
    expect(r.errorId).toBe('err-cliente');
  });
});

describe('findInvalidDetalle', () => {
  test('filas correctas no dan error', () => {
    expect(findInvalidDetalle([item({ cantidad: 2, precio_unitario: 10 })])).toBeNull();
  });

  test('detecta cantidad 0 y nombra el ítem', () => {
    const msg = findInvalidDetalle([item({ descripcion_item: 'Reten', cantidad: 0 })]);
    expect(msg).toContain('Reten');
  });

  test('detecta cantidad negativa', () => {
    expect(findInvalidDetalle([item({ cantidad: -1 })])).not.toBeNull();
  });

  test('detecta precio negativo', () => {
    expect(findInvalidDetalle([item({ precio_unitario: -5 })])).not.toBeNull();
  });

  test('un precio de 0 es válido (ítem de cortesía)', () => {
    expect(findInvalidDetalle([item({ cantidad: 1, precio_unitario: 0 })])).toBeNull();
  });

  test('ignora las filas sin descripción (no se envían)', () => {
    expect(findInvalidDetalle([item({ descripcion_item: '', cantidad: 0 })])).toBeNull();
    expect(findInvalidDetalle([item({ descripcion_item: '   ', cantidad: -9 })])).toBeNull();
  });

  test('devuelve el PRIMER ítem con problema', () => {
    const msg = findInvalidDetalle([
      item({ descripcion_item: 'Bueno', cantidad: 1 }),
      item({ descripcion_item: 'Malo1', cantidad: 0 }),
      item({ descripcion_item: 'Malo2', cantidad: -1 }),
    ]);
    expect(msg).toContain('Malo1');
    expect(msg).not.toContain('Malo2');
  });
});

describe('buildDetalles', () => {
  test('descarta las filas sin descripción', () => {
    const out = buildDetalles([
      item({ descripcion_item: 'Filtro' }),
      item({ descripcion_item: '' }),
      item({ descripcion_item: '   ' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].descripcion_item).toBe('Filtro');
  });

  test('recorta los espacios de los textos', () => {
    const out = buildDetalles([item({
      descripcion_item: '  Filtro  ', codigo: '  7E-6116  ', tiempo_entrega: '  15 dias  ',
    })]);
    expect(out[0].descripcion_item).toBe('Filtro');
    expect(out[0].codigo).toBe('7E-6116');
    expect(out[0].tiempo_entrega).toBe('15 dias');
  });

  test('los textos vacíos van como null, no como cadena vacía', () => {
    const out = buildDetalles([item({ codigo: '', codigo_alternativo: '   ', tiempo_entrega: '' })]);
    expect(out[0].codigo).toBeNull();
    expect(out[0].codigo_alternativo).toBeNull();
    expect(out[0].tiempo_entrega).toBeNull();
  });

  test('NO coacciona una cantidad de 0 a 1 (el backend debe rechazarla)', () => {
    // Convertir 0 en 1 en silencio taparía el error de tipeo del usuario y
    // guardaría una cantidad que nadie pidió.
    expect(buildDetalles([item({ cantidad: 0 })])[0].cantidad).toBe(0);
  });

  test('convierte cantidades y precios de texto a número', () => {
    const out = buildDetalles([item({ cantidad: '3', precio_unitario: '12.50' })]);
    expect(out[0].cantidad).toBe(3);
    expect(out[0].precio_unitario).toBe(12.5);
  });

  test('un precio no numérico cae a 0', () => {
    expect(buildDetalles([item({ precio_unitario: 'abc' })])[0].precio_unitario).toBe(0);
  });

  test('marca_id vacío va como null', () => {
    expect(buildDetalles([item({ marca_id: null })])[0].marca_id).toBeNull();
    expect(buildDetalles([item({ marca_id: 0 })])[0].marca_id).toBeNull();
  });

  test('conserva la marca elegida', () => {
    expect(buildDetalles([item({ marca_id: 7 })])[0].marca_id).toBe(7);
  });

  test('una lista vacía da un array vacío', () => {
    expect(buildDetalles([])).toEqual([]);
  });

  test('emite exactamente los 8 campos que el backend espera', () => {
    expect(Object.keys(buildDetalles([item()])[0]).sort()).toEqual([
      'cantidad', 'codigo', 'codigo_alternativo', 'descripcion_item',
      'marca_id', 'precio_unitario', 'tiempo_entrega', 'unidad',
    ]);
  });
});

describe('collectFormaPago', () => {
  test('devuelve el preset elegido', () => {
    const c = fakeContainer({ '#forma_pago': { value: '30% DE ANTICIPO' } });
    expect(collectFormaPago(c)).toBe('30% DE ANTICIPO');
  });

  test('con "Otro" devuelve el texto libre recortado', () => {
    const c = fakeContainer({
      '#forma_pago':        { value: '__otro__' },
      '#forma_pago_custom': { value: '  70% ANTICIPO Y SALDO A 30 DIAS  ' },
    });
    expect(collectFormaPago(c)).toBe('70% ANTICIPO Y SALDO A 30 DIAS');
  });

  test('con "Otro" y texto vacío devuelve null (el PDF usa su default)', () => {
    const c = fakeContainer({
      '#forma_pago':        { value: '__otro__' },
      '#forma_pago_custom': { value: '   ' },
    });
    expect(collectFormaPago(c)).toBeNull();
  });

  test('sin elegir nada devuelve null', () => {
    expect(collectFormaPago(fakeContainer({ '#forma_pago': { value: '' } }))).toBeNull();
  });

  test('sin el campo en el DOM devuelve null', () => {
    expect(collectFormaPago(fakeContainer({}))).toBeNull();
  });
});

describe('DEFAULT_ENTIDAD_EMISORA', () => {
  test('coincide con el DEFAULT de la columna en el esquema', () => {
    expect(DEFAULT_ENTIDAD_EMISORA).toBe('Empresa unipersonal de Ronald Roca Cartagena');
  });

  test('no es el nombre comercial legado', () => {
    expect(DEFAULT_ENTIDAD_EMISORA).not.toBe('RC Tractoparts');
  });
});
