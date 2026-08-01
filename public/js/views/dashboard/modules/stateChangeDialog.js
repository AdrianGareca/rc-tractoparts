// =============================================================================
// public/js/views/dashboard/modules/stateChangeDialog.js
// El diálogo de «confirmá este cambio de estado, con una observación».
//
// POR QUÉ EXISTE
// Estaba escrito DOS veces, palabra por palabra: `_confirmStateChange` en
// managerStrategy y `_confirmDelegatedStateChange` en executiveStrategy. Misma
// firma, mismo HTML, misma lógica; lo único distinto era el prefijo de los `id`
// (`sc-` contra `dsc-`), que existe únicamente porque quien copió el bloque
// tuvo que renombrarlos para no chocar.
//
// Es el mismo patrón que ya nos mordió con la paginación (cuatro copias de
// renderPagination) y con el botón de archivar (dibujado en la plantilla,
// cableado en una sola strategy). La forma en que termina siempre es la misma:
// alguien corrige un lado y el otro queda viejo, y nadie se entera hasta que un
// usuario reporta que "en mi pantalla no funciona igual".
//
// Lo usan las dos rutas del ciclo de vida:
//   • el Jefe/SysAdmin decidiendo sobre una cotización
//   • el Ejecutivo con delegación haciendo lo mismo con su propia autorización
// Las dos van por PUT /:id/estado (ChangeStatusCommand); el backend revalida el
// permiso en cada llamada, así que compartir el diálogo no comparte privilegios.
// =============================================================================

import { UI } from '../modalUI.js';
import { CommandInvoker, ChangeStatusCommand } from '../commands.js';

/**
 * Abre el diálogo y ejecuta la transición si el usuario confirma.
 *
 * @param {Object}   opts
 * @param {number}   opts.id            — cotización
 * @param {string}   opts.newState      — estado destino
 * @param {string}   opts.title         — título del modal Y texto del botón
 * @param {string}   opts.description   — qué va a pasar, en una frase
 * @param {string}   opts.obsLabel      — etiqueta del campo de observación
 * @param {boolean} [opts.obsRequired]  — si es obligatorio completarlo
 * @param {string}   opts.successMsg    — toast al salir bien
 * @param {Function} [opts.onSuccess]   — típicamente refrescar el listado
 */
export function confirmStateChange({
  id, newState, title, description,
  obsLabel, obsRequired = false, successMsg, onSuccess,
}) {
  UI.openModal(title, (body) => {
    body.innerHTML = `
      <p class="text-sm" style="color:var(--text-secondary);margin-bottom:1rem;">
        ${description}
      </p>
      <div class="form-group">
        <label class="form-label" for="scd-obs">${obsLabel}</label>
        <textarea class="form-control" id="scd-obs" rows="3"
                  placeholder="${obsRequired ? 'Requerido' : 'Opcional'}"></textarea>
        <span class="field-error" id="scd-err"></span>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem;">
        <button class="btn btn-ghost" id="scd-cancel">Cancelar</button>
        <button class="btn btn-primary" id="scd-confirm">${title}</button>
      </div>`;

    body.querySelector('#scd-cancel')?.addEventListener('click', UI.closeModal);

    body.querySelector('#scd-confirm')?.addEventListener('click', () => {
      const obs   = body.querySelector('#scd-obs')?.value.trim() ?? '';
      const errEl = body.querySelector('#scd-err');

      // El servidor también lo exige donde corresponde; esto evita el viaje de
      // ida y vuelta y muestra el error en el campo, no en un toast.
      if (obsRequired && !obs) {
        errEl.textContent = 'Este campo es requerido.';
        return;
      }
      errEl.textContent = '';

      CommandInvoker.run(new ChangeStatusCommand(id, newState, obs), {
        btn: body.querySelector('#scd-confirm'),
        successMsg,
        onSuccess: () => { UI.closeModal(); onSuccess?.(); },
      });
    });
  });
}
