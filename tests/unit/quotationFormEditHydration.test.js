// =============================================================================
// tests/unit/quotationFormEditHydration.test.js
// Red de seguridad de la hidratación del formulario en modo edición.
//
// Cuando un Jefe manda una cotización "a corregir", el ejecutivo la reabre y
// espera ver EXACTAMENTE lo que había guardado. Un campo que no se hidrata no
// muestra ningún error: aparece vacío, el usuario lo reenvía así, y el dato se
// pierde en silencio. Por eso el foco está en el mapeo de nombres — findById
// aliasea varias columnas (nombre_sol, nro_solicitud, area_sol…) y ahí es donde
// un typo se traga un campo entero.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  showToast: jest.fn(),
}));

import {
  populateHeaderForEdit,
  setFormaPago,
} from '../../public/js/views/quotationForm/editHydration.js';

/** Contenedor falso: cada '#id' devuelve un input con .value. */
function fakeContainer(ids = []) {
  const els = {};
  ids.forEach((id) => { els['#' + id] = { value: '', checked: false }; });
  return {
    els,
    querySelector: (sel) => els[sel] ?? null,
  };
}

const CAMPOS = [
  'cliente-search', 'id_cliente', 'descripcion', 'fecha_emision', 'fecha_validez',
  'moneda', 'entidad_emisora', 'tipo_pedido', 'observaciones', 'tiempo_entrega',
  'solicitante_nombre', 'solicitante_no_solicitud', 'solicitante_area',
  'solicitante_celular', 'solicitante_correo',
  'equipo_marca', 'equipo_tipo', 'equipo_modelo', 'equipo_serie', 'equipo_motor',
  'descuento_manual', 'mostrar_codigos',
];

describe('populateHeaderForEdit — datos del cliente', () => {
  test('vuelca el nombre en el buscador y el id en el campo oculto', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { cliente_nombre: 'Minera San Cristóbal', id_cliente: 42 });

    expect(c.els['#cliente-search'].value).toBe('Minera San Cristóbal');
    expect(c.els['#id_cliente'].value).toBe('42');
  });

  test('un id_cliente ausente deja el campo vacío, no "null"', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { id_cliente: null });

    expect(c.els['#id_cliente'].value).toBe('');
  });
});

describe('populateHeaderForEdit — fechas', () => {
  test('recorta un datetime a YYYY-MM-DD para el input date', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { fecha_emision: '2026-07-26T00:00:00.000Z' });

    expect(c.els['#fecha_emision'].value).toBe('2026-07-26');
  });

  test('convierte un objeto Date (lo que devuelve mysql2)', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { fecha_validez: new Date('2026-08-30T00:00:00.000Z') });

    expect(c.els['#fecha_validez'].value).toBe('2026-08-30');
  });

  test('una fecha nula deja el campo intacto', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { fecha_validez: null });

    expect(c.els['#fecha_validez'].value).toBe('');
  });
});

describe('populateHeaderForEdit — bloque del solicitante', () => {
  test('acepta los alias de columna que devuelve findById', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, {
      nombre_sol:    'Juan Pérez',
      nro_solicitud: 'OC-2026-0045',
      area_sol:      'Mantenimiento',
      celular_sol:   '77012345',
      correo_sol:    'juan@empresa.com',
    });

    expect(c.els['#solicitante_nombre'].value).toBe('Juan Pérez');
    expect(c.els['#solicitante_no_solicitud'].value).toBe('OC-2026-0045');
    expect(c.els['#solicitante_area'].value).toBe('Mantenimiento');
    expect(c.els['#solicitante_celular'].value).toBe('77012345');
    expect(c.els['#solicitante_correo'].value).toBe('juan@empresa.com');
  });

  test('también acepta los nombres sin alias', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { solicitante_nombre: 'Ana', solicitante_area: 'Compras' });

    expect(c.els['#solicitante_nombre'].value).toBe('Ana');
    expect(c.els['#solicitante_area'].value).toBe('Compras');
  });
});

describe('populateHeaderForEdit — bloque del equipo', () => {
  test('vuelca los cinco campos', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, {
      equipo_marca: 'Caterpillar', equipo_tipo: 'Excavadora',
      equipo_modelo: '336', equipo_serie: 'CAT0336XXXXX', equipo_motor: 'C9.3',
    });

    expect(c.els['#equipo_marca'].value).toBe('Caterpillar');
    expect(c.els['#equipo_tipo'].value).toBe('Excavadora');
    expect(c.els['#equipo_modelo'].value).toBe('336');
    expect(c.els['#equipo_serie'].value).toBe('CAT0336XXXXX');
    expect(c.els['#equipo_motor'].value).toBe('C9.3');
  });
});

