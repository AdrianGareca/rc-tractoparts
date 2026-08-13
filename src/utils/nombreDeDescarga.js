// =============================================================================
// src/utils/nombreDeDescarga.js
// La cabecera Content-Disposition de un archivo que se descarga.
//
// POR QUÉ EXISTE — el acento se perdía en cada descarga.
//
// El saneo anterior era `nombre.replace(/[^\w.\- ]/g, '_')`. `\w` es el
// alfabeto INGLÉS ([A-Za-z0-9_]), así que en una empresa boliviana cada
// descarga salía mutilada:
//
//     Especificación técnica.pdf   ->   Especificaci_n t_cnica.pdf
//
// La intención era correcta: el nombre lo elige quien sube el archivo, y meterlo
// crudo en una cabecera HTTP permite INYECTAR CABECERAS — un salto de línea
// adentro del nombre y lo que sigue se interpreta como una cabecera propia,
// desde una cookie hasta una redirección. La lista blanca cerraba eso, pero de
// la forma más gruesa posible.
//
// LA SOLUCIÓN ES LA DEL ESTÁNDAR (RFC 6266 + RFC 5987)
// La cabecera lleva DOS nombres:
//
//     attachment; filename="Especificacion tecnica.pdf";
//                 filename*=UTF-8''Especificaci%C3%B3n%20t%C3%A9cnica.pdf
//
// El primero es ASCII, para los clientes que no entienden el segundo. El
// segundo va percent-encodeado y es el que prefieren todos los navegadores
// actuales, así que el acento sobrevive.
//
// El percent-encoding no es un adorno: ES el cierre de la inyección. Un salto
// de línea sale como %0A, que dentro de una cabecera es texto, no un salto.
//
// EL ORDEN IMPORTA: el parámetro viejo va PRIMERO. Un cliente que no conoce el
// asterisco lo ignora y se queda con el que ya leyó; al revés se quedaría sin
// ninguno.
//
// Cubierto por tests/unit/nombreDeDescarga.test.js.
// =============================================================================

'use strict';

/** Con qué se responde cuando del nombre no queda nada utilizable. */
const NOMBRE_POR_DEFECTO = 'documento';

/**
 * La versión ASCII del nombre — el parámetro `filename=` de toda la vida.
 *
 * Se saca de en medio todo lo que pueda alterar la cabecera: comillas (cierran
 * el valor y dejan escribir parámetros nuevos), separadores de ruta (sugieren
 * una carpeta al cliente) y cualquier carácter de control, saltos de línea
 * incluidos.
 *
 * Los acentos se degradan en lugar de convertirse en guiones bajos:
 * `normalize('NFD')` separa la letra de su tilde y el filtro se queda con la
 * letra. Así «Especificación» cae a «Especificacion» y no a «Especificaci_n» —
 * el nombre sigue siendo legible y buscable aunque el cliente sea antiguo.
 *
 * @param {*} nombre
 * @returns {string} nunca vacío
 */
function nombreAscii(nombre) {
  const crudo = String(nombre ?? '');

  const degradado = crudo
    .normalize('NFD')                    // 'á' -> 'a' + tilde combinante
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '')        // fuera todo lo no imprimible en ASCII
    .replace(/["\\/\r\n]/g, '')          // comillas, barras y saltos de línea
    .replace(/\s+/g, ' ')                // espacios de más, colapsados
    .trim();

  // Un nombre íntegramente no-ASCII ('汉字.pdf') queda vacío acá. Devolver ''
  // dejaría `filename=""` y el navegador inventaría un nombre — a veces el
  // último tramo de la URL, o sea el id numérico.
  if (!degradado) {
    // Se rescata la extensión si la había: sin ella Windows no sabe con qué
    // abrir el archivo y muestra el diálogo de "elegir programa".
    const ext = (crudo.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
    return ext ? `${NOMBRE_POR_DEFECTO}.${ext.toLowerCase()}` : NOMBRE_POR_DEFECTO;
  }

  return degradado;
}

/**
 * El valor completo de la cabecera Content-Disposition.
 *
 * @param {*} nombre         el nombre original, tal como se subió
 * @param {'attachment'|'inline'} disposicion  'attachment' baja el archivo,
 *                                             'inline' lo abre en el navegador
 * @returns {string}
 */
function cabeceraDeDescarga(nombre, disposicion = 'attachment') {
  const ascii = nombreAscii(nombre);

  // encodeURIComponent deja pasar unos pocos caracteres que la RFC 5987 no
  // admite en un valor de cabecera; se codifican a mano. El apóstrofo es el
  // más importante: la sintaxis usa comillas simples como separador de campos
  // (`UTF-8''nombre`), así que uno sin escapar corta el valor donde no debe.
  const utf8 = encodeURIComponent(String(nombre ?? NOMBRE_POR_DEFECTO))
    .replace(/['()!*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

  return `${disposicion}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

module.exports = { cabeceraDeDescarga, nombreAscii, NOMBRE_POR_DEFECTO };
