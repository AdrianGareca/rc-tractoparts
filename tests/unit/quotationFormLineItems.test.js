// =============================================================================
// tests/unit/quotationFormLineItems.test.js
// Red de seguridad del componente de filas de ítems.
//
// El foco está en findDuplicateRow: es la única regla de NEGOCIO del formulario
// que no vivía en quotationTotals.js. Fusionar de más arruina una cotización
// (cantidades sumadas que el cliente no pidió) y fusionar de menos duplica
// líneas. La clave es COMPUESTA — código + marca — porque CAT y CUMMINS pueden
// compartir número de parte.
// =============================================================================

'use strict';

import {
  safeAttr,
  buildRowHtml,
  findDuplicateRow,
} from '../../public/js/views/quotationForm/lineItemsComponent.js';

const row = (codigo, marca_id = null, cantidad = 1) => ({ codigo, marca_id, cantidad });

describe('safeAttr', () => {
  test('escapa comillas dobles y ampersands', () => {
    expect(safeAttr('7E"6116')).toBe('7E&quot;6116');
    expect(safeAttr('A&B')).toBe('A&amp;B');
  });

  test('escapa el ampersand primero (sin doble escape)', () => {
    expect(safeAttr('&quot;')).toBe('&amp;quot;');
  });

  test('neutraliza un escape del atributo value', () => {
    const html = buildRowHtml(0, { descripcion_item: '" onfocus="alert(1)' });
    expect(html).not.toContain('onfocus="alert(1)"');
    expect(html).toContain('&quot; onfocus=&quot;alert(1)');
  });

  test('null y undefined dan string vacío', () => {
    expect(safeAttr(null)).toBe('');
    expect(safeAttr(undefined)).toBe('');
  });
});

describe('buildRowHtml', () => {
  test('una fila nueva usa los valores por defecto', () => {
    const html = buildRowHtml(0);
    expect(html).toContain('value="1"');          // cantidad
    expect(html).toContain('value="0"');          // precio
    expect(html).toContain('value="UND" selected');
  });

  test('propaga el índice a todos los data-idx de la fila', () => {
    const html = buildRowHtml(7);
    expect(html).toContain('data-idx="7"');
    expect(html).toContain('data-item-subtotal="7"');
    expect(html).toContain('data-remove="7"');
  });

  test('hidrata los valores de un ítem existente', () => {
    const html = buildRowHtml(0, {
      descripcion_item: 'Filtro de aceite',
      codigo:           '7E-6116',
      cantidad:         5,
      precio_unitario:  120.5,
      unidad:           'PZA',
    });
    expect(html).toContain('value="Filtro de aceite"');
    expect(html).toContain('value="7E-6116"');
    expect(html).toContain('value="5"');
    expect(html).toContain('value="120.5"');
    expect(html).toContain('value="PZA" selected');
  });

  test('marca la marca seleccionada y escapa su nombre', () => {
    const brands = [{ id: 1, nombre: 'CAT' }, { id: 2, nombre: '<b>Komatsu</b>' }];
    const html = buildRowHtml(0, { marca_id: 2 }, brands);

    expect(html).toContain('<option value="2" selected>');
    expect(html).toContain('&lt;b&gt;Komatsu&lt;/b&gt;');
    expect(html).not.toContain('<b>Komatsu</b>');
  });

  test('sin marcas sólo queda la opción "Sin marca"', () => {
    expect(buildRowHtml(0, null, [])).toContain('— Sin marca —');
  });

  test('mantiene las 4 unidades de medida', () => {
    const html = buildRowHtml(0);
    ['PZA', 'GGO', 'KIT', 'UND'].forEach(u => expect(html).toContain(`value="${u}"`));
  });
});

