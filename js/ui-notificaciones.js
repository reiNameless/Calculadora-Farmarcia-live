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
        banner.innerHTML = `<span>${escaparHtml(texto)}</span><button type="button" class="btn-icono" style="border:none;background:transparent;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;" aria-label="Cerrar notificación">&times;</button>`;

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

    // --- UX-08: Filtro estricto anti-letras para casillas y entradas numéricas (con soporte opcional de oferta Compradas+Bonificadas) ---
    function configurarFiltroNumerico(input, esDecimal = false, permitirOferta = false) {
        if (!input) return null;

        const onKeyDown = e => {
            // Teclas de control y navegación siempre permitidas
            const teclasPermitidas = [
                'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
                'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                'Home', 'End'
            ];
            if (teclasPermitidas.includes(e.key)) return;

            // Atajos del sistema (Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+X, Ctrl+Z, etc.)
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // Si es campo decimal, permitir punto o coma siempre que no exista ya uno
            if (esDecimal && (e.key === '.' || e.key === ',')) {
                const tieneSeparador = input.value.includes('.') || input.value.includes(',');
                if (tieneSeparador) {
                    let estaSeleccionado = false;
                    try {
                        if (typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
                            const sel = input.value.substring(input.selectionStart, input.selectionEnd);
                            estaSeleccionado = sel.includes('.') || sel.includes(',');
                        }
                    } catch (_) {}
                    if (!estaSeleccionado) {
                        e.preventDefault();
                        return;
                    }
                }
                return;
            }

            // Si permite oferta de droguería (ej: 10+2), permitir el signo + siempre que no exista ya uno
            if (permitirOferta && e.key === '+') {
                const tieneMas = input.value.includes('+');
                if (tieneMas) {
                    let estaSeleccionado = false;
                    try {
                        if (typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
                            const sel = input.value.substring(input.selectionStart, input.selectionEnd);
                            estaSeleccionado = sel.includes('+');
                        }
                    } catch (_) {}
                    if (!estaSeleccionado) {
                        e.preventDefault();
                        return;
                    }
                }
                return;
            }

            // Bloquear cualquier carácter que no sea un dígito 0-9
            if (!/^[0-9]$/.test(e.key)) {
                e.preventDefault();
            }
        };

        const onInput = () => {
            let val = input.value;
            if (esDecimal) {
                val = val.replace(/,/g, '.');
                val = val.replace(/[^0-9.]/g, '');
                const partes = val.split('.');
                if (partes.length > 2) {
                    val = partes[0] + '.' + partes.slice(1).join('');
                }
            } else if (permitirOferta) {
                val = val.replace(/[^0-9+]/g, '');
                const partes = val.split('+');
                if (partes.length > 2) {
                    val = partes[0] + '+' + partes.slice(1).join('');
                }
            } else {
                val = val.replace(/[^0-9]/g, '');
            }
            if (input.value !== val) {
                input.value = val;
            }
        };

        input.addEventListener('keydown', onKeyDown);
        input.addEventListener('input', onInput);

        return () => {
            input.removeEventListener('keydown', onKeyDown);
            input.removeEventListener('input', onInput);
        };
    }

    function mostrarPrompt(mensaje, valorInicial = '', titulo = 'Ingresar Valor', tipoFiltro = null) {
        const dialog = el('modalPrompt');
        if (!dialog || typeof dialog.showModal !== 'function') {
            return Promise.resolve(window.prompt(mensaje, valorInicial));
        }
        return new Promise(resolve => {
            el('modalPromptTitulo').textContent = titulo;
            el('modalPromptMensaje').textContent = mensaje;
            const input = el('modalPromptInput');
            input.value = valorInicial;
            input.inputMode = tipoFiltro === 'decimal' ? 'decimal' : (tipoFiltro === 'entero' ? 'numeric' : 'text');

            let removerFiltro = null;
            if (tipoFiltro === 'entero') {
                removerFiltro = configurarFiltroNumerico(input, false);
            } else if (tipoFiltro === 'decimal') {
                removerFiltro = configurarFiltroNumerico(input, true);
            }

            const form = el('formModalPrompt');
            const btnCancelar = el('modalPromptBtnCancelar');

            const limpiar = () => {
                if (typeof removerFiltro === 'function') removerFiltro();
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

    UI.configurarFiltroNumerico = configurarFiltroNumerico;

    UI.Notificaciones = Object.freeze({
        mostrarMensaje,
        mostrarConfirmacion,
        mostrarPrompt,
        configurarFiltroNumerico,
        escaparHtml
    });
})(window);
