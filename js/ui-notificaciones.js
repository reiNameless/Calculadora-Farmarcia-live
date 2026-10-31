(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;

    const el = id => document.getElementById(id);
    const escaparHtml = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let temporizadoresNotificacion = [];

    // --- UX-07: Notificaciones con animación, auto-cierre y accesibilidad ---
    function mostrarMensaje(texto, tipo = 'info') {
        const banner = el('notificacionGlobal');
        if (!banner) return;

        temporizadoresNotificacion.forEach(clearTimeout);
        temporizadoresNotificacion = [];

        banner.className = `alert-banner mostrar alert-${tipo}`;
        banner.innerHTML = `<span>${escaparHtml(texto)}</span><button type="button" class="action-icon-btn" aria-label="Cerrar notificación">Cerrar</button>`;

        const btnCerrar = banner.querySelector('button');
        if (btnCerrar) {
            btnCerrar.onclick = () => {
                banner.classList.remove('mostrar');
                banner.style.display = 'none';
            };
        }
        banner.style.display = 'flex';

        const duracion = tipo === 'error' ? 8500 : CONSTANTES.DURACION_NOTIFICACION_MS;
        temporizadoresNotificacion.push(
            setTimeout(() => {
                banner.classList.remove('mostrar');
                banner.style.display = 'none';
            }, duracion)
        );
    }

    // --- UX-01: Diálogos Modales Accesibles HTML5 (<dialog>) ---
    function mostrarConfirmacion(mensaje, titulo = 'Confirmación') {
        const dialog = el('modalConfirmacion');
        if (!dialog || typeof dialog.showModal !== 'function') {
            return Promise.resolve(window.confirm(mensaje));
        }
        return new Promise(resolve => {
            el('modalConfirmTitulo').textContent = titulo;
            el('modalConfirmMensaje').textContent = mensaje;
            const btnAceptar = el('modalConfirmBtnAceptar');
            const btnCancelar = el('modalConfirmBtnCancelar');

            const limpiar = () => {
                btnAceptar.removeEventListener('click', onAceptar);
                btnCancelar.removeEventListener('click', onCancelar);
                dialog.removeEventListener('close', onClose);
            };
            const onAceptar = () => { limpiar(); dialog.close(); resolve(true); };
            const onCancelar = () => { limpiar(); dialog.close(); resolve(false); };
            const onClose = () => { limpiar(); resolve(false); };

            btnAceptar.addEventListener('click', onAceptar);
            btnCancelar.addEventListener('click', onCancelar);
            dialog.addEventListener('close', onClose);
            dialog.showModal();
        });
    }

    function mostrarPrompt(mensaje, valorInicial = '', titulo = 'Ingresar Valor') {
        const dialog = el('modalPrompt');
        if (!dialog || typeof dialog.showModal !== 'function') {
            return Promise.resolve(window.prompt(mensaje, valorInicial));
        }
        return new Promise(resolve => {
            el('modalPromptTitulo').textContent = titulo;
            el('modalPromptMensaje').textContent = mensaje;
            const input = el('modalPromptInput');
            input.value = valorInicial;
            const form = el('formModalPrompt');
            const btnCancelar = el('modalPromptBtnCancelar');

            const limpiar = () => {
                form.removeEventListener('submit', onSubmit);
                btnCancelar.removeEventListener('click', onCancelar);
                dialog.removeEventListener('close', onClose);
            };
            const onSubmit = (e) => {
                e.preventDefault();
                const val = input.value;
                limpiar();
                dialog.close();
                resolve(val);
            };
            const onCancelar = () => { limpiar(); dialog.close(); resolve(null); };
            const onClose = () => { limpiar(); resolve(null); };

            form.addEventListener('submit', onSubmit);
            btnCancelar.addEventListener('click', onCancelar);
            dialog.addEventListener('close', onClose);
            dialog.showModal();
            input.focus();
            input.select();
        });
    }

    UI.Notificaciones = Object.freeze({
        mostrarMensaje,
        mostrarConfirmacion,
        mostrarPrompt,
        escaparHtml
    });
})(window);
