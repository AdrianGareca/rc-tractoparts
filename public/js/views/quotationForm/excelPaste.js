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
// QUÉ NO INTENTA RESOLVER
// La MARCA y si el repuesto es "original o alternativo" (que hoy se anota en
// T. Entrega) no vienen en la planilla del vendedor — quedan en blanco tras
// importar, igual que si se cargara el ítem a mano.
// =============================================================================

import { crearSubModal } from '../../shared/subModal.js';
// La unidad por defecto sale de donde vive la lista del desplegable, para que
// una celda de Excel sin unidad caiga en lo mismo que una fila nueva a mano.
import { UNIDAD_POR_DEFECTO } from './lineItemsComponent.js';

/** Mayúsculas y sin tildes, para comparar encabezados sin depender de acentos. */
function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase();
}

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
};

// Variantes de unidad -> una de las que la app realmente acepta (ver UNIDADES_DE_MEDIDA
// en lineItemsComponent.js). Lo que no matchea cae a la unidad por defecto.
//
// La tabla incluye los códigos VIEJOS —`UND` y `GGO`, de antes del cambio de
// lista del 2026-09-01— apuntando a los nuevos: quien pegue una planilla
// armada con el formato anterior no tiene por qué saber que cambiaron, y lo
// que quiso decir es evidente.
const ALIAS_UNIDAD = {
  PZA: 'PZA', PZ: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  UNI: 'UNI', UND: 'UNI', UNIDAD: 'UNI', UNIDADES: 'UNI',
  JGOS: 'JGOS', JGO: 'JGOS', GGO: 'JGOS', JUEGO: 'JGOS', JUEGOS: 'JGOS',
  KIT: 'KIT', KITS: 'KIT', SET: 'KIT',
  LTS: 'LTS', LT: 'LTS', L: 'LTS', LITRO: 'LTS', LITROS: 'LTS',
  KG: 'KG', KGS: 'KG', KILO: 'KG', KILOS: 'KG', KILOGRAMO: 'KG', KILOGRAMOS: 'KG',
  MTS: 'MTS', MT: 'MTS', M: 'MTS', METRO: 'MTS', METROS: 'MTS',
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

// Posiciones por defecto cuando NO hay fila de encabezado (se infiere por la
// cantidad de columnas — el formato con o sin la columna "ITEM #" al inicio).
const POSICIONES_CON_ITEM = { codigo: 1, codigo_alternativo: 2, descripcion_item: 3, cantidad: 4, unidad: 5, precio_unitario: 6 };
const POSICIONES_SIN_ITEM = { codigo: 0, codigo_alternativo: 1, descripcion_item: 2, cantidad: 3, unidad: 4, precio_unitario: 5 };

/**
 * Convierte el texto pegado (formato TSV que produce copiar un rango de Excel)
 * en ítems listos para LineItemsSubject.addItemData.
 *
 * @param {string} texto
 * @returns {{ items: Array<Object>, advertencias: string[] }}
 */
export function parseExcelPaste(texto) {
  const filas = String(texto ?? '')
    .split(/\r\n|\n|\r/)
    .map((l) => l.split('\t').map((c) => c.trim()))
    .filter((cols) => cols.some((c) => c !== ''));

  let mapaColumnas = null; // se arma al detectar la fila de encabezado
  const items = [];
  const advertencias = [];

  for (const celdas of filas) {
    // Fila de encabezado: arma el mapeo de columnas y no se importa como ítem.
    //
    // EL MATCH TIENE QUE SER EXACTO, NO "empieza con"
    // Antes bastaba con que UNA celda empezara con "DESCRIPCION" para tomar
    // toda la fila como encabezado. Un ítem legítimo sin fila de encabezado
    // pegada, con una descripción como "Descripcion general del kit
    // hidraulico", disparaba lo mismo — esa fila se descartaba en silencio, Y
    // como ninguna de sus celdas matcheaba un alias real, mapaColumnas
    // quedaba en `{}`: TODAS las filas siguientes también se leían vacías y
    // se descartaban, no sólo esa una. Encontrado en la ronda de estrés del
    // 2026-08-25.
    //
    // Exigir que la celda sea EXACTAMENTE "DESCRIPCION" o "DESCRIPCION DEL
    // ITEM" (los dos encabezados reales de ALIAS_COLUMNA) evita el falso
    // positivo — una oración real casi nunca es igual, palabra por palabra, a
    // uno de esos dos encabezados — y de paso garantiza que mapaColumnas
    // nunca quede sin la columna de descripción resuelta.
    if (!mapaColumnas && celdas.some((c) => ALIAS_COLUMNA[normalizar(c)] === 'descripcion_item')) {
      mapaColumnas = {};
      celdas.forEach((c, i) => {
        const campo = ALIAS_COLUMNA[normalizar(c)];
        if (campo) mapaColumnas[campo] = i;
      });
      continue;
    }

    // Fila de "TOTAL BOLIVIANOS" / "TOTAL USD": se descarta.
    if (celdas.some((c) => normalizar(c).includes('TOTAL'))) continue;

    const posiciones = mapaColumnas
      ?? (celdas.length >= 8 ? POSICIONES_CON_ITEM
        : celdas.length === 7 ? POSICIONES_SIN_ITEM
        : null);

    if (!posiciones) {
      advertencias.push(`No se pudo interpretar la fila: "${celdas.join(' | ')}"`);
      continue;
    }

    const leer = (campo) => (posiciones[campo] != null ? celdas[posiciones[campo]] ?? '' : '');

    const descripcion = leer('descripcion_item');
    if (!descripcion) continue; // fila vacía / espaciadora entre ítems

    const cantidad = parseNumero(leer('cantidad'));
    const precio   = parseNumero(leer('precio_unitario'));
    const unidadCelda = leer('unidad');
    const unidadNorm  = normalizar(unidadCelda);
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

    items.push({
      descripcion_item:   descripcion,
      codigo:             leer('codigo'),
      codigo_alternativo: leer('codigo_alternativo'),
      unidad,
      cantidad:           Number.isFinite(cantidad) ? cantidad : 1,
      precio_unitario:    Number.isFinite(precio) ? precio : 0,
      marca_id:           null,
      tiempo_entrega:     '',
    });
  }

  return { items, advertencias };
}

/**
 * Abre el sub-modal de pegado. onImport(items, advertencias) se llama solo
 * cuando se reconoció al menos un ítem.
 */
export function openExcelPasteModal({ onImport }) {
  const cuerpo = `
    <p class="text-sm text-secondary mb-1">
      Copia el rango de celdas de tu Excel (con o sin encabezados) y pégalo acá con Ctrl+V.
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
    const { items, advertencias } = parseExcelPaste($('#excel-paste-textarea').value);

    if (items.length === 0) {
      $('#excel-paste-err').textContent = 'No se reconoció ningún ítem en el texto pegado.';
      return;
    }

    onImport(items, advertencias);
    cerrar();
  });

  // La persona ya tiene el rango copiado — foco inmediato, listo para Ctrl+V.
  $('#excel-paste-textarea').focus();
}
