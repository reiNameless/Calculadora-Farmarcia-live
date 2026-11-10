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

    function limpiarEtiquetaSubcategoria(subCat, macro) {
        if (!subCat) return '';
        let limpia = String(subCat).trim();
        if (limpia.includes('/')) {
            limpia = limpia.split('/').slice(1).join('/').trim();
        }
        limpia = limpia.replace(/^(antibiótic[oa]s?|antidiabétic[oa]s?|suplementos?)\s+/i, '').trim();
        return limpia ? (limpia.charAt(0).toUpperCase() + limpia.slice(1)) : subCat;
    }

    function renderizarDiccionarioUI(filtroTermino = '', filtroCategoria = '') {
        const contenedor = el('contenedorDiccionario');
        if (!contenedor) return;
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const todosLosItems = Object.values(diccionario || {});

        // 1. Actualizar dinámicamente el selector de categorías agrupado por Macro-Categorías (Rol 01 / EGM)
        const selCat = el('filtroCategoriaDiccionario');
        if (selCat) {
            const catActualSeleccionada = filtroCategoria || selCat.value || '';
            const macroMap = new Map();

            todosLosItems.forEach(p => {
                const subCat = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                    ? Dominio.obtenerMacroCategoria(subCat)
                    : subCat;

                if (!macroMap.has(macro)) {
                    macroMap.set(macro, { total: 0, subcategorias: new Map() });
                }
                const entradaMacro = macroMap.get(macro);
                entradaMacro.total += 1;
                entradaMacro.subcategorias.set(subCat, (entradaMacro.subcategorias.get(subCat) || 0) + 1);
            });

            const macrosOrdenadas = Array.from(macroMap.keys()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

            let optionsHtml = `<option value="">Todas las categorías (${todosLosItems.length} productos)</option>`;
            macrosOrdenadas.forEach(macro => {
                const entrada = macroMap.get(macro);
                const subKeys = Array.from(entrada.subcategorias.keys()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

                const selectedMacro = catActualSeleccionada === `macro:${macro}` || catActualSeleccionada === macro ? ' selected' : '';

                if (subKeys.length <= 1 && subKeys[0] === macro) {
                    optionsHtml += `<option value="macro:${escaparHtml(macro)}"${selectedMacro}>${escaparHtml(macro)} (${entrada.total})</option>`;
                } else {
                    optionsHtml += `<optgroup label="${escaparHtml(macro)} (${entrada.total})">`;
                    optionsHtml += `<option value="macro:${escaparHtml(macro)}"${selectedMacro}>★ Todos en ${escaparHtml(macro)} (${entrada.total})</option>`;
                    subKeys.forEach(sub => {
                        const count = entrada.subcategorias.get(sub);
                        const selectedSub = catActualSeleccionada === `sub:${sub}` || catActualSeleccionada === sub ? ' selected' : '';
                        const etiquetaLimpia = limpiarEtiquetaSubcategoria(sub, macro);
                        optionsHtml += `<option value="sub:${escaparHtml(sub)}"${selectedSub}>   ${escaparHtml(etiquetaLimpia)} (${count})</option>`;
                    });
                    optionsHtml += `</optgroup>`;
                }
            });
            selCat.innerHTML = optionsHtml;
        }

        let listaItems = [...todosLosItems];

        // 2. Filtro por categoría o macro-categoría seleccionada
        const catFiltro = filtroCategoria || (selCat ? selCat.value : '');
        if (catFiltro) {
            if (catFiltro.startsWith('macro:')) {
                const targetMacro = catFiltro.slice(6);
                listaItems = listaItems.filter(p => {
                    const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                    return (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                        ? Dominio.obtenerMacroCategoria(c) === targetMacro
                        : c === targetMacro;
                });
            } else if (catFiltro.startsWith('sub:')) {
                const targetSub = catFiltro.slice(4).toLowerCase();
                listaItems = listaItems.filter(p => {
                    const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                    return c.toLowerCase() === targetSub;
                });
            } else {
                const target = catFiltro.toLowerCase();
                listaItems = listaItems.filter(p => {
                    const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                    const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                        ? Dominio.obtenerMacroCategoria(c).toLowerCase()
                        : '';
                    return c.toLowerCase() === target || macro === target;
                });
            }
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
                        <button type="button" class="action-icon-btn" data-usar-codigo="${codEscapado}" title="Cargar en Calculadora" aria-label="Cargar ${escaparHtml(nombreTexto)} en calculadora">${iconoSvg('calc')}</button>
                        <button type="button" class="action-icon-btn" data-editar-ficha="${codEscapado}" title="Editar Ficha en Catálogo" aria-label="Editar ficha de ${escaparHtml(nombreTexto)}">${iconoSvg('edit')}</button>
                        <button type="button" class="action-icon-btn text-danger" data-borrar-codigo="${codEscapado}" title="Eliminar del Catálogo" aria-label="Eliminar código ${codEscapado}">${iconoSvg('trash')}</button>
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

    async function restaurarDiccionarioJson(inputArchivo, modoForzado = 'fusion') {
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

            const res = Almacenamiento.fusionarCatalogoDesdeArchivo(datos, { modo: modoForzado });
            if (!res.exito) {
                throw new Error(res.error || 'No se pudieron incorporar los productos del archivo.');
            }

            renderizarDiccionarioUI();
            UI.Factura.actualizarBarraSuperior();
            UI.Calculadora.calcularEnVivo();

            if (res.tipo === 'vademecum-digemaps') {
                UI.Notificaciones.mostrarMensaje(
                    res.mensaje || `Vademécum Oficial DIGEMAPS cargado con éxito (${res.total} medicamentos). Listo para enlazado en mostrador.`,
                    'success'
                );
            } else if (res.tipo === 'catalogo-conveniencia') {
                const est = res.estadisticas || { agregados: res.total, actualizados: 0, conservados: 0, totalFinal: res.total };
                UI.Notificaciones.mostrarMensaje(
                    `Catálogo de Conveniencia cargado con éxito: +${est.agregados} productos con 18% ITBIS añadidos.`,
                    'success'
                );
            } else {
                const est = res.estadisticas;
                UI.Notificaciones.mostrarMensaje(
                    `Catálogo sincronizado: +${est.agregados} nuevos añadidos, ${est.actualizados} actualizados, ${est.conservados} conservados intactos (${est.totalFinal} fármacos en total).`,
                    'success'
                );
            }
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

        let guardandoFichaEnCurso = false;
        if (formEdit) {
            formEdit.addEventListener('submit', e => {
                e.preventDefault();
                if (guardandoFichaEnCurso) return;
                const btnSubmit = formEdit.querySelector('button[type="submit"]');
                try {
                    guardandoFichaEnCurso = true;
                    if (btnSubmit) {
                        btnSubmit.disabled = true;
                        btnSubmit.classList.add('btn-loading');
                    }
                    const codigo = el('editProdCodigo').value;
                    const nombreNormalizado = (Dominio && typeof Dominio.normalizarNombreProductoMayusculas === 'function')
                        ? Dominio.normalizarNombreProductoMayusculas(el('editProdNombre').value)
                        : el('editProdNombre').value.toUpperCase().trim();

                    const ficha = {
                        codigoBarras: codigo,
                        nombre: nombreNormalizado,
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

                    if (Dominio && typeof Dominio.validarDatosMinimosProducto === 'function') {
                        const valMin = Dominio.validarDatosMinimosProducto(ficha);
                        if (!valMin.esValido) {
                            UI.Notificaciones.mostrarMensaje(valMin.error, 'error');
                            return;
                        }
                    }

                const res = Almacenamiento.guardarFichaProductoCatalogo(ficha);
                if (res.exito) {
                    cerrarModalEdit();
                    aplicarFiltrosDiccionario();
                    UI.Notificaciones.mostrarMensaje(`Ficha de "${ficha.nombre}" actualizada en el Catálogo Maestro.`, 'success');
                } else {
                    UI.Notificaciones.mostrarMensaje(res.error || 'Error al guardar ficha.', 'error');
                }
                } finally {
                    guardandoFichaEnCurso = false;
                    if (btnSubmit) {
                        btnSubmit.disabled = false;
                        btnSubmit.classList.remove('btn-loading');
                    }
                }
            });
        }

        el('btnDescargarDiccionario').addEventListener('click', descargarDiccionarioJson);
        el('inputRestaurarDiccionario').addEventListener('change', e => restaurarDiccionarioJson(e.target));

        // Sincronización entre Cajas (Smart Delta Patch)
        const btnExportarCaja = el('btnExportarParaOtraCaja');
        if (btnExportarCaja) {
            btnExportarCaja.addEventListener('click', () => {
                Almacenamiento.exportarParcheParaOtraCaja();
                UI.Notificaciones.mostrarMensaje('Catálogo empaquetado para transferir a otra computadora descargado.', 'success');
            });
        }

        const inputFusionar = el('inputFusionarCatalogo');
        if (inputFusionar) {
            inputFusionar.addEventListener('change', e => restaurarDiccionarioJson(e.target, 'fusion'));
        }

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