describe('findDuplicateRow — fusiona', () => {
  test('mismo código y misma marca', () => {
    const items = [row('7E-6116', 1, 2), row('7E-6116', 1, 3)];
    expect(findDuplicateRow(items, 1, '7E-6116')).toEqual({ dupeIdx: 0, merged: 5 });
  });

  test('ignora mayúsculas y espacios del código', () => {
    const items = [row('  7e-6116 ', 1, 2), row('7E-6116', 1, 1)];
    expect(findDuplicateRow(items, 1, '7E-6116')).toEqual({ dupeIdx: 0, merged: 3 });
  });

  // ── ESTOS DOS ESPERABAN LO CONTRARIO, Y ERA EL BUG ────────────────────────
  // Afirmaban que dos filas sin marca con el mismo código SÍ debían fusionarse.
  // Ventas reportó el síntoma: «sobre mismos códigos de ítems pero diferente
  // marca se borra».
  //
  // La causa es de momento: la fusión se dispara al SALIR del campo Código, y
  // el orden natural de carga es descripción → código → marca. Al salir del
  // código de la segunda fila el usuario todavía no eligió su marca, así que
  // las dos valen null, se ven idénticas, y la fila se borra junto con la marca
  // que estaba por elegir.
  //
  // Los tests no «no cubrían» el agujero: lo declaraban correcto. Quien
  // intentara arreglarlo se los habría encontrado en rojo. Ver la justificación
  // completa en tests/unit/fusionItemsMarca.test.js.
  test('dos filas SIN marca con el mismo código NO se fusionan', () => {
    const items = [row('P553191', null, 4), row('P553191', null, 6)];
    expect(findDuplicateRow(items, 1, 'P553191')).toBeNull();
  });

  test('una marca ausente no equivale a otra ausente: son dos desconocidas', () => {
    // `undefined` y `null` siguen normalizándose igual entre sí — lo que cambió
    // es que «desconocida» ya no habilita la fusión.
    const items = [{ codigo: 'X1', cantidad: 1 }, row('X1', null, 1)];
    expect(findDuplicateRow(items, 1, 'X1')).toBeNull();
  });

  test('redondea la cantidad fusionada a 4 decimales', () => {
    const items = [row('X', 1, 0.1), row('X', 1, 0.2)];
    expect(findDuplicateRow(items, 1, 'X')).toEqual({ dupeIdx: 0, merged: 0.3 });
  });

  test('una cantidad no numérica cuenta como 1', () => {
    const items = [row('X', 1, 'abc'), row('X', 1, 2)];
    expect(findDuplicateRow(items, 1, 'X')).toEqual({ dupeIdx: 0, merged: 3 });
  });

  test('devuelve el PRIMER duplicado cuando hay varios', () => {
    const items = [row('X', 1, 1), row('X', 1, 2), row('X', 1, 5)];
    expect(findDuplicateRow(items, 2, 'X')).toEqual({ dupeIdx: 0, merged: 6 });
  });
});

describe('findDuplicateRow — NO fusiona', () => {
  test('mismo código pero marcas distintas (CAT vs CUMMINS)', () => {
    const items = [row('7E-6116', 1, 2), row('7E-6116', 2, 3)];
    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
  });

  test('una fila con marca y otra sin marca', () => {
    const items = [row('7E-6116', 1, 2), row('7E-6116', null, 3)];
    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
  });

  test('códigos distintos', () => {
    const items = [row('7E-6116', 1, 2), row('P553191', 1, 3)];
    expect(findDuplicateRow(items, 1, 'P553191')).toBeNull();
  });

  test('nunca se fusiona consigo misma', () => {
    expect(findDuplicateRow([row('7E-6116', 1, 2)], 0, '7E-6116')).toBeNull();
  });

  test('código en blanco o sólo espacios', () => {
    const items = [row('X', 1, 1), row('', 1, 1)];
    expect(findDuplicateRow(items, 1, '')).toBeNull();
    expect(findDuplicateRow(items, 1, '   ')).toBeNull();
    expect(findDuplicateRow(items, 1, null)).toBeNull();
  });

  test('las filas existentes sin código no cuentan como duplicado', () => {
    const items = [row('', 1, 1), row(null, 1, 1), row('X', 1, 1)];
    expect(findDuplicateRow(items, 2, 'X')).toBeNull();
  });

  test('un índice actual inexistente no rompe', () => {
    const items = [row('X', 1, 1)];
    expect(() => findDuplicateRow(items, 99, 'Y')).not.toThrow();
    expect(findDuplicateRow(items, 99, 'Y')).toBeNull();
  });

  test('lista vacía', () => {
    expect(findDuplicateRow([], 0, 'X')).toBeNull();
  });
});
