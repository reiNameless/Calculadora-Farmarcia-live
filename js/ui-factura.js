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

    function actualizarDesgloseFiscalGlobal() {
        const Estado = AppFarmacia.Estado;
        const productos = Estado.sesionActual.productos || [];
        const totalFisico = parseFloat(el('facTotalFisico') ? el('facTotalFisico').value : 0) || 0;

        let totalBruto = 0;
        let totalDescuento = 0;
        let totalExento = 0;
        let totalGravado = 0;
        let totalItbis = 0;

        productos.forEach(p => {
            const cajas = Number(p.cajasCompradas) || 1;
            const precioBase = Number(p.precioCajaBase) || 0;
            const desc = Number(p.descuentoTotalLinea) || 0;
            const brutoLinea = cajas * precioBase;
            const netoLinea = Math.max(0, brutoLinea - desc);

            totalBruto += brutoLinea;
            totalDescuento += desc;

            if (!p.aplicaItbis || p.tasaItbis === 0) {
                totalExento += netoLinea;
            } else {
                totalGravado += netoLinea;
            }

            const itbisLinea = p.montoItbisLinea !== undefined
                ? Number(p.montoItbisLinea)
                : (p.aplicaItbis ? netoLinea * ((p.tasaItbis || 18) / 100) : 0);
            totalItbis += itbisLinea;
        });

        const totalCalculado = totalExento + totalGravado + totalItbis;
        const diferencia = Dominio.redondearDecimalExacto(totalCalculado - totalFisico, CONSTANTES.DECIMALES_MONEDA);
        const tieneFisico = totalFisico > 0;
        const cuadre = tieneFisico && Math.abs(diferencia) <= CONSTANTES.TOLERANCIA_CUADRE_FACTURA;

        if (el('resumenFiscalBruto')) el('resumenFiscalBruto').textContent = '$' + totalBruto.toFixed(2);
        if (el('resumenFiscalDescuento')) el('resumenFiscalDescuento').textContent = '-$' + totalDescuento.toFixed(2);
        if (el('resumenFiscalExento')) el('resumenFiscalExento').textContent = '$' + totalExento.toFixed(2);
        if (el('resumenFiscalGravado')) el('resumenFiscalGravado').textContent = '$' + totalGravado.toFixed(2);
        if (el('resumenFiscalItbis')) el('resumenFiscalItbis').textContent = '+$' + totalItbis.toFixed(2);
        if (el('resumenFiscalTotalCalculado')) el('resumenFiscalTotalCalculado').textContent = '$' + totalCalculado.toFixed(2);
        if (el('resumenFiscalTotalFisico')) el('resumenFiscalTotalFisico').textContent = '$' + totalFisico.toFixed(2);

        const elDif = el('resumenFiscalDiferencia');
        const badge = el('badgeCuadreFiscal');
        const boxSemaforo = el('boxSemaforoCuadre');

        if (elDif && badge) {
            if (!tieneFisico) {
                elDif.textContent = 'Digita Total en Papel';
                elDif.style.color = 'var(--color-texto-secundario)';
                badge.textContent = 'Sin Total Físico';
                badge.style.background = 'var(--color-superficie-resaltada)';
                badge.style.color = 'var(--color-texto-secundario)';
                if (boxSemaforo) boxSemaforo.style.borderColor = 'var(--color-borde-fuerte)';
            } else if (cuadre) {
                elDif.textContent = 'Cuadre Exacto (±0.05)';
                elDif.style.color = 'var(--color-exito)';
                badge.textContent = '✅ Factura Cuadrada';
                badge.style.background = 'var(--color-exito-fondo)';
                badge.style.color = 'var(--color-exito)';
                if (boxSemaforo) boxSemaforo.style.borderColor = 'var(--color-exito)';
            } else {
                const signo = diferencia > 0 ? '+' : '';
                elDif.textContent = 'Diferencia: ' + signo + '$' + diferencia.toFixed(2);
                elDif.style.color = 'var(--color-alerta)';
                badge.textContent = '⚠️ Descuadre (' + signo + '$' + diferencia.toFixed(2) + ')';
                badge.style.background = 'var(--color-alerta-fondo)';
                badge.style.color = 'var(--color-alerta)';
                if (boxSemaforo) boxSemaforo.style.borderColor = 'var(--color-alerta)';
            }
        }
    }

    function renderizarTablaProductosActuales() {
        const Estado = AppFarmacia.Estado;
        const tbody = el('tablaProductosActuales');
        const usarRedondeo = el('calcRedondeo').checked;

        if (!Estado.sesionActual.productos.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center p-18 text-muted">Sin productos registrados en esta factura.</td></tr>';
            actualizarDesgloseFiscalGlobal();
            return;
        }

        const celdaPrecio = (p, n) => {
            const exacto = p['p' + n + 'Exacto'];
            const redondeado = p['p' + n + 'Redondeado'];
            const valorPrincipal = usarRedondeo ? redondeado : exacto;
            const valorSecundario = usarRedondeo ? exacto : redondeado;
            return '<td class="mono c-p' + n + '" style="text-align:right;">' +
                '<button type="button" class="copy-chip" data-copiar-precio="' + valorPrincipal + '" title="Clic para copiar $' + valorPrincipal + ' al portapapeles">' +
                    '<span>$' + valorPrincipal + '</span>' +
                    '<svg class="ico ico-sm" style="width:11px;height:11px;"><use href="#i-copy"/></svg>' +
                '</button>' +
                '<div class="fs-xs text-muted" style="font-size:10px;">($' + valorSecundario + ')</div>' +
            '</td>';
        };

        tbody.innerHTML = Estado.sesionActual.productos.map(p => {
            const attrId = 'data-id="' + escaparHtml(p.idLinea) + '"';
            const etiquetaCodigo = p.codigoBarras ? '<div class="fs-xs text-muted" style="font-size:11px;">' + iconoSvg('barcode') + ' ' + escaparHtml(p.codigoBarras) + '</div>' : '';
            const badgeLeche = p.esLeche ? '<span style="display:inline-block;padding:1px 5px;font-size:9px;background:var(--color-superficie-resaltada);border:1px solid var(--color-primario);color:var(--color-primario);border-radius:3px;margin-left:4px;font-weight:var(--peso-seminegrita);">Leche 10%</span>' : '';
            const descLinea = (p.descuentoTotalLinea && p.descuentoTotalLinea > 0) ? p.descuentoTotalLinea : 0;
            const subtotalNetoLinea = Math.max(0, (p.cajasCompradas * p.precioCajaBase) - descLinea);

            const itbisPorCaja = p.montoItbisPorCaja !== undefined
                ? p.montoItbisPorCaja
                : (p.aplicaItbis ? Dominio.redondearDecimalExacto(p.precioCajaBase * (Estado.reglasActivas.porcentajeItbis / 100), CONSTANTES.DECIMALES_MONEDA) : 0);
            const itbisLinea = p.montoItbisLinea !== undefined
                ? p.montoItbisLinea
                : Dominio.redondearDecimalExacto(p.cajasCompradas * itbisPorCaja, CONSTANTES.DECIMALES_MONEDA);

            const detalleInvCosto = p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE
                ? 'Trae ' + p.unidadesPorCaja + ' uds (' + p.totalUnidadesInventario + ' total) | Unit Fiscal: $' + Dominio.formatearCostoFiscalOchoDecimales(p.costoUnitarioFinal || p.costoUnitario)
                : 'Venta entera (1 ud) | Unit Fiscal: $' + Dominio.formatearCostoFiscalOchoDecimales(p.costoUnitarioFinal || p.costoUnitario);

            return '<tr>' +
                '<td class="celda-edit" ' + attrId + ' data-campo="nombre">' +
                    '<strong>' + escaparHtml(p.nombre) + '</strong>' + badgeLeche +
                    etiquetaCodigo +
                    '<div class="fs-xs text-muted" style="font-size:10px;margin-top:2px;">' + detalleInvCosto + '</div>' +
                '</td>' +
                '<td class="mono celda-edit" ' + attrId + ' data-campo="cajasCompradas" style="text-align:right;">' + p.cajasCompradas + '</td>' +
                '<td class="mono celda-edit c-caja" ' + attrId + ' data-campo="precioCajaBase" style="text-align:right;" title="Clic para editar precio de compra base">' +
                    '$' + p.precioCajaBase.toFixed(2) +
                '</td>' +
                '<td class="mono" style="text-align:right;color:' + (descLinea > 0 ? 'var(--color-exito)' : 'inherit') + ';">' +
                    (descLinea > 0 ? '-$' + descLinea.toFixed(2) : '$0.00') +
                '</td>' +
                '<td class="mono c-sub" style="text-align:right;"><strong>$' + subtotalNetoLinea.toFixed(2) + '</strong></td>' +
                '<td class="celda-edit mono c-itbis" ' + attrId + ' data-campo="itbis" style="text-align:center;" title="Clic para alternar ITBIS">' +
                    '<span class="' + (p.aplicaItbis ? 'badge-itbis-on' : 'badge-itbis-off') + '">' +
                        (p.aplicaItbis ? '+' + (p.tasaItbis || 18) + '% ($' + itbisLinea.toFixed(2) + ')' : 'Exento') +
                    '</span>' +
                '</td>' +
                '<td class="mono" style="text-align:right;"><strong>$' + p.subtotalFactura.toFixed(2) + '</strong></td>' +
                celdaPrecio(p, 1) + celdaPrecio(p, 2) + celdaPrecio(p, 3) +
                '<td style="text-align:center;">' +
                    '<div style="display:flex; gap:4px; justify-content:center;">' +
                        '<button type="button" class="action-icon-btn" data-accion="editar" ' + attrId + ' title="Editar fila completa" aria-label="Editar fila">' + iconoSvg('edit') + '</button>' +
                        '<button type="button" class="action-icon-btn text-danger" data-accion="eliminar" ' + attrId + ' title="Eliminar fila" aria-label="Eliminar fila">' + iconoSvg('trash') + '</button>' +
                    '</div>' +
                '</td>' +
            '</tr>';
        }).join('');

        actualizarDesgloseFiscalGlobal();
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
            const btnCopiar = e.target.closest('[data-copiar-precio]');
            if (btnCopiar) {
                const valor = btnCopiar.dataset.copiarPrecio;
                try {
                    await navigator.clipboard.writeText(valor);
                    btnCopiar.classList.add('copiado');
                    UI.Notificaciones.mostrarMensaje('Precio copiado: $' + valor, 'info');
                    setTimeout(() => btnCopiar.classList.remove('copiado'), 1200);
                } catch (err) {
                    UI.Notificaciones.mostrarMensaje('$' + valor, 'info');
                }
                return;
            }

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
