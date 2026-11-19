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
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const crearIconoSvg = (nombre, clase = 'ico') => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', clase);
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#i-${nombre}`);
        svg.appendChild(use);
        return svg;
    };

    const CLAVE_MODO_ORDEN_CATALOGO = 'calc_orden_catalogo';
    let modoOrdenCatalogo = (() => {
        try {
            const guardado = localStorage.getItem(CLAVE_MODO_ORDEN_CATALOGO);
            return guardado === 'nombre_az' ? 'nombre_az' : 'categoria_az';
        } catch (_) {
            return 'categoria_az';
        }
    })();

    function actualizarBotonOrdenCatalogo() {
        const btn = el('btnAlternarOrdenCatalogo');
        const txt = el('txtOrdenCatalogo');
        const esGlobalAz = modoOrdenCatalogo === 'nombre_az';
        if (txt) {
            txt.textContent = esGlobalAz ? 'Vista: A–Z Global' : 'Vista: Categorías (A–Z)';
        }
        if (btn) {
            btn.setAttribute('aria-pressed', esGlobalAz ? 'true' : 'false');
        }
    }

    function cumpleFiltroItbisCatalogo(item, filtroItbis) {
        if (!filtroItbis) return true;
        const tasa = (item && item.tasaItbis !== undefined && Number.isFinite(Number(item.tasaItbis)))
            ? Number(item.tasaItbis)
            : (item && item.aplicaItbis ? 18 : 0);
        if (filtroItbis === '0') return tasa === 0;
        if (filtroItbis === 'gravados') return tasa > 0;
        if (filtroItbis === '18') return tasa === 18;
        if (filtroItbis === '16') return tasa === 16;
        return true;
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
            'Endocrinología', 'Gastrointestinal & Digestivo', 'Pediatría & Cuidado Infantil',
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

        // Asegurar que todas las macrocategorías canónicas y la del producto actual estén contempladas
        macrosBase.forEach(macro => {
            if (catMap.has(macro) && catMap.get(macro).size === 0) {
                catMap.get(macro).add(macro);
            }
        });
        let encontrada = false;
        if (categoriaSeleccionada) {
            const macroActual = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                ? Dominio.obtenerMacroCategoria(categoriaSeleccionada)
                : 'General / Otros';
            if (!catMap.has(macroActual)) catMap.set(macroActual, new Set());
            catMap.get(macroActual).add(categoriaSeleccionada);
        }

        const fragSel = document.createDocumentFragment();
        const optVacia = document.createElement('option');
        optVacia.value = '';
        optVacia.textContent = '-- Selecciona Categoría Terapéutica --';
        fragSel.appendChild(optVacia);

        const macrosOrdenadas = Array.from(catMap.keys()).sort((a, b) => {
            if (a === 'General / Otros') return 1;
            if (b === 'General / Otros') return -1;
            return a.localeCompare(b, 'es', { sensitivity: 'base' });
        });
        macrosOrdenadas.forEach(macro => {
            const subs = Array.from(catMap.get(macro)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
            if (subs.length > 0) {
                const grp = document.createElement('optgroup');
                grp.label = macro;
                subs.forEach(s => {
                    const isSel = s.toLowerCase() === (categoriaSeleccionada || '').toLowerCase();
                    if (isSel) encontrada = true;
                    const opt = document.createElement('option');
                    opt.value = s;
                    opt.textContent = s;
                    if (isSel) opt.selected = true;
                    grp.appendChild(opt);
                });
                fragSel.appendChild(grp);
            }
        });

        // Opción especial para agregar una categoría que no exista
        const optNueva = document.createElement('option');
        optNueva.value = '__NUEVA__';
        optNueva.textContent = '+ Escribir nueva categoría...';
        if (!encontrada && categoriaSeleccionada) optNueva.selected = true;
        fragSel.appendChild(optNueva);
        sel.replaceChildren(fragSel);

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

    // Renderizado del Directorio de Proveedores / Distribuidores Oficiales
    function renderizarProveedoresUI(terminoFiltro = '') {
        const contenedor = el('contenedorProveedores');
        if (!contenedor) return;

        if (AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado()) {
            contenedor.innerHTML = `<div class="tarjeta-bloqueo-boveda">
                <div style="color:var(--color-alerta);">${iconoSvg('lock')}</div>
                <div><strong>Directorio de Proveedores y Acuerdos Cifrado (AES-256)</strong></div>
                <div class="fs-xs text-muted" style="max-width:430px;margin:4px auto 10px;">
                    Los RNCs, acuerdos comerciales, días de crédito y descuentos pactados con droguerías son secretos privados del negocio. Desbloquea la Bóveda de Administrador para verlos o editarlos.
                </div>
                <button type="button" class="btn-primario" id="btnDesbloquearDesdeProveedores" style="height:32px;padding:0 14px;font-size:12px;">
                    ${iconoSvg('unlock')} <span>Desbloquear Bóveda</span>
                </button>
            </div>`;
            const btnDesbloq = el('btnDesbloquearDesdeProveedores');
            if (btnDesbloq && UI.Seguridad) {
                btnDesbloq.addEventListener('click', () => UI.Seguridad.abrirModalSeguridad('vistaModalDesbloquear'));
            }
            return;
        }

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
                <div style="font-weight:600;">No se encontraron proveedores o distribuidores.</div>
                <div class="fs-xs" style="margin-top:4px;">Presiona "+ Nuevo Proveedor" para registrar un distribuidor.</div>
            </div>`;
            return;
        }

        const filas = filtrados.map(p => {
            const idTarget = p.id || p.rnc || p.nombre;
            const idEsc = escaparHtml(idTarget);
            const rncFmt = p.rnc ? `<span class="badge-radar-costo igual">${escaparHtml(p.rnc)}</span>` : '<span class="text-muted fs-xs">Sin RNC</span>';
            return `<tr>
                <td class="mono" style="font-weight:600;">${rncFmt}</td>
                <td data-editar-proveedor="${idEsc}" style="cursor:pointer;" title="Clic para editar datos de este proveedor">
                    <strong style="color:var(--color-accion);display:inline-block;">${escaparHtml(p.nombre)}</strong>
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
            <div style="font-size:12px;color:var(--color-texto-secundario);padding:6px 0;display:flex;justify-content:space-between;align-items:center;">
                <span><strong>${filtrados.length}</strong> proveedores y distribuidores registrados.</span>
                <span class="fs-xs text-muted">Haz clic en el nombre o en el lápiz para editar.</span>
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>RNC</th>
                            <th>Proveedor / Distribuidor</th>
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
                <td data-editar-laboratorio="${idEsc}" style="cursor:pointer;" title="Clic para editar laboratorio">
                    <strong style="color:var(--color-accion);display:inline-block;">${escaparHtml(l.nombre)}</strong>
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

    let ultimaVersionCatDic = -1;
    let ultimoConteoCatDic = -1;

    function crearBadgeCatalogo(texto, estiloCss, titulo = '') {
        const span = document.createElement('span');
        span.className = 'badge';
        span.style.cssText = estiloCss;
        span.textContent = texto;
        if (titulo) span.title = titulo;
        return span;
    }

    function renderizarDiccionarioUI(filtroTermino, filtroCategoria, filtroItbis) {
        const contenedor = el('contenedorDiccionario');
        if (!contenedor) return;
        const inputFiltro = el('filtroBuscadorDiccionario');
        const selCat = el('filtroCategoriaDiccionario');
        const selItbis = el('filtroItbisDiccionario');

        const terminoEfectivo = filtroTermino !== undefined ? String(filtroTermino) : (inputFiltro ? inputFiltro.value : '');
        const catFiltroEfectivo = filtroCategoria !== undefined ? String(filtroCategoria) : (selCat ? selCat.value : '');
        const itbisFiltroEfectivo = filtroItbis !== undefined ? String(filtroItbis) : (selItbis ? selItbis.value : '');

        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const todosLosItems = Object.values(diccionario || {});

        // 1. Actualizar selector de macrocategorías limpias (A-Z, 'General / Otros' al final) solo si cambió el catálogo
        const versionDic = (Almacenamiento && typeof Almacenamiento.obtenerVersionDiccionario === 'function')
            ? Almacenamiento.obtenerVersionDiccionario()
            : -1;
        if (selCat && (versionDic === -1 || versionDic !== ultimaVersionCatDic || todosLosItems.length !== ultimoConteoCatDic)) {
            ultimaVersionCatDic = versionDic;
            ultimoConteoCatDic = todosLosItems.length;
            const catActualSeleccionada = catFiltroEfectivo || selCat.value || '';
            const macroMap = new Map();

            for (let i = 0; i < todosLosItems.length; i++) {
                const p = todosLosItems[i];
                const subCat = (p && p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                    ? Dominio.obtenerMacroCategoria(subCat)
                    : subCat;
                macroMap.set(macro, (macroMap.get(macro) || 0) + 1);
            }

            const macrosOrdenadas = Array.from(macroMap.keys()).sort((a, b) => {
                if (a === 'General / Otros') return 1;
                if (b === 'General / Otros') return -1;
                return a.localeCompare(b, 'es', { sensitivity: 'base' });
            });

            const fragOpts = document.createDocumentFragment();
            const optTodas = document.createElement('option');
            optTodas.value = '';
            optTodas.textContent = `Todas las categorías (${todosLosItems.length})`;
            fragOpts.appendChild(optTodas);

            macrosOrdenadas.forEach(macro => {
                const count = macroMap.get(macro) || 0;
                const opt = document.createElement('option');
                opt.value = `macro:${macro}`;
                opt.textContent = `${macro} (${count})`;
                if (catActualSeleccionada === `macro:${macro}` || catActualSeleccionada === macro) {
                    opt.selected = true;
                }
                fragOpts.appendChild(opt);
            });
            selCat.replaceChildren(fragOpts);
        }

        // 2. Filtrado por categoría, régimen ITBIS y término de búsqueda
        const qTerm = terminoEfectivo.trim();
        let listaItems;

        if (!catFiltroEfectivo && !itbisFiltroEfectivo && qTerm.length >= 2 &&
            Almacenamiento && typeof Almacenamiento.buscarProductosEnDiccionarioRapido === 'function') {
            listaItems = Almacenamiento.buscarProductosEnDiccionarioRapido(qTerm, 150);
        } else {
            listaItems = todosLosItems.slice();
            if (catFiltroEfectivo) {
                if (catFiltroEfectivo.startsWith('macro:')) {
                    const targetMacro = catFiltroEfectivo.slice(6);
                    listaItems = listaItems.filter(p => {
                        const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                        return (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                            ? Dominio.obtenerMacroCategoria(c) === targetMacro
                            : c === targetMacro;
                    });
                } else if (catFiltroEfectivo.startsWith('sub:')) {
                    const targetSub = catFiltroEfectivo.slice(4).toLowerCase();
                    listaItems = listaItems.filter(p => {
                        const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                        return c.toLowerCase() === targetSub;
                    });
                } else {
                    const target = catFiltroEfectivo.toLowerCase();
                    listaItems = listaItems.filter(p => {
                        const c = (p.categoria && p.categoria.trim()) ? p.categoria.trim() : 'General / Otros';
                        const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                            ? Dominio.obtenerMacroCategoria(c).toLowerCase()
                            : '';
                        return c.toLowerCase() === target || macro === target;
                    });
                }
            }

            if (itbisFiltroEfectivo) {
                listaItems = listaItems.filter(p => cumpleFiltroItbisCatalogo(p, itbisFiltroEfectivo));
            }

            if (qTerm.length >= 2) {
                listaItems = (Dominio && typeof Dominio.buscarEnCatalogoFuzzy === 'function')
                    ? Dominio.buscarEnCatalogoFuzzy(qTerm, listaItems, 150)
                    : listaItems.filter(p => (p.nombre && p.nombre.toLowerCase().includes(qTerm.toLowerCase())) || (p.codigoBarras && p.codigoBarras.includes(qTerm)));
            }
        }

        if (!listaItems.length) {
            const vacio = document.createElement('div');
            vacio.className = 'text-center p-18 text-muted';
            vacio.textContent = (qTerm || catFiltroEfectivo || itbisFiltroEfectivo)
                ? 'No se encontraron productos coincidentes con los filtros aplicados.'
                : 'Aún no hay productos memorizados. Escanea o agrega un producto con nombre en la calculadora para catalogarlo.';
            contenedor.replaceChildren(vacio);
            return;
        }

        // 3. ORDENACIÓN DETERMINÍSTICA: por Macrocategoría (A-Z) + Nombre Ascendente (A-Z), o A-Z Global
        const ordenFinal = (Dominio && typeof Dominio.ordenarProductosCatalogo === 'function')
            ? Dominio.ordenarProductosCatalogo(listaItems, { modoOrden: modoOrdenCatalogo })
            : listaItems.slice();

        // Pre-contar por macrocategoría en el resultado visible para mostrar conteo en encabezados
        const conteoVisiblePorMacro = new Map();
        ordenFinal.forEach(item => {
            const macro = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                ? Dominio.obtenerMacroCategoria(item.categoria)
                : ((item.categoria && item.categoria.trim()) || 'General / Otros');
            conteoVisiblePorMacro.set(macro, (conteoVisiblePorMacro.get(macro) || 0) + 1);
        });

        // 4. Construcción DOM segura (DocumentFragment, cero innerHTML dinámico)
        const fragContenedor = document.createDocumentFragment();

        const barraEstado = document.createElement('div');
        barraEstado.style.cssText = 'font-size:12px;color:var(--color-texto-secundario);padding:4px 0 8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;';
        const spanResumen = document.createElement('span');
        const textoGrupos = modoOrdenCatalogo === 'categoria_az'
            ? ` en ${conteoVisiblePorMacro.size} categoría${conteoVisiblePorMacro.size === 1 ? '' : 's'}`
            : '';
        spanResumen.textContent = `Mostrando ${ordenFinal.length} producto${ordenFinal.length === 1 ? '' : 's'}${textoGrupos} • Orden: ${modoOrdenCatalogo === 'nombre_az' ? 'Nombre Global (A–Z)' : 'Categoría → Nombre (A–Z)'}`;
        barraEstado.appendChild(spanResumen);
        fragContenedor.appendChild(barraEstado);

        const tablaWrap = document.createElement('div');
        tablaWrap.className = 'table-responsive';
        const tabla = document.createElement('table');

        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        ['Código de Barras', 'Producto / Laboratorio', 'Categoría / Tipo', 'Trae x Caja', 'Último Costo Caja', 'Acciones'].forEach(colTitulo => {
            const th = document.createElement('th');
            th.textContent = colTitulo;
            trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        tabla.appendChild(thead);

        const tbody = document.createElement('tbody');
        const estaBloqueado = Boolean(AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado());
        const mostrarEncabezadosGrupo = modoOrdenCatalogo === 'categoria_az' && !qTerm;
        let ultimaMacro = null;

        ordenFinal.forEach(item => {
            const cod = item.codigoBarras || '';
            const subCatRaw = (item.categoria && item.categoria.trim()) ? item.categoria.trim() : '';
            const macroActual = (Dominio && typeof Dominio.obtenerMacroCategoria === 'function')
                ? Dominio.obtenerMacroCategoria(subCatRaw)
                : (subCatRaw || 'General / Otros');

            if (mostrarEncabezadosGrupo && macroActual !== ultimaMacro) {
                ultimaMacro = macroActual;
                const trGrupo = document.createElement('tr');
                trGrupo.className = 'fila-grupo-categoria';
                const tdGrupo = document.createElement('td');
                tdGrupo.colSpan = 6;
                tdGrupo.style.cssText = 'background:var(--color-fondo-panel);font-weight:700;font-size:12px;color:var(--color-primario);padding:8px 12px;border-top:1.5px solid var(--color-borde);border-bottom:1px solid var(--color-borde);';
                const totalGrupo = conteoVisiblePorMacro.get(macroActual) || 0;
                tdGrupo.textContent = `${macroActual} (${totalGrupo})`;
                trGrupo.appendChild(tdGrupo);
                tbody.appendChild(trGrupo);
            }

            const tr = document.createElement('tr');

            // Columna 1: Código de barras (+ badge Interno si es prefijo 200...)
            const tdCod = document.createElement('td');
            tdCod.className = 'mono';
            tdCod.appendChild(document.createTextNode(cod));
            if (Dominio && typeof Dominio.esCodigoBarrasInterno === 'function' && Dominio.esCodigoBarrasInterno(cod)) {
                tdCod.appendChild(document.createElement('br'));
                tdCod.appendChild(crearBadgeCatalogo(
                    'Interno',
                    'font-size:9px;background:var(--color-superficie-resaltada);border:1px solid var(--color-borde-fuerte);color:var(--color-texto-secundario);padding:1px 5px;border-radius:3px;',
                    'Código interno GS1 (prefijo 200) asignado automáticamente'
                ));
            }
            tr.appendChild(tdCod);

            // Columna 2: Nombre + badges fiscales + subtítulo
            const tdNom = document.createElement('td');
            const nombreTexto = item.nombre || item.nombreComercial || 'Producto sin nombre';
            const strongNom = document.createElement('strong');
            strongNom.textContent = nombreTexto;
            tdNom.appendChild(strongNom);

            if (item.esLeche) {
                tdNom.appendChild(crearBadgeCatalogo(
                    'Leche 10%',
                    'font-size:10px;background:var(--color-primario-fondo);color:var(--color-primario);padding:1px 5px;border-radius:3px;margin-left:4px;'
                ));
            }

            const tasaItbis = (item.tasaItbis !== undefined && Number.isFinite(Number(item.tasaItbis)))
                ? Number(item.tasaItbis)
                : (item.aplicaItbis ? 18 : 0);
            if (tasaItbis > 0) {
                tdNom.appendChild(crearBadgeCatalogo(
                    `+${tasaItbis}% ITBIS`,
                    'font-size:10px;background:var(--color-alerta-fondo);color:var(--color-alerta);padding:1px 5px;border-radius:3px;margin-left:4px;'
                ));
            } else {
                tdNom.appendChild(crearBadgeCatalogo(
                    'Exento 0%',
                    'font-size:10px;background:var(--color-exito-fondo);color:var(--color-exito);padding:1px 5px;border-radius:3px;margin-left:4px;',
                    'Exento de ITBIS (0%)'
                ));
            }

            const subtitulo = [item.principioActivo, item.laboratorio].filter(Boolean).join(' • ');
            if (subtitulo) {
                const divSub = document.createElement('div');
                divSub.style.cssText = 'font-size:11px;color:var(--color-texto-secundario);';
                divSub.textContent = subtitulo;
                tdNom.appendChild(divSub);
            }
            tr.appendChild(tdNom);

            // Columna 3: Categoría limpia + detalle + tipo
            const tdCat = document.createElement('td');
            const spanMacro = document.createElement('span');
            spanMacro.style.cssText = 'font-size:11px;font-weight:600;color:var(--color-texto-principal);';
            spanMacro.textContent = macroActual;
            tdCat.appendChild(spanMacro);
            if (subCatRaw && subCatRaw.toLowerCase() !== macroActual.toLowerCase()) {
                const divSubCat = document.createElement('div');
                divSubCat.style.cssText = 'font-size:10px;color:var(--color-texto-secundario);';
                divSubCat.textContent = subCatRaw;
                tdCat.appendChild(divSubCat);
            } else {
                tdCat.appendChild(document.createElement('br'));
            }
            const spanTipo = document.createElement('span');
            spanTipo.style.cssText = 'font-size:10px;color:var(--color-texto-secundario);';
            spanTipo.textContent = item.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero';
            tdCat.appendChild(spanTipo);
            tr.appendChild(tdCat);

            // Columna 4: Unidades por caja
            const tdUnid = document.createElement('td');
            tdUnid.className = 'mono';
            tdUnid.textContent = String(item.unidadesPorCaja || 1);
            tr.appendChild(tdUnid);

            // Columna 5: Último Costo Caja (con hidratación JIT si Admin activo)
            const tdCosto = document.createElement('td');
            tdCosto.className = 'mono';
            if (estaBloqueado) {
                const spanBloq = document.createElement('span');
                spanBloq.className = 'badge-cifrado-celda';
                spanBloq.title = 'Costo cifrado con AES-256. Desbloquea Admin para visualizar.';
                spanBloq.appendChild(crearIconoSvg('lock'));
                spanBloq.appendChild(document.createTextNode(' Cifrado'));
                tdCosto.appendChild(spanBloq);
            } else {
                const spanCosto = document.createElement('span');
                spanCosto.setAttribute('data-celda-costo-cod', cod);
                const tieneCostoLocal = item.ultimoPrecioCaja !== undefined && item.ultimoPrecioCaja !== null && Number(item.ultimoPrecioCaja) > 0;
                if (tieneCostoLocal) {
                    spanCosto.textContent = `$${Number(item.ultimoPrecioCaja).toFixed(2)}`;
                    if (item.variacionCosto && Number(item.variacionCosto) !== 0) {
                        const varNum = Number(item.variacionCosto);
                        const bg = varNum > 0 ? '#fee2e2' : '#dcfce7';
                        const color = varNum > 0 ? '#dc2626' : '#16a34a';
                        spanCosto.appendChild(crearBadgeCatalogo(
                            `${varNum > 0 ? '+' : ''}${varNum}%`,
                            `font-size:9px;background:${bg};color:${color};padding:1px 4px;border-radius:3px;margin-left:4px;`,
                            'Variación respecto a la compra anterior'
                        ));
                    }
                } else {
                    spanCosto.textContent = '—';
                }
                tdCosto.appendChild(spanCosto);
            }
            tr.appendChild(tdCosto);

            // Columna 6: Acciones
            const tdAcc = document.createElement('td');
            tdAcc.style.whiteSpace = 'nowrap';
            const divAcc = document.createElement('div');
            divAcc.style.cssText = 'display:flex;gap:4px;align-items:center;';

            const btnUsar = document.createElement('button');
            btnUsar.type = 'button';
            btnUsar.className = 'action-icon-btn';
            btnUsar.setAttribute('data-usar-codigo', cod);
            btnUsar.title = 'Cargar en Calculadora';
            btnUsar.setAttribute('aria-label', `Cargar ${nombreTexto} en calculadora`);
            btnUsar.appendChild(crearIconoSvg('calc'));

            const btnEditar = document.createElement('button');
            btnEditar.type = 'button';
            btnEditar.className = 'action-icon-btn';
            btnEditar.setAttribute('data-editar-ficha', cod);
            btnEditar.title = 'Editar Ficha en Catálogo';
            btnEditar.setAttribute('aria-label', `Editar ficha de ${nombreTexto}`);
            btnEditar.appendChild(crearIconoSvg('edit'));

            const btnBorrar = document.createElement('button');
            btnBorrar.type = 'button';
            btnBorrar.className = 'action-icon-btn text-danger';
            btnBorrar.setAttribute('data-borrar-codigo', cod);
            btnBorrar.title = 'Eliminar del Catálogo';
            btnBorrar.setAttribute('aria-label', `Eliminar código ${cod}`);
            btnBorrar.appendChild(crearIconoSvg('trash'));

            divAcc.append(btnUsar, btnEditar, btnBorrar);
            tdAcc.appendChild(divAcc);
            tr.appendChild(tdAcc);

            tbody.appendChild(tr);
        });

        tabla.appendChild(tbody);
        tablaWrap.appendChild(tabla);
        fragContenedor.appendChild(tablaWrap);
        contenedor.replaceChildren(fragContenedor);

        // Hidratación puntual de costos para tabla solo si Administrador está desbloqueado
        if (AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && !AppFarmacia.Seguridad.estaBloqueado() &&
            typeof Almacenamiento.obtenerResumenCostosTablaSiAdmin === 'function') {
            Almacenamiento.obtenerResumenCostosTablaSiAdmin().then(mapaCostos => {
                if (!contenedor || !mapaCostos || !mapaCostos.size) return;
                if (AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaBloqueado()) return;
                contenedor.querySelectorAll('[data-celda-costo-cod]').forEach(celda => {
                    const codItem = celda.getAttribute('data-celda-costo-cod');
                    const info = mapaCostos.get(codItem);
                    if (info && info.ultimoPrecioCaja !== undefined && Number(info.ultimoPrecioCaja) > 0) {
                        const nodos = [document.createTextNode(`$${Number(info.ultimoPrecioCaja).toFixed(2)}`)];
                        if (info.variacionCosto && Number(info.variacionCosto) !== 0) {
                            const v = Number(info.variacionCosto);
                            const bg = v > 0 ? '#fee2e2' : '#dcfce7';
                            const col = v > 0 ? '#dc2626' : '#16a34a';
                            nodos.push(crearBadgeCatalogo(
                                `${v > 0 ? '+' : ''}${v}%`,
                                `font-size:9px;background:${bg};color:${col};padding:1px 4px;border-radius:3px;margin-left:4px;`
                            ));
                        }
                        celda.replaceChildren(...nodos);
                    } else {
                        celda.textContent = '—';
                    }
                });
            }).catch(() => {});
        }
    }

    function descargarDiccionarioJson() {
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        if (Object.keys(diccionario).length === 0) {
            return UI.Notificaciones.mostrarMensaje('El diccionario de códigos está vacío. No hay datos para descargar.', 'error');
        }
        // Purga en caliente: elimina costos, márgenes, historial financiero y proveedores privados
        const diccionarioSanitario = Dominio.sanitizarDiccionarioPublico(diccionario);
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            sanitizadoPublico: true,
            diccionario: diccionarioSanitario
        }, `catalogo-sanitario-farmacia-${Dominio.obtenerFechaLocalISO()}.json`, CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS);
        UI.Notificaciones.mostrarMensaje('Catálogo Sanitario Público descargado (costos y proveedores purgados).', 'success');
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
                throw new Error('Archivo de respaldo completo no compatible con la importación sanitaria.');
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
                UI.Notificaciones.mostrarMensaje(`Catálogo Sanitario Público (${res.totalProductos} productos) exportado en CSV sin costos ni proveedores.`, 'success');
            });
        }

        const inputFiltro = el('filtroBuscadorDiccionario');
        const selCat = el('filtroCategoriaDiccionario');
        const selItbis = el('filtroItbisDiccionario');
        const btnOrdenCat = el('btnAlternarOrdenCatalogo');

        const aplicarFiltrosDiccionario = () => {
            const termino = inputFiltro ? inputFiltro.value.trim() : '';
            const cat = selCat ? selCat.value : '';
            const itbis = selItbis ? selItbis.value : '';
            renderizarDiccionarioUI(termino, cat, itbis);
        };

        actualizarBotonOrdenCatalogo();
        if (btnOrdenCat) {
            btnOrdenCat.addEventListener('click', () => {
                modoOrdenCatalogo = (modoOrdenCatalogo === 'nombre_az') ? 'categoria_az' : 'nombre_az';
                try { localStorage.setItem(CLAVE_MODO_ORDEN_CATALOGO, modoOrdenCatalogo); } catch (_) {}
                actualizarBotonOrdenCatalogo();
                aplicarFiltrosDiccionario();
            });
        }

        let temporizadorFiltroDic = null;
        if (inputFiltro) {
            inputFiltro.addEventListener('input', () => {
                if (temporizadorFiltroDic) clearTimeout(temporizadorFiltroDic);
                temporizadorFiltroDic = setTimeout(() => {
                    temporizadorFiltroDic = null;
                    aplicarFiltrosDiccionario();
                }, 150);
            });
        }
        if (selCat) selCat.addEventListener('change', aplicarFiltrosDiccionario);
        if (selItbis) selItbis.addEventListener('change', aplicarFiltrosDiccionario);

        // Diálogo Modal de Edición de Ficha Maestra
        const modalEdit = el('modalEditarProductoDiccionario');
        const btnCerrarEdit = el('btnCerrarModalEditarProducto');
        const btnCancelarEdit = el('btnCancelarEditarProducto');
        const formEdit = el('formEditarFichaProducto');

        function limpiarErrorModalProducto() {
            const boxErr = el('errorModalEditarProducto');
            if (boxErr) {
                boxErr.style.display = 'none';
                boxErr.classList.remove('mostrar');
                boxErr.textContent = '';
            }
            if (formEdit) {
                formEdit.querySelectorAll('[aria-invalid]').forEach(campo => {
                    campo.removeAttribute('aria-invalid');
                    if (campo.id === 'editProdCodigo') {
                        campo.setAttribute('aria-describedby', 'hintEditProdCodigo');
                    } else if (campo.getAttribute('aria-describedby') === 'errorModalEditarProducto') {
                        campo.removeAttribute('aria-describedby');
                    }
                });
            }
        }

        function mostrarErrorModalProducto(mensaje, idCampo) {
            const boxErr = el('errorModalEditarProducto');
            if (boxErr) {
                boxErr.textContent = String(mensaje || '');
                boxErr.className = 'alert-banner alert-error mostrar';
                boxErr.style.display = 'flex';
            }
            if (idCampo) {
                const campo = el(idCampo);
                if (campo) {
                    campo.setAttribute('aria-invalid', 'true');
                    campo.setAttribute(
                        'aria-describedby',
                        campo.id === 'editProdCodigo'
                            ? 'hintEditProdCodigo errorModalEditarProducto'
                            : 'errorModalEditarProducto'
                    );
                    campo.focus();
                    if (typeof campo.select === 'function') campo.select();
                }
            }
        }

        function sincronizarUnidadesModalProducto() {
            const selTipo = el('editProdTipo');
            const inpUnid = el('editProdUnidades');
            if (!selTipo || !inpUnid) return;
            if (selTipo.value === CONSTANTES.CATEGORIAS.ENTERO) {
                inpUnid.value = '1';
                inpUnid.min = '1';
                inpUnid.disabled = true;
            } else {
                inpUnid.disabled = false;
                inpUnid.min = '2';
                if (!inpUnid.value || Number(inpUnid.value) < 1) {
                    inpUnid.value = '1';
                }
            }
        }

        let temporizadorAutoFicha = null;
        function limpiarFlagsAutocompletado() {
            if (temporizadorAutoFicha) {
                clearTimeout(temporizadorAutoFicha);
                temporizadorAutoFicha = null;
            }
            if (formEdit) {
                formEdit.querySelectorAll('[data-auto-completado], [data-auto-elegible]').forEach(nodo => {
                    delete nodo.dataset.autoCompletado;
                    delete nodo.dataset.autoElegible;
                });
            }
            const hintAuto = el('hintAutoCompletadoFicha');
            if (hintAuto) {
                hintAuto.style.display = 'none';
                hintAuto.textContent = '';
            }
        }

        function marcarAutocompletado(campo, valor, etiquetaResumen, resumenLista) {
            if (!campo || valor === undefined || valor === null || valor === '') return false;
            const actual = String(campo.value || '').trim();
            const esAuto = campo.dataset && campo.dataset.autoCompletado === 'true';
            if (actual !== '' && !esAuto) return false;
            if (actual === String(valor)) return false;
            campo.value = String(valor);
            campo.dataset.autoCompletado = 'true';
            if (etiquetaResumen && Array.isArray(resumenLista)) {
                resumenLista.push(`${etiquetaResumen} (${valor})`);
            }
            return true;
        }

        function seleccionarCategoriaAutocompletada(catDetectada, resumenLista) {
            const selCat = el('editProdCategoria');
            if (!selCat || !catDetectada) return false;
            const valActual = String(selCat.value || '').trim();
            const esAuto = selCat.dataset && selCat.dataset.autoCompletado === 'true';
            const estaVacioODefault = !valActual || valActual === 'General / Otros';
            if (!estaVacioODefault && !esAuto) return false;

            const opciones = Array.from(selCat.options || []);
            const norm = t => String(t || '').toLowerCase().trim();
            let matchOpt = opciones.find(o => norm(o.value) === norm(catDetectada));
            if (!matchOpt && Dominio && typeof Dominio.obtenerMacroCategoria === 'function') {
                const macroObj = Dominio.obtenerMacroCategoria(catDetectada);
                matchOpt = opciones.find(o => norm(o.value) === norm(macroObj));
            }
            if (!matchOpt || !matchOpt.value) return false;
            if (norm(valActual) === norm(matchOpt.value)) return false;
            selCat.value = matchOpt.value;
            selCat.dataset.autoCompletado = 'true';
            if (el('editProdCategoriaNueva')) {
                el('editProdCategoriaNueva').style.display = 'none';
                el('editProdCategoriaNueva').value = '';
            }
            if (Array.isArray(resumenLista)) resumenLista.push(`Categoría (${matchOpt.value})`);
            return true;
        }

        function aplicarAutocompletadoDesdeNombre() {
            const inpNom = el('editProdNombre');
            if (!inpNom || !Dominio || typeof Dominio.extraerMetadatosDesdeNombre !== 'function') return;

            const meta = Dominio.extraerMetadatosDesdeNombre(inpNom.value, {
                laboratorios: typeof Almacenamiento.obtenerDirectorioLaboratorios === 'function' ? Almacenamiento.obtenerDirectorioLaboratorios() : [],
                vademecum: typeof Almacenamiento.obtenerVademecumMaestro === 'function' ? Almacenamiento.obtenerVademecumMaestro() : []
            });

            const resumen = [];
            marcarAutocompletado(el('editProdConcentracion'), meta.concentracion, 'Dosis', resumen);
            marcarAutocompletado(el('editProdLaboratorio'), meta.laboratorio, 'Laboratorio', resumen);
            marcarAutocompletado(el('editProdPrincipioActivo'), meta.principioActivo, 'Principio Activo', resumen);
            seleccionarCategoriaAutocompletada(meta.categoria, resumen);
            marcarAutocompletado(el('editProdForma'), meta.formaFarmaceutica, 'Forma', resumen);
            marcarAutocompletado(el('editProdPresentacion'), meta.presentacion, 'Presentación', resumen);
            marcarAutocompletado(el('editProdRegistroSanitario'), meta.registroSanitario, 'Registro', resumen);

            const selTipo = el('editProdTipo');
            if (selTipo && meta.tipo && (selTipo.dataset.autoElegible === 'true' || selTipo.dataset.autoCompletado === 'true')) {
                if (selTipo.value !== meta.tipo) {
                    selTipo.value = meta.tipo;
                    selTipo.dataset.autoCompletado = 'true';
                    resumen.push(`Venta (${meta.tipo === CONSTANTES.CATEGORIAS.ENTERO ? 'Entero' : 'Divisible'})`);
                }
                sincronizarUnidadesModalProducto();
            }

            const inpUnid = el('editProdUnidades');
            if (inpUnid && meta.unidadesPorCaja && !inpUnid.disabled &&
                (inpUnid.dataset.autoElegible === 'true' || inpUnid.dataset.autoCompletado === 'true' || Number(inpUnid.value) <= 1)) {
                if (Number(inpUnid.value) !== Number(meta.unidadesPorCaja)) {
                    inpUnid.value = String(meta.unidadesPorCaja);
                    inpUnid.dataset.autoCompletado = 'true';
                    resumen.push(`Trae x Caja (${meta.unidadesPorCaja})`);
                }
            }

            const selItbis = el('editProdTasaItbis');
            if (selItbis && meta.tasaItbis !== undefined && (selItbis.dataset.autoElegible === 'true' || selItbis.dataset.autoCompletado === 'true')) {
                if (selItbis.value !== String(meta.tasaItbis)) {
                    selItbis.value = String(meta.tasaItbis);
                    selItbis.dataset.autoCompletado = 'true';
                    resumen.push(`ITBIS (${meta.tasaItbis}%)`);
                }
            }

            const selCond = el('editProdCondicion');
            if (selCond && meta.condicionVenta && (selCond.dataset.autoElegible === 'true' || selCond.dataset.autoCompletado === 'true')) {
                if (selCond.value !== meta.condicionVenta) {
                    selCond.value = meta.condicionVenta;
                    selCond.dataset.autoCompletado = 'true';
                    resumen.push(`Condición (${meta.condicionVenta})`);
                }
            }

            const chkLeche = el('editProdEsLeche');
            if (chkLeche && meta.esLeche && (chkLeche.dataset.autoElegible === 'true' || chkLeche.dataset.autoCompletado === 'true')) {
                if (!chkLeche.checked) {
                    chkLeche.checked = true;
                    chkLeche.dataset.autoCompletado = 'true';
                    resumen.push('Leche (10%)');
                }
            }

            const hintAuto = el('hintAutoCompletadoFicha');
            if (hintAuto) {
                if (resumen.length > 0) {
                    hintAuto.textContent = 'Autocompletado desde nombre: ' + resumen.join(', ');
                    hintAuto.style.display = 'block';
                } else if (!inpNom.value.trim()) {
                    hintAuto.textContent = '';
                    hintAuto.style.display = 'none';
                }
            }
        }

        const cerrarModalEdit = () => {
            limpiarErrorModalProducto();
            limpiarFlagsAutocompletado();
            if (modalEdit && typeof modalEdit.close === 'function') modalEdit.close();
        };

        if (btnCerrarEdit) btnCerrarEdit.addEventListener('click', cerrarModalEdit);
        if (btnCancelarEdit) btnCancelarEdit.addEventListener('click', cerrarModalEdit);

        if (typeof UI.configurarFiltroNumerico === 'function' && el('editProdCodigo')) {
            UI.configurarFiltroNumerico(el('editProdCodigo'), false);
        }
        if (el('editProdTipo')) {
            el('editProdTipo').addEventListener('change', sincronizarUnidadesModalProducto);
        }

        let guardandoFichaEnCurso = false;
        if (formEdit) {
            const limpiarErrorDeCampoEditado = ev => {
                const target = ev && ev.target;
                if (target && typeof target.removeAttribute === 'function') {
                    target.removeAttribute('aria-invalid');
                    if (target.id === 'editProdCodigo') {
                        target.setAttribute('aria-describedby', 'hintEditProdCodigo');
                    } else if (target.getAttribute('aria-describedby') === 'errorModalEditarProducto') {
                        target.removeAttribute('aria-describedby');
                    }
                    if (target.id && target.id !== 'editProdNombre' && target.dataset) {
                        delete target.dataset.autoCompletado;
                        delete target.dataset.autoElegible;
                    }
                }
                const boxErr = el('errorModalEditarProducto');
                if (boxErr && boxErr.style.display !== 'none') {
                    boxErr.style.display = 'none';
                    boxErr.classList.remove('mostrar');
                    boxErr.textContent = '';
                }
            };
            formEdit.addEventListener('input', limpiarErrorDeCampoEditado);
            formEdit.addEventListener('change', limpiarErrorDeCampoEditado);

            const inpEditNombre = el('editProdNombre');
            if (inpEditNombre) {
                inpEditNombre.addEventListener('input', () => {
                    if (temporizadorAutoFicha) clearTimeout(temporizadorAutoFicha);
                    temporizadorAutoFicha = setTimeout(aplicarAutocompletadoDesdeNombre, 220);
                });
                inpEditNombre.addEventListener('blur', () => {
                    if (temporizadorAutoFicha) {
                        clearTimeout(temporizadorAutoFicha);
                        temporizadorAutoFicha = null;
                    }
                    aplicarAutocompletadoDesdeNombre();
                });
            }

            formEdit.addEventListener('submit', async e => {
                e.preventDefault();
                if (guardandoFichaEnCurso) return;
                aplicarAutocompletadoDesdeNombre();
                const btnSubmit = formEdit.querySelector('button[type="submit"]');
                limpiarErrorModalProducto();
                try {
                    guardandoFichaEnCurso = true;
                    if (btnSubmit) {
                        btnSubmit.disabled = true;
                        btnSubmit.classList.add('btn-loading');
                    }

                    const estaBloqueado = Boolean(AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado());
                    const inputCod = el('editProdCodigo');
                    const codigoNuevo = Dominio.normalizarCodigoBarras(inputCod ? inputCod.value : '');
                    const codigoOriginal = Dominio.normalizarCodigoBarras((inputCod && inputCod.dataset && inputCod.dataset.codigoOriginal) || codigoNuevo);

                    if (!codigoNuevo) {
                        mostrarErrorModalProducto('El código de barras no puede estar vacío.', 'editProdCodigo');
                        return;
                    }

                    if (codigoNuevo !== codigoOriginal) {
                        if (estaBloqueado) {
                            mostrarErrorModalProducto('Debes activar la sesión de Administrador para editar el código de barras.', 'editProdCodigo');
                            return;
                        }
                        const valGs1 = Dominio.validarCodigoBarrasEstandar(codigoNuevo);
                        if (!valGs1.esValido) {
                            mostrarErrorModalProducto(valGs1.error, 'editProdCodigo');
                            return;
                        }
                        const dicActual = Almacenamiento.obtenerDiccionarioCodigos();
                        if (dicActual[codigoNuevo]) {
                            mostrarErrorModalProducto(
                                `Ya existe otro producto registrado con el código ${codigoNuevo} ("${dicActual[codigoNuevo].nombre || 'Sin nombre'}").`,
                                'editProdCodigo'
                            );
                            return;
                        }
                    }

                    const nombreCrudo = el('editProdNombre').value.trim();
                    const nombreNormalizado = nombreCrudo
                        ? ((Dominio && typeof Dominio.normalizarNombreProductoMayusculas === 'function')
                            ? Dominio.normalizarNombreProductoMayusculas(nombreCrudo)
                            : nombreCrudo.toUpperCase())
                        : '';

                    const catSelVal = el('editProdCategoria').value;
                    const catFinal = (catSelVal === '__NUEVA__')
                        ? (el('editProdCategoriaNueva') ? el('editProdCategoriaNueva').value.trim() : 'General / Otros')
                        : catSelVal;

                    const tipoSel = el('editProdTipo').value;
                    const unidadesVal = tipoSel === CONSTANTES.CATEGORIAS.ENTERO
                        ? 1
                        : parseInt(el('editProdUnidades').value, 10);

                    const ficha = {
                        codigoBarras: codigoNuevo,
                        codigoBarrasAnterior: codigoOriginal,
                        nombre: nombreNormalizado,
                        categoria: catFinal || 'General / Otros',
                        principioActivo: el('editProdPrincipioActivo').value.trim(),
                        concentracion: el('editProdConcentracion') ? el('editProdConcentracion').value.trim() : '',
                        laboratorio: el('editProdLaboratorio').value.trim(),
                        formaFarmaceutica: el('editProdForma') ? el('editProdForma').value : '',
                        presentacion: el('editProdPresentacion') ? el('editProdPresentacion').value.trim() : '',
                        tipo: tipoSel,
                        unidadesPorCaja: Number.isFinite(unidadesVal) ? unidadesVal : 0,
                        tasaItbis: el('editProdTasaItbis').value,
                        aplicaItbis: Number(el('editProdTasaItbis').value) > 0,
                        condicionVenta: el('editProdCondicion') ? el('editProdCondicion').value : 'OTC',
                        esLeche: Boolean(el('editProdEsLeche') && el('editProdEsLeche').checked),
                        registroSanitario: el('editProdRegistroSanitario').value.trim(),
                        permitirSinNombre: true,
                        permitirNombreVacio: true,
                        permitirSinLaboratorio: true,
                        permitirCero: true
                    };

                    if (!estaBloqueado) {
                        ficha.ubicacion = el('editProdUbicacion') ? el('editProdUbicacion').value.trim() : '';
                        ficha.proveedorHabitual = el('editProdProveedorHabitual') ? el('editProdProveedorHabitual').value.trim() : '';
                        const costoRaw = el('editProdUltimoCosto') ? el('editProdUltimoCosto').value.trim() : '';
                        if (costoRaw !== '') {
                            const costoParsed = Number(costoRaw.replace(',', '.'));
                            if (!Number.isFinite(costoParsed) || costoParsed < 0) {
                                mostrarErrorModalProducto('El último costo debe ser un número válido mayor o igual a 0.', 'editProdUltimoCosto');
                                return;
                            }
                            ficha.ultimoPrecioCaja = costoParsed;
                        } else {
                            ficha.ultimoPrecioCaja = '';
                        }
                    }

                    if (Dominio && typeof Dominio.validarDatosMinimosProducto === 'function') {
                        const valMin = Dominio.validarDatosMinimosProducto(ficha);
                        if (!valMin.esValido) {
                            const mapaCampos = {
                                nombre: 'editProdNombre',
                                concentracion: 'editProdConcentracion',
                                unidadesPorCaja: 'editProdUnidades',
                                precioCaja: 'editProdUltimoCosto',
                                laboratorio: 'editProdLaboratorio'
                            };
                            mostrarErrorModalProducto(valMin.error, mapaCampos[valMin.campo] || 'editProdNombre');
                            return;
                        }
                    }

                    const res = Almacenamiento.guardarFichaProductoCatalogo(ficha);
                    if (!res || !res.exito) {
                        mostrarErrorModalProducto(
                            (res && res.error) || 'Error al guardar ficha.',
                            (res && res.campo === 'codigoBarras') ? 'editProdCodigo' : 'editProdNombre'
                        );
                        return;
                    }

                    if (res.promesaPersistencia) {
                        await res.promesaPersistencia;
                    }

                    if (codigoNuevo !== codigoOriginal && el('calcCodigoBarras') && Dominio.normalizarCodigoBarras(el('calcCodigoBarras').value) === codigoOriginal) {
                        UI.Calculadora?.limpiarEstadoOperativoCaja?.();
                    }

                    cerrarModalEdit();
                    aplicarFiltrosDiccionario();
                    if (UI.Factura && typeof UI.Factura.actualizarBarraSuperior === 'function') {
                        UI.Factura.actualizarBarraSuperior();
                    }
                    const nombreMsg = (res.producto && res.producto.nombre) || 'Producto sin nombre';
                    const extraCod = (codigoNuevo !== codigoOriginal) ? ` (código actualizado a ${codigoNuevo})` : '';
                    UI.Notificaciones.mostrarMensaje(`Ficha de "${nombreMsg}" actualizada en el Catálogo Maestro${extraCod}.`, 'success');
                } finally {
                    guardandoFichaEnCurso = false;
                    if (btnSubmit) {
                        btnSubmit.disabled = false;
                        btnSubmit.classList.remove('btn-loading');
                    }
                }
            });
        }

        if (el('btnDescargarDiccionario')) el('btnDescargarDiccionario').addEventListener('click', descargarDiccionarioJson);
        if (el('inputRestaurarDiccionario')) el('inputRestaurarDiccionario').addEventListener('change', e => restaurarDiccionarioJson(e.target));

        // Sincronización entre Cajas (Solo Catálogo Sanitario Público)
        const btnExportarCaja = el('btnExportarParaOtraCaja');
        if (btnExportarCaja) {
            btnExportarCaja.addEventListener('click', () => {
                Almacenamiento.exportarParcheParaOtraCaja();
                UI.Notificaciones.mostrarMensaje('Parche Sanitario Público descargado (costos y acuerdos eliminados).', 'success');
            });
        }

        const inputFusionar = el('inputFusionarCatalogo');
        if (inputFusionar) {
            inputFusionar.addEventListener('change', e => restaurarDiccionarioJson(e.target, 'fusion'));
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
                const estaBloqueado = Boolean(AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado());
                let prod = Almacenamiento.buscarProductoPorCodigo(cod);
                if (!estaBloqueado && typeof Almacenamiento.obtenerDetalleProductoAdmin === 'function') {
                    prod = (await Almacenamiento.obtenerDetalleProductoAdmin(cod)) || prod;
                }
                if (prod && el('modalEditarProductoDiccionario')) {
                    limpiarErrorModalProducto();
                    limpiarFlagsAutocompletado();
                    const inputCod = el('editProdCodigo');
                    const codOriginal = prod.codigoBarras || cod;
                    if (inputCod) {
                        inputCod.value = codOriginal;
                        inputCod.dataset.codigoOriginal = codOriginal;
                        inputCod.readOnly = estaBloqueado;
                    }
                    const hintCod = el('hintEditProdCodigo');
                    if (hintCod) {
                        const esInterno = Boolean(Dominio && typeof Dominio.esCodigoBarrasInterno === 'function' && Dominio.esCodigoBarrasInterno(codOriginal));
                        if (estaBloqueado) {
                            hintCod.textContent = 'Solo lectura (desbloquea Admin para editar código)';
                        } else if (esInterno) {
                            hintCod.textContent = 'Código interno GS1 (200...) — Puedes reemplazarlo por el código oficial del fabricante';
                        } else {
                            hintCod.textContent = 'Editable en modo Administrador (GS1: 8, 12, 13 o 14 dígitos)';
                        }
                    }
                    const nomProd = String(prod.nombre || prod.nombreComercial || '').trim();
                    const esPlaceholderNom = !nomProd || /^Producto(\s*#\d+)?$/i.test(nomProd) || nomProd.toLowerCase() === 'producto sin nombre';
                    el('editProdNombre').value = esPlaceholderNom ? '' : nomProd;
                    poblarSelectorCategoriasEdicion(prod.categoria || '');
                    el('editProdPrincipioActivo').value = prod.principioActivo || '';
                    if (el('editProdConcentracion')) el('editProdConcentracion').value = prod.concentracion || '';
                    el('editProdLaboratorio').value = prod.laboratorio || '';

                    const inputProvHab = el('editProdProveedorHabitual');
                    if (inputProvHab) {
                        inputProvHab.disabled = estaBloqueado;
                        inputProvHab.value = estaBloqueado ? '' : (prod.proveedorHabitual || '');
                        inputProvHab.placeholder = estaBloqueado ? 'Cifrado en Bóveda (Requiere Admin)' : 'Ej. Droguería Betances';
                    }

                    if (el('editProdForma')) el('editProdForma').value = prod.formaFarmaceutica || '';
                    if (el('editProdPresentacion')) el('editProdPresentacion').value = prod.presentacion || '';
                    el('editProdTipo').value = prod.tipo || 'divisible';
                    el('editProdUnidades').value = prod.unidadesPorCaja || 1;
                    sincronizarUnidadesModalProducto();

                    const inputUltCosto = el('editProdUltimoCosto');
                    if (inputUltCosto) {
                        inputUltCosto.disabled = estaBloqueado;
                        const tieneCosto = prod.ultimoPrecioCaja !== undefined && prod.ultimoPrecioCaja !== null && Number(prod.ultimoPrecioCaja) > 0;
                        inputUltCosto.value = estaBloqueado ? '' : (tieneCosto ? Number(prod.ultimoPrecioCaja).toFixed(2) : '');
                        inputUltCosto.placeholder = estaBloqueado ? 'Cifrado (Requiere Admin)' : 'Sin costo registrado';
                    }

                    el('editProdTasaItbis').value = String(prod.tasaItbis !== undefined ? prod.tasaItbis : (prod.aplicaItbis ? 18 : 0));
                    if (el('editProdCondicion')) el('editProdCondicion').value = prod.condicionVenta || 'OTC';
                    if (el('editProdEsLeche')) el('editProdEsLeche').checked = Boolean(prod.esLeche);
                    el('editProdRegistroSanitario').value = prod.registroSanitario || '';
                    const inputUbicacion = el('editProdUbicacion');
                    if (inputUbicacion) {
                        inputUbicacion.disabled = estaBloqueado;
                        inputUbicacion.value = estaBloqueado ? '' : (prod.ubicacion || '');
                        inputUbicacion.placeholder = estaBloqueado ? 'Cifrado (Requiere Admin)' : 'Ej. Tramo A-2';
                    }

                    if (esPlaceholderNom || !prod.tipo) el('editProdTipo').dataset.autoElegible = 'true';
                    if (esPlaceholderNom || !prod.unidadesPorCaja || Number(prod.unidadesPorCaja) <= 1) el('editProdUnidades').dataset.autoElegible = 'true';
                    if (esPlaceholderNom || prod.tasaItbis === undefined) el('editProdTasaItbis').dataset.autoElegible = 'true';
                    if (el('editProdCondicion') && (esPlaceholderNom || !prod.condicionVenta)) el('editProdCondicion').dataset.autoElegible = 'true';
                    if (el('editProdEsLeche') && !prod.esLeche) el('editProdEsLeche').dataset.autoElegible = 'true';

                    actualizarDatalistsDirectorios();
                    if (!esPlaceholderNom) {
                        aplicarAutocompletadoDesdeNombre();
                    }
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

                const tituloBoveda = el('tituloCabeceraCatalogoBoveda');
                if (tituloBoveda) {
                    if (subtab === 'productos') tituloBoveda.textContent = 'Catálogo Maestro de Fármacos & Productos';
                    if (subtab === 'proveedores') tituloBoveda.textContent = 'Directorio Oficial: Proveedores & Distribuidores';
                    if (subtab === 'laboratorios') tituloBoveda.textContent = 'Directorio Oficial: Laboratorios Fabricantes';
                }

                if (subtab === 'proveedores') renderizarProveedoresUI();
                if (subtab === 'laboratorios') renderizarLaboratoriosUI();
            });
        });

        // Búsquedas en tiempo real para Proveedores y Laboratorios (con debounce)
        const inputFiltroProvs = el('filtroBuscadorProveedores');
        if (inputFiltroProvs) {
            let temporizadorProvs = null;
            inputFiltroProvs.addEventListener('input', () => {
                if (temporizadorProvs) clearTimeout(temporizadorProvs);
                temporizadorProvs = setTimeout(() => {
                    temporizadorProvs = null;
                    renderizarProveedoresUI(inputFiltroProvs.value);
                }, 150);
            });
        }

        const inputFiltroLabs = el('filtroBuscadorLaboratorios');
        if (inputFiltroLabs) {
            let temporizadorLabs = null;
            inputFiltroLabs.addEventListener('input', () => {
                if (temporizadorLabs) clearTimeout(temporizadorLabs);
                temporizadorLabs = setTimeout(() => {
                    temporizadorLabs = null;
                    renderizarLaboratoriosUI(inputFiltroLabs.value);
                }, 150);
            });
        }

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

        // Click delegation en tabla de proveedores (botón editar y celda de nombre/razón social)
        const contProvs = el('contenedorProveedores');
        if (contProvs) {
            contProvs.addEventListener('click', async e => {
                const btnEdit = e.target.closest('[data-editar-proveedor]');
                if (btnEdit) {
                    const idProv = String(btnEdit.dataset.editarProveedor || '').trim();
                    const provs = Almacenamiento.obtenerDirectorioProveedores();
                    const prov = provs.find(p =>
                        String(p.id) === idProv ||
                        (p.rnc && String(p.rnc) === idProv) ||
                        (p.nombre && String(p.nombre).toLowerCase() === idProv.toLowerCase()) ||
                        (p.razonSocial && String(p.razonSocial).toLowerCase() === idProv.toLowerCase())
                    );
                    if (prov && modalProv) {
                        if (el('editProvId')) el('editProvId').value = prov.id || '';
                        if (el('editProvRnc')) el('editProvRnc').value = prov.rnc || '';
                        if (el('editProvNombre')) el('editProvNombre').value = prov.nombre || '';
                        if (el('editProvRazonSocial')) el('editProvRazonSocial').value = prov.razonSocial || '';
                        if (el('editProvTelefono')) el('editProvTelefono').value = prov.telefono || '';
                        if (el('editProvContacto')) el('editProvContacto').value = prov.contacto || '';
                        if (el('editProvDiasCredito')) el('editProvDiasCredito').value = prov.diasCredito || 30;
                        if (el('editProvDescuento')) el('editProvDescuento').value = (prov.descuentoHabitual || 0).toFixed(2);
                        if (el('tituloModalProveedor')) el('tituloModalProveedor').textContent = 'Editar Proveedor / Distribuidor';
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
                    const idLab = String(btnEdit.dataset.editarLaboratorio || '').trim();
                    const labs = Almacenamiento.obtenerDirectorioLaboratorios();
                    const lab = labs.find(l =>
                        String(l.id) === idLab ||
                        (l.nombre && String(l.nombre).toLowerCase() === idLab.toLowerCase()) ||
                        (l.razonSocial && String(l.razonSocial).toLowerCase() === idLab.toLowerCase())
                    );
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

        const btnExportLabs = el('btnExportarLaboratoriosJson');
        if (btnExportLabs) {
            btnExportLabs.addEventListener('click', () => {
                const res = Almacenamiento.exportarLaboratoriosJson();
                if (res && res.exito) {
                    UI.Notificaciones.mostrarMensaje(`Directorio público de ${res.totalLaboratorios} laboratorios exportado en JSON.`, 'success');
                }
            });
        }

        const inputImportLabs = el('inputImportarLaboratoriosJson');
        if (inputImportLabs) {
            inputImportLabs.addEventListener('change', async e => {
                const archivo = e.target.files[0];
                e.target.value = '';
                if (!archivo) return;
                try {
                    const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
                    const res = Almacenamiento.importarLaboratoriosJson(datos);
                    if (!res || !res.exito) {
                        throw new Error((res && res.error) || 'No se pudo importar el directorio de laboratorios.');
                    }
                    renderizarLaboratoriosUI();
                    actualizarDatalistsDirectorios();
                    UI.Notificaciones.mostrarMensaje(`Laboratorios importados: +${res.agregados} nuevos, ${res.actualizados} actualizados (${res.total} totales).`, 'success');
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje(err.message || 'Error al importar laboratorios.', 'error');
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
