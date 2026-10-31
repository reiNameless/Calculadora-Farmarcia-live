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
        Almacenamiento.aprenderProductoEnDiccionario(nuevoProducto);
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
        el('facProveedor').value = sesionActual.proveedor;
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

            // Eventos IA
            el('iaApiKey').addEventListener('change', e => {
                sessionStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY, e.target.value.trim());
            });
            el('iaModelo').addEventListener('change', e => {
                localStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_MODELO, e.target.value.trim());
            });

            el('iaImagenInput').addEventListener('change', async e => {
                const archivo = e.target.files[0];
                e.target.value = '';
                if (!archivo) return;

                const contenedorIA = el('seccionEscanerIA');
                contenedorIA.classList.add('btn-loading');
                el('iaEstadoTexto').textContent = 'Analizando factura con IA de Google...';

                try {
                    const apiKey = sessionStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY) || el('iaApiKey').value.trim();
                    const modelo = el('iaModelo').value.trim() || CONSTANTES.MODELO_IA_POR_DEFECTO;
                    const res = await ServicioIA.analizarImagenFactura(archivo, apiKey, modelo, reglasActivas);

                    if (res.proveedor && !sesionActual.proveedor) sesionActual.proveedor = res.proveedor;
                    if (res.numeroFactura && !sesionActual.numeroFactura) sesionActual.numeroFactura = res.numeroFactura;
                    if (res.fechaEmision) sesionActual.fechaEmision = res.fechaEmision;
                    if (res.totalFactura && !sesionActual.totalFisico) sesionActual.totalFisico = res.totalFactura;

                    res.productos.forEach(p => sesionActual.productos.push(p));
                    sincronizarYGuardarSesion();
                    renderizarTodo();
                    UI.Calculadora.calcularEnVivo();
                    el('iaEstadoTexto').textContent = `Se cargaron ${res.productos.length} productos desde la imagen.`;
                    UI.Notificaciones.mostrarMensaje(`Escaneo completado: ${res.productos.length} productos añadidos.`, 'success');
                } catch (err) {
                    el('iaEstadoTexto').textContent = err.message;
                    UI.Notificaciones.mostrarMensaje(err.message, 'error');
                } finally {
                    contenedorIA.classList.remove('btn-loading');
                }
            });

            // UX-02: Navegación Superior con marca visual activa
            el('barraNavegacion').addEventListener('click', e => {
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
