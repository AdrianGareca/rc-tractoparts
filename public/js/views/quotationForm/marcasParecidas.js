// =============================================================================
// public/js/views/quotationForm/marcasParecidas.js
// Reconocer una marca escrita a mano contra el catálogo, y avisar cuando se
// parece a otra que ya existe.
//
// POR QUÉ EXISTE
// El catálogo de marcas crece desde el botón «+» del formulario, y el servidor
// sólo rechaza nombres IDÉNTICOS sin distinguir mayúsculas
// (BrandModel.findByNombre: LOWER(nombre) = LOWER(?)). Rechaza «caterpillar»,
// pero aceptó «CAT» cuando «Caterpillar» ya existía. Medido en producción el
// 2026-09-11: 54 marcas, ocho creadas en los últimos diez días, y cinco
// entradas que empiezan con CAT.
//
// Además, la planilla que usan los vendedores trae una columna MARCA con
// texto libre («CATERPILLAR»), y la fila de la cotización necesita el id de
// una marca del catálogo. Alguien tiene que traducir una cosa a la otra.
//
// LO USAN DOS LUGARES, Y POR ESO VIVE ACÁ
//   - el pegado desde Excel (quotationForm.js + revisionImportacion.js), que
//     traduce la columna MARCA de la planilla al catálogo;
//   - el alta de marca (brandModal.js), que pregunta «¿quisiste decir…?»
//     antes de crear una nueva.
// Estando en un solo lugar, los dos entienden igual qué es «la misma marca».
//
// LO QUE NO HACE: UNIFICAR POR SU CUENTA
// «CAT» y «Caterpillar» son dos entradas del catálogo, y se quedan así a
// propósito: el PDF imprime la marca tal como la eligió el vendedor, porque
// es la que reconocen sus clientes (decisión de Adrian, 2026-09-11). Por eso
// «CAT» escrito en una planilla se reconoce como CAT, no como Caterpillar.
// Las parecidas se SUGIEREN; nunca se eligen solas.
// =============================================================================

/**
 * La forma de comparar dos nombres de marca: mayúsculas, sin tildes, y con
 * cualquier signo o espacio repetido reducido a un solo espacio.
 * «CAT - BRASIL», «cat-brasil» y «CAT  BRASIL» quedan iguales.
 */
export function normalizarMarca(nombre) {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Cuántas letras hay que cambiar, agregar o sacar para pasar de `a` a `b`
 * (distancia de Levenshtein). Sirve para reconocer un error de tipeo:
 * CATERPILLER está a una letra de CATERPILLAR.
 */
export function distanciaEdicion(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
    }
    previa = actual;
  }
  return previa[b.length];
}

/**
 * La marca del catálogo que ES la escrita, o null.
 *
 * Primero se busca la coincidencia literal (sin distinguir mayúsculas) y
 * recién después la normalizada: si alguna vez convivieran «CAT-REMAN» y
 * «CAT REMAN» como dos entradas, gana la que se escribió exactamente igual.
 */
export function buscarMarcaExacta(nombre, marcas = []) {
  const clave = normalizarMarca(nombre);
  if (!clave) return null;

  const literal = String(nombre).trim().toLowerCase();
  return marcas.find((m) => String(m.nombre).trim().toLowerCase() === literal)
      ?? marcas.find((m) => normalizarMarca(m.nombre) === clave)
      ?? null;
}

// Con menos de tres letras, «empieza con» sugiere cualquier cosa.
const MINIMO_PREFIJO = 3;

/**
 * Cuántos errores de tipeo se toleran según el largo del nombre. Las marcas de
 * tres letras (FAG, FAW, SKF, LUK, CTP…) no toleran ninguno: a una letra de
 * distancia hay OTRA marca real, no un error.
 */
function toleranciaPara(largo) {
  if (largo >= 8) return 2;
  if (largo >= 4) return 1;
  return 0;
}

/** Qué tan parecidas son dos claves sin espacios. Menor = más parecidas; null = no lo son. */
function puntajeParecido(a, b) {
  let puntaje = null;

  // Una empieza con la otra: CAT / CATERPILLAR, MASTER / MASTER POWER.
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (corta.length >= MINIMO_PREFIJO && larga.startsWith(corta)) {
    puntaje = larga.length - corta.length;
  }

  // Error de tipeo: CATERPILLER / CATERPILLAR, KOMATZU / KOMATSU.
  const distancia = distanciaEdicion(a, b);
  if (distancia <= toleranciaPara(corta.length)) {
    puntaje = puntaje == null ? distancia : Math.min(puntaje, distancia);
  }
  return puntaje;
}

/**
 * Las marcas del catálogo que se PARECEN a la escrita, de la más a la menos
 * parecida. Nunca incluye la idéntica: ésa no es parecida, es la misma (para
 * eso está buscarMarcaExacta).
 *
 * @returns {Array<{id, nombre}>} hasta `max` marcas
 */
export function marcasParecidas(nombre, marcas = [], max = 3) {
  const clave = normalizarMarca(nombre);
  if (!clave) return [];
  const sinEspacios = clave.replace(/ /g, '');

  const candidatas = [];
  for (const marca of marcas) {
    const otra = normalizarMarca(marca.nombre);
    if (!otra || otra === clave) continue;

    const puntaje = puntajeParecido(sinEspacios, otra.replace(/ /g, ''));
    if (puntaje != null) candidatas.push({ marca, puntaje });
  }

  return candidatas
    .sort((x, y) => x.puntaje - y.puntaje || x.marca.nombre.localeCompare(y.marca.nombre))
    .slice(0, max)
    .map((c) => c.marca);
}

/**
 * Traduce la marca escrita de cada ítem pegado (`marca_texto`) a una marca del
 * catálogo. No modifica los ítems recibidos.
 *
 * @returns {{ items: Array, desconocidas: Array<{nombre, filas, sugerencias}> }}
 *   `filas` son las posiciones dentro de `items` que traían esa marca; las
 *   marcas desconocidas se agrupan sin distinguir mayúsculas ni signos, así
 *   «HITACHI» y «hitachi» se deciden una sola vez.
 */
export function resolverMarcas(items, marcas = []) {
  const desconocidas = new Map();

  const resueltos = items.map((item, posicion) => {
    if (item.marca_id != null) return item;

    const texto = String(item.marca_texto ?? '').trim();
    if (!texto) return item;

    const marca = buscarMarcaExacta(texto, marcas);
    if (marca) return { ...item, marca_id: marca.id };

    const clave = normalizarMarca(texto);
    if (!desconocidas.has(clave)) {
      desconocidas.set(clave, { nombre: texto, filas: [], sugerencias: marcasParecidas(texto, marcas) });
    }
    desconocidas.get(clave).filas.push(posicion);
    return item;
  });

  return { items: resueltos, desconocidas: [...desconocidas.values()] };
}
