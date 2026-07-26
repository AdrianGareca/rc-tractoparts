// =============================================================================
// public/js/views/quotationForm/fileUpload.js
// Adjunto opcional de planilla Excel (drag & drop + selector de archivo).
//
// Lógica PURA separada del cableado:
//   validateExcelFile — reglas de aceptación (.xlsx y ≤ 10 MB)
//   wireFileUpload    — engancha change / dragover / dragleave / drop
//
// Extraído de FormMediator._wireFileUpload sin cambios de comportamiento.
// Cubierto por tests/unit/quotationFormFileUpload.test.js.
// =============================================================================

import { showToast } from '../../services/apiClient.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Tamaño máximo aceptado por el backend para la planilla de auditoría. */
export const MAX_EXCEL_BYTES = 10 * 1024 * 1024;

/**
 * Valida un archivo antes de adjuntarlo. Función pura.
 * @returns {{ ok: true }|{ ok: false, message: string }}
 */
export function validateExcelFile(file) {
  if (!file) return { ok: false, message: null };   // sin archivo: no se avisa nada

  const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME;
  if (!isXlsx) {
    return { ok: false, message: 'Solo se aceptan archivos .xlsx (Excel OpenXML).' };
  }
  if (file.size > MAX_EXCEL_BYTES) {
    return { ok: false, message: 'El archivo Excel excede el tamaño máximo de 10 MB.' };
  }
  return { ok: true };
}

/**
 * Cablea la zona de drag & drop del Excel.
 *
 * @param {Object} deps
 *   container  {HTMLElement} — raíz del formulario
 *   onFile     {Function}    — (file) cuando el archivo pasa la validación
 */
export function wireFileUpload({ container, onFile } = {}) {
  const excelZone     = container.querySelector('#excel-drop-zone');
  const excelInput    = container.querySelector('#excel-input');
  const excelFileName = container.querySelector('#excel-file-name');
  if (!excelZone || !excelInput) return;

  const onExcelFile = (file) => {
    const result = validateExcelFile(file);
    if (!result.ok) {
      if (result.message) showToast(result.message, 'error');
      return;
    }
    onFile?.(file);
    excelFileName.textContent = `✓ ${file.name}`;
    excelFileName.classList.remove('hidden');
  };

  excelInput.addEventListener('change', (e) => {
    if (e.target.files[0]) onExcelFile(e.target.files[0]);
  });

  excelZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    excelZone.classList.add('dragover');
  });

  excelZone.addEventListener('dragleave', () => excelZone.classList.remove('dragover'));

  excelZone.addEventListener('drop', (e) => {
    e.preventDefault();
    excelZone.classList.remove('dragover');
    onExcelFile(e.dataTransfer.files[0]);
  });
}
