(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;

    const el = id => document.getElementById(id);

    const VISTAS_MODAL = [
        'vistaModalSetupClave',
        'vistaModalCodigoRecuperacion',
        'vistaModalDesbloquear',
        'vistaModalRecuperar',
        'vistaModalDesbloqueado'
    ];

    let resolucionModalPendiente = null; // { resolver: fn, modo: 'admin' | 'caja_o_admin' }
    let tarjetaPeerPendiente = null;
    let sincronizandoPorEventoSeguridad = false;
    let nivelPrevioSincronizado = null;

    function obtenerSeguridad() {
        return AppFarmacia.Seguridad;
    }

    function obtenerAlmacenamiento() {
        return AppFarmacia.Almacenamiento;
    }

    function notificar(mensaje, tipo = 'info') {
        if (UI.Notificaciones && typeof UI.Notificaciones.mostrarMensaje === 'function') {
            UI.Notificaciones.mostrarMensaje(mensaje, tipo);
        }
    }

    function escaparHtml(texto) {
        if (UI.Notificaciones && typeof UI.Notificaciones.escaparHtml === 'function') {
            return UI.Notificaciones.escaparHtml(texto);
        }
        return String(texto ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    async function copiarTextoSeguro(texto) {
        if (!texto) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(texto);
                return true;
            }
        } catch (_) {}
        return false;
    }

    function mostrarSoloVistaModal(vistaActivaId) {
        for (const id of VISTAS_MODAL) {
            const nodo = el(id);
            if (nodo) nodo.style.display = (id === vistaActivaId) ? 'block' : 'none';
        }
    }

    function limpiarInputsSensiblesModal() {
        const ids = [
            'inputModalNuevaClave',
            'inputModalConfirmarClave',
            'inputModalPinCajaSetup',
            'inputModalPinCajaUnlock',
            'inputModalClaveUnlock',
            'inputModalCodigoRec',
            'inputModalNuevaClaveRec'
        ];
        ids.forEach(id => {
            const inp = el(id);
            if (inp) inp.value = '';
        });
    }

    function limpiarEstadoP2pEnDom() {
        tarjetaPeerPendiente = null;
        if (el('inputAliasPeerP2P')) el('inputAliasPeerP2P').value = '';
        if (el('inputTarjetaPeerP2P')) el('inputTarjetaPeerP2P').value = '';
        if (el('boxCodigoSasP2P')) {
            el('boxCodigoSasP2P').textContent = 'SAS: ---';
            el('boxCodigoSasP2P').style.display = 'none';
        }
        if (el('btnConfirmarEmparejarP2P')) el('btnConfirmarEmparejarP2P').style.display = 'none';
        if (el('boxCodigoEntregaSync')) el('boxCodigoEntregaSync').style.display = 'none';
        if (el('txtCodigoEntregaSync')) el('txtCodigoEntregaSync').textContent = '';
        if (el('inputCodigoEntregaImportP2P')) el('inputCodigoEntregaImportP2P').value = '';
        if (el('inputImportarSyncP2P')) el('inputImportarSyncP2P').value = '';
        if (el('listaPeersP2P')) el('listaPeersP2P').innerHTML = '';
        if (el('selDestinoSyncP2P')) {
            el('selDestinoSyncP2P').innerHTML = '<option value="">Selecciona PC destino autorizada...</option>';
        }
    }

    function alternarTabUnlock(modoTab) {
        const Seguridad = obtenerSeguridad();
        const cajaConf = Boolean(Seguridad && Seguridad.estaCajaConfigurada && Seguridad.estaCajaConfigurada());
        const usarCaja = (modoTab === 'caja') && cajaConf;

        const btnCaja = el('btnTabUnlockCaja');
        const btnAdmin = el('btnTabUnlockAdmin');
        const formCaja = el('formModalDesbloquearCaja');
        const formAdmin = el('formModalDesbloquear');

        if (btnCaja) btnCaja.classList.toggle('activo', usarCaja);
        if (btnAdmin) btnAdmin.classList.toggle('activo', !usarCaja);
        if (formCaja) formCaja.style.display = usarCaja ? 'flex' : 'none';
        if (formAdmin) formAdmin.style.display = usarCaja ? 'none' : 'flex';

        if (usarCaja) {
            if (el('inputModalClaveUnlock')) el('inputModalClaveUnlock').value = '';
            setTimeout(() => { el('inputModalPinCajaUnlock')?.focus(); }, 40);
        } else {
            if (el('inputModalPinCajaUnlock')) el('inputModalPinCajaUnlock').value = '';
            setTimeout(() => { el('inputModalClaveUnlock')?.focus(); }, 40);
        }
    }

    function resolverEsperaSeguridad() {
        if (!resolucionModalPendiente) return;
        const pendiente = resolucionModalPendiente;
        resolucionModalPendiente = null;

        const Seguridad = obtenerSeguridad();
        if (!Seguridad || !Seguridad.estaConfigurado()) {
            pendiente.resolver(true);
            return;
        }
        const ok = (pendiente.modo === 'caja_o_admin')
            ? Boolean(typeof Seguridad.estaCajaActiva === 'function' ? Seguridad.estaCajaActiva() : !Seguridad.estaBloqueado())
            : Boolean(!Seguridad.estaBloqueado());
        pendiente.resolver(ok);
    }

    function abrirModalSeguridad(vistaPreferida = null, opciones = {}) {
        const modal = el('modalAdminSeguridad');
        const Seguridad = obtenerSeguridad();
        if (!modal || !Seguridad) return;

        const estado = Seguridad.obtenerEstado();
        if (!estado.soportado) {
            notificar('Este navegador no soporta cifrado AES-256 (WebCrypto). Actualiza tu navegador.', 'error');
            return;
        }

        limpiarInputsSensiblesModal();

        const titulo = el('tituloModalAdminSeguridad');
        if (titulo) {
            titulo.textContent = estado.configurado
                ? 'Seguridad de Bóveda (AES-256)'
                : 'Configurar Bóveda Cifrada (AES-256)';
        }

        if (!estado.configurado) {
            mostrarSoloVistaModal('vistaModalSetupClave');
            setTimeout(() => { el('inputModalNuevaClave')?.focus(); }, 50);
        } else if (estado.adminDesbloqueado) {
            if (vistaPreferida === 'vistaModalCodigoRecuperacion') {
                mostrarSoloVistaModal('vistaModalCodigoRecuperacion');
            } else {
                mostrarSoloVistaModal('vistaModalDesbloqueado');
                const txtEst = el('txtEstadoModalDesbloqueado');
                if (txtEst) {
                    txtEst.textContent = 'Sesión de Administrador activa. Tienes acceso total a costos, historial, proveedores, reglas y sincronización PC-a-PC.';
                }
                if (el('btnModalSubirAdmin')) el('btnModalSubirAdmin').style.display = 'none';
                if (el('btnModalBloquearSoloAdmin')) {
                    el('btnModalBloquearSoloAdmin').style.display = estado.cajaConfigurada ? 'inline-flex' : 'none';
                }
                if (el('btnModalIrPanelAdmin')) el('btnModalIrPanelAdmin').style.display = 'inline-flex';
            }
        } else if (estado.cajaDesbloqueada) {
            // Nivel SOLO_CAJA activo
            if (vistaPreferida === 'vistaModalDesbloquear' || opciones.preferirTabAdmin) {
                mostrarSoloVistaModal('vistaModalDesbloquear');
                if (el('tabsUnlockDual')) el('tabsUnlockDual').style.display = 'none';
                alternarTabUnlock('admin');
            } else if (vistaPreferida === 'vistaModalRecuperar') {
                mostrarSoloVistaModal('vistaModalRecuperar');
                setTimeout(() => { el('inputModalCodigoRec')?.focus(); }, 50);
            } else {
                mostrarSoloVistaModal('vistaModalDesbloqueado');
                const txtEst = el('txtEstadoModalDesbloqueado');
                if (txtEst) {
                    txtEst.textContent = 'Modo Mostrador activo: autocompletado puntual del último costo habilitado y sellado ciego al guardar. Historial y proveedores permanecen cifrados.';
                }
                if (el('btnModalSubirAdmin')) el('btnModalSubirAdmin').style.display = 'inline-flex';
                if (el('btnModalBloquearSoloAdmin')) el('btnModalBloquearSoloAdmin').style.display = 'none';
                if (el('btnModalIrPanelAdmin')) el('btnModalIrPanelAdmin').style.display = 'inline-flex';
            }
        } else {
            // BLOQUEADO_TOTAL
            if (vistaPreferida === 'vistaModalRecuperar') {
                mostrarSoloVistaModal('vistaModalRecuperar');
                setTimeout(() => { el('inputModalCodigoRec')?.focus(); }, 50);
            } else {
                mostrarSoloVistaModal('vistaModalDesbloquear');
                const tabsDual = el('tabsUnlockDual');
                if (tabsDual) tabsDual.style.display = estado.cajaConfigurada ? 'flex' : 'none';
                const tabInicial = (estado.cajaConfigurada && !opciones.preferirTabAdmin) ? 'caja' : 'admin';
                alternarTabUnlock(tabInicial);
            }
        }

        if (!modal.open && typeof modal.showModal === 'function') {
            modal.showModal();
        }
    }

    function cerrarModalSeguridad() {
        const modal = el('modalAdminSeguridad');
        limpiarInputsSensiblesModal();
        if (modal && modal.open) {
            modal.close();
        }
        resolverEsperaSeguridad();
    }

    function solicitarDesbloqueoSiNecesario() {
        const Seguridad = obtenerSeguridad();
        if (!Seguridad || !Seguridad.estaConfigurado() || !Seguridad.estaBloqueado()) {
            return Promise.resolve(true);
        }
        if (resolucionModalPendiente) {
            const anterior = resolucionModalPendiente;
            resolucionModalPendiente = null;
            anterior.resolver(false);
        }
        return new Promise(resolve => {
            resolucionModalPendiente = { resolver: resolve, modo: 'admin' };
            abrirModalSeguridad('vistaModalDesbloquear', { preferirTabAdmin: true });
        });
    }

    function solicitarAccesoCajaOAdmin() {
        const Seguridad = obtenerSeguridad();
        if (!Seguridad || !Seguridad.estaConfigurado()) {
            return Promise.resolve(true);
        }
        const cajaOAdminActivos = typeof Seguridad.estaCajaActiva === 'function'
            ? Seguridad.estaCajaActiva()
            : !Seguridad.estaBloqueado();
        if (cajaOAdminActivos) {
            return Promise.resolve(true);
        }
        if (resolucionModalPendiente) {
            const anterior = resolucionModalPendiente;
            resolucionModalPendiente = null;
            anterior.resolver(false);
        }
        return new Promise(resolve => {
            resolucionModalPendiente = { resolver: resolve, modo: 'caja_o_admin' };
            abrirModalSeguridad('vistaModalDesbloquear', { preferirTabCaja: true });
        });
    }

    function renderizarPeersP2P() {
        const Seguridad = obtenerSeguridad();
        const txtMiId = el('txtMiDeviceIdP2P');
        const lista = el('listaPeersP2P');
        const selDestino = el('selDestinoSyncP2P');
        if (!Seguridad) return;

        const estado = Seguridad.obtenerEstado();
        if (txtMiId) {
            txtMiId.textContent = estado.deviceId ? String(estado.deviceId) : '-';
        }
        if (!estado.adminDesbloqueado) {
            limpiarEstadoP2pEnDom();
            return;
        }

        const peers = Seguridad.obtenerPeersConfiables ? Seguridad.obtenerPeersConfiables() : [];
        if (selDestino) {
            const valPrevio = selDestino.value;
            selDestino.innerHTML = '';
            const optVacia = document.createElement('option');
            optVacia.value = '';
            optVacia.textContent = peers.length > 0
                ? 'Selecciona PC destino autorizada...'
                : 'Sin equipos emparejados todavía';
            selDestino.appendChild(optVacia);

            peers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.deviceId;
                opt.textContent = `${p.alias} (${p.deviceId.slice(0, 8)}...)`;
                selDestino.appendChild(opt);
            });
            if (valPrevio && peers.some(p => p.deviceId === valPrevio)) {
                selDestino.value = valPrevio;
            }
        }

        if (lista) {
            if (peers.length === 0) {
                lista.innerHTML = '<div class="fs-xs text-muted">Ninguna computadora hermana vinculada aún.</div>';
            } else {
                lista.innerHTML = peers.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--color-borde);border-radius:var(--radio-sm);background:var(--color-superficie);">
                        <div style="min-width:0;">
                            <div style="font-size:12px;font-weight:600;">${escaparHtml(p.alias)}</div>
                            <div class="fs-xs text-muted mono">ID: ${escaparHtml(p.deviceId.slice(0, 14))}… · Env:${Number(p.ultimoSeqEnviado || 0)} / Rec:${Number(p.ultimoSeqRecibido || 0)}</div>
                        </div>
                        <button type="button" class="btn-icono text-danger btn-revocar-peer-p2p" data-peer-id="${escaparHtml(p.deviceId)}" data-peer-alias="${escaparHtml(p.alias)}" style="height:28px;font-size:11px;padding:0 8px;">Revocar</button>
                    </div>
                `).join('');

                lista.querySelectorAll('.btn-revocar-peer-p2p').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const peerId = btn.dataset.peerId;
                        const peerAlias = btn.dataset.peerAlias || 'este equipo';
                        const Alm = obtenerAlmacenamiento();
                        if (!Alm || !peerId) return;

                        let confirmado = true;
                        if (UI.Notificaciones && typeof UI.Notificaciones.mostrarConfirmacion === 'function') {
                            confirmado = await UI.Notificaciones.mostrarConfirmacion(
                                `¿Revocar la autorización de "${peerAlias}"? Ya no podrá recibir ni enviar paquetes cifrados hasta re-emparejarlo.`,
                                'Revocar Equipo P2P'
                            );
                        }
                        if (!confirmado) return;

                        try {
                            await Alm.revocarDispositivoP2P(peerId);
                            notificar(`Equipo "${peerAlias}" revocado.`, 'info');
                            renderizarPeersP2P();
                        } catch (err) {
                            notificar(err.message || 'No se pudo revocar el equipo.', 'error');
                        }
                    });
                });
            }
        }
    }

    function actualizarInterfazEstado() {
        const Seguridad = obtenerSeguridad();
        if (!Seguridad) return;
        const estado = Seguridad.obtenerEstado();

        // 1. Indicador en header
        const btnHeader = el('btnEstadoSeguridadHeader');
        const txtHeader = el('txtEstadoSeguridadHeader');
        const icoHeader = el('icoEstadoSeguridadHeader');

        if (btnHeader && txtHeader) {
            btnHeader.classList.remove('bloqueado', 'desbloqueado', 'sin-clave', 'solo-caja');
            if (!estado.configurado) {
                btnHeader.classList.add('sin-clave');
                txtHeader.textContent = 'Sin Cifrar';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-unlock"/>';
                btnHeader.title = 'Configura una contraseña para cifrar los costos e historial en este dispositivo';
            } else if (estado.adminDesbloqueado) {
                btnHeader.classList.add('desbloqueado');
                txtHeader.textContent = 'Admin Abierto';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-unlock"/>';
                btnHeader.title = 'Sesión de Administrador activa. Clic para bloquear o cambiar a Modo Mostrador.';
            } else if (estado.cajaDesbloqueada) {
                btnHeader.classList.add('solo-caja');
                txtHeader.textContent = 'Solo Mostrador';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-lock"/>';
                btnHeader.title = 'Modo Mostrador activo (último costo al escanear + buzón ciego). Clic para opciones o Admin.';
            } else {
                btnHeader.classList.add('bloqueado');
                txtHeader.textContent = 'Bloqueado';
                if (icoHeader) icoHeader.innerHTML = '<use href="#i-lock"/>';
                btnHeader.title = 'Datos privados cifrados. Clic para abrir Turno Mostrador o Administrador.';
            }
        }

        // 2. Panel de Seguridad & Datos dentro de Bóveda
        const badgePanel = el('badgePanelAdminEstado');
        const blkSinClave = el('adminBloqueSinClave');
        const blkBloqueado = el('adminBloqueBloqueado');
        const blkDesbloqueado = el('adminBloqueDesbloqueado');

        if (badgePanel && blkSinClave && blkBloqueado && blkDesbloqueado) {
            blkSinClave.style.display = 'none';
            blkBloqueado.style.display = 'none';
            blkDesbloqueado.style.display = 'none';

            if (!estado.configurado) {
                blkSinClave.style.display = 'block';
                badgePanel.textContent = 'Sin Contraseña';
                badgePanel.style.background = '#fef3c7';
                badgePanel.style.color = '#92400e';
            } else if (estado.adminDesbloqueado) {
                blkDesbloqueado.style.display = 'block';
                badgePanel.textContent = 'Admin Desbloqueada';
                badgePanel.style.background = '#dcfce7';
                badgePanel.style.color = '#166534';

                const selAuto = el('selPanelAutoBloqueo');
                if (selAuto) {
                    selAuto.value = String(estado.minutosAutoBloqueo ?? 15);
                }
                const btnSoloAdmin = el('btnPanelBloquearSoloAdmin');
                if (btnSoloAdmin) {
                    btnSoloAdmin.style.display = estado.cajaConfigurada ? 'inline-flex' : 'none';
                }
                const btnQuitarPin = el('btnPanelQuitarPinCaja');
                if (btnQuitarPin) {
                    btnQuitarPin.style.display = estado.cajaConfigurada ? 'inline-flex' : 'none';
                }
                renderizarPeersP2P();
            } else if (estado.cajaDesbloqueada) {
                blkBloqueado.style.display = 'block';
                badgePanel.textContent = 'Solo Mostrador (Admin Bloq.)';
                badgePanel.style.background = '#dbeafe';
                badgePanel.style.color = '#1e40af';
            } else {
                blkBloqueado.style.display = 'block';
                badgePanel.textContent = 'Cifrada / Bloqueada';
                badgePanel.style.background = '#fee2e2';
                badgePanel.style.color = '#991b1b';
            }
        }

        // 3. Visibilidad controles dependientes de sesión Admin
        const btnNuevoProv = el('btnNuevoProveedor');
        if (btnNuevoProv) {
            btnNuevoProv.style.display = (!estado.configurado || estado.adminDesbloqueado) ? 'inline-flex' : 'none';
        }
        const avisoReglas = el('avisoReglasBloqueadas');
        if (avisoReglas) {
            avisoReglas.style.display = (estado.configurado && !estado.adminDesbloqueado) ? 'flex' : 'none';
        }
    }

    function limpiarDomPrivadoPorBloqueo(mantenerCaja) {
        if (UI.Historial && typeof UI.Historial.limpiarAreaImpresion === 'function') {
            UI.Historial.limpiarAreaImpresion();
        } else {
            const areaImp = el('printArea');
            if (areaImp) areaImp.innerHTML = '';
        }

        if (el('contenedorHistorial')) el('contenedorHistorial').innerHTML = '';
        if (el('contenedorProveedores')) el('contenedorProveedores').innerHTML = '';
        if (el('listaProveedoresHabitualesSugeridos')) el('listaProveedoresHabitualesSugeridos').innerHTML = '';

        ['modalEditarProductoDiccionario', 'modalEditarProveedor'].forEach(id => {
            const dlg = el(id);
            if (dlg && dlg.open) {
                try { dlg.close(); } catch (_) {}
            }
        });

        limpiarEstadoP2pEnDom();

        if (!mantenerCaja) {
            if (el('calcPrecioCaja')) el('calcPrecioCaja').value = '';
            if (UI.Calculadora && typeof UI.Calculadora.limpiarEstadoOperativoCaja === 'function') {
                UI.Calculadora.limpiarEstadoOperativoCaja();
            }
        }
    }

    function sincronizarAppTrasCambioSeguridad(fueAdminDesbloqueo) {
        const Estado = AppFarmacia.Estado;
        const Almacenamiento = obtenerAlmacenamiento();
        const Seguridad = obtenerSeguridad();
        if (!Estado || !Almacenamiento) return;

        const estadoSeg = Seguridad ? Seguridad.obtenerEstado() : null;
        const nivelActual = estadoSeg ? estadoSeg.nivelAcceso : 'SIN_CLAVE';
        nivelPrevioSincronizado = nivelActual;

        const estaBloqueadoAdmin = !fueAdminDesbloqueo && Boolean(Seguridad && Seguridad.estaConfigurado() && Seguridad.estaBloqueado());
        const provPrevioDom = (DominioSafeSanitizarTexto(el('facProveedor')?.value || '')).trim();
        const totalPrevioDom = parseFloat(el('facTotalFisico')?.value || '') || 0;

        if (fueAdminDesbloqueo) {
            const sesionEnCurso = Estado.sesionActual;
            const tieneTrabajoEnCurso = Boolean(sesionEnCurso && Array.isArray(sesionEnCurso.productos) && sesionEnCurso.productos.length > 0);
            if (!tieneTrabajoEnCurso) {
                const borrador = Almacenamiento.cargarBorradorActivo();
                const borradorVacio = !borrador.productos.length && !borrador.proveedor && !(borrador.totalFisico > 0);
                if (borradorVacio && (provPrevioDom || totalPrevioDom > 0)) {
                    borrador.proveedor = provPrevioDom;
                    borrador.totalFisico = totalPrevioDom;
                }
                Estado.sesionActual = borrador;
            } else {
                Almacenamiento.guardarBorradorActivo(sesionEnCurso);
            }
            Estado.reglasActivas = Almacenamiento.obtenerReglasNegocio();
            if (UI.Calculadora && typeof UI.Calculadora.establecerBloqueoReglas === 'function') {
                UI.Calculadora.establecerBloqueoReglas(false);
            }
        } else if (estaBloqueadoAdmin) {
            const cajaActiva = Boolean(Seguridad && typeof Seguridad.estaCajaActiva === 'function' && Seguridad.estaCajaActiva());
            limpiarDomPrivadoPorBloqueo(cajaActiva);

            if (cajaActiva) {
                // Degradación segura a Mostrador / F5 -> PIN Mostrador: restaura borrador completo (productos + proveedor + totalFisico)
                const sesionEnCurso = Estado.sesionActual;
                const tieneTrabajoEnCurso = Boolean(sesionEnCurso && Array.isArray(sesionEnCurso.productos) && sesionEnCurso.productos.length > 0);
                if (!tieneTrabajoEnCurso) {
                    const borrador = Almacenamiento.cargarBorradorActivo();
                    const borradorVacio = !borrador.productos.length && !borrador.proveedor && !(borrador.totalFisico > 0);
                    if (borradorVacio && (provPrevioDom || totalPrevioDom > 0)) {
                        borrador.proveedor = provPrevioDom;
                        borrador.totalFisico = totalPrevioDom;
                    }
                    Estado.sesionActual = borrador;
                } else {
                    Almacenamiento.guardarBorradorActivo(sesionEnCurso);
                }
            } else {
                Estado.sesionActual = Almacenamiento.crearSesionVacia();
            }
            Estado.reglasActivas = Almacenamiento.obtenerReglasNegocio();
            if (UI.Calculadora && typeof UI.Calculadora.establecerBloqueoReglas === 'function') {
                UI.Calculadora.establecerBloqueoReglas(true);
            }
        } else {
            // Sin clave configurada
            Estado.reglasActivas = Almacenamiento.obtenerReglasNegocio();
            if (UI.Calculadora && typeof UI.Calculadora.establecerBloqueoReglas === 'function') {
                UI.Calculadora.establecerBloqueoReglas(false);
            }
        }

        // Volcar modelo -> DOM sin sobreescribir el borrador restaurado con inputs vacíos tras F5
        if (typeof Estado.renderizarTodo === 'function') {
            Estado.renderizarTodo();
        } else {
            actualizarInterfazEstado();
        }

        if (UI.Calculadora) {
            if (typeof UI.Calculadora.calcularEnVivo === 'function') UI.Calculadora.calcularEnVivo();
        }
        if (UI.Factura) {
            if (typeof UI.Factura.verificarDuplicadoUI === 'function') UI.Factura.verificarDuplicadoUI();
            if (typeof UI.Factura.actualizarDesgloseFiscalGlobal === 'function') UI.Factura.actualizarDesgloseFiscalGlobal();
        }
        if (UI.Diccionario && typeof UI.Diccionario.renderizarLaboratoriosUI === 'function') {
            UI.Diccionario.renderizarLaboratoriosUI();
        }
    }

    function DominioSafeSanitizarTexto(texto) {
        const Dom = AppFarmacia.Dominio;
        return (Dom && typeof Dom.sanitizarEntradaTexto === 'function')
            ? Dom.sanitizarEntradaTexto(texto, 120)
            : String(texto || '').slice(0, 120);
    }

    async function ejecutarConProgresoBoton(btn, textoEspera, tareaAsync) {
        const textoOriginal = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            if (textoEspera) btn.textContent = textoEspera;
        }
        try {
            await new Promise(resolve => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => setTimeout(resolve, 16));
                } else {
                    setTimeout(resolve, 16);
                }
            });
            return await tareaAsync();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
                btn.textContent = textoOriginal;
            }
        }
    }

    function validarPinCajaInput(pin) {
        const minPin = CONSTANTES.SEGURIDAD_BOVEDA.MIN_LONGITUD_PIN_CAJA || 4;
        const maxPin = CONSTANTES.SEGURIDAD_BOVEDA.MAX_LONGITUD_PIN_CAJA || 16;
        if (!pin || pin.length < minPin || pin.length > maxPin) {
            throw new Error(`El PIN de mostrador debe tener entre ${minPin} y ${maxPin} caracteres o dígitos.`);
        }
    }

    // --- Transferencia P2P Opcional por Wi-Fi LAN (WebRTC sin servidor externo) ---
    function esperarRecoleccionIce(pc, timeoutMs = 2500) {
        return new Promise(resolve => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }
            const timer = setTimeout(() => {
                pc.removeEventListener('icegatheringstatechange', onState);
                resolve();
            }, timeoutMs);
            function onState() {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timer);
                    pc.removeEventListener('icegatheringstatechange', onState);
                    resolve();
                }
            }
            pc.addEventListener('icegatheringstatechange', onState);
        });
    }

    function codificarSdpBase64(desc) {
        const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
        return btoa(unescape(encodeURIComponent(json)));
    }

    function decodificarSdpBase64(b64) {
        const limpio = String(b64 || '').trim();
        if (!limpio) throw new Error('Señal WebRTC vacía.');
        return JSON.parse(decodeURIComponent(escape(atob(limpio))));
    }

    async function enviarPorWebRtcLan(peerId, incluirProveedores) {
        if (typeof RTCPeerConnection !== 'function') {
            notificar('Tu navegador no admite Wi-Fi LAN directa (WebRTC). Usa "Exportar Delta (.cfpatch)".', 'warning');
            return;
        }
        const Almacenamiento = obtenerAlmacenamiento();
        if (!Almacenamiento) return;

        let pc = null;
        try {
            const res = await Almacenamiento.exportarSyncCifradaParaPeer(peerId, { incluirProveedores });
            if (el('txtCodigoEntregaSync')) el('txtCodigoEntregaSync').textContent = res.codigoEntrega;
            if (el('boxCodigoEntregaSync')) el('boxCodigoEntregaSync').style.display = 'block';

            const jsonPaquete = JSON.stringify(res.paquete);
            pc = new RTCPeerConnection({ iceServers: [] });
            const dc = pc.createDataChannel('chroniris-sync');

            const oferta = await pc.createOffer();
            await pc.setLocalDescription(oferta);
            await esperarRecoleccionIce(pc);

            const ofertaB64 = codificarSdpBase64(pc.localDescription);
            await copiarTextoSeguro(ofertaB64);

            const paso1 = await UI.Notificaciones.mostrarPrompt(
                `Código Efímero generado: ${res.codigoEntrega} (díctalo a la otra PC).\nPaso 1/2: Copia esta OFERTA Wi-Fi y presiona Aceptar cuando la hayas pegado en la PC Receptora.`,
                ofertaB64,
                'Enviar por Wi-Fi LAN — Paso 1/2'
            );
            if (paso1 === null) {
                pc.close();
                return;
            }

            const respB64 = await UI.Notificaciones.mostrarPrompt(
                'Paso 2/2: Pega aquí la RESPUESTA generada por la PC Receptora:',
                '',
                'Enviar por Wi-Fi LAN — Paso 2/2'
            );
            if (!respB64) {
                pc.close();
                return;
            }

            const respuesta = decodificarSdpBase64(respB64);
            await pc.setRemoteDescription(respuesta);

            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado conectando en red LAN. Usa archivo .cfpatch.')), 15000);
                dc.onopen = () => {
                    clearTimeout(timer);
                    try {
                        const CHUNK = 16384;
                        const total = Math.ceil(jsonPaquete.length / CHUNK) || 1;
                        for (let i = 0; i < total; i++) {
                            dc.send(JSON.stringify({ type: 'chunk', idx: i, total, data: jsonPaquete.slice(i * CHUNK, (i + 1) * CHUNK) }));
                        }
                        dc.send(JSON.stringify({ type: 'eof', len: jsonPaquete.length }));
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                };
                dc.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error('Error en canal WebRTC LAN.'));
                };
            });

            notificar(`Transferencia Wi-Fi LAN completada (${res.totalProductos} productos cifrados, seq #${res.seq}).`, 'success');
            renderizarPeersP2P();
        } catch (err) {
            notificar(err.message || 'No se pudo completar envío Wi-Fi LAN. Usa archivo .cfpatch.', 'warning');
        } finally {
            setTimeout(() => { try { pc?.close(); } catch (_) {} }, 1200);
        }
    }

    async function recibirPorWebRtcLan() {
        if (typeof RTCPeerConnection !== 'function') {
            notificar('Tu navegador no admite Wi-Fi LAN directa (WebRTC). Usa "Importar Delta (.cfpatch)".', 'warning');
            return;
        }
        const Almacenamiento = obtenerAlmacenamiento();
        if (!Almacenamiento) return;

        let pc = null;
        try {
            const codigoEntrega = await UI.Notificaciones.mostrarPrompt(
                'Paso 1/3: Ingresa el Código Efímero de Entrega mostrado en la PC Emisora (ej. ABCD-1234):',
                (el('inputCodigoEntregaImportP2P')?.value || '').trim().toUpperCase(),
                'Recibir por Wi-Fi LAN — Paso 1/3'
            );
            if (!codigoEntrega || !codigoEntrega.trim()) return;

            const ofertaB64 = await UI.Notificaciones.mostrarPrompt(
                'Paso 2/3: Pega aquí la OFERTA Wi-Fi enviada desde la PC Emisora:',
                '',
                'Recibir por Wi-Fi LAN — Paso 2/3'
            );
            if (!ofertaB64) return;

            const oferta = decodificarSdpBase64(ofertaB64);
            pc = new RTCPeerConnection({ iceServers: [] });

            const promesaDatos = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Tiempo agotado esperando paquete en Wi-Fi LAN.')), 25000);
                const partes = [];
                pc.ondatachannel = ev => {
                    const ch = ev.channel;
                    ch.onmessage = m => {
                        try {
                            const msg = JSON.parse(m.data);
                            if (msg.type === 'chunk') {
                                partes[msg.idx] = msg.data;
                            } else if (msg.type === 'eof') {
                                clearTimeout(timer);
                                resolve(partes.join(''));
                            }
                        } catch (e) {
                            clearTimeout(timer);
                            reject(e);
                        }
                    };
                    ch.onerror = () => {
                        clearTimeout(timer);
                        reject(new Error('Error recibiendo flujo WebRTC LAN.'));
                    };
                };
            });

            await pc.setRemoteDescription(oferta);
            const respuesta = await pc.createAnswer();
            await pc.setLocalDescription(respuesta);
            await esperarRecoleccionIce(pc);

            const respB64 = codificarSdpBase64(pc.localDescription);
            await copiarTextoSeguro(respB64);

            const ack = await UI.Notificaciones.mostrarPrompt(
                'Paso 3/3: Copia esta RESPUESTA y pégala en la PC Emisora. Luego presiona Aceptar para esperar la transferencia:',
                respB64,
                'Recibir por Wi-Fi LAN — Paso 3/3'
            );
            if (ack === null) {
                pc.close();
                return;
            }

            const jsonRecibido = await promesaDatos;
            const res = await Almacenamiento.importarSyncCifradaDePeer(jsonRecibido, codigoEntrega.trim().toUpperCase());

            sincronizarAppTrasCambioSeguridad(true);
            notificar(
                `Sincronización Wi-Fi LAN recibida de "${res.origenPeer.alias}" (#${res.seq}): ${res.estadisticas.nuevos} nuevos, ${res.estadisticas.actualizados} actualizados.`,
                'success'
            );
        } catch (err) {
            notificar(err.message || 'No se pudo completar recepción Wi-Fi LAN. Usa archivo .cfpatch.', 'warning');
        } finally {
            setTimeout(() => { try { pc?.close(); } catch (_) {} }, 1200);
        }
    }

    function inicializarEventosSeguridad() {
        const Seguridad = obtenerSeguridad();
        const Almacenamiento = obtenerAlmacenamiento();
        if (!Seguridad || !Almacenamiento) return;

        el('btnEstadoSeguridadHeader')?.addEventListener('click', () => {
            abrirModalSeguridad();
        });

        el('btnCerrarModalAdminSeguridad')?.addEventListener('click', cerrarModalSeguridad);
        el('modalAdminSeguridad')?.addEventListener('close', () => {
            limpiarInputsSensiblesModal();
            resolverEsperaSeguridad();
        });

        el('btnAbrirSetupDesdePanel')?.addEventListener('click', () => {
            abrirModalSeguridad('vistaModalSetupClave');
        });
        el('btnAbrirUnlockDesdePanel')?.addEventListener('click', () => {
            abrirModalSeguridad('vistaModalDesbloquear', { preferirTabAdmin: true });
        });

        // Tabs Duales en Modal de Desbloqueo
        el('btnTabUnlockCaja')?.addEventListener('click', () => alternarTabUnlock('caja'));
        el('btnTabUnlockAdmin')?.addEventListener('click', () => alternarTabUnlock('admin'));

        // Vista Setup Inicial
        el('formModalSetupClave')?.addEventListener('submit', async e => {
            e.preventDefault();
            const pass = el('inputModalNuevaClave')?.value || '';
            const conf = el('inputModalConfirmarClave')?.value || '';
            const pinCaja = (el('inputModalPinCajaSetup')?.value || '').trim();
            const mins = Number(el('selectModalAutoBloqueo')?.value || 15);
            const btn = el('btnModalActivarCifrado');

            const minLong = CONSTANTES.SEGURIDAD_BOVEDA.MIN_LONGITUD_CONTRASENA;
            if (pass.length < minLong) {
                notificar(`La contraseña de Administrador debe tener al menos ${minLong} caracteres.`, 'error');
                return;
            }
            if (pass !== conf) {
                notificar('Las contraseñas no coinciden.', 'error');
                return;
            }
            if (pinCaja) {
                try {
                    validarPinCajaInput(pinCaja);
                } catch (err) {
                    notificar(err.message, 'error');
                    return;
                }
            }

            try {
                await ejecutarConProgresoBoton(btn, 'Cifrando bóveda AES-256...', async () => {
                    const res = await Almacenamiento.activarCifradoConContrasena(pass, {
                        minutosAutoBloqueo: mins,
                        pinCaja: pinCaja || null
                    });
                    limpiarInputsSensiblesModal();
                    const boxCod = el('boxModalCodigoRecuperacion');
                    if (boxCod) boxCod.textContent = res.codigoRecuperacion;
                    mostrarSoloVistaModal('vistaModalCodigoRecuperacion');
                    sincronizarAppTrasCambioSeguridad(true);
                    notificar('Cifrado AES-256-GCM activado correctamente. Guarda tu código de recuperación.', 'success');
                });
            } catch (err) {
                notificar(err.message || 'No se pudo activar el cifrado.', 'error');
            }
        });

        el('btnCopiarCodigoRecuperacion')?.addEventListener('click', async () => {
            const codigo = el('boxModalCodigoRecuperacion')?.textContent?.trim();
            if (!codigo) return;
            const copiado = await copiarTextoSeguro(codigo);
            if (copiado) {
                notificar('Código de recuperación copiado. Guárdalo fuera de este navegador.', 'info');
            } else {
                notificar('Cópialo manualmente y guárdalo en lugar seguro.', 'warning');
            }
        });

        el('btnConfirmarCodigoGuardado')?.addEventListener('click', () => {
            cerrarModalSeguridad();
        });

        // Desbloquear Turno Mostrador (PIN Caja)
        el('formModalDesbloquearCaja')?.addEventListener('submit', async e => {
            e.preventDefault();
            const pin = (el('inputModalPinCajaUnlock')?.value || '').trim();
            const btn = el('btnModalDesbloquearCaja');
            if (!pin) return;
            try {
                await ejecutarConProgresoBoton(btn, 'Verificando PIN Mostrador...', async () => {
                    await Almacenamiento.desbloquearCajaBoveda(pin);
                    limpiarInputsSensiblesModal();
                    sincronizarAppTrasCambioSeguridad(false);
                    cerrarModalSeguridad();
                    notificar('Turno de Mostrador activo. Escanea un producto para cargar su último costo.', 'success');
                });
            } catch (err) {
                if (el('inputModalPinCajaUnlock')) {
                    el('inputModalPinCajaUnlock').value = '';
                    el('inputModalPinCajaUnlock').focus();
                }
                notificar(err.message || 'PIN de mostrador incorrecto.', 'error');
            }
        });

        // Desbloquear Admin
        el('formModalDesbloquear')?.addEventListener('submit', async e => {
            e.preventDefault();
            const pass = el('inputModalClaveUnlock')?.value || '';
            const btn = el('btnModalDesbloquear');
            if (!pass) return;
            try {
                await ejecutarConProgresoBoton(btn, 'Derivando llaves AES-256...', async () => {
                    await Almacenamiento.desbloquearBoveda(pass);
                    limpiarInputsSensiblesModal();
                    sincronizarAppTrasCambioSeguridad(true);
                    cerrarModalSeguridad();
                    notificar('Sesión de Administrador desbloqueada y buzón consolidado.', 'success');
                });
            } catch (err) {
                if (el('inputModalClaveUnlock')) {
                    el('inputModalClaveUnlock').value = '';
                    el('inputModalClaveUnlock').focus();
                }
                notificar(err.message || 'Contraseña incorrecta.', 'error');
            }
        });

        el('btnModalMostrarRecuperar')?.addEventListener('click', () => {
            limpiarInputsSensiblesModal();
            mostrarSoloVistaModal('vistaModalRecuperar');
            setTimeout(() => { el('inputModalCodigoRec')?.focus(); }, 50);
        });

        el('btnModalVolverUnlock')?.addEventListener('click', () => {
            limpiarInputsSensiblesModal();
            mostrarSoloVistaModal('vistaModalDesbloquear');
            alternarTabUnlock('admin');
        });

        el('formModalRecuperar')?.addEventListener('submit', async e => {
            e.preventDefault();
            const codigo = (el('inputModalCodigoRec')?.value || '').trim();
            const nuevaPass = el('inputModalNuevaClaveRec')?.value || '';
            const btn = el('btnModalRecuperar');

            const minLong = CONSTANTES.SEGURIDAD_BOVEDA.MIN_LONGITUD_CONTRASENA;
            if (!codigo || nuevaPass.length < minLong) {
                notificar(`Ingresa tu código completo y una nueva contraseña de al menos ${minLong} caracteres.`, 'error');
                return;
            }
            try {
                await ejecutarConProgresoBoton(btn, 'Restableciendo bóveda AES-256...', async () => {
                    const res = await Almacenamiento.recuperarBovedaConCodigo(codigo, nuevaPass);
                    limpiarInputsSensiblesModal();
                    sincronizarAppTrasCambioSeguridad(true);
                    const boxCod = el('boxModalCodigoRecuperacion');
                    if (boxCod && res.nuevoCodigoRecuperacion) {
                        boxCod.textContent = res.nuevoCodigoRecuperacion;
                        mostrarSoloVistaModal('vistaModalCodigoRecuperacion');
                        notificar('Contraseña restablecida. Guarda tu NUEVO código de recuperación en papel.', 'success');
                    } else {
                        cerrarModalSeguridad();
                    }
                });
            } catch (err) {
                notificar(err.message || 'Código de recuperación inválido.', 'error');
            }
        });

        // Subir a Admin desde vista Desbloqueado Mostrador
        el('btnModalSubirAdmin')?.addEventListener('click', () => {
            abrirModalSeguridad('vistaModalDesbloquear', { preferirTabAdmin: true });
        });

        // Bajar de Admin a Solo Mostrador
        const ejecutarBajarASoloCaja = () => {
            Almacenamiento.bloquearAdminBoveda();
            cerrarModalSeguridad();
            sincronizarAppTrasCambioSeguridad(false);
            notificar('Admin cerrado. Activo únicamente Turno de Mostrador (último costo puntual y buzón ciego).', 'info');
        };
        el('btnModalBloquearSoloAdmin')?.addEventListener('click', ejecutarBajarASoloCaja);
        el('btnPanelBloquearSoloAdmin')?.addEventListener('click', ejecutarBajarASoloCaja);

        // Bloqueo Total (purgar K_Admin y K_Caja)
        const ejecutarBloqueoTotal = () => {
            Almacenamiento.bloquearBoveda();
            cerrarModalSeguridad();
            sincronizarAppTrasCambioSeguridad(false);
            notificar('Sesión bloqueada completamente. Todas las llaves y secretos fueron purgados de RAM.', 'info');
        };
        el('btnModalBloquearAhora')?.addEventListener('click', ejecutarBloqueoTotal);
        el('btnPanelBloquearAhora')?.addEventListener('click', ejecutarBloqueoTotal);

        el('btnModalIrPanelAdmin')?.addEventListener('click', () => {
            cerrarModalSeguridad();
            const drawer = el('drawerBoveda');
            const backdrop = el('drawerBackdrop');
            if (drawer) drawer.classList.add('abierto');
            if (backdrop) backdrop.classList.add('activo');
            document.querySelectorAll('#drawerBoveda .drawer-tab-btn').forEach(b => {
                b.classList.toggle('activo', b.dataset.bovedaTab === 'seccionEscanerIA');
            });
            document.querySelectorAll('#drawerBoveda .boveda-panel').forEach(panel => {
                panel.classList.toggle('activo', panel.id === 'seccionEscanerIA');
            });
        });

        // Configurar / Quitar PIN de Mostrador en Panel Admin
        el('formPanelPinCaja')?.addEventListener('submit', async e => {
            e.preventDefault();
            const pin = (el('inputPanelPinCaja')?.value || '').trim();
            const btn = el('btnPanelGuardarPinCaja');
            try {
                validarPinCajaInput(pin);
                if (btn) btn.disabled = true;
                await Almacenamiento.configurarPinCajaBoveda(pin);
                if (el('inputPanelPinCaja')) el('inputPanelPinCaja').value = '';
                actualizarInterfazEstado();
                notificar('PIN Rápido de Mostrador guardado. Sobres operativos re-empaquetados.', 'success');
            } catch (err) {
                notificar(err.message || 'No se pudo guardar el PIN de mostrador.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        el('btnPanelQuitarPinCaja')?.addEventListener('click', async () => {
            let confirmado = true;
            if (UI.Notificaciones && typeof UI.Notificaciones.mostrarConfirmacion === 'function') {
                confirmado = await UI.Notificaciones.mostrarConfirmacion(
                    '¿Desactivar el PIN Rápido de Mostrador? El cajero no podrá cargar costos sin clave de Administrador.',
                    'Desactivar PIN de Mostrador'
                );
            }
            if (!confirmado) return;
            try {
                await Almacenamiento.desactivarPinCajaBoveda();
                actualizarInterfazEstado();
                notificar('PIN de Mostrador desactivado.', 'info');
            } catch (err) {
                notificar(err.message || 'No se pudo desactivar el PIN.', 'error');
            }
        });

        el('selPanelAutoBloqueo')?.addEventListener('change', async e => {
            const mins = Number(e.target.value);
            try {
                await Almacenamiento.actualizarAutoBloqueoBoveda(mins);
                notificar(
                    mins > 0
                        ? `Auto-bloqueo Admin configurado a ${mins} minutos de inactividad.`
                        : 'Auto-bloqueo Admin automático desactivado (solo bloqueo manual).',
                    'info'
                );
            } catch (err) {
                notificar(err.message || 'No se pudo actualizar auto-bloqueo.', 'error');
            }
        });

        el('formPanelCambiarClave')?.addEventListener('submit', async e => {
            e.preventDefault();
            const actual = el('inputPanelClaveActual')?.value || '';
            const nueva = el('inputPanelClaveNueva')?.value || '';
            const conf = el('inputPanelClaveNuevaConf')?.value || '';
            const btn = el('btnPanelCambiarClave');

            const minLong = CONSTANTES.SEGURIDAD_BOVEDA.MIN_LONGITUD_CONTRASENA;
            if (nueva.length < minLong) {
                notificar(`La nueva contraseña debe tener al menos ${minLong} caracteres.`, 'error');
                return;
            }
            if (nueva !== conf) {
                notificar('Las contraseñas nuevas no coinciden.', 'error');
                return;
            }

            if (btn) btn.disabled = true;
            try {
                await Almacenamiento.cambiarContrasenaBoveda(actual, nueva);
                if (el('inputPanelClaveActual')) el('inputPanelClaveActual').value = '';
                if (el('inputPanelClaveNueva')) el('inputPanelClaveNueva').value = '';
                if (el('inputPanelClaveNuevaConf')) el('inputPanelClaveNuevaConf').value = '';
                notificar('Contraseña de Administrador actualizada correctamente.', 'success');
            } catch (err) {
                notificar(err.message || 'No se pudo cambiar la contraseña.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        el('formPanelRegenRec')?.addEventListener('submit', async e => {
            e.preventDefault();
            const actual = el('inputPanelClaveRegenRec')?.value || '';
            if (!actual) return;
            try {
                const res = await Almacenamiento.regenerarCodigoRecuperacionBoveda(actual);
                if (el('inputPanelClaveRegenRec')) el('inputPanelClaveRegenRec').value = '';
                const boxCod = el('boxModalCodigoRecuperacion');
                if (boxCod) boxCod.textContent = res.codigoRecuperacion;
                abrirModalSeguridad('vistaModalCodigoRecuperacion');
                notificar('Nuevo código de recuperación generado. El código anterior quedó invalidado.', 'success');
            } catch (err) {
                notificar(err.message || 'No se pudo regenerar el código.', 'error');
            }
        });

        el('btnPanelPurgarPrivados')?.addEventListener('click', async () => {
            let confirmado = true;
            if (UI.Notificaciones && typeof UI.Notificaciones.mostrarConfirmacion === 'function') {
                confirmado = await UI.Notificaciones.mostrarConfirmacion(
                    '¿BORRAR permanentemente todo el Historial, Proveedores y Costos de Compra locales? Los códigos GS1 y nombres sanitarios del catálogo permanecerán intactos.',
                    'Purgar Datos Privados Locales'
                );
            }
            if (!confirmado) return;

            try {
                await Almacenamiento.purgarDatosPrivadosLocales();
                const Estado = AppFarmacia.Estado;
                if (Estado) Estado.sesionActual = Almacenamiento.crearSesionVacia();

                if (UI.Historial?.renderizarHistorialUI) UI.Historial.renderizarHistorialUI();
                if (UI.Diccionario?.renderizarDiccionarioUI) UI.Diccionario.renderizarDiccionarioUI();
                if (UI.Diccionario?.renderizarProveedoresUI) UI.Diccionario.renderizarProveedoresUI();
                if (UI.Factura) {
                    UI.Factura.actualizarDatalistProveedores?.();
                    UI.Factura.renderizarTablaProductosActuales?.();
                    UI.Factura.actualizarBarraSuperior?.();
                }
                notificar('Costos, proveedores e historial purgados. Solo permanecen las fichas sanitarias públicas.', 'warning');
            } catch (err) {
                notificar(err.message || 'No se pudo completar la purga.', 'error');
            }
        });

        // --- Panel Sync Cifrado P2P ---
        el('btnCopiarTarjetaP2P')?.addEventListener('click', async () => {
            const tarjeta = Seguridad.obtenerTarjetaEmparejamiento ? Seguridad.obtenerTarjetaEmparejamiento() : null;
            if (!tarjeta) {
                notificar('Activa la bóveda cifrada antes de copiar tu tarjeta de vinculación.', 'warning');
                return;
            }
            const textoTarjeta = JSON.stringify(tarjeta);
            const ok = await copiarTextoSeguro(textoTarjeta);
            if (ok) {
                notificar('Tarjeta de Vinculación copiada. Compártela únicamente con otra caja de tu farmacia.', 'success');
            } else if (UI.Notificaciones && typeof UI.Notificaciones.mostrarPrompt === 'function') {
                await UI.Notificaciones.mostrarPrompt(
                    'Copia manualmente esta Tarjeta de Vinculación:',
                    textoTarjeta,
                    'Tarjeta de Vinculación Local'
                );
            }
        });

        el('btnCalcularSasP2P')?.addEventListener('click', async () => {
            const raw = (el('inputTarjetaPeerP2P')?.value || '').trim();
            if (!raw) {
                notificar('Pega la Tarjeta de Vinculación de la otra PC.', 'warning');
                return;
            }
            try {
                const miTarjeta = Seguridad.obtenerTarjetaEmparejamiento();
                if (!miTarjeta) throw new Error('Identidad local del equipo aún no inicializada.');
                const tarjetaPeer = JSON.parse(raw);
                if (!tarjetaPeer || tarjetaPeer.tipo !== 'chroniris-peer-card-v1' || !tarjetaPeer.deviceId || !tarjetaPeer.idEncPub || !tarjetaPeer.idSignPub) {
                    throw new Error('La tarjeta pegada no corresponde al formato válido de vinculación.');
                }
                if (tarjetaPeer.deviceId === miTarjeta.deviceId) {
                    throw new Error('No puedes emparejar esta misma computadora consigo misma.');
                }
                const sas = await Seguridad.calcularCodigoSas(miTarjeta, tarjetaPeer);
                tarjetaPeerPendiente = tarjetaPeer;
                if (el('boxCodigoSasP2P')) {
                    el('boxCodigoSasP2P').textContent = `SAS: ${sas}`;
                    el('boxCodigoSasP2P').style.display = 'inline-block';
                }
                if (el('btnConfirmarEmparejarP2P')) {
                    el('btnConfirmarEmparejarP2P').style.display = 'inline-flex';
                }
                notificar(`Código SAS calculado (${sas}). Confirma que la otra PC muestra exactamente el mismo código antes de autorizar.`, 'info');
            } catch (err) {
                tarjetaPeerPendiente = null;
                if (el('boxCodigoSasP2P')) el('boxCodigoSasP2P').style.display = 'none';
                if (el('btnConfirmarEmparejarP2P')) el('btnConfirmarEmparejarP2P').style.display = 'none';
                notificar(err.message || 'Tarjeta de vinculación inválida.', 'error');
            }
        });

        el('btnConfirmarEmparejarP2P')?.addEventListener('click', async () => {
            if (!tarjetaPeerPendiente) {
                notificar('Primero verifica el Código SAS de la tarjeta del otro equipo.', 'warning');
                return;
            }
            const alias = (el('inputAliasPeerP2P')?.value || '').trim() || 'Caja Hermana';
            try {
                await Almacenamiento.emparejarDispositivoP2P(tarjetaPeerPendiente, alias);
                tarjetaPeerPendiente = null;
                if (el('inputAliasPeerP2P')) el('inputAliasPeerP2P').value = '';
                if (el('inputTarjetaPeerP2P')) el('inputTarjetaPeerP2P').value = '';
                if (el('boxCodigoSasP2P')) el('boxCodigoSasP2P').style.display = 'none';
                if (el('btnConfirmarEmparejarP2P')) el('btnConfirmarEmparejarP2P').style.display = 'none';
                renderizarPeersP2P();
                notificar(`Computadora "${alias}" autorizada para intercambio cifrado PC-a-PC.`, 'success');
            } catch (err) {
                notificar(err.message || 'No se pudo autorizar la computadora hermana.', 'error');
            }
        });

        el('btnExportarSyncP2P')?.addEventListener('click', async () => {
            const peerId = el('selDestinoSyncP2P')?.value || '';
            if (!peerId) {
                notificar('Selecciona primero la PC destino autorizada.', 'warning');
                return;
            }
            const incluirProveedores = Boolean(el('chkSyncIncluirProveedores')?.checked);
            try {
                const res = await Almacenamiento.exportarSyncCifradaParaPeer(peerId, { incluirProveedores });
                if (el('txtCodigoEntregaSync')) el('txtCodigoEntregaSync').textContent = res.codigoEntrega;
                if (el('boxCodigoEntregaSync')) el('boxCodigoEntregaSync').style.display = 'block';

                const fecha = new Date().toISOString().slice(0, 10);
                Almacenamiento.descargarTextoComoArchivo(
                    JSON.stringify(res.paquete, null, 2),
                    `sync-farmacia-${fecha}-seq${res.seq}.cfpatch`,
                    'application/json'
                );
                renderizarPeersP2P();
                notificar(`Archivo .cfpatch exportado (${res.totalProductos} productos cifrados). Ingresa el código ${res.codigoEntrega} en la PC destino.`, 'success');
            } catch (err) {
                notificar(err.message || 'No se pudo generar el paquete .cfpatch.', 'error');
            }
        });

        el('inputImportarSyncP2P')?.addEventListener('change', async e => {
            const archivo = e.target?.files?.[0];
            if (!archivo) return;
            const codigoEntrega = (el('inputCodigoEntregaImportP2P')?.value || '').trim().toUpperCase();
            if (!codigoEntrega) {
                e.target.value = '';
                notificar('Ingresa primero el Código Efímero de Entrega (XXXX-XXXX) de la PC emisora.', 'warning');
                el('inputCodigoEntregaImportP2P')?.focus();
                return;
            }

            try {
                const texto = await archivo.text();
                const res = await Almacenamiento.importarSyncCifradaDePeer(texto, codigoEntrega);
                if (el('inputCodigoEntregaImportP2P')) el('inputCodigoEntregaImportP2P').value = '';
                e.target.value = '';
                sincronizarAppTrasCambioSeguridad(true);
                notificar(
                    `Sync cifrada importada de "${res.origenPeer.alias}" (#${res.seq}): ${res.estadisticas.nuevos} nuevos, ${res.estadisticas.actualizados} actualizados.`,
                    'success'
                );
            } catch (err) {
                e.target.value = '';
                notificar(err.message || 'No se pudo descifrar el paquete .cfpatch. Verifica código, equipo origen o anti-replay.', 'error');
            }
        });

        el('btnWebRtcEnviarP2P')?.addEventListener('click', () => {
            const peerId = el('selDestinoSyncP2P')?.value || '';
            if (!peerId) {
                notificar('Selecciona primero la PC destino autorizada.', 'warning');
                return;
            }
            const incluirProveedores = Boolean(el('chkSyncIncluirProveedores')?.checked);
            enviarPorWebRtcLan(peerId, incluirProveedores);
        });

        el('btnWebRtcRecibirP2P')?.addEventListener('click', () => {
            recibirPorWebRtcLan();
        });

        // Rastreo de actividad del usuario para renovar temporizador de auto-bloqueo Admin
        const registrarActividadThrottled = (() => {
            let ultimoRegistro = 0;
            return () => {
                const ahora = Date.now();
                if (ahora - ultimoRegistro < 15000) return;
                ultimoRegistro = ahora;
                if (Seguridad && typeof Seguridad.registrarActividad === 'function') {
                    Seguridad.registrarActividad();
                }
            };
        })();

        ['click', 'keydown', 'pointerdown'].forEach(ev => {
            document.addEventListener(ev, registrarActividadThrottled, { passive: true });
        });

        // Ocultar impresiones y montos revelados al cambiar de pestaña del navegador
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                if (UI.Historial && typeof UI.Historial.limpiarAreaImpresion === 'function') {
                    UI.Historial.limpiarAreaImpresion();
                }
                if (Seguridad && Seguridad.estaConfigurado() && Seguridad.estaAdminDesbloqueado && Seguridad.estaAdminDesbloqueado()) {
                    UI.Historial?.renderizarHistorialUI?.();
                }
            }
        });

        // Reaccionar cuando el temporizador automático bloquea Admin en segundo plano
        Seguridad.suscribirCambioEstado(estado => {
            if (!estado) return;
            actualizarInterfazEstado();
            if (estado.configurado && estado.bloqueado && nivelPrevioSincronizado === 'ADMIN' && !sincronizandoPorEventoSeguridad) {
                sincronizandoPorEventoSeguridad = true;
                try {
                    const mantuvoCaja = Boolean(estado.cajaDesbloqueada);
                    sincronizarAppTrasCambioSeguridad(false);
                    notificar(
                        mantuvoCaja
                            ? 'Sesión de Administrador cerrada por inactividad. Turno de Mostrador sigue activo.'
                            : 'Sesión bloqueada por inactividad. Secretos purgados de memoria RAM.',
                        'warning'
                    );
                } finally {
                    sincronizandoPorEventoSeguridad = false;
                }
            } else {
                nivelPrevioSincronizado = estado.nivelAcceso;
            }
        });

        const estInicial = Seguridad.obtenerEstado();
        nivelPrevioSincronizado = estInicial ? estInicial.nivelAcceso : null;
        actualizarInterfazEstado();
    }

    UI.Seguridad = Object.freeze({
        abrirModalSeguridad,
        cerrarModalSeguridad,
        solicitarDesbloqueoSiNecesario,
        solicitarAccesoCajaOAdmin,
        actualizarInterfazEstado,
        inicializarEventosSeguridad
    });
})(window);
