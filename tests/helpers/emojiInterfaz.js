// =============================================================================
// tests/helpers/emojiInterfaz.js
// La lista de emoji que vigilan los tests, en un solo lugar.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// La lista estaba escrita dos veces —en estilosInline.test.js y en
// copyInterfaz.test.js— y las dos copias se desincronizaron enseguida: 👥 y 📉
// estaban en una y no en la otra, así que «👥 Rendimiento del Equipo de Ventas»
// pasaba los dos guardias sin que ninguno lo viera. Un guardia con un agujero
// es peor que no tenerlo, porque además da confianza.
//
// POR QUÉ UNA LISTA EXPLÍCITA Y NO UN RANGO UNICODE
// Los rangos de emoji también abarcan símbolos tipográficos legítimos —flechas,
// guiones largos, comillas angulares— que el proyecto sí usa. Un rango daría
// falsos positivos justo en la puntuación que hace falta cuidar.
//
// No es un archivo .test.js a propósito: Jest sólo levanta suites que terminan
// en .test.js, así que esto se importa sin que se lo tome por una.
// =============================================================================

'use strict';

/** Los que aparecieron alguna vez en public/js. Al sacar uno se deja igual. */
const EMOJI = [
  // Documentos y datos
  '📦', '📅', '📊', '📋', '📑', '📄', '📝', '📈', '📉', '📌', '📎', '🗑', '📍',
  // Personas y lugares
  '🏢', '👤', '👥', '🚜',
  // Estados y acciones
  '✅', '❌', '⚠️', '🔑', '🔓', '🔒', '💾', '⏸', '🔄', '↩', '🏆', '🟢',
  '➕', '✏️', '🖊️', '🚫', '🕐', '💬', '🔔',
  // Flechas y búsqueda
  '⬇', '📤', '📥', '🔍', '🔎', '🔼',
  // Imágenes
  '🖼️',
];

/** Alternativa lista para meter en una expresión regular.
 *  Ninguno lleva metacaracteres, así que se concatenan sin escapar. */
const ALTERNATIVA = EMOJI.join('|');

/** Cuántos emoji de la lista hay en un texto. */
function contarEn(texto) {
  return EMOJI.reduce((n, e) => n + texto.split(e).length - 1, 0);
}

/**
 * Cuántos emoji hay en el CÓDIGO de un archivo, sin contar los comentarios.
 *
 * La distinción no es un tecnicismo. Los comentarios que explican por qué se
 * sacó un emoji necesitan nombrarlo para que se entiendan —«eran 📄 📝 📊 y
 * cada sistema los dibuja distinto»— y si contaran, el trinquete nunca podría
 * llegar a cero y la documentación saldría penalizada. Lo que se mide es lo
 * que ve el usuario, que es lo único que importa acá.
 *
 * @param {string} src — contenido del archivo
 * @returns {number}
 */
function contarEnFuente(src) {
  return src.split('\n').reduce((total, linea) => {
    const t = linea.trim();
    // Comentario de línea, o cuerpo de uno de bloque.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return total;
    return total + contarEn(linea);
  }, 0);
}

module.exports = { EMOJI, ALTERNATIVA, contarEn, contarEnFuente };
