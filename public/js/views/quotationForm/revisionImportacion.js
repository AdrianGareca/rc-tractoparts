// =============================================================================
// public/js/views/quotationForm/revisionImportacion.js
// Lo que el pegado desde Excel no pudo resolver solo, mostrado para decidirlo.
//
// POR QUÉ EXISTE
// Antes, todo lo raro del pegado —una unidad desconocida, un precio ilegible—
// terminaba en `console.warn`, con un aviso que decía «detalle en la consola».
// La consola no la abre nadie que cotiza. Y dos columnas enteras de la
// planilla de la empresa, MARCA y TIEMPO DE ENTREGA, se descartaban sin un
// solo aviso: comprobado con la planilla real el 2026-09-11.
//
// Esta ventana aparece después de importar SÓLO si hay algo que decir:
//   1. Marcas que no están en el catálogo, con «¿quisiste decir…?» y un botón
//      para agregarlas. Lo que se elige se aplica a TODAS las filas que la
//      traían.
//   2. Columnas de la planilla que no se importaron.
//   3. El resto de los avisos (unidad, cantidad o precio no reconocidos).
//
// POR QUÉ UNA MARCA NUEVA NO SE CREA SOLA
// El catálogo creció a mano, y así nacieron duplicados como «CAT» al lado de
// «Caterpillar». Crear en silencio todo lo que traiga una planilla multiplica
// eso: un «CATERPILLER» mal tipeado quedaría como marca para siempre. Acá la
// marca nueva entra con UN clic —el pedido de Adrian es que entre, y entra—,
// pero con una persona mirando.
//
// Cerrar sin elegir deja esas filas sin marca, igual que antes de que esto
// existiera. La marca se puede elegir después en cada fila.
// =============================================================================

import api from '../../services/apiClient.js';
import { crearSubModal } from '../../shared/subModal.js';
import { escText } from './helpers.js';
import { aplicarMarcaAFilas } from './brandModal.js';

const filasTexto = (n) => `${n} fila${n === 1 ? '' : 's'}`;

/** ¿Hay algo que mostrar? Si no, la ventana no se abre. */
export function hayQueRevisar({ desconocidas = [], columnasIgnoradas = [], advertencias = [] } = {}) {
  return desconocidas.length + columnasIgnoradas.length + advertencias.length > 0;
}

/** Una marca desconocida, con sus sugerencias y el botón para agregarla. */
function htmlMarca(desconocida, i) {
  const sugerencias = desconocida.sugerencias.map((m, j) =>
    `<button type="button" class="btn btn-outline btn-sm" data-usar="${j}">Usar «${escText(m.nombre)}»</button>`
  ).join('');

  return `
    <li class="lista-item" data-marca="${i}">
      <span class="lista-item-nombre">${escText(desconocida.nombre)}</span>
      <span class="text-sm text-secondary">— ${filasTexto(desconocida.filas.length)}</span>
      ${desconocida.sugerencias.length ? '<p class="text-sm text-secondary mt-1" data-pregunta>¿Quisiste decir…?</p>' : ''}
      <div class="flex flex-wrap gap-1 mt-1" data-acciones>
        ${sugerencias}
        <button type="button" class="btn btn-primary btn-sm" data-agregar>Agregar «${escText(desconocida.nombre)}» al catálogo</button>
      </div>
      <p class="text-sm text-secondary mt-1" data-resultado role="status"></p>
    </li>`;
}

/** El contenido completo. Todo lo que viene de la planilla pasa por escText. */
function construirCuerpo({ desconocidas, columnasIgnoradas, advertencias }) {
  const partes = [];

  if (desconocidas.length) {
    partes.push(`
      <section class="mb-2">
        <p><strong>Marcas que no están en el catálogo</strong></p>
        <p class="text-sm text-secondary mb-1">
          Esas filas quedaron sin marca. Lo que elijas se aplica a todas las filas que la traían.
          Si cierras sin elegir, quedan sin marca y puedes ponerla después en cada fila.
        </p>
        <ul class="lista-limpia">${desconocidas.map(htmlMarca).join('')}</ul>
      </section>`);
  }

  if (columnasIgnoradas.length) {
    partes.push(`
      <section class="mb-2">
        <p><strong>Columnas que no se importaron</strong></p>
        <p class="text-sm text-secondary">
          ${columnasIgnoradas.map((c) => `«${escText(c)}»`).join(', ')}: el formulario no tiene dónde guardarlas.
        </p>
      </section>`);
  }

  if (advertencias.length) {
    partes.push(`
      <section class="mb-2">
        <p><strong>Otros avisos</strong></p>
        <ul class="lista-limpia text-sm">${advertencias.map((a) => `<li>${escText(a)}</li>`).join('')}</ul>
      </section>`);
  }

  partes.push('<div class="modal-actions"><button type="button" class="btn btn-primary" data-listo>Listo</button></div>');
  return partes.join('');
}

