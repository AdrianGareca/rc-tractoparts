// =============================================================================
// public/js/shared/icons.js
// Los íconos de la barra lateral, como SVG en línea.
//
// POR QUÉ ACÁ SÍ HAY ÍCONOS Y EN LOS BOTONES NO
// Al sacar los 129 emoji de la interfaz, los botones se quedaron sin nada: un
// botón que dice «Aprobar cotización» no necesita un ✅, y el emoji le competía
// la atención a la palabra.
//
// La barra lateral es el caso opuesto. Se recorre con la vista decenas de veces
// por día, siempre buscando el mismo destino, y ahí la FORMA lleva al lugar
// antes de que uno termine de leer. Un ícono que se usa así se gana el espacio.
//
// POR QUÉ SVG EN LÍNEA Y NO UNA LIBRERÍA
// El proyecto no tiene build step ni empaquetador, y la política de contenido
// del servidor no permite pedir nada a un CDN. Un sprite externo sería otra
// petición de red que puede fallar y dejar la barra sin íconos. Ocho cadenas de
// texto no necesitan infraestructura.
//
// Todos son monocromos y usan `currentColor`, así que heredan el color del
// enlace: gris cuando está en reposo, naranja cuando está activo. Con un ícono
// de color propio habría que mantener dos versiones o aceptar que el activo se
// vea mal.
//
// `aria-hidden` en todos: la etiqueta de texto que va al lado ya nombra el
// destino, y un lector de pantalla que anunciara ambos lo diría dos veces.
// =============================================================================

