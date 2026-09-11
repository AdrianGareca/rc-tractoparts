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

import { parseNumero, parseExcelPaste, dividirFilasTSV } from '../../public/js/views/quotationForm/excelPaste.js';

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

describe('parseNumero — notación científica', () => {
  // BUG REAL: la limpieza de caracteres sólo dejaba dígitos/coma/punto/guion,
  // así que la "e" desaparecía sin avisar y "1e10" quedaba pegado como "110"
  // (mil veces menos de lo que decía la celda).
  test.each([
    ['1e10', 1e10],
    ['1.5E+3', 1500],
    ['-2.5e-2', -0.025],
    ['1,5e3', 1500],   // coma decimal (formato boliviano) + notación científica
  ])('%s -> %d', (entrada, esperado) => {
    expect(parseNumero(entrada)).toBeCloseTo(esperado);
  });
});

describe('parseNumero — más de un signo es basura, no un número raro', () => {
  // BUG REAL: "--5" se leía como si el segundo guion no estuviera y devolvía
  // 5 sin ningún aviso — un dato ambiguo (guion de más al pegar, o una resta
  // sin terminar) se convertía en uno que parece perfectamente válido.
  test.each(['--5', '-5-', '5-', '1-2'])('%s da NaN, no un número silencioso', (entrada) => {
    expect(parseNumero(entrada)).toBeNaN();
  });

  test('un solo signo al principio sigue funcionando normal', () => {
    expect(parseNumero('-5')).toBe(-5);
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
      'E\t1\tLITROS\t10',
      'F\t1\tKILO\t10',
      'G\t1\tMETROS\t10',
    ].join('\n');
    const { items, advertencias } = parseExcelPaste(texto);
    expect(items.map((i) => i.unidad)).toEqual(['PZA', 'JGOS', 'KIT', 'UNI', 'LTS', 'KG', 'MTS']);
    expect(advertencias).toEqual([]);
  });

  test('una planilla armada con los códigos VIEJOS se traduce a los nuevos', () => {
    // Quien tenga una plantilla de antes del cambio de lista (2026-09-01) no
    // tiene por qué saber que GGO pasó a JGOS y UND a UNI. Lo que quiso decir
    // es evidente, así que se traduce en vez de avisarle que no se reconoce.
    const texto = [
      'DESCRIPCION\tUNI',
      'A\tGGO',
      'B\tUND',
    ].join('\n');
    const { items, advertencias } = parseExcelPaste(texto);
    expect(items.map((i) => i.unidad)).toEqual(['JGOS', 'UNI']);
    expect(advertencias).toEqual([]);
  });

  test('una unidad no reconocida cae a la de por defecto y avisa', () => {
    const texto = 'DESCRIPCION\tUNI\nItem raro\tBULTOS';
    const { items, advertencias } = parseExcelPaste(texto);
    expect(items[0].unidad).toBe('UNI');
    expect(advertencias.some((a) => a.includes('BULTOS'))).toBe(true);
  });
});

describe('parseExcelPaste — una descripción real no se confunde con el encabezado', () => {
  // BUG REAL: antes bastaba con que una celda EMPEZARA con "DESCRIPCION" para
  // tratar toda la fila como encabezado. Un ítem legítimo sin fila de
  // encabezado pegada, cuya descripción arranca así, disparaba lo mismo — y
  // como ninguna celda de esa fila matcheaba un alias real, el mapeo de
  // columnas quedaba vacío y TODAS las filas siguientes también se
  // descartaban (no sólo esa una).
  test('un ítem sin encabezado cuya descripción empieza con "Descripcion" se importa igual', () => {
    const texto = [
      'COD1\tALT1\tDescripcion general del kit hidraulico\t5\tPZA\t100\t500',
      'COD2\tALT2\tOtro repuesto cualquiera\t2\tUND\t50\t100',
    ].join('\n');

    const { items, advertencias } = parseExcelPaste(texto);

    expect(items).toHaveLength(2);
    expect(items[0].descripcion_item).toBe('Descripcion general del kit hidraulico');
    expect(items[0].cantidad).toBe(5);
    expect(items[1].descripcion_item).toBe('Otro repuesto cualquiera');
    expect(advertencias).toEqual([]);
  });

  test('una fila de encabezado real todavía se reconoce (match exacto)', () => {
    const texto = [
      'CODIGO\tALTERNATIVO\tDESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO',
      'COD1\tALT1\tItem normal\t3\tPZA\t10',
    ].join('\n');

    const { items } = parseExcelPaste(texto);

    expect(items).toHaveLength(1);
    expect(items[0].descripcion_item).toBe('Item normal');
  });
});

