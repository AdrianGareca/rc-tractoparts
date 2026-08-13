// =============================================================================
// tests/unit/nombreDeDescarga.test.js
// El archivo se descarga con el nombre que tenía cuando se subió.
//
// EL BUG
// La cabecera de descarga saneaba el nombre así:
//
//     doc.nombre_original.replace(/[^\w.\- ]/g, '_')
//
// `\w` es [A-Za-z0-9_] — el alfabeto INGLÉS. Todo lo demás se reemplaza por un
// guión bajo. En una empresa boliviana, donde los documentos se llaman
// «Especificación técnica.pdf» o «Pliego de condiciones — año 2026.pdf», eso
// significa que CADA descarga sale mutilada:
//
//     Especificación técnica.pdf   ->   Especificaci_n t_cnica.pdf
//     Cotización N° 12.pdf         ->   Cotizaci_n N_ 12.pdf
//
// No es cosmético. Quien baja veinte documentos de una licitación para armar el
// expediente termina con veinte archivos que no puede buscar por nombre, y al
// adjuntarlos a la respuesta oficial manda nombres rotos con el membrete de la
// empresa.
//
// POR QUÉ ESTABA ASÍ
// El saneo era correcto en su intención: el nombre viene de quien subió el
// archivo, y meterlo crudo en una cabecera HTTP permite inyectar cabeceras —
// un salto de línea adentro del nombre y se puede escribir una cabecera nueva.
// La lista blanca resolvía eso, pero de la forma más gruesa posible.
//
// LA SOLUCIÓN, QUE ES LA DEL ESTÁNDAR
// La RFC 6266 (y la 5987 para la codificación) previó exactamente esto: la
// cabecera lleva DOS nombres. `filename=` en ASCII para los clientes viejos, y
// `filename*=UTF-8''…` percent-encodeado para todos los demás. Los navegadores
// actuales prefieren el segundo, así que el acento sobrevive; los que no lo
// entienden ignoran el parámetro con asterisco y usan el de siempre.
//
// El percent-encoding no es un adorno: es lo que cierra la inyección. Un salto
// de línea sale como %0A, que en una cabecera es texto y no un salto.
// =============================================================================

'use strict';

const { cabeceraDeDescarga, nombreAscii } = require('../../src/utils/nombreDeDescarga');

// ---------------------------------------------------------------------------
describe('el acento sobrevive a la descarga', () => {
  test('un nombre en castellano llega entero', () => {
    const cabecera = cabeceraDeDescarga('Especificación técnica.pdf');

    // El parámetro con asterisco es el que leen los navegadores actuales.
    expect(cabecera).toContain("filename*=UTF-8''");
    // 'ó' es %C3%B3 en UTF-8 percent-encodeado.
    expect(cabecera).toContain('Especificaci%C3%B3n%20t%C3%A9cnica.pdf');
  });

  test('la eñe también', () => {
    const cabecera = cabeceraDeDescarga('Diseño de la propuesta.docx');
    expect(cabecera).toContain('Dise%C3%B1o');
  });

  test('sigue habiendo un nombre ASCII para los clientes viejos', () => {
    const cabecera = cabeceraDeDescarga('Especificación técnica.pdf');

    // Los dos parámetros conviven en la misma cabecera. El viejo va primero
    // porque un cliente que no entiende el segundo lo ignora y se queda con
    // este; al revés, un cliente viejo se quedaría sin ninguno.
    expect(cabecera).toMatch(/filename="[^"]+"/);
    expect(cabecera).toMatch(/^attachment; filename="/);
  });

  test('la extensión nunca se pierde', () => {
    // Sin extensión, Windows no sabe con qué abrirlo y muestra el diálogo de
    // "elegir programa" para un PDF perfectamente normal.
    const cabecera = cabeceraDeDescarga('Análisis año 2026.xlsx');
    expect(cabecera).toContain('.xlsx');
    expect(nombreAscii('Análisis año 2026.xlsx')).toMatch(/\.xlsx$/);
  });
});

// ---------------------------------------------------------------------------
describe('lo que la cabecera no deja pasar', () => {
  test('un salto de línea no puede abrir una cabecera nueva', () => {
    // El ataque: el nombre del archivo lo elige quien lo sube. Si un salto de
    // línea llega crudo a la cabecera, lo que sigue se interpreta como una
    // cabecera HTTP propia — desde una cookie hasta una redirección.
    const cabecera = cabeceraDeDescarga('inocente.pdf\r\nSet-Cookie: rol=SysAdmin');

    expect(cabecera).not.toContain('\r');
    expect(cabecera).not.toContain('\n');
    // Ni siquiera el nombre de la cabecera inyectada debe quedar legible en el
    // tramo ASCII, donde no hay percent-encoding que lo neutralice.
    expect(cabecera).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''\S*$/);
  });

  test('una comilla no puede cerrar el nombre antes de tiempo', () => {
    // `filename="x"; algo="y"` — cerrar la comilla deja escribir parámetros.
    const cabecera = cabeceraDeDescarga('archivo".pdf');
    const entreComillas = cabecera.match(/filename="([^"]*)"/)[1];
    expect(entreComillas).not.toContain('"');
  });

  test('una barra no puede sugerir una ruta', () => {
    const cabecera = cabeceraDeDescarga('../../etc/passwd');
    const entreComillas = cabecera.match(/filename="([^"]*)"/)[1];
    expect(entreComillas).not.toContain('/');
    expect(entreComillas).not.toContain('\\');
  });
});

// ---------------------------------------------------------------------------
describe('los casos degenerados no dejan la cabecera rota', () => {
  test('un nombre vacío se reemplaza por uno utilizable', () => {
    // Sin esto la cabecera queda `filename=""` y el navegador inventa un nombre
    // —a veces el último tramo de la URL, o sea el id numérico—.
    const cabecera = cabeceraDeDescarga('');
    expect(cabecera).toMatch(/filename="[^"]+"/);
  });

  test('un nombre que era todo acentos no queda vacío en el tramo ASCII', () => {
    // '汉字.pdf' no tiene nada representable en ASCII. El tramo viejo tiene que
    // seguir diciendo algo, aunque sea genérico.
    expect(nombreAscii('汉字.pdf').length).toBeGreaterThan(0);
  });

  test('null y undefined no rompen', () => {
    expect(() => cabeceraDeDescarga(null)).not.toThrow();
    expect(() => cabeceraDeDescarga(undefined)).not.toThrow();
  });
});
