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

    function renderizarDiccionarioUI(filtroTermino = '', filtroCategoria = '') {
        const contenedor = el('contenedorDiccionario');
        if (!contenedor) return;
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const todosLosItems = Object.values(diccionario || {});

        // 1. Actualizar dinámicamente el selector de categorías si está presente
        const selCat = el('filtroCategoriaDiccionario');
        if (selCat) {
            const catActualSeleccionada = filtroCategoria || selCat.value || '';
            const categoriasSet = new Map();
            todosLosItems.forEach(p => {
                const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                categoriasSet.set(c, (categoriasSet.get(c) || 0) + 1);
            });
            const catsOrdenadas = Array.from(categoriasSet.keys()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

            let optionsHtml = `<option value="">Todas las categorías (${todosLosItems.length} productos)</option>`;
            catsOrdenadas.forEach(c => {
                const selected = c === catActualSeleccionada ? ' selected' : '';
                optionsHtml += `<option value="${escaparHtml(c)}"${selected}>${escaparHtml(c)} (${categoriasSet.get(c)})</option>`;
            });
            selCat.innerHTML = optionsHtml;
        }

        let listaItems = [...todosLosItems];

        // 2. Filtro por categoría seleccionada
        const catFiltro = filtroCategoria || (selCat ? selCat.value : '');
        if (catFiltro) {
            listaItems = listaItems.filter(p => {
                const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                return c.toLowerCase() === catFiltro.toLowerCase();
            });
        }

        // 3. Filtro difuso o por texto
        if (filtroTermino && filtroTermino.trim().length >= 2) {
            listaItems = (Dominio && typeof Dominio.buscarEnCatalogoFuzzy === 'function')
                ? Dominio.buscarEnCatalogoFuzzy(filtroTermino.trim(), Object.fromEntries(listaItems.map(p => [p.codigoBarras, p])), 100)
                : listaItems.filter(p => (p.nombre && p.nombre.toLowerCase().includes(filtroTermino.toLowerCase())) || (p.codigoBarras && p.codigoBarras.includes(filtroTermino)));
        }

        if (!listaItems.length) {
            contenedor.innerHTML = (filtroTermino || catFiltro)
                ? `<div class="text-center p-18 text-muted">No se encontraron productos coincidentes en el catálogo.</div>`
                : `<div class="text-center p-18 text-muted">Aún no hay códigos de barra memorizados. Escanea un producto en la calculadora y agrégalo para aprenderlo.</div>`;
            return;
        }

        // 4. ORGANIZACIÓN DETERMINÍSTICA: Categoría (A-Z) y dentro de cada categoría, Nombre Ascendente (A-Z)
        listaItems.sort((a, b) => {
            const catA = (a.categoria && a.categoria.trim()) ? a.categoria.trim() : 'General / Otros';
            const catB = (b.categoria && b.categoria.trim()) ? b.categoria.trim() : 'General / Otros';
            const cmpCat = catA.localeCompare(catB, 'es', { sensitivity: 'base' });
            if (cmpCat !== 0) return cmpCat;

            const nomA = (a.nombre || a.nombreComercial || '').trim();
            const nomB = (b.nombre || b.nombreComercial || '').trim();
            return nomA.localeCompare(nomB, 'es', { sensitivity: 'base' });
        });

        // 5. Renderizado en cuadrícula con cabeceras de categoría si no hay término difuso específico
        let filasHtml = '';
        let ultimaCategoria = null;

        listaItems.forEach(item => {
            const cod = item.codigoBarras || '';
            const codEscapado = escaparHtml(cod);
            const categoriaActual = (item.categoria && item.categoria.trim()) ? item.categoria.trim() : 'General / Otros';

            // Insertar separador de categoría si cambia
            if (!filtroTermino && categoriaActual !== ultimaCategoria) {
                ultimaCategoria = categoriaActual;
                filasHtml += `<tr class="fila-grupo-categoria">
                    <td colspan="6" style="background:var(--color-fondo-panel);font-weight:700;font-size:12px;color:var(--color-primario);padding:8px 12px;border-top:1.5px solid var(--color-borde);border-bottom:1px solid var(--color-borde);">
                        ${escaparHtml(categoriaActual)}
                    </td>
                </tr>`;
            }

            const badges = [];
            if (item.esLeche) {
                badges.push('<span class="badge" style="font-size:10px;background:var(--color-primario-fondo);color:var(--color-primario);padding:1px 5px;border-radius:3px;margin-left:4px;">Leche 10%</span>');
            }
            if (item.tasaItbis > 0 || item.aplicaItbis) {
                const tasa = item.tasaItbis || 18;
                badges.push(`<span class="badge" style="font-size:10px;background:var(--color-alerta-fondo);color:var(--color-alerta);padding:1px 5px;border-radius:3px;margin-left:4px;">+${tasa}% ITBIS</span>`);
            }
            const nombreTexto = item.nombre || 'Producto sin nombre';
            const subtitulo = [item.principioActivo, item.laboratorio].filter(Boolean).join(' • ');

            let badgeVariacion = '';
            if (item.variacionCosto && Number(item.variacionCosto) !== 0) {
                const varNum = Number(item.variacionCosto);
                const bg = varNum > 0 ? '#fee2e2' : '#dcfce7';
                const color = varNum > 0 ? '#dc2626' : '#16a34a';
                badgeVariacion = `<span class="badge" style="font-size:9px;background:${bg};color:${color};padding:1px 4px;border-radius:3px;margin-left:4px;" title="Variación respecto a la compra anterior">${varNum > 0 ? '+' : ''}${varNum}%</span>`;
            }

            filasHtml += `<tr>
                <td class="mono">${escaparHtml(cod)}</td>
                <td>
                    <strong>${escaparHtml(nombreTexto)}</strong>${badges.join('')}
                    ${subtitulo ? `<div style="font-size:11px;color:var(--color-texto-secundario);">${escaparHtml(subtitulo)}</div>` : ''}
                </td>
                <td><span style="font-size:11px;color:var(--color-texto-secundario);">${escaparHtml(categoriaActual)}</span><br><span style="font-size:10px;">${item.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}</span></td>
                <td class="mono">${item.unidadesPorCaja}</td>
                <td class="mono">$${Number(item.ultimoPrecioCaja || 0).toFixed(2)}${badgeVariacion}</td>
                <td style="white-space:nowrap;">
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button type="button" class="action-icon-btn" data-usar-codigo="${codEscapado}" aria-label="Cargar ${escaparHtml(nombreTexto)} en calculadora">Cargar</button>
                        <button type="button" class="action-icon-btn" data-editar-ficha="${codEscapado}" aria-label="Editar ficha de ${escaparHtml(nombreTexto)}" title="Editar Ficha en Catálogo">
                            ${iconoSvg('edit')} Editar
                        </button>
                        <button type="button" class="action-icon-btn text-danger" data-borrar-codigo="${codEscapado}" aria-label="Eliminar código ${codEscapado}">${iconoSvg('trash')}</button>
                    </div>
                </td>
            </tr>`;
        });

        contenedor.innerHTML = `
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Código de Barras</th>
                            <th>Producto / Laboratorio</th>
                            <th>Categoría / Tipo</th>
                            <th>Trae x Caja</th>
                            <th>Último Costo Caja</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasHtml}
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
        }, `diccionario-codigos-farmacia-${Dominio.obtenerFechaLocalISO()}.json`, CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS);
    }

    async function restaurarDiccionarioJson(inputArchivo) {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
        if (!archivo) return;

        try {
            let datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
            if (Dominio && typeof Dominio.verificarSobreDatos === 'function') {
                const resVerif = Dominio.verificarSobreDatos(datos, CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS);
                if (resVerif.esValido) {
                    datos = resVerif.datos;
                } else if (!resVerif.esLegacy) {
                    throw new Error(resVerif.error);
                }
            }
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
        const btnSembrar = el('btnSembrarCatalogoRd');
        if (btnSembrar) {
            btnSembrar.addEventListener('click', async () => {
                const confirmar = await UI.Notificaciones.mostrarConfirmacion(
                    '¿Deseas precargar el catálogo oficial dominicano con 77 medicamentos y productos esenciales? Se preservarán los productos que ya tengas registrados.',
                    'Sembrar Catálogo Dominicano'
                );
                if (confirmar) {
                    const res = await Almacenamiento.sembrarCatalogoInicial(false);
                    if (res.sembrado) {
                        renderizarDiccionarioUI();
                        UI.Factura.actualizarBarraSuperior();
                        UI.Notificaciones.mostrarMensaje('¡Catálogo dominicano precargado con éxito (' + res.totalProductos + ' productos disponibles)!', 'success');
                    } else {
                        UI.Notificaciones.mostrarMensaje(res.motivo || res.error || 'El catálogo ya está actualizado.', 'info');
                    }
                }
            });
        }

        const btnExportCsv = el('btnExportarCatalogoCsv');
        if (btnExportCsv) {
            btnExportCsv.addEventListener('click', () => {
                const res = Almacenamiento.exportarCatalogoMaestroCsv();
                UI.Notificaciones.mostrarMensaje(`Catálogo Maestro (${res.totalProductos} productos) exportado en CSV relacional para ERP.`, 'success');
            });
        }

        const inputFiltro = el('filtroBuscadorDiccionario');
        const selCat = el('filtroCategoriaDiccionario');

        const aplicarFiltrosDiccionario = () => {
            const termino = inputFiltro ? inputFiltro.value.trim() : '';
            const cat = selCat ? selCat.value : '';
            renderizarDiccionarioUI(termino, cat);
        };

        if (inputFiltro) inputFiltro.addEventListener('input', aplicarFiltrosDiccionario);
        if (selCat) selCat.addEventListener('change', aplicarFiltrosDiccionario);

        // Diálogo Modal de Edición de Ficha Maestra
        const modalEdit = el('modalEditarProductoDiccionario');
        const btnCerrarEdit = el('btnCerrarModalEditarProducto');
        const btnCancelarEdit = el('btnCancelarEditarProducto');
        const formEdit = el('formEditarFichaProducto');

        const cerrarModalEdit = () => {
            if (modalEdit && typeof modalEdit.close === 'function') modalEdit.close();
        };

        if (btnCerrarEdit) btnCerrarEdit.addEventListener('click', cerrarModalEdit);
        if (btnCancelarEdit) btnCancelarEdit.addEventListener('click', cerrarModalEdit);

        if (formEdit) {
            formEdit.addEventListener('submit', e => {
                e.preventDefault();
                const codigo = el('editProdCodigo').value;
                const ficha = {
                    codigoBarras: codigo,
                    nombre: el('editProdNombre').value,
                    categoria: el('editProdCategoria').value,
                    principioActivo: el('editProdPrincipioActivo').value,
                    laboratorio: el('editProdLaboratorio').value,
                    tipo: el('editProdTipo').value,
                    unidadesPorCaja: el('editProdUnidades').value,
                    tasaItbis: el('editProdTasaItbis').value,
                    aplicaItbis: Number(el('editProdTasaItbis').value) > 0,
                    esLeche: Boolean(el('editProdEsLeche') && el('editProdEsLeche').checked),
                    registroSanitario: el('editProdRegistroSanitario').value,
                    ubicacion: el('editProdUbicacion').value
                };

                const res = Almacenamiento.guardarFichaProductoCatalogo(ficha);
                if (res.exito) {
                    cerrarModalEdit();
                    aplicarFiltrosDiccionario();
                    UI.Notificaciones.mostrarMensaje(`Ficha de "${ficha.nombre}" actualizada en el Catálogo Maestro.`, 'success');
                } else {
                    UI.Notificaciones.mostrarMensaje(res.error || 'Error al guardar ficha.', 'error');
                }
            });
        }

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
            const btnEditar = e.target.closest('[data-editar-ficha]');
            if (btnEditar) {
                const cod = btnEditar.dataset.editarFicha;
                const dic = Almacenamiento.obtenerDiccionarioCodigos();
                const prod = dic[cod];
                if (prod && el('modalEditarProductoDiccionario')) {
                    el('editProdCodigo').value = prod.codigoBarras || cod;
                    el('editProdNombre').value = prod.nombre || '';
                    el('editProdCategoria').value = prod.categoria || '';
                    el('editProdPrincipioActivo').value = prod.principioActivo || '';
                    el('editProdLaboratorio').value = prod.laboratorio || '';
                    el('editProdTipo').value = prod.tipo || 'divisible';
                    el('editProdUnidades').value = prod.unidadesPorCaja || 1;
                    el('editProdTasaItbis').value = String(prod.tasaItbis !== undefined ? prod.tasaItbis : (prod.aplicaItbis ? 18 : 0));
                    if (el('editProdEsLeche')) el('editProdEsLeche').checked = Boolean(prod.esLeche);
                    el('editProdRegistroSanitario').value = prod.registroSanitario || '';
                    el('editProdUbicacion').value = prod.ubicacion || '';
                    el('modalEditarProductoDiccionario').showModal();
                }
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
