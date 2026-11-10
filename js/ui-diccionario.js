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

    // Población estructurada del <select> de categorías con <optgroup> por Macrocategoría clínica
    function poblarSelectorCategoriasEdicion(categoriaSeleccionada = '') {
        const sel = el('editProdCategoria');
        if (!sel) return;
        const inputNueva = el('editProdCategoriaNueva');
        if (inputNueva) {
            inputNueva.style.display = 'none';
            inputNueva.value = '';
        }

        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const todosLosItems = Object.values(diccionario || {});
        const catMap = new Map();

        // Lista base de macrocategorías canónicas
        const macrosBase = [
            'Antibióticos', 'Antidiabéticos', 'Cardiovascular & Hipertensión',
            'Analgésicos & Antiinflamatorios', 'Antialérgicos & Respiratorio',
            'Gastrointestinal & Digestivo', 'Pediatría & Cuidado Infantil',
            'Cuidado Personal & Cosmética', 'Salud Bucodental',
            'Primeros Auxilios & Material Médico', 'Vitaminas & Suplementos',
            'Conveniencia & Bebidas', 'General / Otros'
        ];
        macrosBase.forEach(m => catMap.set(m, new Set()));

        todosLosItems.forEach(p => {
            const sub = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
            const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                ? Dominio.obtenerMacroCategoria(sub)
                : 'General / Otros';
            if (!catMap.has(macro)) catMap.set(macro, new Set());
            catMap.get(macro).add(sub);
        });

        // Asegurar que la categoría del producto actual esté contemplada
        let encontrada = false;
        if (categoriaSeleccionada) {
            const macroActual = Dominio.obtenerMacroCategoria(categoriaSeleccionada);
            if (!catMap.has(macroActual)) catMap.set(macroActual, new Set());
            catMap.get(macroActual).add(categoriaSeleccionada);
        }

        let html = '<option value="">-- Selecciona Categoría Terapéutica --</option>';
        Array.from(catMap.keys()).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).forEach(macro => {
            const subs = Array.from(catMap.get(macro)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
            if (subs.length > 0) {
                html += `<optgroup label="${escaparHtml(macro)}">`;
                subs.forEach(s => {
                    const isSel = (s.toLowerCase() === (categoriaSeleccionada || '').toLowerCase());
                    if (isSel) encontrada = true;
                    html += `<option value="${escaparHtml(s)}"${isSel ? ' selected' : ''}>${escaparHtml(s)}</option>`;
                });
                html += '</optgroup>';
            }
        });

        // Opción especial para agregar una categoría que no exista
        html += `<option value="__NUEVA__"${(!encontrada && categoriaSeleccionada) ? ' selected' : ''}>+ Escribir nueva categoría...</option>`;
        sel.innerHTML = html;

        if (!encontrada && categoriaSeleccionada && inputNueva) {
            sel.value = '__NUEVA__';
            inputNueva.style.display = 'block';
            inputNueva.value = categoriaSeleccionada;
        }
    }

    // Actualización de Datalists para autocompletar en mostrador y formularios
    function actualizarDatalistsDirectorios() {
        const dlLabs = el('listaLaboratoriosSugeridos');
        if (dlLabs) {
            const labs = Almacenamiento.obtenerDirectorioLaboratorios();
            dlLabs.innerHTML = labs.map(l => `<option value="${escaparHtml(l.nombre)}">${escaparHtml(l.origen || '')} — ${escaparHtml(l.razonSocial || '')}</option>`).join('');
        }
        const dlProvsHab = el('listaProveedoresHabitualesSugeridos');
        if (dlProvsHab) {
            const provs = Almacenamiento.obtenerDirectorioProveedores();
            dlProvsHab.innerHTML = provs.map(p => `<option value="${escaparHtml(p.nombre)}">${escaparHtml(p.rnc ? p.rnc + ' — ' : '')}${escaparHtml(p.razonSocial || '')}</option>`).join('');
        }
        if (typeof UI.Factura?.actualizarDatalistProveedores === 'function') {
            UI.Factura.actualizarDatalistProveedores();
        }
    }

    // Renderizado del Directorio de Proveedores / Droguerías
    function renderizarProveedoresUI(terminoFiltro = '') {
        const contenedor = el('contenedorProveedores');
        if (!contenedor) return;
        const lista = Almacenamiento.obtenerDirectorioProveedores();
        const term = terminoFiltro.toLowerCase().trim();

        const filtrados = lista.filter(p => {
            if (!term) return true;
            return (p.nombre && p.nombre.toLowerCase().includes(term)) ||
                   (p.rnc && p.rnc.includes(term)) ||
                   (p.razonSocial && p.razonSocial.toLowerCase().includes(term)) ||
                   (p.contacto && p.contacto.toLowerCase().includes(term));
        });

        if (filtrados.length === 0) {
            contenedor.innerHTML = `<div style="text-align:center;padding:24px;color:var(--color-texto-secundario);">
                <svg class="ico ico-lg" style="opacity:0.4;margin-bottom:8px;"><use href="#i-box"/></svg>
                <div style="font-weight:600;">No se encontraron droguerías o proveedores.</div>
                <div class="fs-xs" style="margin-top:4px;">Presiona "+ Nueva Droguería" para registrar un distribuidor.</div>
            </div>`;
            return;
        }

        const filas = filtrados.map(p => {
            const idEsc = escaparHtml(p.id);
            const rncFmt = p.rnc ? `<span class="badge-radar-costo igual">${escaparHtml(p.rnc)}</span>` : '<span class="text-muted fs-xs">Sin RNC</span>';
            return `<tr>
                <td class="mono" style="font-weight:600;">${rncFmt}</td>
                <td>
                    <strong>${escaparHtml(p.nombre)}</strong>
                    ${p.razonSocial ? `<div class="fs-xs text-muted">${escaparHtml(p.razonSocial)}</div>` : ''}
                </td>
                <td>
                    <div>${escaparHtml(p.telefono || '—')}</div>
                    ${p.contacto ? `<div class="fs-xs text-muted">Cont: ${escaparHtml(p.contacto)}</div>` : ''}
                </td>
                <td class="mono" style="text-align:center;">${p.diasCredito || 30} días</td>
                <td class="mono" style="text-align:right;">${(p.descuentoHabitual || 0).toFixed(2)}%</td>
                <td style="white-space:nowrap;text-align:center;">
                    <div style="display:flex;gap:4px;justify-content:center;">
                        <button type="button" class="action-icon-btn" data-editar-proveedor="${idEsc}" title="Editar Proveedor" aria-label="Editar ${escaparHtml(p.nombre)}">${iconoSvg('edit')}</button>
                        <button type="button" class="action-icon-btn text-danger" data-borrar-proveedor="${idEsc}" title="Eliminar Proveedor" aria-label="Eliminar ${escaparHtml(p.nombre)}">${iconoSvg('trash')}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        contenedor.innerHTML = `
            <div style="font-size:12px;color:var(--color-texto-secundario);padding:6px 0;">
                ${filtrados.length} droguerías y proveedores registrados.
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>RNC</th>
                            <th>Droguería / Razón Social</th>
                            <th>Teléfono / Contacto</th>
                            <th style="text-align:center;">Crédito</th>
                            <th style="text-align:right;">Desc. Base</th>
                            <th style="text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>`;
    }

    // Renderizado del Directorio de Laboratorios Fabricantes
    function renderizarLaboratoriosUI(terminoFiltro = '') {
        const contenedor = el('contenedorLaboratorios');
        if (!contenedor) return;
        const lista = Almacenamiento.obtenerDirectorioLaboratorios();
        const term = terminoFiltro.toLowerCase().trim();

        const filtrados = lista.filter(l => {
            if (!term) return true;
            return (l.nombre && l.nombre.toLowerCase().includes(term)) ||
                   (l.razonSocial && l.razonSocial.toLowerCase().includes(term)) ||
                   (l.titularRegistro && l.titularRegistro.toLowerCase().includes(term));
        });

        if (filtrados.length === 0) {
            contenedor.innerHTML = `<div style="text-align:center;padding:24px;color:var(--color-texto-secundario);">
                <svg class="ico ico-lg" style="opacity:0.4;margin-bottom:8px;"><use href="#i-check"/></svg>
                <div style="font-weight:600;">No se encontraron laboratorios fabricantes.</div>
                <div class="fs-xs" style="margin-top:4px;">Presiona "+ Nuevo Laboratorio" para dar de alta una marca.</div>
            </div>`;
            return;
        }

        const filas = filtrados.map(l => {
            const idEsc = escaparHtml(l.id);
            const origenClase = (l.origen === 'Nacional RD') ? 'badge-radar-costo baja' : 'badge-radar-costo igual';
            return `<tr>
                <td>
                    <strong>${escaparHtml(l.nombre)}</strong>
                    ${l.razonSocial ? `<div class="fs-xs text-muted">${escaparHtml(l.razonSocial)}</div>` : ''}
                </td>
                <td><span class="${origenClase}">${escaparHtml(l.origen || 'Nacional RD')}</span></td>
                <td>${escaparHtml(l.titularRegistro || l.razonSocial || '—')}</td>
                <td>${escaparHtml(l.telefono || '—')}</td>
                <td style="white-space:nowrap;text-align:center;">
                    <div style="display:flex;gap:4px;justify-content:center;">
                        <button type="button" class="action-icon-btn" data-editar-laboratorio="${idEsc}" title="Editar Laboratorio" aria-label="Editar ${escaparHtml(l.nombre)}">${iconoSvg('edit')}</button>
                        <button type="button" class="action-icon-btn text-danger" data-borrar-laboratorio="${idEsc}" title="Eliminar Laboratorio" aria-label="Eliminar ${escaparHtml(l.nombre)}">${iconoSvg('trash')}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        contenedor.innerHTML = `
            <div style="font-size:12px;color:var(--color-texto-secundario);padding:6px 0;">
                ${filtrados.length} laboratorios y fabricantes registrados.
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Laboratorio / Marca</th>
                            <th>Origen</th>
                            <th>Titular / Razón Social</th>
                            <th>Teléfono</th>
                            <th style="text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>`;
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

                    const catSelVal = el('editProdCategoria').value;
                    const catFinal = (catSelVal === '__NUEVA__')
                        ? (el('editProdCategoriaNueva') ? el('editProdCategoriaNueva').value.trim() : 'General / Otros')
                        : catSelVal;

                    const ficha = {
                        codigoBarras: codigo,
                        nombre: nombreNormalizado,
                        categoria: catFinal || 'General / Otros',
                        principioActivo: el('editProdPrincipioActivo').value.trim(),
                        concentracion: el('editProdConcentracion') ? el('editProdConcentracion').value.trim() : '',
                        laboratorio: el('editProdLaboratorio').value.trim(),
                        proveedorHabitual: el('editProdProveedorHabitual') ? el('editProdProveedorHabitual').value.trim() : '',
                        formaFarmaceutica: el('editProdForma') ? el('editProdForma').value : '',
                        presentacion: el('editProdPresentacion') ? el('editProdPresentacion').value.trim() : '',
                        tipo: el('editProdTipo').value,
                        unidadesPorCaja: el('editProdUnidades').value,
                        ultimoPrecioCaja: el('editProdUltimoCosto') ? parseFloat(el('editProdUltimoCosto').value) || 0 : 0,
                        tasaItbis: el('editProdTasaItbis').value,
                        aplicaItbis: Number(el('editProdTasaItbis').value) > 0,
                        condicionVenta: el('editProdCondicion') ? el('editProdCondicion').value : 'OTC',
                        esLeche: Boolean(el('editProdEsLeche') && el('editProdEsLeche').checked),
                        registroSanitario: el('editProdRegistroSanitario').value.trim(),
                        ubicacion: el('editProdUbicacion').value.trim()
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
                    poblarSelectorCategoriasEdicion(prod.categoria || '');
                    el('editProdPrincipioActivo').value = prod.principioActivo || '';
                    if (el('editProdConcentracion')) el('editProdConcentracion').value = prod.concentracion || '';
                    el('editProdLaboratorio').value = prod.laboratorio || '';
                    if (el('editProdProveedorHabitual')) el('editProdProveedorHabitual').value = prod.proveedorHabitual || '';
                    if (el('editProdForma')) el('editProdForma').value = prod.formaFarmaceutica || '';
                    if (el('editProdPresentacion')) el('editProdPresentacion').value = prod.presentacion || '';
                    el('editProdTipo').value = prod.tipo || 'divisible';
                    el('editProdUnidades').value = prod.unidadesPorCaja || 1;
                    if (el('editProdUltimoCosto')) el('editProdUltimoCosto').value = (prod.ultimoPrecioCaja !== undefined) ? Number(prod.ultimoPrecioCaja).toFixed(2) : '0.00';
                    el('editProdTasaItbis').value = String(prod.tasaItbis !== undefined ? prod.tasaItbis : (prod.aplicaItbis ? 18 : 0));
                    if (el('editProdCondicion')) el('editProdCondicion').value = prod.condicionVenta || 'OTC';
                    if (el('editProdEsLeche')) el('editProdEsLeche').checked = Boolean(prod.esLeche);
                    el('editProdRegistroSanitario').value = prod.registroSanitario || '';
                    el('editProdUbicacion').value = prod.ubicacion || '';
                    actualizarDatalistsDirectorios();
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

        // Listener para cambio en selector de categoría terapéutica (desplegar input nueva)
        const selCatModal = el('editProdCategoria');
        if (selCatModal) {
            selCatModal.addEventListener('change', () => {
                const inputNueva = el('editProdCategoriaNueva');
                if (!inputNueva) return;
                if (selCatModal.value === '__NUEVA__') {
                    inputNueva.style.display = 'block';
                    inputNueva.focus();
                } else {
                    inputNueva.style.display = 'none';
                    inputNueva.value = '';
                }
            });
        }

        // Conmutador de Subtabs de Catálogos (Fármacos, Proveedores, Laboratorios)
        const subtabsBtns = document.querySelectorAll('.subtabs-catalogo [data-subtab-cat]');
        subtabsBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const subtab = btn.dataset.subtabCat;
                subtabsBtns.forEach(b => b.classList.remove('activo'));
                btn.classList.add('activo');

                const panelProds = el('panelCatalogoProductos');
                const panelProvs = el('panelCatalogoProveedores');
                const panelLabs = el('panelCatalogoLaboratorios');

                if (panelProds) panelProds.style.display = (subtab === 'productos') ? 'block' : 'none';
                if (panelProvs) panelProvs.style.display = (subtab === 'proveedores') ? 'block' : 'none';
                if (panelLabs) panelLabs.style.display = (subtab === 'laboratorios') ? 'block' : 'none';

                if (subtab === 'proveedores') renderizarProveedoresUI();
                if (subtab === 'laboratorios') renderizarLaboratoriosUI();
            });
        });

        // Búsquedas en tiempo real para Proveedores y Laboratorios
        const inputFiltroProvs = el('filtroBuscadorProveedores');
        if (inputFiltroProvs) inputFiltroProvs.addEventListener('input', () => renderizarProveedoresUI(inputFiltroProvs.value));

        const inputFiltroLabs = el('filtroBuscadorLaboratorios');
        if (inputFiltroLabs) inputFiltroLabs.addEventListener('input', () => renderizarLaboratoriosUI(inputFiltroLabs.value));

        // Gestión Modal: Proveedores / Droguerías
        const modalProv = el('modalEditarProveedor');
        const formProv = el('formEditarProveedor');
        const btnNuevoProv = el('btnNuevoProveedor');
        const btnCerrarProv = el('btnCerrarModalProveedor');
        const btnCancelarProv = el('btnCancelarEditarProveedor');

        const cerrarModalProv = () => { if (modalProv && typeof modalProv.close === 'function') modalProv.close(); };
        if (btnCerrarProv) btnCerrarProv.addEventListener('click', cerrarModalProv);
        if (btnCancelarProv) btnCancelarProv.addEventListener('click', cerrarModalProv);

        if (btnNuevoProv) {
            btnNuevoProv.addEventListener('click', () => {
                if (formProv) formProv.reset();
                if (el('editProvId')) el('editProvId').value = '';
                if (el('tituloModalProveedor')) el('tituloModalProveedor').textContent = 'Nueva Droguería / Proveedor';
                if (modalProv) modalProv.showModal();
            });
        }

        if (formProv) {
            formProv.addEventListener('submit', e => {
                e.preventDefault();
                const rnc = el('editProvRnc').value.trim();
                const nombre = el('editProvNombre').value.trim();
                if (!nombre) return UI.Notificaciones.mostrarMensaje('El nombre de la droguería es obligatorio.', 'error');

                const provData = {
                    id: el('editProvId') ? el('editProvId').value : '',
                    rnc,
                    nombre,
                    razonSocial: el('editProvRazonSocial') ? el('editProvRazonSocial').value.trim() : '',
                    telefono: el('editProvTelefono') ? el('editProvTelefono').value.trim() : '',
                    contacto: el('editProvContacto') ? el('editProvContacto').value.trim() : '',
                    diasCredito: el('editProvDiasCredito') ? parseInt(el('editProvDiasCredito').value, 10) || 30 : 30,
                    descuentoHabitual: el('editProvDescuento') ? parseFloat(el('editProvDescuento').value) || 0 : 0
                };

                const res = Almacenamiento.guardarProveedorEnDirectorio(provData);
                if (res) {
                    cerrarModalProv();
                    renderizarProveedoresUI();
                    actualizarDatalistsDirectorios();
                    UI.Notificaciones.mostrarMensaje('Proveedor "' + provData.nombre + '" guardado con éxito.', 'success');
                } else {
                    UI.Notificaciones.mostrarMensaje('No se pudo guardar el proveedor.', 'error');
                }
            });
        }

        // Click delegation en tabla de proveedores
        const contProvs = el('contenedorProveedores');
        if (contProvs) {
            contProvs.addEventListener('click', async e => {
                const btnEdit = e.target.closest('[data-editar-proveedor]');
                if (btnEdit) {
                    const idProv = btnEdit.dataset.editarProveedor;
                    const provs = Almacenamiento.obtenerDirectorioProveedores();
                    const prov = provs.find(p => p.id === idProv);
                    if (prov && modalProv) {
                        if (el('editProvId')) el('editProvId').value = prov.id || '';
                        if (el('editProvRnc')) el('editProvRnc').value = prov.rnc || '';
                        if (el('editProvNombre')) el('editProvNombre').value = prov.nombre || '';
                        if (el('editProvRazonSocial')) el('editProvRazonSocial').value = prov.razonSocial || '';
                        if (el('editProvTelefono')) el('editProvTelefono').value = prov.telefono || '';
                        if (el('editProvContacto')) el('editProvContacto').value = prov.contacto || '';
                        if (el('editProvDiasCredito')) el('editProvDiasCredito').value = prov.diasCredito || 30;
                        if (el('editProvDescuento')) el('editProvDescuento').value = (prov.descuentoHabitual || 0).toFixed(2);
                        if (el('tituloModalProveedor')) el('tituloModalProveedor').textContent = 'Editar Droguería / Proveedor';
                        modalProv.showModal();
                    }
                    return;
                }
                const btnBorrar = e.target.closest('[data-borrar-proveedor]');
                if (btnBorrar) {
                    const idProv = btnBorrar.dataset.borrarProveedor;
                    const confirmar = await UI.Notificaciones.mostrarConfirmacion('¿Deseas eliminar este proveedor del directorio?', 'Eliminar Proveedor');
                    if (confirmar) {
                        Almacenamiento.eliminarProveedorDeDirectorio(idProv);
                        renderizarProveedoresUI();
                        actualizarDatalistsDirectorios();
                        UI.Notificaciones.mostrarMensaje('Proveedor eliminado.', 'info');
                    }
                }
            });
        }

        // Gestión Modal: Laboratorios Fabricantes
        const modalLab = el('modalEditarLaboratorio');
        const formLab = el('formEditarLaboratorio');
        const btnNuevoLab = el('btnNuevoLaboratorio');
        const btnCerrarLab = el('btnCerrarModalLaboratorio');
        const btnCancelarLab = el('btnCancelarEditarLaboratorio');

        const cerrarModalLab = () => { if (modalLab && typeof modalLab.close === 'function') modalLab.close(); };
        if (btnCerrarLab) btnCerrarLab.addEventListener('click', cerrarModalLab);
        if (btnCancelarLab) btnCancelarLab.addEventListener('click', cerrarModalLab);

        if (btnNuevoLab) {
            btnNuevoLab.addEventListener('click', () => {
                if (formLab) formLab.reset();
                if (el('editLabId')) el('editLabId').value = '';
                if (el('tituloModalLaboratorio')) el('tituloModalLaboratorio').textContent = 'Nuevo Laboratorio Fabricante';
                if (modalLab) modalLab.showModal();
            });
        }

        if (formLab) {
            formLab.addEventListener('submit', e => {
                e.preventDefault();
                const nombre = el('editLabNombre').value.trim();
                if (!nombre) return UI.Notificaciones.mostrarMensaje('El nombre del laboratorio es obligatorio.', 'error');

                const labData = {
                    id: el('editLabId') ? el('editLabId').value : '',
                    nombre,
                    razonSocial: el('editLabRazonSocial') ? el('editLabRazonSocial').value.trim() : '',
                    origen: el('editLabOrigen') ? el('editLabOrigen').value : 'Nacional RD',
                    telefono: el('editLabTelefono') ? el('editLabTelefono').value.trim() : '',
                    titularRegistro: el('editLabTitular') ? el('editLabTitular').value.trim() : ''
                };

                const res = Almacenamiento.guardarLaboratorioEnDirectorio(labData);
                if (res) {
                    cerrarModalLab();
                    renderizarLaboratoriosUI();
                    actualizarDatalistsDirectorios();
                    UI.Notificaciones.mostrarMensaje('Laboratorio "' + labData.nombre + '" guardado con éxito.', 'success');
                } else {
                    UI.Notificaciones.mostrarMensaje('No se pudo guardar el laboratorio.', 'error');
                }
            });
        }

        // Click delegation en tabla de laboratorios
        const contLabs = el('contenedorLaboratorios');
        if (contLabs) {
            contLabs.addEventListener('click', async e => {
                const btnEdit = e.target.closest('[data-editar-laboratorio]');
                if (btnEdit) {
                    const idLab = btnEdit.dataset.editarLaboratorio;
                    const labs = Almacenamiento.obtenerDirectorioLaboratorios();
                    const lab = labs.find(l => l.id === idLab);
                    if (lab && modalLab) {
                        if (el('editLabId')) el('editLabId').value = lab.id || '';
                        if (el('editLabNombre')) el('editLabNombre').value = lab.nombre || '';
                        if (el('editLabRazonSocial')) el('editLabRazonSocial').value = lab.razonSocial || '';
                        if (el('editLabOrigen')) el('editLabOrigen').value = lab.origen || 'Nacional RD';
                        if (el('editLabTelefono')) el('editLabTelefono').value = lab.telefono || '';
                        if (el('editLabTitular')) el('editLabTitular').value = lab.titularRegistro || '';
                        if (el('tituloModalLaboratorio')) el('tituloModalLaboratorio').textContent = 'Editar Laboratorio Fabricante';
                        modalLab.showModal();
                    }
                    return;
                }
                const btnBorrar = e.target.closest('[data-borrar-laboratorio]');
                if (btnBorrar) {
                    const idLab = btnBorrar.dataset.borrarLaboratorio;
                    const confirmar = await UI.Notificaciones.mostrarConfirmacion('¿Deseas eliminar este laboratorio del directorio?', 'Eliminar Laboratorio');
                    if (confirmar) {
                        Almacenamiento.eliminarLaboratorioDeDirectorio(idLab);
                        renderizarLaboratoriosUI();
                        actualizarDatalistsDirectorios();
                        UI.Notificaciones.mostrarMensaje('Laboratorio eliminado.', 'info');
                    }
                }
            });
        }

        // Inicializar Datalists
        actualizarDatalistsDirectorios();
    }

    UI.Diccionario = Object.freeze({
        renderizarDiccionarioUI,
        renderizarProveedoresUI,
        renderizarLaboratoriosUI,
        actualizarDatalistsDirectorios,
        poblarSelectorCategoriasEdicion,
        descargarDiccionarioJson,
        restaurarDiccionarioJson,
        inicializarEventosDiccionario
    });
})(window);