describe('parseExcelPaste — casos borde', () => {
  test('texto vacío no rompe, devuelve listas vacías', () => {
    expect(parseExcelPaste('')).toEqual({ items: [], advertencias: [], columnasIgnoradas: [] });
    expect(parseExcelPaste(null)).toEqual({ items: [], advertencias: [], columnasIgnoradas: [] });
  });

  test('una fila sin descripción se descarta silenciosamente (espaciadora)', () => {
    const { items } = parseExcelPaste('DESCRIPCION\tCANT.\n\t5');
    expect(items).toHaveLength(0);
  });
});

// =============================================================================
// LA PLANILLA REAL DE LA EMPRESA (2026-09-11)
//
// Pegada tal cual la mandó Adrian, y con ella el parser viejo descartaba en
// silencio la MARCA y el TIEMPO DE ENTREGA: de diez columnas aprovechaba
// cuatro. Y aunque se agregara el alias, el tiempo de entrega se habría
// perdido igual — el encabezado «PRECIO TOTAL» tiene un salto de línea DENTRO
// de la celda, Excel lo copia entre comillas, y cortar por líneas partía la
// fila de encabezado en dos: «TIEMPO DE ENTREGA» quedaba en una segunda línea
// que nunca se leía como encabezado.
// =============================================================================
describe('parseExcelPaste — la planilla real de la empresa', () => {
  const PLANILLA = [
    'ITEM\tCÓDIGO\tCODIGO ALTERNATIVO\tMARCA\tDESCRIPCION \tCANT.\tUNI\tPRECIO UNITARIO\t"PRECIO ',
    'TOTAL"\tTIEMPO DE ENTREGA',
    '1\t8M-4987\t\tCATERPILLAR\tANILLO D/GOMA\t1\tUN\t1.00\t1.00 \t15 DIAS CALENDARIO / ORIGINAL',
    '2\t122-7352\t\tCATERPILLAR\tASIENTO D/V \t24\tUN\t15.00\t360.00 \t15 DIAS CALENDARIO / ORIGINAL',
    '5\t6N-6444\t\tCATERPILLAR\tELEMENTO \t1\tUN\t35.00\t35.00 \t15 DIAS CALENDARIO / ORIGINAL',
    '6\t7X-7657\t\tCATERPILLAR\tEMPAQ.\t2\tKIT\t225.00\t450.00 \t15 DIAS CALENDARIO / ORIGINAL',
    '7\t9L-6647\t\tCATERPILLAR\tCORREA \t3\tUN\t15.00\t45.00 \t15 DIAS CALENDARIO / ORIGINAL',
    'TOTAL USD\t\t\t\t\t\t\t\t891.00 \t',
  ].join('\n');

  test('importa los 5 repuestos y descarta la fila de TOTAL', () => {
    expect(parseExcelPaste(PLANILLA).items).toHaveLength(5);
  });

  test('lee el código, la marca y el tiempo de entrega', () => {
    const { items } = parseExcelPaste(PLANILLA);
    expect(items[0]).toMatchObject({
      codigo:           '8M-4987',
      marca_texto:      'CATERPILLAR',
      descripcion_item: 'ANILLO D/GOMA',
      cantidad:         1,
      unidad:           'UNI',
      precio_unitario:  1,
      tiempo_entrega:   '15 DIAS CALENDARIO / ORIGINAL',
    });
    expect(items[3]).toMatchObject({ unidad: 'KIT', cantidad: 2, precio_unitario: 225 });
  });

  test('la marca queda como TEXTO: el catálogo la resuelve después', () => {
    // El parser es puro y no conoce el catálogo; la traducción de «CATERPILLAR»
    // a una marca real la hace resolverMarcas (marcasParecidas.js).
    for (const item of parseExcelPaste(PLANILLA).items) expect(item.marca_id).toBeNull();
  });

  test('la unidad «UN» se reconoce sin avisar', () => {
    expect(parseExcelPaste(PLANILLA).advertencias).toEqual([]);
  });

  test('ITEM y PRECIO TOTAL no se reportan como ignoradas: se recalculan', () => {
    expect(parseExcelPaste(PLANILLA).columnasIgnoradas).toEqual([]);
  });
});

