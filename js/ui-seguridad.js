(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const Seguridad = AppFarmacia.Seguridad;
    const Almacenamiento = AppFarmacia.Almacenamiento;

    const el = id => document.getElementById(id);

    let resolverDesbloqueoPendiente = null;

    function mostrarSoloVistaModal(idVista) {
        const vistas = [
            'vistaModalSetupClave',
            'vistaModalCodigoRecuperacion',
            'vistaModalDesbloquear',
            'vistaModalRecuperar',
            'vistaModalDesbloqueado'
        ];
        vistas.forEach(id => {
            const node = el(id);
            if (node) node.style.display = (id === idVista) ? 'block' : 'none';
        });
    }

    function abrirModalSeguridad(vistaForzada = null) {
        const modal = el('modalAdminSeguridad');
        if (!modal || !Seguridad) return;

        const estado = Seguridad.obtenerEstado();
        const titulo = el('tituloModalAdminSeguridad');

        // Limpiar inputs de contraseñas al abrir
        [
            'inputModalNuevaClave', 'inputModalConfirmarClave',
            'inputModalClaveUnlock', 'inputModalCodigoRec', 'inputModalNuevaClaveRec'
        ].forEach(id => {
            if (el(id)) el(id).value = '';
        });

        if (vistaForzada) {
            mostrarSoloVistaModal(vistaForzada);
        } else if (!estado.configurado) {
            mostrarSoloVistaModal('vistaModalSetupClave');
            if (titulo) titulo.textContent = 'Activar Cifrado de Negocio (AES-256)';
        } else if (estado.bloqueado) {
            mostrarSoloVistaModal('vistaModalDesbloquear');
            if (titulo) titulo.textContent = 'Desbloquear Bóveda de Administrador';
        } else {
            mostrarSoloVistaModal('vistaModalDesbloqueado');
            if (titulo) titulo.textContent = 'Sesión de Administrador Activa';
        }

        if (!modal.open && typeof modal.showModal === 'function') {
            modal.showModal();
        }

        setTimeout(() => {
            if (el('vistaModalDesbloquear')?.style.display === 'block') el('inputModalClaveUnlock')?.focus();
            else if (el('vistaModalSetupClave')?.style.display === 'block') el('inputModalNuevaClave')?.focus();
        }, 40);
    }

    function cerrarModalSeguridad() {
        const modal = el('modalAdminSeguridad');
        if (modal && modal.open && typeof modal.close === 'function') {
            modal.close();
        }
        if (resolverDesbloqueoPendiente) {
            const res = resolverDesbloqueoPendiente;
            resolverDesbloqueoPendiente = null;
            res(Boolean(Seguridad && !Seguridad.estaBloqueado()));
        }
    }

    function solicitarDesbloqueoSiNecesario() {
        if (!Seguridad || !Seguridad.estaConfigurado() || !Seguridad.estaBloqueado()) {
            return Promise.resolve(true);
        }
        return new Promise(resolve => {
            resolverDesbloqueoPendiente = resolve;
            abrirModalSeguridad('vistaModalDesbloquear');
        });
    }

    function actualizarInterfazEstado() {
        if (!Seguridad) return;
        const estado = Seguridad.obtenerEstado();

        // 1. Indicador en cabecera superior
        const btnHeader = el('btnEstadoSeguridadHeader');
        const txtHeader = el('txtEstadoSeguridadHeader');
        const icoHeader = el('icoEstadoSeguridadHeader');
        if (btnHeader && txtHeader) {
            btnHeader.classList.remove('sin-clave', 'bloqueado', 'desbloqueado');
            if (!estado.configurado) {
                btnHeader.classList.add('sin-clave');
                txtHeader.textContent = 'Cifrado: Sin Clave';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-warn"/>';
            } else if (estado.bloqueado) {
                btnHeader.classList.add('bloqueado');
                txtHeader.textContent = 'Bóveda: Bloqueada';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-lock"/>';
            } else {
                btnHeader.classList.add('desbloqueado');
                txtHeader.textContent = 'Admin: Activo';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-unlock"/>';
            }
        }

        // 2. Panel de Administrador en Bóveda (#panelAdminBoveda)
        const badgePanel = el('badgePanelAdminEstado');
        const bSin = el('adminBloqueSinClave');
        const bBloq = el('adminBloqueBloqueado');
        const bDesbloq = el('adminBloqueDesbloqueado');

        if (badgePanel) {
            badgePanel.classList.remove('sin-clave', 'bloqueado', 'desbloqueado');
            if (!estado.configurado) {
                badgePanel.classList.add('sin-clave');
                badgePanel.textContent = 'Sin Contraseña';
            } else if (estado.bloqueado) {
                badgePanel.classList.add('bloqueado');
                badgePanel.textContent = 'Cifrada / Bloqueada';
            } else {
                badgePanel.classList.add('desbloqueado');
                badgePanel.textContent = 'Desbloqueada en Sesión';
            }
        }

        if (bSin) bSin.style.display = (!estado.configurado) ? 'block' : 'none';
        if (bBloq) bBloq.style.display = (estado.configurado && estado.bloqueado) ? 'block' : 'none';
        if (bDesbloq) bDesbloq.style.display = (estado.configurado && !estado.bloqueado) ? 'block' : 'none';

        if (el('selPanelAutoBloqueo')) {
            el('selPanelAutoBloqueo').value = String(estado.minutosAutoBloqueo || 0);
        }

        // 3. Visibilidad de barra de acciones de Proveedores y Reglas
        const btnNuevoProv = el('btnNuevoProveedor');
        if (btnNuevoProv) {
            btnNuevoProv.style.display = (estado.configurado && estado.bloqueado) ? 'none' : 'inline-flex';
        }
        const avisoReglas = el('avisoReglasBloqueadas');
        if (avisoReglas) {
            avisoReglas.style.display = (estado.configurado && estado.bloqueado) ? 'flex' : 'none';
        }
    }

    function sincronizarAppTrasCambioSeguridad(fueDesbloqueo) {
        const Estado = AppFarmacia.Estado;
        if (!Estado) return;

        if (fueDesbloqueo) {
            const sesionEnCurso = Estado.sesionActual;
            const tieneTrabajoEnCurso = Boolean(sesionEnCurso && Array.isArray(sesionEnCurso.productos) && sesionEnCurso.productos.length > 0);
            if (!tieneTrabajoEnCurso) {
                Estado.sesionActual = Almacenamiento.cargarBorradorActivo();
            } else {
                Almacenamiento.guardarBorradorActivo(sesionEnCurso);
            }
            Estado.reglasActivas = Almacenamiento.obtenerReglasNegocio();
        } else {
            Estado.sesionActual = Almacenamiento.crearSesionVacia();
            Estado.reglasActivas = Almacenamiento.obtenerReglasNegocio();
            if (el('calcPrecioCaja')) el('calcPrecioCaja').value = '';
            if (UI.Calculadora && typeof UI.Calculadora.establecerBloqueoReglas === 'function') {
                UI.Calculadora.establecerBloqueoReglas(true);
            }
        }

        Estado.renderizarTodo();
        if (UI.Diccionario && typeof UI.Diccionario.renderizarProveedoresUI === 'function') {
            UI.Diccionario.renderizarProveedoresUI();
        }
        if (UI.Calculadora && typeof UI.Calculadora.calcularEnVivo === 'function') {
            UI.Calculadora.calcularEnVivo();
        }
        actualizarInterfazEstado();
    }

    function inicializarEventosSeguridad() {
        if (!Seguridad) return;

        const btnHeader = el('btnEstadoSeguridadHeader');
        if (btnHeader) btnHeader.addEventListener('click', () => abrirModalSeguridad());

        const btnCerrar = el('btnCerrarModalAdminSeguridad');
        if (btnCerrar) btnCerrar.addEventListener('click', cerrarModalSeguridad);

        const btnAbrirSetupPanel = el('btnAbrirSetupDesdePanel');
        if (btnAbrirSetupPanel) btnAbrirSetupPanel.addEventListener('click', () => abrirModalSeguridad('vistaModalSetupClave'));

        const btnAbrirUnlockPanel = el('btnAbrirUnlockDesdePanel');
        if (btnAbrirUnlockPanel) btnAbrirUnlockPanel.addEventListener('click', () => abrirModalSeguridad('vistaModalDesbloquear'));

        // Setup inicial de Contraseña Maestra
        const formSetup = el('formModalSetupClave');
        if (formSetup) {
            formSetup.addEventListener('submit', async e => {
                e.preventDefault();
                const pass = el('inputModalNuevaClave')?.value || '';
                const conf = el('inputModalConfirmarClave')?.value || '';
                const mins = parseInt(el('selectModalAutoBloqueo')?.value || '15', 10);
                if (pass !== conf) {
                    return UI.Notificaciones.mostrarMensaje('Las contraseñas no coinciden.', 'error');
                }
                const btn = el('btnModalActivarCifrado');
                try {
                    if (btn) btn.disabled = true;
                    const res = await Almacenamiento.activarCifradoConContrasena(pass, { minutosAutoBloqueo: mins });
                    if (res && res.exito) {
                        if (el('boxModalCodigoRecuperacion')) {
                            el('boxModalCodigoRecuperacion').textContent = res.codigoRecuperacion;
                        }
                        if (el('tituloModalAdminSeguridad')) {
                            el('tituloModalAdminSeguridad').textContent = 'Guarda tu Código de Recuperación';
                        }
                        mostrarSoloVistaModal('vistaModalCodigoRecuperacion');
                        sincronizarAppTrasCambioSeguridad(true);
                        UI.Notificaciones.mostrarMensaje('Cifrado AES-256 activado. Todos tus costos, facturas y proveedores fueron cifrados localmente.', 'success');
                    }
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'No se pudo activar el cifrado.', 'error');
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        }

        // Copiar y confirmar código de recuperación
        const btnCopiarRec = el('btnCopiarCodigoRecuperacion');
        if (btnCopiarRec) {
            btnCopiarRec.addEventListener('click', () => {
                const codigo = el('boxModalCodigoRecuperacion')?.textContent || '';
                if (!codigo) return;
                AppFarmacia.Dominio.copiarAlPortapapeles(codigo).then(() => {
                    UI.Notificaciones.mostrarMensaje('Código de recuperación copiado. Guárdalo fuera de este equipo.', 'info');
                });
            });
        }
        const btnConfirmRec = el('btnConfirmarCodigoGuardado');
        if (btnConfirmRec) {
            btnConfirmRec.addEventListener('click', () => {
                if (el('boxModalCodigoRecuperacion')) el('boxModalCodigoRecuperacion').textContent = '';
                cerrarModalSeguridad();
            });
        }

        // Desbloquear Bóveda
        const formUnlock = el('formModalDesbloquear');
        if (formUnlock) {
            formUnlock.addEventListener('submit', async e => {
                e.preventDefault();
                const pass = el('inputModalClaveUnlock')?.value || '';
                const btn = el('btnModalDesbloquear');
                try {
                    if (btn) btn.disabled = true;
                    await Almacenamiento.desbloquearBoveda(pass);
                    if (el('inputModalClaveUnlock')) el('inputModalClaveUnlock').value = '';
                    sincronizarAppTrasCambioSeguridad(true);
                    UI.Notificaciones.mostrarMensaje('Bóveda desbloqueada. Acceso autorizado en RAM.', 'success');
                    cerrarModalSeguridad();
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'Contraseña incorrecta.', 'error');
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        }

        // Alternar a recuperación
        const btnMostrarRec = el('btnModalMostrarRecuperar');
        if (btnMostrarRec) {
            btnMostrarRec.addEventListener('click', () => {
                mostrarSoloVistaModal('vistaModalRecuperar');
                if (el('tituloModalAdminSeguridad')) el('tituloModalAdminSeguridad').textContent = 'Recuperación de Emergencia';
                el('inputModalCodigoRec')?.focus();
            });
        }
        const btnVolverUnlock = el('btnModalVolverUnlock');
        if (btnVolverUnlock) {
            btnVolverUnlock.addEventListener('click', () => {
                mostrarSoloVistaModal('vistaModalDesbloquear');
                if (el('tituloModalAdminSeguridad')) el('tituloModalAdminSeguridad').textContent = 'Desbloquear Bóveda de Administrador';
            });
        }

        // Recuperar con código de emergencia
        const formRecuperar = el('formModalRecuperar');
        if (formRecuperar) {
            formRecuperar.addEventListener('submit', async e => {
                e.preventDefault();
                const codigo = el('inputModalCodigoRec')?.value || '';
                const nuevaClave = el('inputModalNuevaClaveRec')?.value || '';
                const btn = el('btnModalRecuperar');
                try {
                    if (btn) btn.disabled = true;
                    const res = await Almacenamiento.recuperarBovedaConCodigo(codigo, nuevaClave);
                    if (res && res.exito) {
                        if (el('boxModalCodigoRecuperacion')) {
                            el('boxModalCodigoRecuperacion').textContent = res.nuevoCodigoRecuperacion;
                        }
                        if (el('tituloModalAdminSeguridad')) {
                            el('tituloModalAdminSeguridad').textContent = 'Nuevo Código de Recuperación Generado';
                        }
                        mostrarSoloVistaModal('vistaModalCodigoRecuperacion');
                        sincronizarAppTrasCambioSeguridad(true);
                        UI.Notificaciones.mostrarMensaje('Contraseña restablecida y nuevo código de emergencia generado.', 'success');
                    }
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'Código inválido.', 'error');
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        }

        // Bloquear manualmente desde modal o panel
        const ejecutarBloqueoManual = () => {
            Almacenamiento.bloquearBoveda();
            sincronizarAppTrasCambioSeguridad(false);
            cerrarModalSeguridad();
            UI.Notificaciones.mostrarMensaje('Sesión bloqueada y memoria RAM limpiada.', 'info');
        };
        if (el('btnModalBloquearAhora')) el('btnModalBloquearAhora').addEventListener('click', ejecutarBloqueoManual);
        if (el('btnPanelBloquearAhora')) el('btnPanelBloquearAhora').addEventListener('click', ejecutarBloqueoManual);

        const btnIrPanel = el('btnModalIrPanelAdmin');
        if (btnIrPanel) {
            btnIrPanel.addEventListener('click', () => {
                cerrarModalSeguridad();
                const drawer = el('drawerBoveda');
                const backdrop = el('drawerBackdrop');
                document.querySelectorAll('[data-boveda-tab]').forEach(btn => {
                    btn.classList.toggle('activo', btn.getAttribute('data-boveda-tab') === 'seccionEscanerIA');
                });
                document.querySelectorAll('#drawerBoveda .boveda-panel').forEach(panel => {
                    panel.classList.toggle('activo', panel.id === 'seccionEscanerIA');
                });
                if (drawer) drawer.classList.add('abierto');
                if (backdrop) backdrop.classList.add('abierto');
            });
        }

        // Auto-bloqueo configurable en Panel Admin
        const selAuto = el('selPanelAutoBloqueo');
        if (selAuto) {
            selAuto.addEventListener('change', async () => {
                await Almacenamiento.actualizarAutoBloqueoBoveda(parseInt(selAuto.value, 10));
                UI.Notificaciones.mostrarMensaje('Tiempo de bloqueo automático actualizado.', 'success');
            });
        }

        // Cambiar contraseña en Panel Admin
        const formCambio = el('formPanelCambiarClave');
        if (formCambio) {
            formCambio.addEventListener('submit', async e => {
                e.preventDefault();
                const actual = el('inputPanelClaveActual')?.value || '';
                const nueva = el('inputPanelClaveNueva')?.value || '';
                const conf = el('inputPanelClaveNuevaConf')?.value || '';
                if (nueva !== conf) {
                    return UI.Notificaciones.mostrarMensaje('La nueva contraseña y su confirmación no coinciden.', 'error');
                }
                const btn = el('btnPanelCambiarClave');
                try {
                    if (btn) btn.disabled = true;
                    await Almacenamiento.cambiarContrasenaBoveda(actual, nueva);
                    formCambio.reset();
                    UI.Notificaciones.mostrarMensaje('Contraseña maestra actualizada exitosamente.', 'success');
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'Error al cambiar contraseña.', 'error');
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        }

        // Regenerar código de recuperación
        const formRegenRec = el('formPanelRegenRec');
        if (formRegenRec) {
            formRegenRec.addEventListener('submit', async e => {
                e.preventDefault();
                const actual = el('inputPanelClaveRegenRec')?.value || '';
                try {
                    const res = await Almacenamiento.regenerarCodigoRecuperacionBoveda(actual);
                    formRegenRec.reset();
                    if (el('boxModalCodigoRecuperacion')) {
                        el('boxModalCodigoRecuperacion').textContent = res.codigoRecuperacion;
                    }
                    abrirModalSeguridad('vistaModalCodigoRecuperacion');
                    UI.Notificaciones.mostrarMensaje('Nuevo código de recuperación generado.', 'success');
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'Contraseña actual incorrecta.', 'error');
                }
            });
        }

        // Purga total de datos privados locales (conserva catálogo sanitario)
        const btnPurgarPrivados = el('btnPanelPurgarPrivados');
        if (btnPurgarPrivados) {
            btnPurgarPrivados.addEventListener('click', async () => {
                const conf = await UI.Notificaciones.mostrarConfirmacion(
                    'Esta acción eliminará permanentemente todos los costos de compra, historiales, facturas y proveedores personalizados del dispositivo, conservando únicamente el catálogo sanitario público de códigos de barras.\n\n¿Deseas continuar?',
                    'Purgar Datos Comerciales Locales'
                );
                if (!conf) return;
                try {
                    const res = await Almacenamiento.purgarDatosPrivadosLocales();
                    if (AppFarmacia.Estado) {
                        AppFarmacia.Estado.sesionActual = Almacenamiento.crearSesionVacia();
                    }
                    sincronizarAppTrasCambioSeguridad(!Seguridad.estaBloqueado());
                    UI.Notificaciones.mostrarMensaje(`Purga completada: secretos comerciales eliminados. Se conservaron ${res.totalProductosConservados} fichas sanitarias públicas.`, 'success');
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'No se pudo completar la purga.', 'error');
                }
            });
        }

        // Reiniciar timer por actividad de usuario
        ['keydown', 'click'].forEach(evt => {
            window.addEventListener(evt, () => {
                if (Seguridad && typeof Seguridad.registrarActividad === 'function') {
                    Seguridad.registrarActividad();
                }
            }, { passive: true });
        });

        // Reaccionar al bloqueo automático por inactividad
        Seguridad.suscribirCambioEstado(estado => {
            actualizarInterfazEstado();
            if (estado && estado.configurado && estado.bloqueado && AppFarmacia.Estado) {
                sincronizarAppTrasCambioSeguridad(false);
            }
        });

        actualizarInterfazEstado();
    }

    UI.Seguridad = Object.freeze({
        abrirModalSeguridad,
        cerrarModalSeguridad,
        solicitarDesbloqueoSiNecesario,
        actualizarInterfazEstado,
        inicializarEventosSeguridad
    });
})(window);
