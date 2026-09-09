/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/guardarArchivo.test.js
// Guardar un archivo y avisar dónde quedó.
//
// POR QUÉ EXISTE
// saveBlobAs() maneja el guardado de TODO lo que baja de la aplicación
// —proformas, expedientes, reportes, planillas, documentos de licitación— desde
// seis pantallas distintas, y no tenía ni una prueba. Tiene dos caminos: el
// diálogo del sistema y la descarga clásica, y el segundo existe justamente
// para los navegadores donde no se puede probar a mano cómodamente.
//
// El aviso estaba copiado en los seis sitios y ya se había separado: cuatro
// decían «guardado en la ubicación elegida» y dos sólo «guardado.», que es
// precisamente omitir el dato que importa.
//
// jsdom por archivo, no global: es la convención de este proyecto.
// =============================================================================

'use strict';

const {
  saveBlobAs, mensajeDeGuardado, guardarArchivo,
  TIPO_PDF, TIPO_EXCEL, TIPO_CUALQUIERA,
} = require('../../public/js/shared/guardarArchivo.js');

const blobFalso = () => new Blob(['contenido'], { type: 'text/plain' });

// jsdom no implementa URL.createObjectURL ni revokeObjectURL: son APIs del
// navegador de verdad, atadas a su gestor de descargas. Se suplen con dobles
// que anotan lo que se les pidió — el camino alternativo de saveBlobAs depende
// de las dos, y es justo el que no se puede probar a mano en Chrome.
let urlsCreadas, urlsLiberadas;

