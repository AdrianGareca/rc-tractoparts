// =============================================================================
// public/js/views/quotationForm/excelPaste.js
// Importar ítems de detalle pegando un rango copiado de Excel — evita cargar
// a mano cotizaciones de 50+ ítems que el vendedor ya armó en una planilla
// antes de pasarla a la app.
//
// parseExcelPaste  — función PURA: recibe el texto tal como llega del
//                     portapapeles (separado por tabs, una fila por línea) y
//                     devuelve los ítems ya en el formato que espera
//                     LineItemsSubject.addItemData. Sin DOM, testeable directo.
// openExcelPasteModal — cablea el textarea + botón sobre el sub-modal
//                     compartido (shared/subModal.js).
//
// LA MARCA Y EL TIEMPO DE ENTREGA
// La planilla de la empresa trae las dos columnas (MARCA, TIEMPO DE ENTREGA)
// y hasta el 2026-09-11 se descartaban sin aviso. Ahora se leen:
//   - el tiempo de entrega pasa tal cual, es texto libre;
//   - la marca sale como `marca_texto`, con `marca_id` todavía en null. El
//     parser no conoce el catálogo: la traducción a una marca real la hace
//     resolverMarcas (marcasParecidas.js), y lo que no se reconoce se decide a
//     mano en revisionImportacion.js.
// Las columnas que el formulario no tiene dónde guardar se devuelven en
// `columnasIgnoradas`, para avisarlas en pantalla en lugar de perderlas callado.
// =============================================================================

import { crearSubModal } from '../../shared/subModal.js';
// La unidad por defecto sale de donde vive la lista del desplegable, para que
// una celda de Excel sin unidad caiga en lo mismo que una fila nueva a mano.
import { UNIDAD_POR_DEFECTO } from './lineItemsComponent.js';

/**
 * Mayúsculas, sin tildes y con los espacios juntos reducidos a uno, para
 * comparar encabezados sin depender de cómo se escribieron. El encabezado
 * «PRECIO TOTAL» de la planilla real tiene un salto de línea en el medio.
 */
function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim().toUpperCase();
}

