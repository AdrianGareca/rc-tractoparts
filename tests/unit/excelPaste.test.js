// =============================================================================
// tests/unit/excelPaste.test.js
// Red de seguridad del pegado masivo de ítems desde Excel.
//
// EL FOCO: parseNumero. Una planilla puede traer números en dos formatos que
// se ven casi iguales a simple vista pero significan cosas MUY distintas:
//   6,800.00  (coma miles / punto decimal)
//   6.800,00  (punto miles / coma decimal — el que usa Bolivia)
// Confundir uno con el otro no da un error: da un precio 1000 veces más chico
// o una cantidad 10 veces más grande, silenciosamente, en una cotización real.
// =============================================================================

'use strict';

import { parseNumero, parseExcelPaste } from '../../public/js/views/quotationForm/excelPaste.js';

describe('parseNumero — formato coma-miles / punto-decimal', () => {
  test.each([
    ['6,800.00', 6800],
    ['1,234,567.89', 1234567.89],
    ['900.00', 900],
    ['0.5', 0.5],
  ])('%s -> %d', (entrada, esperado) => {
    expect(parseNumero(entrada)).toBe(esperado);
  });
});

describe('parseNumero — formato punto-miles / coma-decimal (boliviano)', () => {
  test.each([
    ['6.800,00', 6800],
    ['1.234.567,89', 1234567.89],
    ['900,00', 900],
    ['1,5', 1.5],
  ])('%s -> %d', (entrada, esperado) => {
    expect(parseNumero(entrada)).toBe(esperado);
  });
});

describe('parseNumero — el bug real que esto reemplaza', () => {
  // Antes: se borraban las comas sin convertirlas a punto decimal. Un valor
  // boliviano quedaba con DOS puntos ("6.800.00") y parseFloat cortaba en el
  // primer número válido — 6.8 en vez de 6800. Y "1,5" perdía la coma sin
  // reemplazo y quedaba "15" — diez veces más grande que el real 1.5.
  test('"6.800,00" no da 6.8 (mil veces menos)', () => {
    expect(parseNumero('6.800,00')).toBe(6800);
    expect(parseNumero('6.800,00')).not.toBeCloseTo(6.8);
  });

  test('"1,5" no da 15 (diez veces más)', () => {
    expect(parseNumero('1,5')).toBe(1.5);
    expect(parseNumero('1,5')).not.toBe(15);
  });
});

describe('parseNumero — casos sin ambigüedad', () => {
  test.each([
    ['16', 16],
    ['8', 8],
    ['-45.50', -45.5],
    [' 300 ', 300],
    ['Bs. 1.100,00', 1100],   // símbolo de moneda pegado, se descarta
  ])('%s -> %d', (entrada, esperado) => {
    expect(parseNumero(entrada)).toBe(esperado);
  });

  test('vacío o no numérico da NaN', () => {
    expect(parseNumero('')).toBeNaN();
    expect(parseNumero('   ')).toBeNaN();
    expect(parseNumero(null)).toBeNaN();
    expect(parseNumero(undefined)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
describe('parseExcelPaste — con fila de encabezado', () => {
  const conEncabezado = [
    'ITEM\tCÓDIGO\tCODIGO ALTERNATIVO\tDESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO\tPRECIO TOTAL',
    '1\tT228830\t\tBUJE DE VALDE\t1\tPZA\t6,800.00\t6,800.00',
    '2\tT225569\t\tRETEN DE BUJE DE VALDE\t2\tPZA\t900.00\t1,800.00',
    '4\tK3L\tTK3L\tSEGURO DE PASADOR DE UÑA\t16\tPZA\t300.00\t4,800.00',
    '\t\t\t\t\t\t\t',
    '\t\t\t\tTOTAL BOLIVIANOS\t\t\t45,400.00',
  ].join('\n');

  test('reconoce los 3 ítems y descarta la fila vacía y la de TOTAL', () => {
    const { items, advertencias } = parseExcelPaste(conEncabezado);
    expect(items).toHaveLength(3);
    expect(advertencias).toEqual([]);
  });

  test('mapea código, código alternativo, descripción, cantidad y precio', () => {
    const { items } = parseExcelPaste(conEncabezado);
    expect(items[0]).toMatchObject({
      descripcion_item: 'BUJE DE VALDE',
      codigo: 'T228830',
      codigo_alternativo: '',
      unidad: 'PZA',
      cantidad: 1,
      precio_unitario: 6800,
    });
    expect(items[2]).toMatchObject({
      codigo: 'K3L',
      codigo_alternativo: 'TK3L',
      cantidad: 16,
      precio_unitario: 300,
    });
  });

  test('marca y tiempo de entrega quedan vacíos — no vienen en la planilla', () => {
    const { items } = parseExcelPaste(conEncabezado);
    for (const item of items) {
      expect(item.marca_id).toBeNull();
      expect(item.tiempo_entrega).toBe('');
    }
  });
});

describe('parseExcelPaste — sin fila de encabezado (posición fija)', () => {
  test('con columna de ITEM al inicio (8 columnas)', () => {
    const texto = '1\tT228830\t\tBUJE DE VALDE\t1\tPZA\t6800\t6800';
    const { items } = parseExcelPaste(texto);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ codigo: 'T228830', descripcion_item: 'BUJE DE VALDE', cantidad: 1, precio_unitario: 6800 });
  });

  test('sin columna de ITEM (7 columnas)', () => {
    const texto = 'T228830\t\tBUJE DE VALDE\t1\tPZA\t6800\t6800';
    const { items } = parseExcelPaste(texto);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ codigo: 'T228830', descripcion_item: 'BUJE DE VALDE' });
  });

  test('una fila que no calza en ningún formato conocido se reporta como advertencia, no como ítem', () => {
    const { items, advertencias } = parseExcelPaste('algo\tsuelto');
    expect(items).toHaveLength(0);
    expect(advertencias).toHaveLength(1);
  });
});

describe('parseExcelPaste — unidades', () => {
  test('reconoce variantes comunes de unidad', () => {
    const texto = [
      'DESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO',
      'A\t1\tPZA\t10',
      'B\t1\tJGO\t10',
      'C\t1\tKIT\t10',
      'D\t1\tUNIDAD\t10',
    ].join('\n');
    const { items, advertencias } = parseExcelPaste(texto);
    expect(items.map((i) => i.unidad)).toEqual(['PZA', 'GGO', 'KIT', 'UND']);
    expect(advertencias).toEqual([]);
  });

  test('una unidad no reconocida cae a UND y avisa', () => {
    const texto = 'DESCRIPCION\tUNI\nItem raro\tBULTOS';
    const { items, advertencias } = parseExcelPaste(texto);
    expect(items[0].unidad).toBe('UND');
    expect(advertencias.some((a) => a.includes('BULTOS'))).toBe(true);
  });
});

describe('parseExcelPaste — casos borde', () => {
  test('texto vacío no rompe, devuelve listas vacías', () => {
    expect(parseExcelPaste('')).toEqual({ items: [], advertencias: [] });
    expect(parseExcelPaste(null)).toEqual({ items: [], advertencias: [] });
  });

  test('una fila sin descripción se descarta silenciosamente (espaciadora)', () => {
    const { items } = parseExcelPaste('DESCRIPCION\tCANT.\n\t5');
    expect(items).toHaveLength(0);
  });
});
