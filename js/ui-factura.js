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

    function buscarFacturaDuplicada() {
        const Estado = AppFarmacia.Estado;
        const sesionActual = Estado.sesionActual;
        const prov = sesionActual.proveedor.toLowerCase();
        const num = sesionActual.numeroFactura.toLowerCase();
        if (!prov || !num) return null;
        return Almacenamiento.obtenerHistorialFacturas().find(
            f => f.id !== sesionActual.id &&
                 String(f.proveedor).toLowerCase() === prov &&
                 String(f.numeroFactura).toLowerCase() === num
        ) || null;
    }

    function verificarDuplicadoUI() {
        const Estado = AppFarmacia.Estado;
        const alerta = el('alertaFacturaDuplicada');
        const duplicada = buscarFacturaDuplicada();
        if (!duplicada) {
            alerta.style.display = 'none';
            return false;
        }
        alerta.style.display = 'flex';
        alerta.innerHTML = `<span>${iconoSvg('warn')} El proveedor <b>${escaparHtml(Estado.sesionActual.proveedor)}</b> ya tiene la factura <b>#${escaparHtml(Estado.sesionActual.numeroFactura)}</b>.</span>
            <button type="button" class="action-icon-btn" data-reabrir="${escaparHtml(duplicada.id)}">${iconoSvg('folder')} Reabrir Existente</button>`;
        alerta.querySelector('[data-reabrir]').onclick = () => UI.Historial.reabrirFacturaDeHistorial(duplicada.id);
        return true;
    }

    function actualizarCabeceraFacturaDesdeUI() {
        const Estado = AppFarmacia.Estado;
        Estado.sesionActual.proveedor = el('facProveedor').value.trim();
        Estado.sesionActual.numeroFactura = el('facNumero').value.trim();
        Estado.sesionActual.fechaEmision = el('facFechaEmision').value;
        if (!el('facFechaVencimiento').value && el('facFechaEmision').value) {
            el('facFechaVencimiento').value = Dominio.sumarDiasAFechaISO(el('facFechaEmision').value, 30);
        }
        Estado.sesionActual.fechaVencimiento = el('facFechaVencimiento').value;
        Estado.sesionActual.totalFisico = parseFloat(el('facTotalFisico').value) || 0;

        verificarDuplicadoUI();
        Estado.sincronizarYGuardarSesion();
        actualizarBarraSuperior();
        UI.Calculadora.calcularEnVivo();
    }

    function actualizarBarraSuperior() {
        const Estado = AppFarmacia.Estado;
        const sesionActual = Estado.sesionActual;
        const prov = sesionActual.proveedor || 'Sin proveedor';
        const num = sesionActual.numeroFactura ? `#${sesionActual.numeroFactura}` : 'Sin número';
        el('topInvoiceText').textContent = `${sesionActual.id ? 'Editando: ' : ''}Factura: ${prov} (${num})`;
        el('topItemsCount').textContent = `${sesionActual.productos.length} productos`;

        const totalCodigos = Object.keys(Almacenamiento.obtenerDiccionarioCodigos()).length;
        el('topDiccionarioCount').textContent = `${totalCodigos} códigos`;

        const resumen = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);
        const badge = el('topCuadreBadge');
        const texto = el('topCuadreText');
        const itbisTxt = resumen.totalItbisAcumulado > 0 ? ` (ITBIS: $${Dominio.formatearMonedaDosDecimales(resumen.totalItbisAcumulado)})` : '';

        const facBadge = el('facCuadreBadge');
        const facTexto = el('facCuadreText');
        const facIco = el('facCuadreIco');

        if (resumen.totalFisico > 0) {
            if (resumen.cuadreExacto) {
                if (badge) {
                    badge.style.background = 'var(--color-exito-fondo)';
                    badge.style.color = 'var(--color-exito)';
                }
                if (texto) texto.textContent = `Cuadre Exacto: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt}`;
                if (facBadge) facBadge.className = 'badge-cuadre cuadre-exito';
                if (facTexto) facTexto.textContent = `Cuadre Exacto: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt}`;
                if (facIco) facIco.innerHTML = '<use href="#i-check"/>';
            } else {
                const signo = resumen.diferencia > 0 ? '+' : '';
                if (badge) {
                    badge.style.background = 'var(--color-alerta-fondo)';
                    badge.style.color = 'var(--color-alerta)';
                }
                if (texto) texto.textContent = `Acumulado: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt} (Dif: ${signo}$${Dominio.formatearMonedaDosDecimales(resumen.diferencia)})`;
                if (facBadge) facBadge.className = 'badge-cuadre cuadre-alerta';
                if (facTexto) facTexto.textContent = `Diferencia: ${signo}$${Dominio.formatearMonedaDosDecimales(resumen.diferencia)} | Acum: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt}`;
                if (facIco) facIco.innerHTML = '<use href="#i-warn"/>';
            }
        } else {
            if (badge) {
                badge.style.background = 'var(--color-superficie-resaltada)';
                badge.style.color = 'var(--color-texto-secundario)';
            }
            if (texto) texto.textContent = `Acumulado: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt}`;
            if (facBadge) facBadge.className = 'badge-cuadre cuadre-neutro';
            if (facTexto) facTexto.textContent = `Acumulado: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}${itbisTxt}`;
            if (facIco) facIco.innerHTML = '<use href="#i-wallet"/>';
        }
    }

    function renderizarTablaProductosActuales() {
        const Estado = AppFarmacia.Estado;
        const tbody = el('tablaProductosActuales');
        const usarRedondeo = el('calcRedondeo').checked;

        if (!Estado.sesionActual.productos.length) {
            tbody.innerHTML = `<tr><td colspan="13" class="text-center p-18 text-muted">Sin productos registrados en esta factura.</td></tr>`;
            return;
        }

        const celdaPrecio = (p, n) => {
            const exacto = p['p' + n + 'Exacto'];
            const redondeado = p['p' + n + 'Redondeado'];
            return `<td class="mono c-p${n}">
                ${usarRedondeo ? redondeado : exacto}
                <span class="fs-xs text-muted">(${usarRedondeo ? exacto : redondeado})</span>
            </td>`;
        };

        tbody.innerHTML = Estado.sesionActual.productos.map(p => {
            const attrId = `data-id="${escaparHtml(p.idLinea)}"`;
            const etiquetaCodigo = p.codigoBarras ? `<div class="fs-xs text-muted">${iconoSvg('barcode')} ${escaparHtml(p.codigoBarras)}</div>` : '';
            const badgeLeche = p.esLeche ? `<span style="display:inline-block;padding:1px 5px;font-size:9px;background:var(--color-superficie-resaltada);border:1px solid var(--color-primario);color:var(--color-primario);border-radius:3px;margin-left:4px;font-weight:var(--peso-seminegrita);">Leche 10%</span>` : '';
            const textoDescuento = (p.descuentoTotalLinea && p.descuentoTotalLinea > 0)
                ? `<div class="fs-xs" style="color:var(--color-exito);font-weight:var(--peso-seminegrita);">Desc: -$${p.descuentoPorCaja.toFixed(2)}${p.tipoDescuento === 'porcentaje' ? ` (${p.descuentoValor}%)` : ''}</div>`
                : '';
            const itbisPorCaja = p.montoItbisPorCaja !== undefined
                ? p.montoItbisPorCaja
                : (p.aplicaItbis ? Dominio.redondearDecimalExacto(p.precioCajaBase * (Estado.reglasActivas.porcentajeItbis / 100), CONSTANTES.DECIMALES_MONEDA) : 0);
            const itbisLinea = p.montoItbisLinea !== undefined
                ? p.montoItbisLinea
                : Dominio.redondearDecimalExacto(p.cajasCompradas * itbisPorCaja, CONSTANTES.DECIMALES_MONEDA);
            const costoCajaEfectivo = p.costoCajaEfectivo !== undefined
                ? p.costoCajaEfectivo
                : (p.aplicaItbis ? Dominio.redondearDecimalExacto(p.precioCajaBase + itbisPorCaja, CONSTANTES.DECIMALES_MONEDA) : p.precioCajaBase);

            return `<tr>
                <td class="celda-edit" ${attrId} data-campo="nombre"><strong>${escaparHtml(p.nombre)}</strong>${badgeLeche}${etiquetaCodigo}</td>
                <td class="celda-edit" ${attrId} data-campo="tipo" title="Clic para alternar categoría (Se divide / Se vende entero)">
                    <span class="action-icon-btn" style="pointer-events:none">
                        ${iconoSvg(p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'grid' : 'drop')}
                        ${p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}
                    </span>
                </td>
                <td class="mono celda-edit" ${attrId} data-campo="cajasCompradas">${p.cajasCompradas}</td>
                <td class="mono celda-edit" ${attrId} data-campo="unidadesPorCaja">${p.unidadesPorCaja}</td>
                <td class="mono c-inv">${p.totalUnidadesInventario} uds</td>
                <td class="mono celda-edit c-caja" ${attrId} data-campo="precioCajaBase" title="Clic para editar precio de compra base">
                    $${p.precioCajaBase.toFixed(2)}
                    ${textoDescuento}
                    ${p.aplicaItbis ? `<div class="fs-xs text-muted">C/ITBIS: $${costoCajaEfectivo.toFixed(2)}</div>` : ''}
                </td>
                <td class="celda-edit mono c-itbis" ${attrId} data-campo="itbis" title="Clic para activar o desactivar ITBIS">
                    <span class="${p.aplicaItbis ? 'badge-itbis-on' : 'badge-itbis-off'}">
                        ${iconoSvg(p.aplicaItbis ? 'check' : 'tag')}
                        ${p.aplicaItbis ? `+$${itbisPorCaja.toFixed(2)}` : '$0.00'}
                    </span>
                    <div class="fs-xs ${p.aplicaItbis ? 'text-success' : 'text-muted'}" style="margin-top:2px;">
                        ${p.aplicaItbis ? (p.cajasCompradas > 1 ? `Tot: $${itbisLinea.toFixed(2)}` : `${Estado.reglasActivas.porcentajeItbis}%`) : 'Exento'}
                    </div>
                </td>
                <td class="mono c-sub"><strong>$${p.subtotalFactura.toFixed(2)}</strong></td>
                <td class="mono c-costo">${p.costoUnitario}</td>
                ${celdaPrecio(p, 1)}${celdaPrecio(p, 2)}${celdaPrecio(p, 3)}
                <td>
                    <div style="display:flex; gap:4px;">
                        <button type="button" class="action-icon-btn" data-accion="editar" ${attrId} title="Editar fila completa" aria-label="Editar fila">${iconoSvg('edit')}</button>
                        <button type="button" class="action-icon-btn text-danger" data-accion="eliminar" ${attrId} title="Eliminar fila" aria-label="Eliminar fila">${iconoSvg('trash')}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    function alternarItbisEnTabla(producto) {
        const Estado = AppFarmacia.Estado;
        const nuevoEstado = !producto.aplicaItbis;
        const actualizado = Dominio.crearLineaProductoInmutable({
            ...producto,
            aplicaItbis: nuevoEstado,
            manual: {}
        }, Estado.reglasActivas);

        Estado.reemplazarProductoEnSesion(producto.idLinea, actualizado);
        const detalleMonto = actualizado.montoItbisPorCaja > 0
            ? ` (+$${actualizado.montoItbisPorCaja.toFixed(2)}/caja | Tot: $${actualizado.montoItbisLinea.toFixed(2)})`
            : '';
        UI.Notificaciones.mostrarMensaje(
            `ITBIS ${nuevoEstado ? 'aplicado (+18%)' + detalleMonto : 'desactivado ($0.00 Exento)'} para "${actualizado.nombre}".`,
            nuevoEstado ? 'success' : 'info'
        );
    }

    async function alternarTipoEnTabla(producto) {
        const Estado = AppFarmacia.Estado;
        if (producto.tipo === CONSTANTES.CATEGORIAS.ENTERO) {
            const respuesta = await UI.Notificaciones.mostrarPrompt('Cambiar a "Se divide". ¿Cuántas unidades (pastillas/ampollas) trae 1 caja?', '10', 'Unidades por Caja', 'entero');
            if (respuesta === null) return;
            const validacion = Dominio.validarCantidadEnteraPositiva(respuesta, 'las unidades por caja');
            if (!validacion.esValido) return UI.Notificaciones.mostrarMensaje(validacion.error, 'error');

            const actualizado = Dominio.crearLineaProductoInmutable({
                ...producto,
                tipo: CONSTANTES.CATEGORIAS.DIVISIBLE,
                unidadesPorCaja: validacion.valor,
                manual: {}
            }, Estado.reglasActivas);
            Estado.reemplazarProductoEnSesion(producto.idLinea, actualizado);
        } else {
            const actualizado = Dominio.crearLineaProductoInmutable({
                ...producto,
                tipo: CONSTANTES.CATEGORIAS.ENTERO,
                unidadesPorCaja: 1,
                manual: {}
            }, Estado.reglasActivas);
            Estado.reemplazarProductoEnSesion(producto.idLinea, actualizado);
        }
    }

    function iniciarEdicionCeldaTabla(td) {
        const Estado = AppFarmacia.Estado;
        const producto = Estado.sesionActual.productos.find(p => String(p.idLinea) === String(td.dataset.id));
        const campo = td.dataset.campo;
        if (!producto) return;

        if (campo === 'tipo') {
            alternarTipoEnTabla(producto);
            return;
        }
        if (campo === 'itbis') {
            alternarItbisEnTabla(producto);
            return;
        }

        const mapaValores = {
            nombre: producto.nombre,
            cajasCompradas: producto.cajasCompradas,
            unidadesPorCaja: producto.unidadesPorCaja,
            precioCajaBase: producto.precioCajaBase
        };
        const valorActual = mapaValores[campo];
        if (valorActual === undefined) return;

        const esCampoNumerico = campo === 'cajasCompradas' || campo === 'unidadesPorCaja' || campo === 'precioCajaBase';
        const esDecimal = campo === 'precioCajaBase';

        const input = document.createElement('input');
        input.type = 'text';
        if (esCampoNumerico) {
            input.inputMode = esDecimal ? 'decimal' : 'numeric';
        }
        input.value = valorActual;
        input.style.cssText = 'width:100%;box-sizing:border-box;min-width:60px;padding:4px 6px;border:2px solid var(--primary);border-radius:4px;font:inherit;background:var(--card-bg, #fff);color:inherit;';

        td.innerHTML = '';
        td.appendChild(input);

        let removerFiltro = null;
        if (esCampoNumerico && typeof UI.configurarFiltroNumerico === 'function') {
            removerFiltro = UI.configurarFiltroNumerico(input, esDecimal);
        }

        input.focus();
        input.select();

        let finalizado = false;
        const cerrarEdicion = guardar => {
            if (finalizado) return;
            finalizado = true;

            if (typeof removerFiltro === 'function') {
                removerFiltro();
                removerFiltro = null;
            }

            const valorLimpio = input.value.trim();
            let exito = false;

            if (guardar && valorLimpio !== '' && valorLimpio !== String(valorActual)) {
                exito = aplicarCambioCampoIndividual(producto, campo, valorLimpio);
            }

            // Si no se guardó con éxito o no hubo cambio o fue cancelado,
            // restauramos la tabla para que la celda quede limpia y lista para volver a editarse sin trabarse
            if (!exito) {
                renderizarTablaProductosActuales();
            }
        };

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                cerrarEdicion(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cerrarEdicion(false);
            }
        });
        input.addEventListener('blur', () => cerrarEdicion(true));
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('dblclick', e => e.stopPropagation());
    }

    function aplicarCambioCampoIndividual(producto, campo, nuevoTexto) {
        const Estado = AppFarmacia.Estado;
        const datosClonados = { ...producto, manual: { ...(producto.manual || {}) } };

        if (campo === 'nombre') {
            if (!nuevoTexto.trim()) {
                UI.Notificaciones.mostrarMensaje('El nombre no puede quedar vacío.', 'error');
                return false;
            }
            datosClonados.nombre = nuevoTexto.trim();
        } else if (campo === 'cajasCompradas') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las cajas compradas');
            if (!v.esValido) {
                UI.Notificaciones.mostrarMensaje(v.error, 'error');
                return false;
            }
            datosClonados.cajasCompradas = v.valor;
        } else if (campo === 'unidadesPorCaja') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las unidades por caja');
            if (!v.esValido) {
                UI.Notificaciones.mostrarMensaje(v.error, 'error');
                return false;
            }
            datosClonados.unidadesPorCaja = v.valor;
            datosClonados.tipo = v.valor > 1 ? CONSTANTES.CATEGORIAS.DIVISIBLE : datosClonados.tipo;
            datosClonados.manual = {};
        } else if (campo === 'precioCajaBase') {
            const v = Dominio.validarPrecioCompra(nuevoTexto);
            if (!v.esValido) {
                UI.Notificaciones.mostrarMensaje(v.error, 'error');
                return false;
            }
            datosClonados.precioCajaBase = v.valor;
            datosClonados.manual = {};
        }

        Estado.reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable(datosClonados, Estado.reglasActivas));
        return true;
    }

    async function editarFilaCompletaConDialogo(producto) {
        const Estado = AppFarmacia.Estado;
        const nuevoNombre = await UI.Notificaciones.mostrarPrompt('Nombre del producto:', producto.nombre, 'Editar Producto');
        if (nuevoNombre === null) return;
        const nuevasCajas = await UI.Notificaciones.mostrarPrompt('Cajas en factura:', producto.cajasCompradas, 'Cajas en Factura', 'entero');
        if (nuevasCajas === null) return;
        const vCajas = Dominio.validarCantidadEnteraPositiva(nuevasCajas, 'cajas');
        if (!vCajas.esValido) return UI.Notificaciones.mostrarMensaje(vCajas.error, 'error');

        const nuevoPrecio = await UI.Notificaciones.mostrarPrompt('Precio de compra de 1 caja:', producto.precioCajaBase, 'Precio de Compra', 'decimal');
        if (nuevoPrecio === null) return;
        const vPrecio = Dominio.validarPrecioCompra(nuevoPrecio);
        if (!vPrecio.esValido) return UI.Notificaciones.mostrarMensaje(vPrecio.error, 'error');

        let unidades = 1;
        if (producto.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
            const nuevasUds = await UI.Notificaciones.mostrarPrompt('Unidades por caja:', producto.unidadesPorCaja, 'Unidades por Caja', 'entero');
            if (nuevasUds === null) return;
            const vUds = Dominio.validarCantidadEnteraPositiva(nuevasUds, 'unidades');
            if (!vUds.esValido) return UI.Notificaciones.mostrarMensaje(vUds.error, 'error');
            unidades = vUds.valor;
        }

        const deseaItbis = await UI.Notificaciones.mostrarConfirmacion(
            `¿Este producto lleva ITBIS (+${Estado.reglasActivas.porcentajeItbis}%)?\n\nActualmente: ${producto.aplicaItbis ? 'SÍ lleva ITBIS' : 'NO lleva ITBIS (Exento)'}`,
            'Impuesto ITBIS'
        );

        Estado.reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable({
            ...producto,
            nombre: nuevoNombre.trim() || producto.nombre,
            cajasCompradas: vCajas.valor,
            precioCajaBase: vPrecio.valor,
            unidadesPorCaja: unidades,
            aplicaItbis: deseaItbis,
            manual: {}
        }, Estado.reglasActivas));
    }

    function finalizarYGuardarFactura() {
        const Estado = AppFarmacia.Estado;
        actualizarCabeceraFacturaDesdeUI();
        if (!Estado.sesionActual.proveedor || !Estado.sesionActual.numeroFactura || !Estado.sesionActual.fechaEmision) {
            UI.Notificaciones.mostrarMensaje('Completa Proveedor, Número de Factura y Fecha de Emisión antes de guardar.', 'error');
            el('seccionDatosFactura').scrollIntoView({ behavior: 'smooth' });
            return;
        }
        if (!Estado.sesionActual.productos.length) {
            return UI.Notificaciones.mostrarMensaje('Agrega al menos un producto antes de finalizar la factura.', 'error');
        }
        if (verificarDuplicadoUI()) {
            return UI.Notificaciones.mostrarMensaje('Este proveedor ya tiene registrada una factura con ese número.', 'error');
        }

        const historial = Almacenamiento.obtenerHistorialFacturas();
        const resumen = Dominio.calcularResumenCuadreFactura(Estado.sesionActual.productos, Estado.sesionActual.totalFisico);

        // DAT-05: Guarda fórmulas usadas
        const facturaCerrada = {
            ...Dominio.clonarObjetoSeguro(Estado.sesionActual),
            id: Estado.sesionActual.id || Dominio.generarIdUnico(),
            totalCalculado: resumen.sumaAcumulada,
            timestampGuardado: Date.now(),
            reglasCalculoUsadas: Dominio.clonarObjetoSeguro(Estado.reglasActivas)
        };

        const idx = historial.findIndex(f => f.id === facturaCerrada.id);
        if (idx >= 0) historial[idx] = facturaCerrada;
        else historial.unshift(facturaCerrada);

        const guardado = Almacenamiento.guardarHistorialFacturas(historial);
        if (!guardado.exito) {
            return UI.Notificaciones.mostrarMensaje(guardado.error || 'Error al guardar la factura en el historial.', 'error');
        }

        Estado.vaciarSesion();
        UI.Notificaciones.mostrarMensaje('Factura guardada correctamente en el historial.', 'success');
    }

    function inicializarEventosFactura() {
        const Estado = AppFarmacia.Estado;

        ['facProveedor', 'facNumero', 'facTotalFisico', 'facFechaEmision', 'facFechaVencimiento'].forEach(id => {
            el(id).addEventListener('input', actualizarCabeceraFacturaDesdeUI);
        });

        const inputEmision = el('facFechaEmision');
        if (inputEmision) {
            inputEmision.addEventListener('change', () => {
                if (inputEmision.value) {
                    const nuevaVencimiento = Dominio.sumarDiasAFechaISO(inputEmision.value, 30);
                    const inputVenc = el('facFechaVencimiento');
                    if (inputVenc) inputVenc.value = nuevaVencimiento;
                    Estado.sesionActual.fechaVencimiento = nuevaVencimiento;
                    Estado.sincronizarYGuardarSesion();
                }
            });
        }

        if (typeof UI.configurarFiltroNumerico === 'function') {
            UI.configurarFiltroNumerico(el('facTotalFisico'), true);
        }

        el('tablaProductosActuales').addEventListener('click', async e => {
            const btnAccion = e.target.closest('[data-accion]');
            if (btnAccion) {
                const idProd = btnAccion.dataset.id;
                const prod = Estado.sesionActual.productos.find(p => String(p.idLinea) === String(idProd));
                if (!prod) return;

                if (btnAccion.dataset.accion === 'editar') {
                    await editarFilaCompletaConDialogo(prod);
                } else if (btnAccion.dataset.accion === 'eliminar') {
                    Estado.eliminarProductoDeSesion(prod.idLinea);
                }
                return;
            }
            const td = e.target.closest('td.celda-edit');
            if (td && !td.querySelector('input')) iniciarEdicionCeldaTabla(td);
        });

        el('btnImprimirActual').addEventListener('click', () => UI.Historial.imprimirFactura(Estado.sesionActual));
        el('btnFinalizarFactura').addEventListener('click', finalizarYGuardarFactura);
        el('btnDescartar').addEventListener('click', async () => {
            if (Estado.sesionActual.id || (await UI.Notificaciones.mostrarConfirmacion('¿Deseas descartar la factura en curso y limpiar todos los datos?', 'Descartar Factura'))) {
                Estado.vaciarSesion();
            }
        });
    }

    UI.Factura = Object.freeze({
        actualizarCabeceraFacturaDesdeUI,
        actualizarBarraSuperior,
        renderizarTablaProductosActuales,
        verificarDuplicadoUI,
        finalizarYGuardarFactura,
        inicializarEventosFactura
    });
})(window);
