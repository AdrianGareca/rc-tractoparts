// =============================================================================
// public/js/views/dashboard/modules/licitacion/modalGuardado.js
// Qué pasa cuando se aprieta el botón de guardar.
//
// POR QUÉ ESTÁ SEPARADO
// El submit del modal eran noventa líneas con DOS caminos completos adentro
// —adjuntar documentos a una licitación que ya existe, y crear/editar la
// cabecera— separados por un `return` en la mitad. Los dos manipulaban el
// botón, el mensaje de error y el cierre del modal, cada uno con su copia.
//
// Acá son dos funciones con nombre, y el manejo del botón es UNA sola cosa
// compartida (`conBotonOcupado`). Esa parte no es un detalle: es lo que impide
// que alguien apriete dos veces y cree la licitación por duplicado.
// =============================================================================

import api, { showToast } from '../../../../services/apiClient.js';

/**
 * Ejecuta una tarea con el botón bloqueado, y lo devuelve a su estado si falla.
 *
 * En el éxito NO se restaura: el modal se cierra y el botón se va con él.
 * Restaurarlo antes de cerrar reabre por un instante la ventana de doble clic
 * que este envoltorio existe para cerrar.
 *
 * @param {HTMLButtonElement} boton
 * @param {string} textoOcupado  qué dice mientras trabaja
 * @param {() => Promise<void>} tarea
 * @param {(mensaje: string) => void} mostrarError
 */
async function conBotonOcupado(boton, textoOcupado, tarea, mostrarError) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try {
    await tarea();
  } catch (err) {
    mostrarError(err.data?.message || err.message || 'No se pudo completar la operación.');
    boton.disabled = false;
    boton.textContent = original;
  }
}

/**
 * Modo 'attach': sube archivos a una licitación que ya existe.
 *
 * @param {{ licitacion: object, documentos: object, boton: HTMLButtonElement,
 *           mostrarError: Function, alTerminar: Function }} ctx
 */
export async function subirDocumentosSueltos({ licitacion, documentos, boton, mostrarError, alTerminar }) {
  if (!documentos.hayArchivos()) {
    mostrarError('Selecciona al menos un archivo.');
    return;
  }

  await conBotonOcupado(boton, 'Subiendo…', async () => {
    await api.upload(`/api/licitaciones/${licitacion.id}/documentos`, documentos.aFormData());
    showToast('Documento(s) subido(s) correctamente.', 'success');
    alTerminar(licitacion);
  }, mostrarError);
}

/**
 * Lee el formulario de cabecera y lo valida.
 *
 * @returns {{ payload: object|null, error: string|null }}
 */
export function leerCabecera($) {
  const nombre        = $('#lic-nombre').value.trim();
  const idCliente     = parseInt($('#lic-id-cliente').value, 10);
  const presupuesto   = $('#lic-presupuesto').value.trim();
  const fechaLimite   = $('#lic-fecha-limite').value;

  if (!nombre) return { payload: null, error: 'El nombre es obligatorio.' };

  // El id sale del campo OCULTO, que solo se llena al elegir de la lista. Un
  // texto tipeado a mano y no confirmado deja el oculto vacío y cae acá — que
  // es lo correcto: nadie sabe a qué entidad se refería.
  if (!idCliente || isNaN(idCliente)) {
    return { payload: null, error: 'Selecciona una entidad convocante de la lista (o crea una nueva).' };
  }

  return {
    error: null,
    payload: {
      nombre,
      id_cliente:              idCliente,
      descripcion:             $('#lic-descripcion').value.trim() || null,
      // Vacío es null, no cero: «no se cargó presupuesto» y «el presupuesto es
      // cero» son cosas distintas y el reporte las muestra distinto.
      presupuesto_referencial: presupuesto === '' ? null : parseFloat(presupuesto),
      moneda:                  $('#lic-moneda').value,
      fecha_limite:            fechaLimite || null,
    },
  };
}

/**
 * Modo 'create'/'edit': guarda la cabecera y, si hay, sube los documentos.
 *
 * @param {{ $: Function, licitacion: object|null, isEdit: boolean, documentos: object,
 *           boton: HTMLButtonElement, mostrarError: Function, alTerminar: Function }} ctx
 */
export async function guardarCabecera({ $, licitacion, isEdit, documentos, boton, mostrarError, alTerminar }) {
  const { payload, error } = leerCabecera($);
  if (error) { mostrarError(error); return; }

  await conBotonOcupado(boton, isEdit ? 'Guardando…' : 'Creando…', async () => {
    let guardada;
    if (isEdit) {
      const res = await api.put(`/api/licitaciones/${licitacion.id}`, payload);
      guardada = res.data;
      showToast('Licitación actualizada.', 'success');
    } else {
      const res = await api.post('/api/licitaciones', payload);
      guardada = res.data;
      showToast(`Licitación ${guardada?.codigo ?? ''} creada.`, 'success');
    }

    // Los documentos van DESPUÉS, ahora que la licitación tiene id.
    //
    // Su fallo NO es fatal y va en su propio try: la licitación ya quedó
    // guardada, y dejar que el error suba haría que el envoltorio mostrara
    // «no se pudo guardar» sobre algo que sí se guardó. La persona volvería a
    // apretar y crearía la segunda.
    if (documentos.hayArchivos() && guardada?.id) {
      try {
        await api.upload(`/api/licitaciones/${guardada.id}/documentos`, documentos.aFormData());
      } catch (docErr) {
        showToast(
          `Licitación guardada, pero uno o más documentos no pudieron subirse: ${docErr.data?.message || docErr.message}`,
          'warning'
        );
      }
    }

    alTerminar(guardada);
  }, mostrarError);
}