beforeEach(() => {
  urlsCreadas = [];
  urlsLiberadas = [];
  URL.createObjectURL = (b) => { urlsCreadas.push(b); return `blob:falso/${urlsCreadas.length}`; };
  URL.revokeObjectURL = (u) => { urlsLiberadas.push(u); };
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  delete window.showSaveFilePicker;
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe('el diálogo del sistema, cuando está disponible', () => {
  /** Un selector de archivo que acepta y anota lo que se le pidió. */
  function selectorQueAcepta() {
    const escrito = [];
    const writable = {
      write: (b) => { escrito.push(b); return Promise.resolve(); },
      close: () => Promise.resolve(),
    };
    const picker = jest.fn().mockResolvedValue({
      createWritable: () => Promise.resolve(writable),
    });
    window.showSaveFilePicker = picker;
    return { picker, escrito };
  }

  test('guarda y devuelve «saved»', async () => {
    const { picker, escrito } = selectorQueAcepta();
    const blob = blobFalso();

    const r = await saveBlobAs(blob, 'Reporte.pdf', TIPO_PDF);

    expect(r).toBe('saved');
    expect(escrito).toEqual([blob]);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  test('sugiere el nombre de archivo que se le pasó', async () => {
    const { picker } = selectorQueAcepta();
    await saveBlobAs(blobFalso(), 'SC-2026_000692.pdf', TIPO_PDF);

    expect(picker.mock.calls[0][0].suggestedName).toBe('SC-2026_000692.pdf');
  });

  test('con un tipo concreto le pasa el filtro de extensiones', async () => {
    const { picker } = selectorQueAcepta();
    await saveBlobAs(blobFalso(), 'x.xlsx', TIPO_EXCEL);

    expect(picker.mock.calls[0][0].types).toEqual([TIPO_EXCEL]);
  });

  test('con accept vacío NO le pasa `types`', async () => {
    // showSaveFilePicker rechaza con TypeError un types cuyo accept esté vacío.
    // Es el caso de los documentos sueltos de licitación, que pueden ser de
    // cualquier tipo: pasarlo rompería el diálogo en vez de abrirlo.
    const { picker } = selectorQueAcepta();
    await saveBlobAs(blobFalso(), 'contrato.docx', TIPO_CUALQUIERA);

    expect(picker.mock.calls[0][0].types).toBeUndefined();
  });

  test('si la persona cierra el diálogo, no se guarda nada', async () => {
    const abort = Object.assign(new Error('abort'), { name: 'AbortError' });
    window.showSaveFilePicker = jest.fn().mockRejectedValue(abort);

    expect(await saveBlobAs(blobFalso(), 'x.pdf', TIPO_PDF)).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
describe('la descarga clásica, cuando no hay diálogo', () => {
  test('sin selector cae a la descarga y devuelve «downloaded»', async () => {
    // Firefox, Safari, o cualquier contexto sin HTTPS.
    const r = await saveBlobAs(blobFalso(), 'Reporte.pdf', TIPO_PDF);
    expect(r).toBe('downloaded');
  });

  test('un fallo del selector NO pierde el archivo', async () => {
    // Cualquier error que no sea AbortError debe caer a la descarga: perder el
    // archivo porque el diálogo falló sería mucho peor que ignorar la elección.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    window.showSaveFilePicker = jest.fn().mockRejectedValue(new Error('policy'));

    expect(await saveBlobAs(blobFalso(), 'x.pdf', TIPO_PDF)).toBe('downloaded');
  });

  test('la URL temporal del blob se libera', async () => {
    // Sin revoke, cada archivo descargado queda retenido en memoria hasta que
    // se cierre la pestaña. En una jornada de reportes eso se acumula.
    await saveBlobAs(blobFalso(), 'x.pdf', TIPO_PDF);
    expect(urlsCreadas).toHaveLength(1);

    expect(urlsLiberadas).toHaveLength(0);   // todavía no: hay una espera
    jest.runOnlyPendingTimers();
    expect(urlsLiberadas).toEqual(['blob:falso/1']);
  });

  test('el enlace temporal no queda colgado del documento', async () => {
    // Sin quitarlo, cada descarga deja un <a> invisible acumulándose en el body
    // durante toda la sesión.
    const antes = document.body.children.length;
    await saveBlobAs(blobFalso(), 'x.pdf', TIPO_PDF);
    expect(document.body.children.length).toBe(antes);
  });
});

// ---------------------------------------------------------------------------
describe('el aviso dice DÓNDE quedó el archivo', () => {
  test('cuando la persona eligió, se le confirma que fue ahí', () => {
    const a = mensajeDeGuardado('saved', 'Expediente');
    expect(a.texto).toBe('Expediente guardado en la ubicación elegida.');
    expect(a.tipo).toBe('success');
  });

  test('cuando NO eligió, se le dice a qué carpeta fue', () => {
    // Éste es el caso que importa: en el camino alternativo la persona nunca
    // llegó a elegir, así que sin el aviso el archivo queda «perdido».
    const a = mensajeDeGuardado('downloaded', 'Proforma', 'f');
    expect(a.texto).toBe('Proforma descargada a tu carpeta de Descargas.');
    expect(a.tipo).toBe('info');
  });

  test('cancelar no dice nada', () => {
    // Fue una decisión deliberada; un aviso sería ruido.
    expect(mensajeDeGuardado('cancelled', 'Expediente')).toBeNull();
  });

  test.each([
    ['m', 'Expediente', 'Expediente guardado en la ubicación elegida.'],
    ['f', 'Proforma',   'Proforma guardada en la ubicación elegida.'],
    ['f', 'Planilla',   'Planilla guardada en la ubicación elegida.'],
    ['m', 'Documento',  'Documento guardado en la ubicación elegida.'],
  ])('concuerda en género (%s): %s', (genero, sustantivo, esperado) => {
    expect(mensajeDeGuardado('saved', sustantivo, genero).texto).toBe(esperado);
  });

  test('ningún aviso omite dónde quedó el archivo', () => {
    // Dos de las seis copias decían sólo «Expediente guardado.» — sin el dato
    // que la persona necesita. Esto impide que vuelva a pasar.
    for (const resultado of ['saved', 'downloaded']) {
      const a = mensajeDeGuardado(resultado, 'Cosa');
      expect(a.texto).toMatch(/ubicación elegida|carpeta de Descargas/);
    }
  });
});

// ---------------------------------------------------------------------------
describe('guardarArchivo — las dos cosas en una llamada', () => {
  test('devuelve el resultado y el aviso ya armado', async () => {
    const { resultado, aviso } = await guardarArchivo(
      blobFalso(), 'Reporte.pdf', { sustantivo: 'Reporte', tipo: TIPO_PDF }
    );

    expect(resultado).toBe('downloaded');          // sin selector en jsdom
    expect(aviso.texto).toBe('Reporte descargado a tu carpeta de Descargas.');
    expect(aviso.ms).toBe(3500);
  });

  test('sin opciones no explota', async () => {
    const { resultado } = await guardarArchivo(blobFalso(), 'x.bin');
    expect(resultado).toBe('downloaded');
  });
});
