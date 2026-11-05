(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;
    const Almacenamiento = AppFarmacia.Almacenamiento;

    const el = id => document.getElementById(id);
    const escaparHtml = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const iconoSvg = nombre => `<svg class="ico" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

    function renderizarDiccionarioUI() {
        const contenedor = el('contenedorDiccionario');
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const codigos = Object.keys(diccionario);

        if (!codigos.length) {
            contenedor.innerHTML = `<div class="text-center p-18 text-muted">Aún no hay códigos de barra memorizados. Escanea un producto en la calculadora y agrégalo para aprenderlo.</div>`;
            return;
        }

        contenedor.innerHTML = `
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Código de Barras</th>
                            <th>Producto Memorizado</th>
                            <th>Categoría</th>
                            <th>Trae x Caja</th>
                            <th>Último Costo Caja</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${codigos.map(cod => {
                            const item = diccionario[cod];
                            const codEscapado = escaparHtml(cod);
                            const badges = [];
                            if (item.esLeche) {
                                badges.push('<span class="badge" style="font-size:10px;background:var(--color-primario-fondo);color:var(--color-primario);padding:1px 5px;border-radius:3px;margin-left:4px;">Leche 10%</span>');
                            }
                            if (item.tasaItbis > 0 || item.aplicaItbis) {
                                const tasa = item.tasaItbis || 18;
                                badges.push(`<span class="badge" style="font-size:10px;background:var(--color-alerta-fondo);color:var(--color-alerta);padding:1px 5px;border-radius:3px;margin-left:4px;">+${tasa}% ITBIS</span>`);
                            }
                            const nombreTexto = item.nombre || 'Producto sin nombre';
                            return `<tr>
                                <td class="mono">${escaparHtml(item.codigoBarras)}</td>
                                <td><strong>${escaparHtml(nombreTexto)}</strong>${badges.join('')}</td>
                                <td>${item.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}</td>
                                <td class="mono">${item.unidadesPorCaja}</td>
                                <td class="mono">$${Number(item.ultimoPrecioCaja || 0).toFixed(2)}</td>
                                <td>
                                    <button type="button" class="action-icon-btn" data-usar-codigo="${codEscapado}" aria-label="Cargar ${escaparHtml(nombreTexto)} en calculadora">Cargar en Calculadora</button>
                                    <button type="button" class="action-icon-btn text-danger" data-borrar-codigo="${codEscapado}" aria-label="Eliminar código ${codEscapado}">${iconoSvg('trash')}</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function descargarDiccionarioJson() {
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        if (Object.keys(diccionario).length === 0) {
            return UI.Notificaciones.mostrarMensaje('El diccionario de códigos está vacío. No hay datos para descargar.', 'error');
        }
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            diccionario
        }, `diccionario-codigos-farmacia-${Dominio.obtenerFechaLocalISO()}.json`);
    }

    async function restaurarDiccionarioJson(inputArchivo) {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
        if (!archivo) return;

        try {
            const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
            if (!datos || typeof datos !== 'object') {
                throw new Error('El archivo no contiene un objeto JSON válido.');
            }

            if (datos.tipo === CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO) {
                throw new Error('Has seleccionado un archivo de Respaldo Completo. Para restaurar la base completa usa la casilla "Restaurar Base Completa (.json)" de abajo.');
            }
            if (datos.tipo === CONSTANTES.TIPO_ARCHIVO_RESPALDO_FACTURAS) {
                throw new Error('Has seleccionado un archivo de Historial de Facturas. Para restaurarlo ve a la Bóveda de la Farmacia.');
            }

            // Detección inteligente y flexible de catálogos
            let items = null;
            if (datos.diccionario && typeof datos.diccionario === 'object' && !Array.isArray(datos.diccionario)) {
                items = datos.diccionario;
            } else if (datos.datos && typeof datos.datos === 'object' && !Array.isArray(datos.datos)) {
                items = datos.datos;
            } else if (Array.isArray(datos)) {
                items = {};
                datos.forEach(p => {
                    if (p && p.codigoBarras) items[p.codigoBarras] = p;
                });
            } else if (Array.isArray(datos.productos)) {
                items = {};
                datos.productos.forEach(p => {
                    if (p && p.codigoBarras) items[p.codigoBarras] = p;
                });
            } else {
                // Si es un mapa directo de productos: { "746001": {...} }
                items = datos;
            }

            if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
                throw new Error('El archivo no contiene productos reconocibles en el diccionario.');
            }
            const actual = Almacenamiento.obtenerDiccionarioCodigos();
            let agregados = 0;
            Object.entries(items).forEach(([cod, info]) => {
                const codigoLimpio = Dominio.normalizarCodigoBarras(cod);
                if (codigoLimpio && info && typeof info === 'object') {
                    const tipo = info.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
                    const tasaItbis = (info.tasaItbis !== undefined && Number.isFinite(Number(info.tasaItbis)))
                        ? Number(info.tasaItbis)
                        : (info.aplicaItbis ? 18 : 0);
                    actual[codigoLimpio] = {
                        ...info,
                        codigoBarras: codigoLimpio,
                        nombre: String(info.nombre || info.nombreComercial || 'Producto sin nombre').trim(),
                        nombreComercial: String(info.nombreComercial || info.nombre || 'Producto sin nombre').trim(),
                        principioActivo: String(info.principioActivo || '').trim(),
                        laboratorio: String(info.laboratorio || '').trim(),
                        concentracion: String(info.concentracion || '').trim(),
                        categoria: String(info.categoria || '').trim(),
                        presentacion: String(info.presentacion || '').trim(),
                        formaFarmaceutica: String(info.formaFarmaceutica || '').trim(),
                        registroSanitario: String(info.registroSanitario || '').trim(),
                        condicionVenta: String(info.condicionVenta || 'OTC').trim(),
                        ubicacion: String(info.ubicacion || '').trim(),
                        tipo,
                        unidadesPorCaja: tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(info.unidadesPorCaja) || 1),
                        ultimoPrecioCaja: Number(info.ultimoPrecioCaja) || 0,
                        aplicaItbis: tasaItbis > 0,
                        tasaItbis,
                        esLeche: Boolean(info.esLeche),
                        descuentoValor: Number(info.descuentoValor) || 0,
                        tipoDescuento: info.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                        actualizadoEn: info.actualizadoEn || new Date().toISOString()
                    };
                    agregados++;
                }
            });
            Almacenamiento.guardarDiccionarioCodigos(actual);
            renderizarDiccionarioUI();
            UI.Factura.actualizarBarraSuperior();
            UI.Notificaciones.mostrarMensaje(`Diccionario actualizado: ${agregados} productos importados correctamente.`, 'success');
        } catch (error) {
            UI.Notificaciones.mostrarMensaje(error.message, 'error');
        }
    }

    function inicializarEventosDiccionario() {
        el('btnDescargarDiccionario').addEventListener('click', descargarDiccionarioJson);
        el('inputRestaurarDiccionario').addEventListener('change', e => restaurarDiccionarioJson(e.target));

        // Respaldo y Restauración de Base Completa (IndexedDB)
        const btnDescargarBase = el('btnDescargarBaseCompleta');
        if (btnDescargarBase) {
            btnDescargarBase.addEventListener('click', () => {
                Almacenamiento.exportarBaseCompleta();
            });
        }

        const inputRestaurarBase = el('inputRestaurarBaseCompleta');
        if (inputRestaurarBase) {
            inputRestaurarBase.addEventListener('change', async e => {
                const archivo = e.target.files[0];
                e.target.value = '';
                if (!archivo) return;
                try {
                    const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
                    const confirmar = await UI.Notificaciones.mostrarConfirmacion(
                        'Esta acción restaurará toda la base de datos (Catálogo, Historial y Fórmulas). ¿Deseas continuar?',
                        'Restaurar Base Completa'
                    );
                    if (!confirmar) return;

                    const res = Almacenamiento.restaurarBaseCompleta(datos);
                    if (res.exito) {
                        renderizarDiccionarioUI();
                        AppFarmacia.Estado.renderizarTodo();
                        UI.Calculadora.calcularEnVivo();
                        UI.Notificaciones.mostrarMensaje(`Restauración completa exitosa: ${res.totalProductos} productos y ${res.totalFacturas} facturas restauradas.`, 'success');
                    } else {
                        UI.Notificaciones.mostrarMensaje(res.error || 'Error al restaurar.', 'error');
                    }
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message, 'error');
                }
            });
        }
        el('contenedorDiccionario').addEventListener('click', async e => {
            const btnUsar = e.target.closest('[data-usar-codigo]');
            if (btnUsar) {
                el('calcCodigoBarras').value = btnUsar.dataset.usarCodigo;
                UI.Calculadora.procesarEscaneoCodigoBarras();
                el('seccionCalculadora').scrollIntoView({ behavior: 'smooth' });
                return;
            }
            const btnBorrar = e.target.closest('[data-borrar-codigo]');
            if (btnBorrar) {
                const confirmarBorrado = await UI.Notificaciones.mostrarConfirmacion('¿Eliminar este código y su nombre memorizado del diccionario?', 'Eliminar Código');
                if (confirmarBorrado) {
                    Almacenamiento.eliminarCodigoDeDiccionario(btnBorrar.dataset.borrarCodigo);
                    renderizarDiccionarioUI();
                    UI.Factura.actualizarBarraSuperior();
                }
            }
        });
    }

    UI.Diccionario = Object.freeze({
        renderizarDiccionarioUI,
        descargarDiccionarioJson,
        restaurarDiccionarioJson,
        inicializarEventosDiccionario
    });
})(window);