describe('populateHeaderForEdit — entidad emisora', () => {
  test('mapea el nombre comercial legado a la razón social actual', () => {
    // Si no se mapeara, el <select> no encontraría la opción y quedaría en la
    // primera, cambiando en silencio la entidad emisora de la cotización.
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { entidad_emisora: 'RC Tractoparts' });

    expect(c.els['#entidad_emisora'].value).toBe('Empresa unipersonal de Ronald Roca Cartagena');
  });

  test('respeta la otra razón social', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, { entidad_emisora: 'Roca Importaciones S.R.L.' });

    expect(c.els['#entidad_emisora'].value).toBe('Roca Importaciones S.R.L.');
  });

  test('sin entidad guardada cae a la principal', () => {
    const c = fakeContainer(CAMPOS);

    populateHeaderForEdit(c, {});

    expect(c.els['#entidad_emisora'].value).toBe('Empresa unipersonal de Ronald Roca Cartagena');
  });
});

describe('populateHeaderForEdit — mostrar_codigos', () => {
  test('un 1 de la base tilda la casilla', () => {
    const c = fakeContainer(CAMPOS);
    populateHeaderForEdit(c, { mostrar_codigos: 1 });
    expect(c.els['#mostrar_codigos'].checked).toBe(true);
  });

  test('un 0 la destilda', () => {
    const c = fakeContainer(CAMPOS);
    populateHeaderForEdit(c, { mostrar_codigos: 0 });
    expect(c.els['#mostrar_codigos'].checked).toBe(false);
  });

  test('ausente queda tildada (es el default del esquema)', () => {
    const c = fakeContainer(CAMPOS);
    populateHeaderForEdit(c, {});
    expect(c.els['#mostrar_codigos'].checked).toBe(true);
  });
});

describe('populateHeaderForEdit — robustez', () => {
  test('un contenedor sin los campos no rompe', () => {
    expect(() => populateHeaderForEdit(fakeContainer([]), { descripcion: 'x' })).not.toThrow();
  });

  test('una cotización vacía no rompe', () => {
    expect(() => populateHeaderForEdit(fakeContainer(CAMPOS), {})).not.toThrow();
  });
});

describe('setFormaPago', () => {
  /** Contenedor con el select, el grupo del campo libre y el input. */
  function fakeFormaPago(opciones) {
    const sel = {
      value: '',
      options: opciones.map((v) => ({ value: v })),
    };
    const group = { style: { display: '' } };
    const input = { value: '' };
    return {
      sel, group, input,
      querySelector: (s) => ({
        '#forma_pago': sel,
        '#forma_pago_custom_group': group,
        '#forma_pago_custom': input,
      }[s] ?? null),
    };
  }

  const PRESETS = ['', '20% DE ANTICIPO', '30% DE ANTICIPO', '__otro__'];

  test('un preset guardado se selecciona directo y oculta el campo libre', () => {
    const c = fakeFormaPago(PRESETS);

    setFormaPago(c, '30% DE ANTICIPO');

    expect(c.sel.value).toBe('30% DE ANTICIPO');
    expect(c.group.style.display).toBe('none');
    expect(c.input.value).toBe('');
  });

  test('un valor que NO es preset elige "Otro" y revela el texto guardado', () => {
    const c = fakeFormaPago(PRESETS);

    setFormaPago(c, '70% ANTICIPO Y SALDO A 30 DIAS');

    expect(c.sel.value).toBe('__otro__');
    expect(c.group.style.display).toBe('');
    expect(c.input.value).toBe('70% ANTICIPO Y SALDO A 30 DIAS');
  });

  test('vacío deja la opción por defecto y oculta el campo libre', () => {
    const c = fakeFormaPago(PRESETS);

    setFormaPago(c, '');

    expect(c.sel.value).toBe('');
    expect(c.group.style.display).toBe('none');
  });

  test('"__otro__" no se considera un preset válido', () => {
    // Si se tratara como preset, el select quedaría en "Otro" con el campo
    // libre oculto: el usuario no podría ver ni corregir el texto.
    const c = fakeFormaPago(PRESETS);

    setFormaPago(c, '__otro__');

    expect(c.sel.value).toBe('__otro__');
    expect(c.group.style.display).toBe('');
  });

  test('sin el select en el DOM no rompe', () => {
    expect(() => setFormaPago({ querySelector: () => null }, 'x')).not.toThrow();
  });
});
