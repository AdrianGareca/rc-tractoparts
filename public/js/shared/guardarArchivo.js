// =============================================================================
// public/js/shared/guardarArchivo.js
// Bajar un archivo: elegir dónde, y decirle a la persona dónde quedó.
//
// POR QUÉ SE MUDÓ ACÁ
// saveBlobAs() vivía dentro de views/dashboard/modules/timelineView.js —un
// módulo de vista— y lo importaban otros tres módulos que no tienen nada que
// ver con la línea de tiempo. Una utilidad que usan cuatro pantallas no es
// parte de ninguna de ellas.
//
// EL AVISO ESTABA COPIADO SEIS VECES, Y YA SE HABÍA SEPARADO
// Cada sitio que guarda un archivo repetía las mismas cuatro líneas: mirar el
// resultado, y mostrar un aviso distinto según si la persona eligió la carpeta
// o si el archivo cayó en Descargas. Seis copias, y ya no decían lo mismo:
//
//     «Documento guardado en la ubicación elegida.»   ← cuatro sitios
//     «Expediente guardado.»                          ← sin decir dónde
//     «Proforma guardada.»                            ← sin decir dónde
//
// Justamente el dato que importa —DÓNDE quedó el archivo— es el que faltaba en
// dos de los seis. Y los tiempos del aviso (2500 y 3500 ms) estaban escritos
// seis veces cada uno.
//
// POR QUÉ DEVUELVE EL TEXTO EN VEZ DE MOSTRARLO
// showToast vive en services/apiClient.js, y los módulos de shared/ sólo
// importan de shared/ — es una frontera deliberada que mantiene esta carpeta
// usable desde cualquier pantalla. Así que acá se arma el mensaje y la pantalla
// lo muestra. Dos líneas en el sitio que llama, en vez de cinco.
// =============================================================================

// Los tipos que acepta el diálogo del sistema, escritos una sola vez.
export const TIPO_PDF   = { description: 'Documento PDF',   accept: { 'application/pdf': ['.pdf'] } };
export const TIPO_EXCEL = {
  description: 'Planilla Excel',
  accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
};
// Sin `accept`: para documentos sueltos de licitación, que pueden ser de
// cualquier tipo. showSaveFilePicker rechaza un `types` con accept vacío, así
// que saveBlobAs lo omite en ese caso.
export const TIPO_CUALQUIERA = { description: 'Documento', accept: {} };

// ---------------------------------------------------------------------------
// saveBlobAs — guarda un Blob, dejando que la persona elija dónde cuando se puede.
//
// Camino moderno (Chrome/Edge sobre HTTPS o localhost): showSaveFilePicker abre
// el diálogo «Guardar como…» del sistema, con el nombre sugerido ya puesto.
// Nada toca el disco hasta que la persona confirma; cancelar no guarda nada.
//
// Camino alternativo (Firefox/Safari, o sin contexto seguro): la descarga
// clásica con un enlace. Dónde cae ese archivo lo decide la configuración del
// navegador — por eso hace falta AVISAR que fue a Descargas: en ese camino la
// persona nunca llegó a elegir.
//
// @param   {Blob}   blob
// @param   {string} nombreArchivo — sugerido, p.ej. "SC-2026_000692.pdf"
// @param   {Object} [tipo]        — uno de los TIPO_* de arriba
// @returns {Promise<'saved'|'cancelled'|'downloaded'>}
// ---------------------------------------------------------------------------
export async function saveBlobAs(blob, nombreArchivo, tipo) {
  // El selector SÓLO existe en contexto seguro (HTTPS o localhost) y en
  // navegadores Chromium. Sobre HTTP en una IP de la red local, o en
  // Firefox/Safari, es undefined y se cae al camino alternativo.
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      // showSaveFilePicker rechaza con TypeError un `types` cuyo `accept` esté
      // vacío. Sólo se pasa cuando hay un mapa real de tipo → extensión, para
      // que se pueda pedir «cualquier archivo» sin romper el diálogo.
      const opciones = { suggestedName: nombreArchivo };
      if (tipo && tipo.accept && Object.keys(tipo.accept).length > 0) {
        opciones.types = [tipo];
      }
      const handle   = await window.showSaveFilePicker(opciones);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      // Cerrar el diálogo es una decisión, no un error.
      if (err?.name === 'AbortError') return 'cancelled';
      // Cualquier otro fallo del selector (permisos, error transitorio del
      // sistema de archivos) cae a la descarga clásica: el archivo no se pierde.
      console.warn('[guardarArchivo] Falló el selector — se descarga directo:', err.message);
    }
  }

  const url    = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href  = url;
  enlace.setAttribute('download', nombreArchivo);
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // La espera antes de liberar la URL garantiza que la descarga ya quedó en
  // manos del gestor del navegador.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// mensajeDeGuardado — qué decirle a la persona según dónde quedó el archivo.
//
// Devuelve null cuando canceló: eligió no guardar, no hay nada que informar.
// Un aviso ahí sería ruido sobre una decisión deliberada.
//
// @param {'saved'|'cancelled'|'downloaded'} resultado
// @param {string} sustantivo — cómo se llama la cosa: 'Expediente', 'Proforma'…
// @param {'m'|'f'} [genero]  — para concordar: guardadO / guardadA
// @returns {{texto:string, tipo:string, ms:number}|null}
// ---------------------------------------------------------------------------
export function mensajeDeGuardado(resultado, sustantivo, genero = 'm') {
  const o = genero === 'f' ? 'a' : 'o';

  if (resultado === 'saved') {
    return {
      // «en la ubicación elegida» no es relleno: es la diferencia con el otro
      // caso, y era lo que faltaba en dos de las seis copias.
      texto: `${sustantivo} guardad${o} en la ubicación elegida.`,
      tipo:  'success',
      ms:    2500,
    };
  }

  if (resultado === 'downloaded') {
    return {
      // Acá la persona NO eligió dónde, así que hay que decírselo o el archivo
      // queda «perdido» en una carpeta que no miró.
      texto: `${sustantivo} descargad${o} a tu carpeta de Descargas.`,
      tipo:  'info',
      ms:    3500,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// guardarArchivo — el guardado y el aviso, en una sola llamada.
//
// @returns {Promise<{resultado:string, aviso:{texto,tipo,ms}|null}>}
//
// @example
//   const { aviso } = await guardarArchivo(blob, nombre, { sustantivo: 'Expediente', tipo: TIPO_PDF });
//   if (aviso) showToast(aviso.texto, aviso.tipo, aviso.ms);
// ---------------------------------------------------------------------------
export async function guardarArchivo(blob, nombreArchivo, { sustantivo, genero = 'm', tipo } = {}) {
  const resultado = await saveBlobAs(blob, nombreArchivo, tipo);
  return { resultado, aviso: mensajeDeGuardado(resultado, sustantivo, genero) };
}
