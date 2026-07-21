// =============================================================================
// public/js/views/dashboard/modalUI.js
// MODAL UI Helper — thin singleton shared by DashboardController and every
// Strategy (Executive/Manager/Admin). Extracted verbatim from dashboardView.js
// as part of the file-size cleanup — no behavioral change.
// =============================================================================

export const UI = {
  open: false,
  _activeCleanup: null, // teardown fn for whatever is currently mounted in the modal (if any)
  _closeGuard: null,    // optional fn: return false to block an accidental close (unsaved changes)

  openModal(title, renderFn, { wide = false, dismissOnBackdrop = true } = {}) {
    const overlay  = document.getElementById('modal-overlay');
    const dialog   = document.getElementById('modal-dialog');
    const body     = document.getElementById('modal-body');
    const titleEl  = document.getElementById('modal-title');
    if (!overlay || !body || !titleEl) return;

    // A new modal is about to render — RUN (not just discard) any teardown
    // registered by whatever was previously shown. Discarding silently would
    // leak whatever the old content held (e.g. a draft-lock socket) if a
    // modal is ever replaced without passing through closeModal().
    if (typeof UI._activeCleanup === 'function') {
      try { UI._activeCleanup(); } catch (err) {
        console.warn('[UI.openModal] Previous cleanup callback failed:', err?.message || err);
      }
    }
    UI._activeCleanup = null;
    UI._closeGuard    = null;

    titleEl.textContent = title;
    body.innerHTML      = '';

    // Toggle wide layout for complex views (proforma detail, quotation form)
    if (dialog) {
      dialog.classList.toggle('modal-wide', wide);
    }

    renderFn(body);

    overlay.classList.add('open');
    document.body.classList.add('modal-open'); // makes the page behind the modal inert (see CSS)
    this.open = true;

    // Backdrop click behaviour:
    //   • dismissOnBackdrop = true  → a click on the dark area closes the modal
    //     (through requestClose, so any close-guard still runs). Fine for small
    //     read-only or confirmation modals.
    //   • dismissOnBackdrop = false → a click on the backdrop does NOTHING. Used
    //     by the quotation form: a big data-entry form must never vanish because
    //     the user clicked slightly outside it. It can only be closed via the X,
    //     Escape, or the Cancel button.
    overlay.onclick = dismissOnBackdrop
      ? (e) => { if (e.target === overlay) UI.requestClose(); }
      : null;
  },

  // Lets a modal's content register a teardown callback (e.g. releasing a
  // realtime draft lock) that MUST run no matter which path closes the modal
  // — the X button, Escape, an overlay click, or an explicit Cancel/Submit.
  registerCleanup(fn) {
    UI._activeCleanup = fn;
  },

  // Lets a modal's content register a guard against ACCIDENTAL closes (backdrop
  // click, X button, Escape). Return false from `fn` to keep the modal open —
  // e.g. to ask the user to confirm discarding unsaved changes. Explicit
  // in-form actions (Cancel button, successful Submit) should keep calling
  // closeModal() directly, bypassing this guard.
  registerCloseGuard(fn) {
    UI._closeGuard = fn;
  },

  requestClose() {
    if (typeof UI._closeGuard === 'function') {
      let proceed = true;
      try { proceed = UI._closeGuard(); } catch (err) {
        console.warn('[UI.requestClose] Close guard failed:', err?.message || err);
      }
      if (!proceed) return;
    }
    UI.closeModal();
  },

  closeModal() {
    if (typeof UI._activeCleanup === 'function') {
      try { UI._activeCleanup(); } catch (err) {
        console.warn('[UI.closeModal] Cleanup callback failed:', err?.message || err);
      }
      UI._activeCleanup = null;
    }
    UI._closeGuard = null;

    const overlay = document.getElementById('modal-overlay');
    const dialog  = document.getElementById('modal-dialog');
    if (overlay) overlay.classList.remove('open');
    if (dialog)  dialog.classList.remove('modal-wide');
    document.body.classList.remove('modal-open');
    UI.open = false;
  },
};
