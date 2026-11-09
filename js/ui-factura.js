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
            <button type="button" class="btn-secundario-sm" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:11px;" data-reabrir="${escaparHtml(duplicada.id)}">${iconoSvg('folder')} Reabrir Existente</button>`;
        alerta.querySelector('[data-reabrir]').onclick = () => UI.Historial.reabrirFacturaDeHistorial(duplicada.id);
        return true;
    }

    function actualizarDatalistProveedores() {
        const dl = el('listaProveedoresSugeridos');
        if (!dl) return;
        const proveedores = Almacenamiento.obtenerDirectorioProveedores();
        dl.innerHTML = proveedores.map(p => `<option value="${escaparHtml(p.nombre)}">${escaparHtml(p.rnc ? p.rnc + ' — ' : '')}${escaparHtml(p.razonSocial || '')}</option>`).join('');
    }

    function cargarDatosDesdeQrDgii(datos) {
        if (!datos) return;
        const Estado = AppFarmacia.Estado;
        const sesionActual = Estado.sesionActual;

        if (datos.encf) {
            sesionActual.numeroFactura = datos.encf;
            const inputNum = el('facNumero');
            if (inputNum) inputNum.value = datos.encf;
        }

        if (datos.rncEmisor) {
            sesionActual.rnc = datos.rncEmisor;
            const inputRnc = el('facRnc');
            if (inputRnc) inputRnc.value = datos.rncEmisor;

            const provEncontrado = Almacenamiento.buscarProveedorPorRnc(datos.rncEmisor);
            if (provEncontrado && provEncontrado.nombre) {
                sesionActual.proveedor = provEncontrado.nombre;
                const inputProv = el('facProveedor');
                if (inputProv) inputProv.value = provEncontrado.nombre;
            }
        }

        if (datos.montoTotal && datos.montoTotal > 0) {
            sesionActual.totalFisico = datos.montoTotal;
            const inputTotal = el('facTotalFisico');
            if (inputTotal) inputTotal.value = datos.montoTotal.toFixed(2);
        }

        if (datos.fechaEmision) {
            sesionActual.fechaEmision = datos.fechaEmision;
            const inputFecha = el('facFechaEmision');
            if (inputFecha) inputFecha.value = datos.fechaEmision;
            if (!sesionActual.fechaVencimiento) {
                sesionActual.fechaVencimiento = Dominio.sumarDiasAFechaISO(datos.fechaEmision, 30);
                const inputVenc = el('facFechaVencimiento');
                if (inputVenc) inputVenc.value = sesionActual.fechaVencimiento;
            }
        }

        if (datos.codigoSeguridad) {
            sesionActual.codigoSeguridad = datos.codigoSeguridad;
        }

        // Validación RncComprador vs RNC configurado de la farmacia
        const config = Almacenamiento.obtenerReglasNegocio();
        const rncFarmaciaPropia = config && config.rncFarmacia ? String(config.rncFarmacia).replace(/\D/g, '') : '';
        if (rncFarmaciaPropia && datos.rncComprador && datos.rncComprador !== rncFarmaciaPropia) {
            UI.Notificaciones.mostrarMensaje(`Precaución: El RNC Comprador (${datos.rncComprador}) no coincide con el RNC registrado de tu farmacia (${rncFarmaciaPropia}).`, 'warning');
        } else {
            UI.Notificaciones.mostrarMensaje(`Factura e-CF ${datos.encf || ''} cargada correctamente desde el QR DGII.`, 'success');
        }

        verificarDuplicadoUI();
        Estado.sincronizarYGuardarSesion();
        actualizarBarraSuperior();
        UI.Calculadora.calcularEnVivo();
    }

    function actualizarCabeceraFacturaDesdeUI() {
        const Estado = AppFarmacia.Estado;
        const san = (Dominio && typeof Dominio.sanitizarEntradaTexto === 'function')
            ? Dominio.sanitizarEntradaTexto
            : (x) => String(x || '').trim();
        Estado.sesionActual.proveedor = san(el('facProveedor').value, 120);
        if (el('facRnc')) Estado.sesionActual.rnc = san(el('facRnc').value, 20);
        Estado.sesionActual.numeroFactura = san(el('facNumero').value, 50);
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

    
    function fijarCabeceraFacturaColapsada(colapsada) {
        const grid = el('gridCamposFactura');
        const resumen = el('resumenFacturaCompacta');
        const btn = el('btnToggleDatosFactura');
        const txt = el('txtToggleDatosFactura');
        const ico = el('icoToggleDatosFactura');
        if (!grid || !resumen) return;

        if (colapsada) {
            grid.style.display = 'none';
            resumen.style.display = 'flex';
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (txt) txt.textContent = 'Desplegar Cabecera';
            if (ico) ico.innerHTML = '<use href="#i-unlock"/>';
        } else {
            grid.style.display = 'grid';
            resumen.style.display = 'none';
            if (btn) btn.setAttribute('aria-expanded', 'true');
            if (txt) txt.textContent = 'Ocultar Cabecera';
            if (ico) ico.innerHTML = '<use href="#i-lock"/>';
        }
        try {
            localStorage.setItem('calc_cabecera_factura_colapsada', colapsada ? '1' : '0');
        } catch (_) {}
    }

    function activarTabCockpit(nombreTab) {
        const tabCalc = el('tabCockpitCalc');
        const tabFactura = el('tabCockpitFactura');

        // En el nuevo Cockpit HUD de pantalla unificada:
        // La Calculadora y Precios en Vivo permanecen SIEMPRE visibles en pantalla.
        // Las pestañas/atajos enfocan la sección deseada sin desmontar la calculadora.
        if (nombreTab === 'calc') {
            if (tabCalc) {
                tabCalc.classList.add('activo');
                tabCalc.setAttribute('aria-selected', 'true');
            }
            if (tabFactura) {
                tabFactura.classList.remove('activo');
                tabFactura.setAttribute('aria-selected', 'false');
            }
            const inputCod = el('calcCodigoBarras');
            if (inputCod) inputCod.focus();
        } else {
            if (tabFactura) {
                tabFactura.classList.add('activo');
                tabFactura.setAttribute('aria-selected', 'true');
            }
            if (tabCalc) {
                tabCalc.classList.remove('activo');
                tabCalc.setAttribute('aria-selected', 'false');
            }
            fijarCabeceraFacturaColapsada(false);
            const inputProv = el('facProveedor');
            if (inputProv) inputProv.focus();
        }
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

        if (el('chipFacProveedor')) {
            el('chipFacProveedor').textContent = sesionActual.proveedor || 'Sin proveedor';
        }
        if (el('chipFacNumero')) {
            el('chipFacNumero').textContent = sesionActual.numeroFactura ? (`#${sesionActual.numeroFactura}`) : 'Sin número';
        }
        if (el('chipFacTotalPapel')) {
            el('chipFacTotalPapel').textContent = '$' + Dominio.formatearMonedaDosDecimales(sesionActual.totalFisico || 0);
        }
        if (el('badgeTabFacturaCount')) {
            el('badgeTabFacturaCount').textContent = String(sesionActual.productos.length);
        }

        const miniTxt = el('miniCuadreTexto');
        const miniBadge = el('miniCuadreBadge');
        const miniIco = el('miniCuadreIco');
        if (miniTxt && miniBadge) {
            miniTxt.textContent = `Acum: $${Dominio.formatearMonedaDosDecimales(resumen.sumaAcumulada)}`;
            if (resumen.totalFisico > 0) {
                if (resumen.cuadreExacto) {
                    miniBadge.className = 'badge-cuadre cuadre-exito';
                    miniBadge.textContent = 'Cuadre Exacto';
                    if (miniIco) miniIco.innerHTML = '<use href="#i-check"/>';
                } else {
                    const signo = resumen.diferencia > 0 ? '+' : '';
                    miniBadge.className = 'badge-cuadre cuadre-alerta';
                    miniBadge.textContent = `Dif: ${signo}$${Dominio.formatearMonedaDosDecimales(resumen.diferencia)}`;
                    if (miniIco) miniIco.innerHTML = '<use href="#i-warn"/>';
                }
            } else {
                miniBadge.className = 'badge-cuadre cuadre-neutro';
                miniBadge.textContent = 'Sin Papel';
                if (miniIco) miniIco.innerHTML = '<use href="#i-wallet"/>';
            }
        }
    }

    function actualizarDesgloseFiscalGlobal() {
        const Estado = AppFarmacia.Estado;
        const productos = Estado.sesionActual.productos || [];
        const totalFisico = parseFloat(el('facTotalFisico') ? el('facTotalFisico').value : 0) || 0;

        const resumen = Dominio.calcularResumenCuadreFactura(productos, totalFisico);
        const totalBruto = resumen.totalBrutoAcumulado;
        const totalDescuento = resumen.totalDescuentoAcumulado;
        const totalExento = resumen.totalExentoAcumulado;
        const totalGravado = resumen.totalGravadoAcumulado;
        const totalItbis = resumen.totalItbisAcumulado;
        const totalCalculado = resumen.sumaAcumulada;
        const diferencia = resumen.diferencia;
        const tieneFisico = totalFisico > 0;
        const cuadre = resumen.cuadreExacto;

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
                badge.textContent = 'Factura Cuadrada';
                badge.style.background = 'var(--color-exito-fondo)';
                badge.style.color = 'var(--color-exito)';
                if (boxSemaforo) boxSemaforo.style.borderColor = 'var(--color-exito)';
            } else {
                const signo = diferencia > 0 ? '+' : '';
                elDif.textContent = 'Diferencia: ' + signo + '$' + diferencia.toFixed(2);
                elDif.style.color = 'var(--color-alerta)';
                badge.textContent = 'Descuadre (' + signo + '$' + diferencia.toFixed(2) + ')';
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
            tbody.innerHTML = `<tr>
                <td colspan="12" style="text-align:center;padding:var(--espacio-4) var(--espacio-3);color:var(--color-texto-secundario);">
                    <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                        <svg class="ico ico-sm" style="opacity:0.5;color:var(--color-accion);" aria-hidden="true"><use href="#i-box"/></svg>
                        <span style="font-weight:600;font-size:var(--texto-xs);color:var(--color-texto-principal);">Sin productos en factura.</span>
                        <span style="font-size:var(--texto-xs);">Escanea con la pistola o presiona <kbd class="kbd-badge" style="font-size:10px;padding:1px 4px;">F2</kbd></span>
                    </div>
                </td>
            </tr>`;
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

            const badgeVariacion = (p.variacionCosto !== undefined && Number(p.variacionCosto) !== 0)
                ? '<div class="badge-costo-variacion ' + (p.variacionCosto > 0 ? 'alza' : 'baja') + '" title="Costo anterior: $' + (Number(p.costoAnteriorCaja) || 0).toFixed(2) + '">' +
                    (p.variacionCosto > 0 ? '▲ +' : '▼ ') + p.variacionCosto + '%' +
                  '</div>'
                : '';

            const badgeFefo = (p.fechaVencimiento && Dominio.evaluarSemaforoFefo)
                ? (() => {
                    const f = Dominio.evaluarSemaforoFefo(p.fechaVencimiento);
                    const clase = f.esVencido ? 'vencido' : (f.estado === Dominio.ESTADOS_FEFO.CRITICO_90D ? 'critico' : (f.estado === Dominio.ESTADOS_FEFO.ALERTA_180D ? 'alerta' : 'optimo'));
                    const txtLote = p.lote ? ' [Lote: ' + escaparHtml(p.lote) + ']' : '';
                    return '<div class="badge-fefo-tabla ' + clase + '" title="' + escaparHtml(f.texto) + '">' +
                        escaparHtml(f.texto) + txtLote +
                    '</div>';
                })()
                : (p.lote ? '<div class="fs-xs text-muted" style="font-size:10px;">Lote: ' + escaparHtml(p.lote) + '</div>' : '');

            return '<tr>' +
                '<td class="celda-edit" ' + attrId + ' data-campo="nombre">' +
                    '<strong>' + escaparHtml(p.nombre) + '</strong>' + badgeLeche +
                    badgeFefo +
                    etiquetaCodigo +
                    '<div class="fs-xs text-muted" style="font-size:10px;margin-top:2px;">' + detalleInvCosto + '</div>' +
                '</td>' +
                '<td class="mono celda-edit" ' + attrId + ' data-campo="cajasCompradas" style="text-align:right;">' + p.cajasCompradas + '</td>' +
                '<td class="mono celda-edit" ' + attrId + ' data-campo="unidadesPorCaja" style="text-align:right;" title="Clic para editar unidades por caja">' + (p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? p.unidadesPorCaja : 1) + '</td>' +
                '<td class="mono celda-edit c-caja" ' + attrId + ' data-campo="precioCajaBase" style="text-align:right;" title="Clic para editar precio de compra base">' +
                    '<div>$' + p.precioCajaBase.toFixed(2) + '</div>' +
                    badgeVariacion +
                '</td>' +
                '<td class="mono" style="text-align:right;color:' + (descLinea > 0 ? 'var(--color-exito)' : 'inherit') + ';">' +
                    (descLinea > 0 ? '-$' + descLinea.toFixed(2) : '$0.00') +
                '</td>' +
                '<td class="mono c-sub" style="text-align:right;"><strong>$' + subtotalNetoLinea.toFixed(2) + '</strong></td>' +
                '<td class="celda-edit mono c-itbis" ' + attrId + ' data-campo="itbis" style="text-align:center;cursor:pointer;" title="Clic para alternar ITBIS: Exento (0%) → 18% → 16%">' +
                    '<span class="' + (p.aplicaItbis ? 'badge-itbis-on' : 'badge-itbis-off') + '" style="cursor:pointer;user-select:none;">' +
                        (p.aplicaItbis ? '+' + (p.tasaItbis || 18) + '% ($' + itbisLinea.toFixed(2) + ')' : 'Exento (0%)') +
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
        const tasaActual = (producto.aplicaItbis && producto.tasaItbis !== undefined)
            ? Number(producto.tasaItbis)
            : (producto.aplicaItbis ? 18 : 0);
        let nuevaTasa = 0;
        let nuevoAplica = false;

        // Ciclo oficial RD (DGII): Exento (0%) -> 18% -> 16% -> Exento (0%)
        if (tasaActual === 0) {
            nuevaTasa = 18;
            nuevoAplica = true;
        } else if (tasaActual === 18) {
            nuevaTasa = 16;
            nuevoAplica = true;
        } else {
            nuevaTasa = 0;
            nuevoAplica = false;
        }

        const actualizado = Dominio.crearLineaProductoInmutable({
            ...producto,
            aplicaItbis: nuevoAplica,
            tasaItbis: nuevaTasa,
            manual: {}
        }, Estado.reglasActivas);

        Estado.reemplazarProductoEnSesion(producto.idLinea, actualizado);

        const detalleTexto = nuevoAplica
            ? ("+" + nuevaTasa + "% ITBIS (+$" + Dominio.formatearMonedaDosDecimales(actualizado.montoItbisPorCaja) + "/caja)")
            : "Exento de ITBIS (Tasa 0% - Art. 343 DGII)";

        UI.Notificaciones.mostrarMensaje(
            "ITBIS para \"" + actualizado.nombre + "\": " + detalleTexto + ".",
            nuevoAplica ? "success" : "info"
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
            precioCajaBase: producto.precioCajaBase,
            descuento: producto.descuentoValor || 0
        };
        const valorActual = mapaValores[campo];
        if (valorActual === undefined) return;

        const esCampoNumerico = campo === 'cajasCompradas' || campo === 'unidadesPorCaja' || campo === 'precioCajaBase' || campo === 'descuento';
        const esDecimal = campo === 'precioCajaBase' || campo === 'descuento';

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
        } else if (campo === 'descuento') {
            const v = parseFloat(nuevoTexto);
            if (isNaN(v) || v < 0) {
                UI.Notificaciones.mostrarMensaje('El descuento debe ser un número mayor o igual a 0.', 'error');
                return false;
            }
            datosClonados.descuentoValor = v;
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

    let operacionGuardadoEnCurso = false;
    function finalizarYGuardarFactura() {
        if (operacionGuardadoEnCurso) return;
        const btnFinalizar = el('btnFinalizarFactura');
        try {
            operacionGuardadoEnCurso = true;
            if (btnFinalizar) {
                btnFinalizar.disabled = true;
                btnFinalizar.classList.add('btn-loading');
            }

            const Estado = AppFarmacia.Estado;
            actualizarCabeceraFacturaDesdeUI();
            if (!Estado.sesionActual.proveedor || !Estado.sesionActual.numeroFactura || !Estado.sesionActual.fechaEmision) {
                UI.Notificaciones.mostrarMensaje('Completa Proveedor, Número de Factura y Fecha de Emisión antes de guardar.', 'error');
                fijarCabeceraFacturaColapsada(false);
                activarTabCockpit('factura');
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

            if (Estado.sesionActual.proveedor || Estado.sesionActual.rnc) {
                Almacenamiento.guardarProveedorEnDirectorio({
                    nombre: Estado.sesionActual.proveedor,
                    rnc: Estado.sesionActual.rnc
                });
                actualizarDatalistProveedores();
            }
            if (!guardado.exito) {
                return UI.Notificaciones.mostrarMensaje(guardado.error || 'Error al guardar la factura en el historial.', 'error');
            }

            Estado.vaciarSesion();
            UI.Notificaciones.mostrarMensaje('Factura guardada correctamente en el historial.', 'success');
        } finally {
            operacionGuardadoEnCurso = false;
            if (btnFinalizar) {
                btnFinalizar.disabled = false;
                btnFinalizar.classList.remove('btn-loading');
            }
        }
    }

    function inicializarEventosFactura() {
        const Estado = AppFarmacia.Estado;

        ['facProveedor', 'facRnc', 'facNumero', 'facTotalFisico', 'facFechaEmision', 'facFechaVencimiento'].forEach(id => {
            el(id).addEventListener('input', actualizarCabeceraFacturaDesdeUI);
        });

                const inputProveedor = el('facProveedor');
        const inputRnc = el('facRnc');

        if (inputProveedor) {
            inputProveedor.addEventListener('change', () => {
                const nombre = inputProveedor.value.trim();
                if (nombre) {
                    const match = Almacenamiento.buscarProveedorPorNombre(nombre);
                    if (match && match.rnc && inputRnc && !inputRnc.value) {
                        inputRnc.value = match.rnc;
                        Estado.sesionActual.rnc = match.rnc;
                        Estado.sincronizarYGuardarSesion();
                    }
                }
            });
        }

        if (inputRnc) {
            inputRnc.addEventListener('blur', () => {
                const rncVal = inputRnc.value.trim();
                if (rncVal) {
                    const res = Dominio.validarRnc(rncVal);
                    if (!res.esValido && rncVal.length >= 9) {
                        UI.Notificaciones.mostrarMensaje(res.motivo, 'warning');
                    } else if (res.esValido && inputProveedor && !inputProveedor.value) {
                        const match = Almacenamiento.buscarProveedorPorRnc(rncVal);
                        if (match && match.nombre) {
                            inputProveedor.value = match.nombre;
                            Estado.sesionActual.proveedor = match.nombre;
                            Estado.sincronizarYGuardarSesion();
                        }
                    }
                }
            });
        }

        actualizarDatalistProveedores();

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
                    await Dominio.copiarAlPortapapeles(valor);
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

        const btnToggleCabecera = el('btnToggleDatosFactura');
        if (btnToggleCabecera) {
            btnToggleCabecera.addEventListener('click', () => {
                const estaColapsada = el('gridCamposFactura')?.style.display === 'none';
                fijarCabeceraFacturaColapsada(!estaColapsada);
            });
        }
        const btnExpChip = el('btnExpandirDesdeChip');
        if (btnExpChip) {
            btnExpChip.addEventListener('click', () => {
                fijarCabeceraFacturaColapsada(false);
                el('facProveedor')?.focus();
            });
        }
        const tabCalc = el('tabCockpitCalc');
        if (tabCalc) tabCalc.addEventListener('click', () => activarTabCockpit('calc'));
        const tabFac = el('tabCockpitFactura');
        if (tabFac) tabFac.addEventListener('click', () => activarTabCockpit('factura'));
        const btnVerMini = el('btnVerFacturaDesdeMini');
        if (btnVerMini) btnVerMini.addEventListener('click', () => activarTabCockpit('factura'));

        window.addEventListener('keydown', e => {
            if (e.altKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                const estaColapsada = el('gridCamposFactura')?.style.display === 'none';
                fijarCabeceraFacturaColapsada(!estaColapsada);
            } else if (e.altKey && e.key === '1') {
                e.preventDefault();
                activarTabCockpit('calc');
            } else if (e.altKey && e.key === '2') {
                e.preventDefault();
                activarTabCockpit('factura');
            }
        });

        try {
            const colapsadaInicial = localStorage.getItem('calc_cabecera_factura_colapsada') === '1';
            fijarCabeceraFacturaColapsada(colapsadaInicial);
        } catch (_) {}

        el('btnImprimirActual').addEventListener('click', () => UI.Historial.imprimirFactura(Estado.sesionActual));
        el('btnFinalizarFactura').addEventListener('click', finalizarYGuardarFactura);
        el('btnDescartar').addEventListener('click', async () => {
            if (Estado.sesionActual.id || (await UI.Notificaciones.mostrarConfirmacion('¿Deseas descartar la factura en curso y limpiar todos los datos?', 'Descartar Factura'))) {
                Estado.vaciarSesion();
            }
        });
    }

    UI.Factura = Object.freeze({
        cargarDatosDesdeQrDgii,
        actualizarDatalistProveedores,
        actualizarCabeceraFacturaDesdeUI,
        actualizarBarraSuperior,
        renderizarTablaProductosActuales,
        verificarDuplicadoUI,
        finalizarYGuardarFactura,
        inicializarEventosFactura,
        fijarCabeceraFacturaColapsada,
        activarTabCockpit
    });
})(window);
