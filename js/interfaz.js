(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;
    const Almacenamiento = AppFarmacia.Almacenamiento;
    const ServicioIA = AppFarmacia.ServicioIA;

    const el = id => document.getElementById(id);

    // --- ESTADO CENTRALIZADO COMPARTIDO (ARQ-03) ---
    let sesionActual = Almacenamiento.crearSesionVacia();
    let reglasActivas = Almacenamiento.obtenerReglasNegocio();

    function sincronizarYGuardarSesion() {
        Almacenamiento.guardarBorradorActivo(sesionActual);
        if (!sesionActual.id || !sesionActual.proveedor || !sesionActual.numeroFactura || UI.Factura.buscarFacturaDuplicada?.()) return;

        const historial = Almacenamiento.obtenerHistorialFacturas();
        const idx = historial.findIndex(f => f.id === sesionActual.id);
        if (idx < 0) return;

        const resumen = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);
        historial[idx] = {
            ...Dominio.clonarObjetoSeguro(sesionActual),
            totalCalculado: resumen.sumaAcumulada,
            timestampGuardado: Date.now()
        };
        Almacenamiento.guardarHistorialFacturas(historial);
    }

    function sincronizarYRenderizarProductos() {
        UI.Factura.actualizarBarraSuperior();
        UI.Factura.renderizarTablaProductosActuales();
        UI.Calculadora.calcularEnVivo();
    }

    function agregarProductoASesion(nuevoProducto) {
        sesionActual.productos.unshift(nuevoProducto);
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function reemplazarProductoEnSesion(idLinea, nuevoProducto) {
        const idx = sesionActual.productos.findIndex(p => String(p.idLinea) === String(idLinea));
        if (idx < 0) return;
        sesionActual.productos[idx] = nuevoProducto;
        Almacenamiento.aprenderProductoEnDiccionario(nuevoProducto, sesionActual);
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function eliminarProductoDeSesion(idLinea) {
        sesionActual.productos = sesionActual.productos.filter(p => String(p.idLinea) !== String(idLinea));
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function vaciarSesion() {
        sesionActual = Almacenamiento.crearSesionVacia();
        Almacenamiento.guardarBorradorActivo(sesionActual);
        renderizarTodo();
        UI.Calculadora.calcularEnVivo();
    }

    function renderizarTodo() {
        if (!sesionActual.fechaVencimiento && sesionActual.fechaEmision) {
            sesionActual.fechaVencimiento = Dominio.sumarDiasAFechaISO(sesionActual.fechaEmision, 30);
        }
        el('facProveedor').value = sesionActual.proveedor;
        if (el('facRnc')) el('facRnc').value = sesionActual.rnc || '';
        UI.Factura.actualizarDatalistProveedores?.();
        el('facNumero').value = sesionActual.numeroFactura;
        el('facFechaEmision').value = sesionActual.fechaEmision;
        el('facFechaVencimiento').value = sesionActual.fechaVencimiento;
        el('facTotalFisico').value = sesionActual.totalFisico || '';
        el('avisoEdicion').style.display = sesionActual.id ? 'flex' : 'none';
        el('txtFinalizar').textContent = sesionActual.id ? 'Guardar cambios y cerrar' : 'Finalizar y Guardar';
        el('txtDescartar').textContent = sesionActual.id ? 'Salir de edición' : 'Descartar factura';

        UI.Calculadora.actualizarEtiquetasReglasUI();
        UI.Factura.actualizarBarraSuperior();
        UI.Factura.renderizarTablaProductosActuales();
        UI.Diccionario.renderizarDiccionarioUI();
        UI.Historial.renderizarHistorialUI();
    }

    AppFarmacia.Estado = {
        get sesionActual() { return sesionActual; },
        set sesionActual(val) { sesionActual = val; },
        get reglasActivas() { return reglasActivas; },
        set reglasActivas(val) { reglasActivas = val; },
        agregarProductoASesion,
        reemplazarProductoEnSesion,
        eliminarProductoDeSesion,
        vaciarSesion,
        sincronizarYGuardarSesion,
        sincronizarYRenderizarProductos,
        renderizarTodo
    };

    // --- PWA: REGISTRO DE SERVICE WORKER Y BOTÓN DE INSTALACIÓN (CAL-03) ---
    let eventoInstalacionPwa = null;

    function registrarServiceWorker() {
        if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.info('[PWA] Service Worker registrado con éxito:', reg.scope);
                })
                .catch(err => {
                    console.warn('[PWA] No se pudo registrar el Service Worker:', err);
                });
        }

        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            eventoInstalacionPwa = e;
            const btnInstalar = el('btnInstalarPwa');
            if (btnInstalar) {
                btnInstalar.style.display = 'inline-flex';
                btnInstalar.onclick = async () => {
                    if (eventoInstalacionPwa) {
                        eventoInstalacionPwa.prompt();
                        const { outcome } = await eventoInstalacionPwa.userChoice;
                        if (outcome === 'accepted') {
                            btnInstalar.style.display = 'none';
                        }
                        eventoInstalacionPwa = null;
                    }
                };
            }
        });
    }

    // --- QA-04: MANEJADORES GLOBALES DE ERRORES ---
    window.addEventListener('error', event => {
        console.error('Error global capturado:', event.error || event.message);
        UI.Notificaciones.mostrarMensaje(`Error inesperado en la interfaz: ${event.message || 'Consulta la consola'}`, 'error');
    });

    window.addEventListener('unhandledrejection', event => {
        console.error('Promesa no controlada:', event.reason);
        const razon = event.reason?.message || String(event.reason || 'Operación no completada');
        UI.Notificaciones.mostrarMensaje(`Error en proceso asíncrono: ${razon}`, 'error');
    });

    // --- COD-11: INICIALIZACIÓN PROTEGIDA CON TRY/CATCH ---
    window.addEventListener('DOMContentLoaded', () => {
        try {
            // SEG-02: Detección de Falsificación de Dominio / Clonación no autorizada (Domain Spoofing Guard)
            const dominiosValidos = (CONSTANTES.DOMINIOS_AUTORIZADOS || ['localhost', '127.0.0.1', 'reinameless.github.io']);
            const hostActual = window.location.hostname;
            const esLocalOValido = !hostActual || dominiosValidos.includes(hostActual) || hostActual.endsWith('.local') || window.location.protocol === 'file:';
            if (!esLocalOValido) {
                console.warn('[Chroniris OS] Copia de software ejecutándose en dominio no oficial:', hostActual);
                UI.Notificaciones.mostrarMensaje(
                    'Aviso de Seguridad: Esta aplicación se está ejecutando desde un dominio no verificado. El autor legítimo es reiNameless (Chroniris OS). Protege tus claves y datos.',
                    'warning'
                );
            }
            Almacenamiento.limpiarHistorialExpirado7Dias();
            sesionActual = Almacenamiento.cargarBorradorActivo();
            reglasActivas = Almacenamiento.obtenerReglasNegocio();

            // SEG-01: Migrar API Key de localStorage a sessionStorage por seguridad
            const legacyKey = localStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY);
            if (legacyKey) {
                sessionStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY, legacyKey);
                localStorage.removeItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY);
            }
            el('iaApiKey').value = sessionStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY) || '';
            el('iaModelo').value = localStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_MODELO) || CONSTANTES.MODELO_IA_POR_DEFECTO;

            // Inicializar submódulos
            UI.Calculadora.establecerBloqueoReglas(true);
            UI.Calculadora.actualizarVisibilidadCategoria();
            UI.Calculadora.inicializarEventosCalculadora();
            UI.Factura.inicializarEventosFactura();
            UI.Diccionario.inicializarEventosDiccionario();
            UI.Historial.inicializarEventosHistorial();

            renderizarTodo();

            // Resguardo contra condiciones de carrera durante la hidratación asíncrona de IndexedDB
            let interaccionUsuarioIniciada = false;
            const marcarInteraccion = () => { interaccionUsuarioIniciada = true; };
            window.addEventListener('input', marcarInteraccion, { once: true, passive: true });
            window.addEventListener('click', marcarInteraccion, { once: true, passive: true });

            // Inicializar persistencia asíncrona con IndexedDB
            Almacenamiento.inicializarPersistencia().then(seActualizaronDatos => {
                if (seActualizaronDatos) {
                    if (!interaccionUsuarioIniciada) {
                        sesionActual = Almacenamiento.cargarBorradorActivo();
                        reglasActivas = Almacenamiento.obtenerReglasNegocio();
                        renderizarTodo();
                        UI.Calculadora.calcularEnVivo();
                    } else {
                        // Preservar la sesión activa del usuario para evitar sobreescritura por carrera
                        reglasActivas = Almacenamiento.obtenerReglasNegocio();
                        UI.Diccionario.renderizarDiccionarioUI();
                        UI.Historial.renderizarHistorialUI();
                    }
                }
            }).catch(err => {
                console.warn('[Almacenamiento] Error inicializando persistencia IndexedDB:', err);
            });

            // Eventos IA
            el('iaApiKey').addEventListener('change', e => {
                sessionStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY, e.target.value.trim());
            });
            el('iaModelo').addEventListener('change', e => {
                localStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_MODELO, e.target.value.trim());
            });

            async function procesarArchivosFacturaIA(archivos) {
                const lista = Array.from(archivos || []).filter(Boolean);
                if (lista.length === 0) return;

                const apiKey = sessionStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY) || el('iaApiKey').value.trim();
                if (!apiKey) {
                    if (typeof abrirAjustes === 'function') abrirAjustes('seccionEscanerIA');
                    UI.Notificaciones.mostrarMensaje('Primero ingresa tu API Key de Gemini en Ajustes para procesar facturas.', 'warning');
                    return;
                }

                const contenedorIA = el('seccionEscanerIA');
                if (contenedorIA) contenedorIA.classList.add('btn-loading');
                const plural = lista.length > 1 ? `${lista.length} páginas` : '1 página';
                el('iaEstadoTexto').textContent = `Optimizando y analizando ${plural} de factura con IA...`;
                UI.Notificaciones.mostrarMensaje(`Analizando ${plural} con IA... Por favor espera unos momentos.`, 'info');

                try {
                    const modelo = el('iaModelo').value.trim() || CONSTANTES.MODELO_IA_POR_DEFECTO;
                    const res = await ServicioIA.analizarImagenFactura(lista, apiKey, modelo, reglasActivas);

                    if (res.proveedor && !sesionActual.proveedor) sesionActual.proveedor = res.proveedor;
                    if (res.numeroFactura && !sesionActual.numeroFactura) sesionActual.numeroFactura = res.numeroFactura;
                    if (res.fechaEmision) sesionActual.fechaEmision = res.fechaEmision;
                    if (res.totalFactura && !sesionActual.totalFisico) sesionActual.totalFisico = res.totalFactura;

                    res.productos.forEach(p => sesionActual.productos.push(p));
                    sincronizarYGuardarSesion();
                    renderizarTodo();
                    UI.Calculadora.calcularEnVivo();

                    const msgExito = `Escaneo completado: ${res.productos.length} productos cargados desde ${plural}.`;
                    el('iaEstadoTexto').textContent = msgExito;
                    UI.Notificaciones.mostrarMensaje(msgExito, 'success');
                } catch (err) {
                    el('iaEstadoTexto').textContent = err.message;
                    UI.Notificaciones.mostrarMensaje(err.message, 'error');
                } finally {
                    if (contenedorIA) contenedorIA.classList.remove('btn-loading');
                }
            }

            el('iaImagenInput').addEventListener('change', async e => {
                await procesarArchivosFacturaIA(e.target.files);
                e.target.value = '';
            });

            const inputDirecto = el('iaImagenInputDirecto');
            if (inputDirecto) {
                inputDirecto.addEventListener('change', async e => {
                    await procesarArchivosFacturaIA(e.target.files);
                    e.target.value = '';
                });
            }

            // --- REDISEÑO 2026: BÓVEDA, AJUSTES Y MODO ULTRA-DARK ---

            // 1. Drawer Bóveda (Historial 7 días + Fórmulas Protegidas)
            const drawerBoveda = el('drawerBoveda');
            const drawerBackdrop = el('drawerBackdrop');
            const btnAbrirBoveda = el('btnAbrirBoveda');
            const btnCerrarBoveda = el('btnCerrarBoveda');

            function abrirBoveda(tabInicial) {
                if (tabInicial) activarTabBoveda(tabInicial);
                if (drawerBoveda) drawerBoveda.classList.add('abierto');
                if (drawerBackdrop) drawerBackdrop.classList.add('abierto');
            }

            function cerrarBoveda() {
                if (drawerBoveda) drawerBoveda.classList.remove('abierto');
                if (drawerBackdrop) drawerBackdrop.classList.remove('abierto');
            }

            function activarTabBoveda(idSeccion) {
                document.querySelectorAll('[data-boveda-tab]').forEach(btn => {
                    btn.classList.toggle('activo', btn.getAttribute('data-boveda-tab') === idSeccion);
                });
                document.querySelectorAll('#drawerBoveda .boveda-panel').forEach(panel => {
                    panel.classList.toggle('activo', panel.id === idSeccion);
                });
            }

            if (btnAbrirBoveda) btnAbrirBoveda.addEventListener('click', () => abrirBoveda('seccionHistorial'));
            if (btnCerrarBoveda) btnCerrarBoveda.addEventListener('click', cerrarBoveda);
            if (drawerBackdrop) drawerBackdrop.addEventListener('click', cerrarBoveda);

            document.querySelectorAll('[data-boveda-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const target = btn.getAttribute('data-boveda-tab');
                    if (target) activarTabBoveda(target);
                });
            });

            // 2. Modal Ajustes (API Google Gemini + Diccionario y Archivos)
            const modalAjustes = el('modalAjustes');
            const btnAjustesModal = el('btnAjustesModal');
            const btnCerrarAjustes = el('btnCerrarAjustes');
            const btnFotoFacturaIA = el('btnFotoFacturaIA');

            function abrirAjustes(tabInicial) {
                if (modalAjustes) {
                    if (tabInicial) activarTabAjustes(tabInicial);
                    modalAjustes.showModal();
                }
            }

            function cerrarAjustes() {
                if (modalAjustes) modalAjustes.close();
            }

            function activarTabAjustes(idSeccion) {
                document.querySelectorAll('[data-ajustes-tab]').forEach(btn => {
                    btn.classList.toggle('activo', btn.getAttribute('data-ajustes-tab') === idSeccion);
                });
                document.querySelectorAll('#modalAjustes .ajustes-panel').forEach(panel => {
                    panel.classList.toggle('activo', panel.id === idSeccion);
                });
            }

            if (btnAjustesModal) btnAjustesModal.addEventListener('click', () => abrirAjustes('seccionEscanerIA'));
            if (btnCerrarAjustes) btnCerrarAjustes.addEventListener('click', cerrarAjustes);
            if (btnFotoFacturaIA) btnFotoFacturaIA.addEventListener('click', () => abrirAjustes('seccionEscanerIA'));

            document.querySelectorAll('[data-ajustes-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const target = btn.getAttribute('data-ajustes-tab');
                    if (target) activarTabAjustes(target);
                });
            });

            // 4. Modal de Atajos de Teclado e Información del Sistema (Croniris)
            const modalAtajos = el('modalAtajosAyuda');
            const btnModalAtajos = el('btnModalAtajos');
            const btnAtajosFooter = el('btnAtajosFooter');
            const btnAcercaDeFooter = el('btnAcercaDeFooter');
            const btnCerrarModalAtajos = el('btnCerrarModalAtajos');
            const btnCerrarAtajosFooter = el('btnCerrarAtajosFooter');

            function abrirModalAtajos() {
                if (modalAtajos && typeof modalAtajos.showModal === 'function') {
                    modalAtajos.showModal();
                }
            }

            function cerrarModalAtajos() {
                if (modalAtajos && typeof modalAtajos.close === 'function') {
                    modalAtajos.close();
                }
            }

            if (btnModalAtajos) btnModalAtajos.addEventListener('click', abrirModalAtajos);
            if (btnAtajosFooter) btnAtajosFooter.addEventListener('click', abrirModalAtajos);
            if (btnAcercaDeFooter) btnAcercaDeFooter.addEventListener('click', abrirModalAtajos);
            if (btnCerrarModalAtajos) btnCerrarModalAtajos.addEventListener('click', cerrarModalAtajos);
            if (btnCerrarAtajosFooter) btnCerrarAtajosFooter.addEventListener('click', cerrarModalAtajos);

            // Tecla Escape para cerrar drawer o modal de atajos
            window.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    if (drawerBoveda && drawerBoveda.classList.contains('abierto')) {
                        cerrarBoveda();
                    }
                    if (modalAtajos && modalAtajos.open) {
                        cerrarModalAtajos();
                    }
                }
            });

            // 3. Alternador Modo Ultra-Dark con persistencia
            const btnTema = el('btnToggleTema');
            const svgTema = el('svgIconoTema');
            const txtTema = el('txtLabelTema');

            function aplicarTema(tema) {
                document.documentElement.setAttribute('data-tema', tema);
                const esOscuro = tema === 'oscuro';
                if (svgTema) svgTema.innerHTML = `<use href="#${esOscuro ? 'i-sun' : 'i-moon'}"/>`;
                if (txtTema) txtTema.textContent = esOscuro ? 'Modo Claro Clínico' : 'Modo Ultra-Dark';
                localStorage.setItem('farmacia_tema', tema);
            }

            const temaGuardado = localStorage.getItem('farmacia_tema') || 'claro';
            aplicarTema(temaGuardado);

            if (btnTema) {
                btnTema.addEventListener('click', () => {
                    const actual = document.documentElement.getAttribute('data-tema') || 'claro';
                    aplicarTema(actual === 'oscuro' ? 'claro' : 'oscuro');
                });
            }

            // UX-02: Navegación Superior de respaldo
            if (el('barraNavegacion')) el('barraNavegacion').addEventListener('click', e => {
                const btn = e.target.closest('[data-ir]');
                if (!btn) return;

                document.querySelectorAll('#barraNavegacion .nav-btn').forEach(b => {
                    b.classList.remove('active');
                    b.removeAttribute('aria-current');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-current', 'page');

                const destino = el(btn.dataset.ir);
                if (destino) {
                    destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });

            // PWA Registration
            registrarServiceWorker();
        } catch (errorInicializacion) {
            console.error('Fallo en la inicialización de la Calculadora:', errorInicializacion);
            UI.Notificaciones.mostrarMensaje(`Error al iniciar la aplicación: ${errorInicializacion.message}`, 'error');
        }
    });
})(window);