/**
 * Crea la marca. Si ya existía (409 — otra persona la creó mientras tanto, o
 * cambia sólo en mayúsculas), se usa la existente en lugar de fallar.
 * @returns {Promise<{ marca: {id, nombre}, yaExistia: boolean }>}
 */
async function crearOAdoptar(nombre) {
  try {
    const resp = await api.post('/api/marcas', { nombre });
    return { marca: resp.data, yaExistia: false };
  } catch (err) {
    if (err?.status === 409 && err.data?.data) return { marca: err.data.data, yaExistia: true };
    throw err;
  }
}

/** Engancha los botones de UNA marca desconocida. */
function cablearMarca(li, desconocida, deps) {
  const resultado = li.querySelector('[data-resultado]');
  const filas     = filasTexto(desconocida.filas.length);
  const aplicar   = (marca) => aplicarMarcaAFilas({ ...deps, brand: marca, filas: desconocida.filas });

  // Resuelta: se van los botones y queda escrito qué se hizo.
  const cerrarEntrada = (texto) => {
    li.querySelector('[data-acciones]')?.remove();
    li.querySelector('[data-pregunta]')?.remove();
    resultado.textContent = texto;
  };

  li.querySelectorAll('[data-usar]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const marca = desconocida.sugerencias[Number(boton.dataset.usar)];
      aplicar(marca);
      cerrarEntrada(`Se usó «${marca.nombre}» en ${filas}.`);
    });
  });

  const agregar = li.querySelector('[data-agregar]');
  agregar.addEventListener('click', async () => {
    agregar.disabled = true;
    resultado.textContent = '';
    try {
      const { marca, yaExistia } = await crearOAdoptar(desconocida.nombre);
      aplicar(marca);
      cerrarEntrada(yaExistia
        ? `«${marca.nombre}» ya estaba en el catálogo; se aplicó a ${filas}.`
        : `«${marca.nombre}» quedó en el catálogo y se aplicó a ${filas}.`);
    } catch (err) {
      agregar.disabled = false;
      resultado.textContent = err?.data?.message || err?.message || 'No se pudo agregar la marca.';
    }
  });
}

/**
 * Abre la revisión, sólo si hay algo que decir.
 *
 * @param {Object} o
 * @param {Array}  o.desconocidas      — de resolverMarcas(), con `filas` ya
 *                                       traducidas a índices de fila del formulario
 * @param {string[]} o.columnasIgnoradas
 * @param {string[]} o.advertencias
 * @param {Array}  o.brands            — el caché de marcas del formulario (se muta)
 * @param {HTMLElement} o.container    — raíz del formulario, donde están los selectores
 * @param {Function} o.onFieldChange   — (idx, field, value) del Mediator
 * @returns {Object|null} el sub-modal, o null si no hubo nada que mostrar
 */
export function abrirRevisionImportacion({
  desconocidas = [], columnasIgnoradas = [], advertencias = [], brands = [], container, onFieldChange,
} = {}) {
  if (!hayQueRevisar({ desconocidas, columnasIgnoradas, advertencias })) return null;

  const sub = crearSubModal({
    titulo: 'Revisar lo importado',
    cuerpo: construirCuerpo({ desconocidas, columnasIgnoradas, advertencias }),
    ancho: true,
  });

  const deps = { container, brands, onFieldChange };
  desconocidas.forEach((d, i) => cablearMarca(sub.$(`[data-marca="${i}"]`), d, deps));
  sub.$('[data-listo]')?.addEventListener('click', sub.cerrar);
  return sub;
}
