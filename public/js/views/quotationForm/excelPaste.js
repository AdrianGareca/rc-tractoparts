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

// Variantes de unidad -> una de las 4 que la app realmente acepta
// (ver el <select> en lineItemsComponent.js). Lo que no matchea cae a UND.
const ALIAS_UNIDAD = {
  PZA: 'PZA', PZ: 'PZA', PIEZA: 'PZA', PIEZAS: 'PZA',
  UND: 'UND', UNI: 'UND', UNIDAD: 'UND', UNIDADES: 'UND',
  JGO: 'GGO', JUEGO: 'GGO', JUEGOS: 'GGO', GGO: 'GGO',
  KIT: 'KIT', KITS: 'KIT', SET: 'KIT',
};

/** '6,800.00' / '6800' / ' 900 ' -> número. NaN si no se puede interpretar. */
function parseNumero(s) {
  if (s == null) return NaN;
  const limpio = String(s).trim().replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  return limpio === '' ? NaN : parseFloat(limpio);
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
    if (!mapaColumnas && celdas.some((c) => normalizar(c).startsWith('DESCRIPCION'))) {
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
    const unidad = ALIAS_UNIDAD[unidadNorm] ?? 'UND';

    if (unidadCelda && !ALIAS_UNIDAD[unidadNorm]) {
      advertencias.push(`Unidad "${unidadCelda}" no reconocida en "${descripcion}" — se dejó UND.`);
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