describe('dividirFilasTSV — lo que Excel pone en el portapapeles', () => {
  test.each([
    ['celdas y filas simples',          'a\tb\nc\td',                 [['a', 'b'], ['c', 'd']]],
    ['fin de línea de Windows',         'a\tb\r\nc\td',               [['a', 'b'], ['c', 'd']]],
    ['salto de línea DENTRO de celda',  '"x\ny"\tz',                  [['x\ny', 'z']]],
    ['tab DENTRO de celda',             '"x\ty"\tz',                  [['x\ty', 'z']]],
    ['comillas dobladas',               '"12"" MANGUERA"\t2',         [['12" MANGUERA', '2']]],
    ['comilla al final, sin campo',     'MANGUERA 3/4"\t2',           [['MANGUERA 3/4"', '2']]],
    ['comilla que nunca cierra',        '"ABIERTO\tfin',              [['"ABIERTO', 'fin']]],
    ['comilla que no cierra la celda',  '"TAPA" DE MOTOR\t1',         [['"TAPA" DE MOTOR', '1']]],
    ['salto de línea final',            'a\tb\n',                     [['a', 'b']]],
    ['celda vacía entrecomillada',      '""\tb',                      [['', 'b']]],
  ])('%s', (_nombre, entrada, esperado) => {
    expect(dividirFilasTSV(entrada)).toEqual(esperado);
  });

  test('texto vacío no devuelve filas', () => {
    expect(dividirFilasTSV('')).toEqual([]);
  });
});

// =============================================================================
// BUG ENCONTRADO EL 2026-09-11: una descripción con la palabra TOTAL
//
// La regla para saltear la fila de totales era «alguna celda contiene TOTAL».
// Un repuesto real como «KIT DE REPARACION TOTAL DE MOTOR» cumplía la regla y
// se descartaba EN SILENCIO: de dos ítems pegados entraba uno, sin ningún
// aviso. Comprobado contra el parser antes de corregirlo.
// =============================================================================
describe('parseExcelPaste — una descripción con la palabra TOTAL no se pierde', () => {
  const ENCABEZADO = 'DESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO';

  test('un repuesto que menciona TOTAL en la descripción se importa', () => {
    const texto = [ENCABEZADO, 'KIT DE REPARACION TOTAL DE MOTOR\t1\tKIT\t500', 'FILTRO DE ACEITE\t2\tPZA\t15'].join('\n');
    expect(parseExcelPaste(texto).items.map((i) => i.descripcion_item))
      .toEqual(['KIT DE REPARACION TOTAL DE MOTOR', 'FILTRO DE ACEITE']);
  });

  test('«TOTALIZADOR DE HORAS» es un repuesto, no una fila de total', () => {
    const texto = [ENCABEZADO, 'TOTALIZADOR DE HORAS\t1\tPZA\t80'].join('\n');
    expect(parseExcelPaste(texto).items).toHaveLength(1);
  });

  test('una descripción que EMPIEZA con TOTAL, pero con código, se importa', () => {
    const texto = ['CODIGO\tDESCRIPCION\tCANT.', 'A-1\tTOTAL KIT DE JUNTAS\t1'].join('\n');
    expect(parseExcelPaste(texto).items).toHaveLength(1);
  });

  test.each([['TOTAL USD'], ['TOTAL BOLIVIANOS'], ['SUBTOTAL'], ['Total:']])('«%s» sí se descarta', (rotulo) => {
    const texto = [ENCABEZADO, `${rotulo}\t\t\t891`].join('\n');
    expect(parseExcelPaste(texto).items).toEqual([]);
  });

  test('una fila de total que además suma las cantidades se descarta', () => {
    const texto = [
      'ITEM\tCÓDIGO\tCODIGO ALTERNATIVO\tDESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO\tPRECIO TOTAL',
      '1\tA1\t\tFILTRO\t2\tPZA\t10\t20',
      '\t\t\tTOTAL\t2\t\t\t20',
    ].join('\n');
    expect(parseExcelPaste(texto).items).toHaveLength(1);
  });
});