/** Una celda de varias líneas, en una sola: un salto dentro de la descripción rompería el renglón del PDF. */
const unaLinea = (s) => String(s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();

// Encabezados reales -> campo interno. Cubre las variantes de tildes/puntos
// más comunes; un encabezado que no matchea ninguno simplemente no se mapea
// (la fila se sigue procesando con los campos que sí se reconocieron).
const ALIAS_COLUMNA = {
  'CODIGO':                 'codigo',
  'COD':                    'codigo',
  'COD.':                   'codigo',
  'CODIGO ALTERNATIVO':     'codigo_alternativo',
  'COD ALTERNATIVO':        'codigo_alternativo',
  'COD. ALTERNATIVO':       'codigo_alternativo',
  'CODIGO ALTERNO':         'codigo_alternativo',
  'ALTERNATIVO':            'codigo_alternativo',
  'DESCRIPCION':            'descripcion_item',
  'DESCRIPCION DEL ITEM':   'descripcion_item',
  'CANT':                   'cantidad',
  'CANT.':                  'cantidad',
  'CANTIDAD':               'cantidad',
  'UNI':                    'unidad',
  'UNI.':                   'unidad',
  'UNIDAD':                 'unidad',
  'UM':                     'unidad',
  'PRECIO UNITARIO':        'precio_unitario',
  'P. UNITARIO':            'precio_unitario',
  'PRECIO UNIT':            'precio_unitario',
  'PRECIO UNIT.':           'precio_unitario',
  'MARCA':                  'marca',
  'FABRICANTE':             'marca',
  'TIEMPO DE ENTREGA':      'tiempo_entrega',
  'T. ENTREGA':             'tiempo_entrega',
  'T. DE ENTREGA':          'tiempo_entrega',
  'T ENTREGA':              'tiempo_entrega',
  'PLAZO DE ENTREGA':       'tiempo_entrega',
  'ENTREGA':                'tiempo_entrega',
};

// Columnas que la planilla trae y el formulario NO importa, pero que no hace
// falta avisar: el número de ítem y los totales los vuelve a calcular la app.
// Cualquier otra columna que no se reconozca sí se avisa (columnasIgnoradas).
const COLUMNAS_QUE_SE_RECALCULAN = new Set([
  'ITEM', '#', 'N', 'N°', 'Nº', 'NO', 'NO.', 'NRO', 'NRO.',
  'PRECIO TOTAL', 'P. TOTAL', 'TOTAL', 'SUBTOTAL', 'IMPORTE',
]);

// Variantes de unidad -> una de las que la app realmente acepta (ver UNIDADES_DE_MEDIDA
// en lineItemsComponent.js). Lo que no matchea cae a la unidad por defecto.
// Se buscan sin puntos: «UN.» y «PZA.» son «UN» y «PZA».
//
// La tabla incluye los códigos VIEJOS —`UND` y `GGO`, de antes del cambio de
// lista del 2026-09-01— apuntando a los nuevos: quien pegue una planilla
// armada con el formato anterior no tiene por qué saber que cambiaron, y lo
// que quiso decir es evidente. `UN` es el que usa la planilla real de la
// empresa (2026-09-11), y antes caía en el aviso de «no reconocida».
const ALIAS_UNIDAD = {
  PZA: 'PZA', PZ: 'PZA', PZS: 'PZA', PZAS: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  UNI: 'UNI', UN: 'UNI', UND: 'UNI', UNDS: 'UNI', UNID: 'UNI', UNIDAD: 'UNI', UNIDADES: 'UNI',
  JGOS: 'JGOS', JGO: 'JGOS', JG: 'JGOS', JGS: 'JGOS', GGO: 'JGOS', JUEGO: 'JGOS', JUEGOS: 'JGOS',
  KIT: 'KIT', KITS: 'KIT', SET: 'KIT',
  LTS: 'LTS', LT: 'LTS', LTR: 'LTS', LTRS: 'LTS', L: 'LTS', LITRO: 'LTS', LITROS: 'LTS',
  KG: 'KG', KGS: 'KG', KGR: 'KG', KILO: 'KG', KILOS: 'KG', KILOGRAMO: 'KG', KILOGRAMOS: 'KG',
  MTS: 'MTS', MT: 'MTS', MTR: 'MTS', MTRS: 'MTS', M: 'MTS', METRO: 'MTS', METROS: 'MTS',
};

// ---------------------------------------------------------------------------
// parseNumero — interpreta un número escrito en CUALQUIERA de los dos
// formatos que puede traer una celda de Excel, sin saber de antemano cuál usó
// quien la escribió:
//   formato coma-miles / punto-decimal:   6,800.00   ->  6800
//   formato punto-miles / coma-decimal:   6.800,00   ->  6800  (boliviano)
//   solo un separador, sin el otro:       1,5  ó  1.5   ->  1.5
//                                          6.800 ó 6,800 ->  6800 (se asume
//                                            agrupador de miles: un separador
//                                            decimal real NUNCA se repite, y
//                                            un precio con exactamente 3
//                                            cifras después casi nunca es
//                                            "3 decimales" — es miles)
//
// BUG QUE ESTO ARREGLA: la version anterior asumia SIEMPRE coma=miles y
// punto=decimal, y borraba las comas sin convertirlas. Con un numero en
// formato boliviano "6.800,00" quedaba "6.800.00" (dos puntos) y
// parseFloat corta en el primer numero valido: devolvia 6.8, mil veces menos.
// Con "1,5" (una coma decimal, sin miles) borraba la coma sin volverla punto
// y devolvia 15, diez veces mas. Cubierto por tests/unit/excelPaste.test.js.
// ---------------------------------------------------------------------------
function esAgrupadorDeMiles(partes) {
  // Un separador decimal aparece UNA sola vez. Si el mismo separador se repite
  // ("1.234.567"), es agrupador seguro. Si aparece una sola vez y el resto
  // tiene EXACTAMENTE 3 dígitos, se asume agrupador (grupo de miles estándar)
  // salvo que no haya nada antes (".500" no es "quinientos mil", es 0.5).
  return partes.length > 2 || (partes.length === 2 && partes[1].length === 3 && partes[0].length > 0);
}

// Notación científica: "1.5E+10" o "1,5e-3" (con coma decimal, si la celda
// vino en formato boliviano). Se reconoce ANTES de la limpieza de abajo — esa
// limpieza sólo deja dígitos/coma/punto/guion, así que la "e" desaparecía sin
// avisar y "1e10" quedaba pegado como "110" (mil veces menos de lo que decía
// la celda). parseFloat entiende esta notación de forma nativa y correcta una
// vez que la coma decimal, si la hay, se pasa a punto.
const NOTACION_CIENTIFICA = /^-?\d+([.,]\d+)?[eE][+-]?\d+$/;

export function parseNumero(valorCrudo) {
  if (valorCrudo == null) return NaN;
  const crudo = String(valorCrudo).trim();
  if (crudo === '') return NaN;

  if (NOTACION_CIENTIFICA.test(crudo)) {
    const n = parseFloat(crudo.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  let s = crudo.replace(/[^0-9.,-]/g, '');
  if (s === '') return NaN;

  // Un número real lleva A LO SUMO un signo, y al principio. "--5" no es un
  // formato raro de algún país — es basura (un guion de más al pegar, o una
  // resta que no se completó) — y antes se leía como si el segundo signo no
  // estuviera, devolviendo 5 sin ningún aviso. Lo mismo un signo que no está
  // al principio ("5-"). En cualquiera de los dos casos, mejor NaN: cae en el
  // mismo aviso de "cantidad/precio no reconocido" que ya existe más abajo,
  // en vez de convertir silenciosamente un dato ambiguo en uno que parece válido.
  const cantidadDeSignos = (s.match(/-/g) || []).length;
  if (cantidadDeSignos > 1 || (cantidadDeSignos === 1 && !s.startsWith('-'))) return NaN;

  const negativo = s.startsWith('-');
  if (negativo) s = s.slice(1);

  const tieneComa  = s.includes(',');
  const tienePunto = s.includes('.');

  let normalizado;
  if (tieneComa && tienePunto) {
    // Aparecen los dos: el que esté MÁS A LA DERECHA es el decimal real.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      normalizado = s.replace(/\./g, '').replace(',', '.'); // 6.800,00
    } else {
      normalizado = s.replace(/,/g, '');                     // 6,800.00
    }
  } else if (tieneComa) {
    const partes = s.split(',');
    normalizado = esAgrupadorDeMiles(partes) ? partes.join('') : s.replace(',', '.');
  } else if (tienePunto) {
    const partes = s.split('.');
    normalizado = esAgrupadorDeMiles(partes) ? partes.join('') : s;
  } else {
    normalizado = s;
  }

  const n = parseFloat(normalizado);
  return Number.isFinite(n) ? (negativo ? -n : n) : NaN;
}

// ---------------------------------------------------------------------------
// dividirFilasTSV — el texto del portapapeles, en filas y celdas.
//
// POR QUÉ NO ALCANZA CON CORTAR POR SALTOS DE LÍNEA Y TABS
// Cuando una celda tiene un salto de línea (o un tab, o comillas) adentro,
// Excel la copia ENTRE COMILLAS, con las comillas internas dobladas:
//     ITEM <tab> … <tab> "PRECIO ⏎TOTAL" <tab> TIEMPO DE ENTREGA
// Cortar por líneas partía esa fila de encabezado en dos, y todo lo que venía
// después del salto —la columna TIEMPO DE ENTREGA de la planilla real de la
// empresa— quedaba en una «fila» aparte que nunca se leía como encabezado.
//
// Una comilla sólo se trata como delimitador si abre la celda Y cierra justo
// antes de un tab, un salto o el final. Si no, es una comilla escrita a mano
// («MANGUERA 3/4"», «"TAPA" DE MOTOR») y la celda se lee tal cual.
// ---------------------------------------------------------------------------
const SEPARADOR = /[\t\r\n]/g;

function buscarSeparador(s, desde) {
  SEPARADOR.lastIndex = desde;
  const m = SEPARADOR.exec(s);
  return m ? m.index : s.length;
}

/** Una celda entre comillas que empieza en `inicio`, o null si no lo es. */
function leerCeldaCitada(s, inicio) {
  let valor = '';
  for (let i = inicio + 1; i < s.length; i++) {
    if (s[i] !== '"') { valor += s[i]; continue; }
    if (s[i + 1] === '"') { valor += '"'; i++; continue; }

    const sigue = s[i + 1];
    const cierra = sigue === undefined || sigue === '\t' || sigue === '\n' || sigue === '\r';
    return cierra ? { valor, fin: i + 1 } : null;
  }
  return null; // la comilla nunca cerró: no era un delimitador
}

/** @returns {string[][]} filas de celdas, sin recortar */
export function dividirFilasTSV(texto) {
  const s = String(texto ?? '');
  const filas = [];
  let fila = [];
  let i = 0;

  while (s.length > 0) {
    const citada = s[i] === '"' ? leerCeldaCitada(s, i) : null;
    const fin = citada ? citada.fin : buscarSeparador(s, i);
    fila.push(citada ? citada.valor : s.slice(i, fin));

    if (fin >= s.length) { filas.push(fila); break; }
    if (s[fin] === '\t') { i = fin + 1; continue; }

    filas.push(fila);
    fila = [];
    i = fin + (s[fin] === '\r' && s[fin + 1] === '\n' ? 2 : 1);
    if (i >= s.length) break; // el salto final no abre una fila vacía
  }
  return filas;
}

// Posiciones por defecto cuando NO hay fila de encabezado, según cuántas
// columnas trae la fila.
//
// La plantilla de la empresa (2026-09-11) tiene 10: ITEM, CÓDIGO, CÓDIGO
// ALTERNATIVO, MARCA, DESCRIPCIÓN, CANT., UNI, PRECIO UNITARIO, PRECIO TOTAL,
// TIEMPO DE ENTREGA — 9 si se copia sin la columna ITEM. El formato viejo, sin
// marca ni tiempo de entrega, tiene 8 o 7, y se sigue aceptando.
const PLANTILLA_CON_ITEM = { codigo: 1, codigo_alternativo: 2, marca: 3, descripcion_item: 4, cantidad: 5, unidad: 6, precio_unitario: 7, tiempo_entrega: 9 };
const PLANTILLA_SIN_ITEM = { codigo: 0, codigo_alternativo: 1, marca: 2, descripcion_item: 3, cantidad: 4, unidad: 5, precio_unitario: 6, tiempo_entrega: 8 };
const POSICIONES_CON_ITEM = { codigo: 1, codigo_alternativo: 2, descripcion_item: 3, cantidad: 4, unidad: 5, precio_unitario: 6 };
const POSICIONES_SIN_ITEM = { codigo: 0, codigo_alternativo: 1, descripcion_item: 2, cantidad: 3, unidad: 4, precio_unitario: 5 };

/** ¿La cantidad y el precio están donde estas posiciones dicen? */
function calzaCon(celdas, posiciones) {
  return Number.isFinite(parseNumero(celdas[posiciones.cantidad]))
      && Number.isFinite(parseNumero(celdas[posiciones.precio_unitario]));
}

/**
 * Sin encabezado, el orden de las columnas se deduce. Primero se prueba la
 * plantilla nueva, y sólo si la cantidad y el precio caen en celdas numéricas:
 * así una fila del formato viejo con columnas de más al final no se lee
 * corrida una posición.
 *
 * LÍMITE CONOCIDO: con exactamente 9 celdas, la plantilla nueva sin ITEM y la
 * vieja con UNA columna de más tienen la cantidad y el precio en las mismas
 * celdas, y no hay forma de distinguirlas. Gana la nueva, que es la que usa la
 * empresa. Con fila de encabezado esto no pasa: por eso conviene copiarla.
 */
function posicionesSinEncabezado(celdas) {
  if (celdas.length >= 10 && calzaCon(celdas, PLANTILLA_CON_ITEM)) return PLANTILLA_CON_ITEM;
  if (celdas.length === 9 && calzaCon(celdas, PLANTILLA_SIN_ITEM)) return PLANTILLA_SIN_ITEM;
  if (celdas.length >= 8) return POSICIONES_CON_ITEM;
  if (celdas.length === 7) return POSICIONES_SIN_ITEM;
  return null;
}

/**
 * Fila de encabezado -> { mapa: campo -> posición, ignoradas: [nombres] }, o
 * null si la fila no es un encabezado.
 *
 * EL MATCH TIENE QUE SER EXACTO, NO "empieza con"
 * Antes bastaba con que UNA celda empezara con "DESCRIPCION" para tomar
 * toda la fila como encabezado. Un ítem legítimo sin fila de encabezado
 * pegada, con una descripción como "Descripcion general del kit
 * hidraulico", disparaba lo mismo — esa fila se descartaba en silencio, Y
 * como ninguna de sus celdas matcheaba un alias real, el mapa de columnas
 * quedaba en `{}`: TODAS las filas siguientes también se leían vacías y
 * se descartaban, no sólo esa una. Encontrado en la ronda de estrés del
 * 2026-08-25.
 *
 * Exigir que la celda sea EXACTAMENTE "DESCRIPCION" o "DESCRIPCION DEL
 * ITEM" (los dos encabezados reales de ALIAS_COLUMNA) evita el falso
 * positivo — una oración real casi nunca es igual, palabra por palabra, a
 * uno de esos dos encabezados — y de paso garantiza que el mapa nunca quede
 * sin la columna de descripción resuelta.
 */
function leerEncabezado(celdas) {
  if (!celdas.some((c) => ALIAS_COLUMNA[normalizar(c)] === 'descripcion_item')) return null;

  const mapa = {};
  const ignoradas = [];
  celdas.forEach((c, i) => {
    const clave = normalizar(c);
    const campo = ALIAS_COLUMNA[clave];
    if (campo) mapa[campo] = i;
    else if (clave && !COLUMNAS_QUE_SE_RECALCULAN.has(clave)) ignoradas.push(unaLinea(c));
  });
  return { mapa, ignoradas };
}

// «TOTAL USD», «TOTAL BOLIVIANOS», «SUBTOTAL», «Total:» — la palabra entera,
// no «TOTALIZADOR DE HORAS».
const ROTULO_DE_TOTAL = /^(SUB ?)?TOTAL(?![A-Z])/;

/**
 * ¿Es la fila de totales del pie de la planilla?
 *
 * BUG QUE ESTO ARREGLA (2026-09-11): la regla era «alguna celda contiene
 * TOTAL», y un repuesto real como «KIT DE REPARACION TOTAL DE MOTOR» se
 * descartaba en silencio. Ahora cuenta sólo si la PRIMERA celda con algo
 * escrito es el rótulo, y nunca si la fila tiene código: una fila de totales
 * no lo tiene, un repuesto que se llama «TOTAL KIT…» sí.
 */
function esFilaDeTotal(celdas, posiciones) {
  const primera = celdas.find((c) => c !== '');
  if (!primera || !ROTULO_DE_TOTAL.test(normalizar(primera))) return false;
  return !(posiciones?.codigo != null && celdas[posiciones.codigo]);
}

/** Una fila de datos -> un ítem, anotando en `advertencias` lo que no se entendió. */
function armarItem(celdas, posiciones, advertencias) {
  const leer = (campo) => unaLinea(posiciones[campo] != null ? celdas[posiciones[campo]] : '');

  const descripcion = leer('descripcion_item');
  if (!descripcion) return null; // fila vacía / espaciadora entre ítems

  const cantidad = parseNumero(leer('cantidad'));
  const precio   = parseNumero(leer('precio_unitario'));
  const unidadCelda = leer('unidad');
  const unidadNorm  = normalizar(unidadCelda).replace(/\./g, '');
  const unidad = ALIAS_UNIDAD[unidadNorm] ?? UNIDAD_POR_DEFECTO;

  if (unidadCelda && !ALIAS_UNIDAD[unidadNorm]) {
    advertencias.push(`Unidad "${unidadCelda}" no reconocida en "${descripcion}" — se dejó ${UNIDAD_POR_DEFECTO}.`);
  }
  if (leer('cantidad') && !Number.isFinite(cantidad)) {
    advertencias.push(`Cantidad no reconocida en "${descripcion}" — se puso 1.`);
  }
  if (leer('precio_unitario') && !Number.isFinite(precio)) {
    advertencias.push(`Precio no reconocido en "${descripcion}" — se puso 0.`);
  }

  return {
    descripcion_item:   descripcion,
    codigo:             leer('codigo'),
    codigo_alternativo: leer('codigo_alternativo'),
    unidad,
    cantidad:           Number.isFinite(cantidad) ? cantidad : 1,
    precio_unitario:    Number.isFinite(precio) ? precio : 0,
    marca_id:           null,
    marca_texto:        leer('marca'),
    tiempo_entrega:     leer('tiempo_entrega'),
  };
}

/**
 * Convierte el texto pegado (formato TSV que produce copiar un rango de Excel)
 * en ítems listos para LineItemsSubject.addItemData.
 *
 * @param {string} texto
 * @returns {{ items: Array<Object>, advertencias: string[], columnasIgnoradas: string[] }}
 *   Cada ítem trae `marca_texto` (lo escrito en la columna MARCA) y
 *   `marca_id: null`: la marca del catálogo la resuelve resolverMarcas.
 */
export function parseExcelPaste(texto) {
  const filas = dividirFilasTSV(texto)
    .map((cols) => cols.map((c) => c.trim()))
    .filter((cols) => cols.some((c) => c !== ''));

  let encabezado = null;
  const items = [];
  const advertencias = [];

  for (const celdas of filas) {
    // Fila de encabezado: arma el mapeo de columnas y no se importa como ítem.
    const leido = encabezado ? null : leerEncabezado(celdas);
    if (leido) { encabezado = leido; continue; }

    const posiciones = encabezado?.mapa ?? posicionesSinEncabezado(celdas);

    // Fila de "TOTAL BOLIVIANOS" / "TOTAL USD": se descarta.
    if (esFilaDeTotal(celdas, posiciones)) continue;

    if (!posiciones) {
      advertencias.push(`No se pudo interpretar la fila: "${celdas.map(unaLinea).join(' | ')}"`);
      continue;
    }

    const item = armarItem(celdas, posiciones, advertencias);
    if (item) items.push(item);
  }

  return { items, advertencias, columnasIgnoradas: encabezado?.ignoradas ?? [] };
}

/**
 * Abre el sub-modal de pegado. onImport(items, advertencias, columnasIgnoradas)
 * se llama solo cuando se reconoció al menos un ítem.
 */
export function openExcelPasteModal({ onImport }) {
  const cuerpo = `
    <p class="text-sm text-secondary mb-1">
      Copia el rango de celdas de tu Excel (con o sin encabezados) y pégalo acá con Ctrl+V.
      Si la planilla trae MARCA y TIEMPO DE ENTREGA, también se importan.
    </p>
    <textarea class="form-control textarea-vertical" id="excel-paste-textarea" rows="10"
              placeholder="Pega aquí las filas copiadas de Excel…"></textarea>
    <span class="field-error" id="excel-paste-err"></span>
    <div class="modal-actions mt-1">
      <button type="button" class="btn btn-ghost" id="excel-paste-cancel">Cancelar</button>
      <button type="button" class="btn btn-primary" id="excel-paste-importar">Importar ítems</button>
    </div>`;

  const { $, cerrar } = crearSubModal({ titulo: 'Pegar ítems desde Excel', cuerpo, ancho: true });

  $('#excel-paste-cancel').addEventListener('click', cerrar);
  $('#excel-paste-importar').addEventListener('click', () => {
    const { items, advertencias, columnasIgnoradas } = parseExcelPaste($('#excel-paste-textarea').value);

    if (items.length === 0) {
      $('#excel-paste-err').textContent = 'No se reconoció ningún ítem en el texto pegado.';
      return;
    }

    onImport(items, advertencias, columnasIgnoradas);
    cerrar();
  });

  // La persona ya tiene el rango copiado — foco inmediato, listo para Ctrl+V.
  $('#excel-paste-textarea').focus();
}