/** Envoltura común: 20×20, trazo de 1.7 y sin relleno — un solo lenguaje visual. */
const svg = (paths) =>
  `<svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  // Reloj de arena: lo que está esperando una decisión.
  aprobacion: svg('<path d="M7 3h10M7 21h10M8 3v4a4 4 0 0 0 4 4 4 4 0 0 0 4-4V3M8 21v-4a4 4 0 0 1 4-4 4 4 0 0 1 4 4v4"/>'),

  // Portapapeles con marca: la cola de revisión del Administrador.
  revision: svg('<path d="M9 4h6M9 4a2 2 0 0 0-2 2h10a2 2 0 0 0-2-2M5 6h14v15H5z"/><path d="m9 13 2 2 4-4"/>'),

  // Documento con renglones: el listado de cotizaciones.
  cotizaciones: svg('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),

  // Documento con un más: crear una cotización nueva.
  nueva: svg('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>'),

  // Calendario: las licitaciones se organizan por fecha límite.
  licitaciones: svg('<path d="M4 6h16v14H4z"/><path d="M4 10h16M9 6V4M15 6V4"/>'),

  // Edificio: los clientes son empresas, no personas.
  clientes: svg('<path d="M4 20V6l7-3v17M11 20h9V10l-9-3"/><path d="M14 12h3M14 16h3M7 8v.01M7 12v.01M7 16v.01"/>'),

  // Dos personas: la gestión de usuarios del sistema.
  usuarios: svg('<path d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Z"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 11.2a2.8 2.8 0 1 0 0-5.6M17 14.2a5.6 5.6 0 0 1 4.5 5.5"/>'),

  // Lupa sobre renglones: buscar en la bitácora.
  auditoria: svg('<path d="M5 4h10l4 4v4M5 4v16h7"/><path d="M8 9h6M8 13h4"/><circle cx="17" cy="17" r="3.2"/><path d="m19.4 19.4 2.1 2.1"/>'),

  // Libro abierto: la documentación de la API.
  docs: svg('<path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2Z"/><path d="M12 6.5v13"/>'),

  // Puerta con flecha saliendo: cerrar sesión.
  salir: svg('<path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8"/><path d="M17 8.5 20.5 12 17 15.5M10 12h10.5"/>'),
};

/**
 * Devuelve el SVG de un ícono de navegación, o una cadena vacía si el nombre no
 * existe.
 *
 * Se llama `navIcon` y no `icon` a propósito: `icon` es tan genérico que choca
 * con variables locales de otros módulos, y el test que verifica que lo usado
 * esté importado no puede distinguir un uso real de una coincidencia de nombre.
 * Vacío y no un ícono de reemplazo: un enlace sin ícono se sigue leyendo por
 * su texto, mientras que un signo de pregunta hace pensar que algo falló.
 *
 * @param {string} nombre — clave de ICONS
 * @returns {string} SVG en línea
 */
export function navIcon(nombre) {
  return ICONS[nombre] ?? '';
}

// =============================================================================
// LOS ÍCONOS DEL ESTADO VACÍO
//
// Van aparte de los de navegación porque se dibujan a otra escala. El de la
// barra lateral mide 20px y acompaña a una palabra; éste mide 40px y está solo
// en el centro del panel. Un trazo de 1.7 que se ve bien chico, ampliado al
// doble se ve pesado — por eso 1.25.
//
// Reemplazan al emoji gigante que había antes. Dos razones concretas, más allá
// del gusto: el emoji no hereda `currentColor`, así que quedaba a todo color
// sobre un estado vacío que es gris; y cada sistema operativo lo dibuja
// distinto, de modo que la pantalla que uno diseña no es la que ve el usuario.
// =============================================================================

/** Envoltura del estado vacío: mismo lenguaje, trazo más fino por el tamaño. */
const svgVacio = (paths) =>
  `<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const EMPTY_ICONS = {
  // Hoja con renglones: no hay cotizaciones que mostrar.
  cotizaciones: svgVacio('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),

  // Lupa: se buscó y no apareció nada. Distinto de «no hay nada cargado».
  busqueda: svgVacio('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),

  // Edificio: los clientes son empresas.
  clientes: svgVacio('<path d="M4 20V6l7-3v17M11 20h9V10l-9-3"/><path d="M14 12h3M14 16h3M7 8v.01M7 12v.01M7 16v.01"/>'),

  // Calendario: las licitaciones se ordenan por fecha límite.
  licitaciones: svgVacio('<path d="M4 6h16v14H4z"/><path d="M4 10h16M9 6V4M15 6V4"/>'),

  // Caja: el reporte de consumo cuenta repuestos, no documentos.
  items: svgVacio('<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>'),

  // Visto dentro de un círculo: la cola quedó vacía porque se terminó el
  // trabajo. Es el único estado vacío que es una buena noticia.
  alDia: svgVacio('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),

  // Flecha entrando a una bandeja: la zona donde se suelta un archivo. Una zona
  // de arrastre es un estado vacío que además invita a llenarlo, así que la
  // flecha apunta HACIA ADENTRO — la de descarga apunta al revés y confundía.
  subir: svgVacio('<path d="M12 15V4"/><path d="m8 7.5 4-3.5 4 3.5"/><path d="M4 14v4.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V14"/>'),
};

// =============================================================================
// LOS ÍCONOS DE TIPO DE ARCHIVO
//
// Acá el ícono SÍ hace falta: en una lista de adjuntos uno busca «el Excel» o
// «el PDF» sin leer los nombres, que suelen ser largos y parecidos entre sí.
// Es el mismo argumento que la barra lateral — la forma llega antes que la
// palabra cuando se recorre una lista con la vista.
//
// Eran emoji (📄 📝 📊 🖼️) y el problema no era que estuvieran: era que cada
// sistema operativo los dibuja distinto, así que la lista que uno diseña no es
// la que ve el usuario, y al lado de un nombre de archivo quedaban a todo color
// sobre una fila gris.
// =============================================================================

/** Tamaño de renglón: acompaña al nombre del archivo, no lo tapa. */
const svgArchivo = (paths) =>
  `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Hoja con la esquina doblada — la base de los tres tipos. */
const HOJA = '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>';

const FILE_ICONS = {
  // Renglones de texto: un documento que se lee.
  texto:   svgArchivo(`${HOJA}<path d="M9 13h6M9 17h4"/>`),
  // Cuadrícula: una planilla.
  planilla: svgArchivo(`${HOJA}<path d="M8.5 12.5h7M8.5 16.5h7M12 12.5v7"/>`),
  // Montaña y sol dentro del marco: una imagen.
  imagen:  svgArchivo('<path d="M4 5h16v14H4z"/><circle cx="9" cy="10" r="1.4"/><path d="m5 17 4.5-4.5L13 16l2.5-2.5L19 17"/>'),
  // Clip: cualquier otra cosa. No se inventa un dibujo para lo desconocido.
  otro:    svgArchivo('<path d="M17 8.5 10 15.5a2.5 2.5 0 0 1-3.5-3.5l7.5-7.5a4 4 0 0 1 5.5 5.5l-8 8a5.5 5.5 0 0 1-7.5-7.5l6.5-6.5"/>'),
};

/** Extensión → tipo de dibujo. Lo que no está acá cae en «otro». */
const EXT_TIPO = {
  pdf: 'texto',  doc: 'texto',    docx: 'texto',  txt: 'texto',
  xls: 'planilla', xlsx: 'planilla', csv: 'planilla',
  jpg: 'imagen', jpeg: 'imagen',  png: 'imagen',  webp: 'imagen',
};

/**
 * SVG del ícono que corresponde al nombre de un archivo, por su extensión.
 *
 * @param {string} nombre — nombre del archivo, con extensión
 * @returns {string} SVG en línea
 */
export function fileIcon(nombre) {
  const ext = String(nombre ?? '').split('.').pop().toLowerCase();
  return FILE_ICONS[EXT_TIPO[ext] ?? 'otro'];
}

/**
 * SVG del ícono de un estado vacío, o cadena vacía si el nombre no existe.
 *
 * Vacío y no una excepción: un nombre mal escrito deja el panel sin dibujo,
 * que se sigue leyendo por su título y su texto. Tirar acá dejaría el panel
 * colgado mostrando el esqueleto de carga para siempre, que es mucho peor.
 *
 * @param {string} nombre — clave de EMPTY_ICONS
 * @returns {string} SVG en línea
 */
export function stateIcon(nombre) {
  return EMPTY_ICONS[nombre] ?? '';
}