describe('parseExcelPaste — columnas que no se importan', () => {
  test('se avisan por su nombre, tal como vienen en la planilla', () => {
    const texto = ['DESCRIPCION\tCANT.\tProveedor\tOBSERVACIONES', 'X\t1\tACME\tnada'].join('\n');
    expect(parseExcelPaste(texto).columnasIgnoradas).toEqual(['Proveedor', 'OBSERVACIONES']);
  });

  test('sin fila de encabezado no hay nada que avisar', () => {
    expect(parseExcelPaste('T228830\t\tBUJE\t1\tPZA\t6800\t6800').columnasIgnoradas).toEqual([]);
  });
});

describe('parseExcelPaste — más variantes de unidad', () => {
  test('UN, PZS, JGS, LTR, MTR, KGR y con punto final se reconocen', () => {
    const filas = ['UN', 'UN.', 'PZS', 'PZAS', 'JGS', 'LTR', 'MTR', 'KGR']
      .map((u, i) => `Item ${i}\t1\t${u}\t10`);
    const { items, advertencias } = parseExcelPaste(['DESCRIPCION\tCANT.\tUNI\tPRECIO UNITARIO', ...filas].join('\n'));
    expect(items.map((i) => i.unidad)).toEqual(['UNI', 'UNI', 'PZA', 'PZA', 'JGOS', 'LTS', 'MTS', 'KG']);
    expect(advertencias).toEqual([]);
  });
});

describe('parseExcelPaste — la plantilla nueva pegada sin encabezado', () => {
  test('10 columnas (con ITEM): lee la marca y el tiempo de entrega', () => {
    const t = '1\t8M-4987\t\tCATERPILLAR\tANILLO D/GOMA\t1\tUN\t1.00\t1.00\t15 DIAS CALENDARIO / ORIGINAL';
    expect(parseExcelPaste(t).items[0]).toMatchObject({
      codigo: '8M-4987', marca_texto: 'CATERPILLAR', descripcion_item: 'ANILLO D/GOMA',
      cantidad: 1, precio_unitario: 1, tiempo_entrega: '15 DIAS CALENDARIO / ORIGINAL',
    });
  });

  test('9 columnas (sin ITEM)', () => {
    const t = '8M-4987\t\tCATERPILLAR\tANILLO D/GOMA\t1\tUN\t1.00\t1.00\t15 DIAS';
    expect(parseExcelPaste(t).items[0]).toMatchObject({
      codigo: '8M-4987', marca_texto: 'CATERPILLAR', descripcion_item: 'ANILLO D/GOMA', tiempo_entrega: '15 DIAS',
    });
  });

  test('10 columnas con el tiempo de entrega vacío sigue siendo la plantilla nueva', () => {
    const t = '1\t8M-4987\t\tCATERPILLAR\tANILLO D/GOMA\t1\tUN\t1.00\t1.00\t';
    expect(parseExcelPaste(t).items[0]).toMatchObject({ descripcion_item: 'ANILLO D/GOMA', tiempo_entrega: '' });
  });

  test('una fila vieja de 8 columnas con dos columnas extra al final no se lee como la nueva', () => {
    // 10 celdas, pero donde la plantilla nueva espera la cantidad hay «PZA»:
    // se vuelve al orden viejo (ITEM, código, alternativo, descripción…).
    // Con UNA sola columna extra (9 celdas) no hay forma de distinguirlas —
    // ver posicionesSinEncabezado— y gana la plantilla nueva.
    const t = '1\tT228830\t\tBUJE DE VALDE\t1\tPZA\t6800\t6800\tobs\totra';
    expect(parseExcelPaste(t).items[0]).toMatchObject({ codigo: 'T228830', descripcion_item: 'BUJE DE VALDE', cantidad: 1 });
  });
});

describe('parseExcelPaste — una celda de varias líneas', () => {
  test('una descripción con salto de línea queda en una sola línea', () => {
    // Un salto de línea dentro de la descripción rompería el renglón del PDF.
    const texto = ['DESCRIPCION\tCANT.', '"ANILLO\nD/GOMA"\t1'].join('\n');
    expect(parseExcelPaste(texto).items[0].descripcion_item).toBe('ANILLO D/GOMA');
  });
});
