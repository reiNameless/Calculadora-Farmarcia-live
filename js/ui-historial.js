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

    function renderizarHistorialUI() {
        const contenedor = el('contenedorHistorial');
        if (!contenedor) return;

        if (AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado()) {
            contenedor.innerHTML = `<div class="tarjeta-bloqueo-boveda">
                <div style="color:var(--color-alerta);">${iconoSvg('lock')}</div>
                <div><strong>Historial Confidencial Cifrado (AES-256)</strong></div>
                <div class="fs-xs text-muted" style="max-width:420px;margin:4px auto 10px;">
                    Las facturas, costos de compra, totales y datos de distribuidores están cifrados localmente. Ingresa tu contraseña de administrador para consultarlos.
                </div>
                <button type="button" class="btn-primario" id="btnDesbloquearDesdeHistorial" style="height:32px;padding:0 14px;font-size:12px;">
                    ${iconoSvg('unlock')} <span>Desbloquear Bóveda</span>
                </button>
            </div>`;
            const btnUnlock = el('btnDesbloquearDesdeHistorial');
            if (btnUnlock && UI.Seguridad) {
                btnUnlock.addEventListener('click', () => UI.Seguridad.abrirModalSeguridad('vistaModalDesbloquear'));
            }
            return;
        }

        const historial = Almacenamiento.obtenerHistorialFacturas();
        if (!historial.length) {
            contenedor.innerHTML = `<div class="text-center p-18 text-muted">No hay facturas cerradas en los últimos 7 días.</div>`;
            return;
        }

        const ahora = Date.now();
        contenedor.innerHTML = historial.map(f => {
            const timestamp = Number(f.timestampGuardado) || ahora;
            const msRestantes = CONSTANTES.DIAS_RETENCION_HISTORIAL_MS - (ahora - timestamp);
            const expiraPronto = msRestantes <= CONSTANTES.AVISO_EXPIRACION_HISTORIAL_MS;
            const diasRestantes = Math.max(0, Math.ceil(msRestantes / (24 * 60 * 60 * 1000)));
            const idEscapado = escaparHtml(f.id);

            return `
            <div style="border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-weight:700; color:var(--primary); display:flex; align-items:center; gap:8px;">
                        <span>${escaparHtml(f.proveedor)} — Factura #${escaparHtml(f.numeroFactura)}</span>
                        ${expiraPronto ? `<span class="tag-expira-pronto" title="El historial retiene facturas por 7 días. Descarga un respaldo para no perderla.">Expira en ~${diasRestantes} d</span>` : ''}
                    </div>
                    <div style="font-size:0.82rem; color:var(--text-muted); margin-top:2px;">
                        Emisión: <b>${escaparHtml(f.fechaEmision)}</b> | Productos: <b>${f.productos.length}</b> | Total: <b>$${Number(f.totalCalculado || 0).toFixed(2)}</b>
                    </div>
                </div>
                <div class="actions-group">
                    <button type="button" class="action-icon-btn" data-hist-imprimir="${idEscapado}" title="Imprimir Factura" aria-label="Imprimir factura de ${escaparHtml(f.proveedor)}">${iconoSvg('print')}</button>
                    <button type="button" class="action-icon-btn" data-hist-editar="${idEscapado}" title="Reabrir / Editar Factura" aria-label="Editar factura de ${escaparHtml(f.proveedor)}">${iconoSvg('edit')}</button>
                    <button type="button" class="action-icon-btn text-danger" data-hist-eliminar="${idEscapado}" title="Eliminar Factura" aria-label="Eliminar factura de ${escaparHtml(f.proveedor)}">${iconoSvg('trash')}</button>
                </div>
            </div>`;
        }).join('');
    }

    async function reabrirFacturaDeHistorial(idFactura) {
        const Estado = AppFarmacia.Estado;
        const factura = Almacenamiento.obtenerHistorialFacturas().find(x => x.id === idFactura);
        if (!factura) return;
        if (Estado.sesionActual.id || Estado.sesionActual.productos.length) {
            const descartar = await UI.Notificaciones.mostrarConfirmacion('Hay datos en la factura actual. ¿Deseas abrir la factura guardada y descartar el borrador en curso?', 'Reabrir Factura');
            if (!descartar) return;
        }
        Estado.sesionActual = Dominio.clonarObjetoSeguro(factura);
        Almacenamiento.guardarBorradorActivo(Estado.sesionActual);
        Estado.renderizarTodo();
        UI.Calculadora.calcularEnVivo();
        el('seccionProductosRegistrados').scrollIntoView({ behavior: 'smooth' });
    }

    function imprimirFactura(factura) {
        if (!factura || !factura.productos.length) {
            return UI.Notificaciones.mostrarMensaje('No hay productos para imprimir.', 'error');
        }
        const resumen = Dominio.calcularResumenCuadreFactura(factura.productos, factura.totalFisico);
        el('printArea').innerHTML = `
            <div class="print-header">
                <h2 style="margin:0 0 4px 0;">Calculadora de Farmacia — Reporte de Recepción</h2>
                <p style="margin:0; font-size:0.85rem;">
                    <b>Proveedor:</b> ${escaparHtml(factura.proveedor || 'No especificado')} &nbsp;|&nbsp;
                    <b>Factura #:</b> ${escaparHtml(factura.numeroFactura || 'S/N')} &nbsp;|&nbsp;
                    <b>Fecha Emisión:</b> ${escaparHtml(factura.fechaEmision || '-')}
                </p>
            </div>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Cant. Cajas</th>
                        <th>Trae x Caja</th>
                        <th>Total Inv</th>
                        <th>Costo Caja</th>
                        <th>ITBIS</th>
                        <th>Subtotal</th>
                        <th>Costo Unitario (8 dec)</th>
                        <th>Precio 1 (Ex/Red)</th>
                        <th>Precio 2 (Ex/Red)</th>
                        <th>Precio 3 (Ex/Red)</th>
                    </tr>
                </thead>
                <tbody>
                    ${factura.productos.map(p => {
                        const itbisPorCaja = p.montoItbisPorCaja !== undefined
                            ? p.montoItbisPorCaja
                            : (p.aplicaItbis ? Dominio.redondearDecimalExacto(p.precioCajaBase * 0.18, 2) : 0);
                        const itbisLinea = p.montoItbisLinea !== undefined
                            ? p.montoItbisLinea
                            : Dominio.redondearDecimalExacto(p.cajasCompradas * itbisPorCaja, 2);
                        return `<tr>
                            <td><strong>${escaparHtml(p.nombre)}</strong></td>
                            <td>${p.cajasCompradas}</td>
                            <td>${p.unidadesPorCaja}</td>
                            <td><b>${p.totalUnidadesInventario}</b></td>
                            <td>$${Number(p.precioCajaBase || 0).toFixed(2)}</td>
                            <td>${p.aplicaItbis ? `+$${itbisLinea.toFixed(2)}` : '$0.00'}</td>
                            <td>$${Number(p.subtotalFactura || 0).toFixed(2)}</td>
                            <td>${p.costoUnitario}</td>
                            <td>$${p.p1Exacto} / <b>$${p.p1Redondeado}</b></td>
                            <td>$${p.p2Exacto} / <b>$${p.p2Redondeado}</b></td>
                            <td>$${p.p3Exacto} / <b>$${p.p3Redondeado}</b></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            <div class="print-totals">
                <b>Total Base:</b> $${(resumen.subtotalBaseAcumulado || 0).toFixed(2)} &nbsp;&nbsp;|&nbsp;&nbsp;
                <b>Total ITBIS:</b> $${(resumen.totalItbisAcumulado || 0).toFixed(2)} &nbsp;&nbsp;|&nbsp;&nbsp;
                <b>Total Factura Físico:</b> $${Number(factura.totalFisico || 0).toFixed(2)} &nbsp;&nbsp;|&nbsp;&nbsp;
                <b>Total Calculado Acumulado:</b> $${resumen.sumaAcumulada.toFixed(2)}
                ${resumen.totalFisico > 0 ? `<br><small style="color:${resumen.cuadreExacto ? 'green' : 'orange'};">${resumen.cuadreExacto ? 'Factura Cuadra Exactamente' : `Diferencia: $${resumen.diferencia.toFixed(2)}`}</small>` : ''}
            </div>`;
        window.print();
    }

    function descargarRespaldoFacturas() {
        UI.Notificaciones.mostrarMensaje('La exportación de facturas fue eliminada por cumplimiento legal y protección de datos confidenciales.', 'warning');
        return false;
    }

    async function restaurarRespaldoFacturas() {
        UI.Notificaciones.mostrarMensaje('La importación de respaldos externos de facturas fue deshabilitada.', 'info');
        return false;
    }

    function exportarFormato606() {
        UI.Notificaciones.mostrarMensaje('La exportación de archivos fiscales externos fue eliminada por confidencialidad.', 'warning');
        return false;
    }

    function inicializarEventosHistorial() {
        if (el('contenedorHistorial')) el('contenedorHistorial').addEventListener('click', async e => {
            const btnImp = e.target.closest('[data-hist-imprimir]');
            if (btnImp) {
                if (AppFarmacia.Seguridad && AppFarmacia.Seguridad.estaConfigurado() && AppFarmacia.Seguridad.estaBloqueado()) {
                    return UI.Seguridad && UI.Seguridad.solicitarDesbloqueoSiNecesario();
                }
                const fac = Almacenamiento.obtenerHistorialFacturas().find(x => x.id === btnImp.dataset.histImprimir);
                return imprimirFactura(fac);
            }
            const btnEd = e.target.closest('[data-hist-editar]');
            if (btnEd) return reabrirFacturaDeHistorial(btnEd.dataset.histEditar);

            const btnElim = e.target.closest('[data-hist-eliminar]');
            if (btnElim) {
                const confirmarEliminacion = await UI.Notificaciones.mostrarConfirmacion('¿Deseas eliminar permanentemente esta factura del historial?', 'Eliminar Factura');
                if (confirmarEliminacion) {
                    const filtrado = Almacenamiento.obtenerHistorialFacturas().filter(x => x.id !== btnElim.dataset.histEliminar);
                    Almacenamiento.guardarHistorialFacturas(filtrado);
                    renderizarHistorialUI();
                    UI.Notificaciones.mostrarMensaje('Factura eliminada del historial.', 'info');
                }
            }
        });
    }

    UI.Historial = Object.freeze({
        renderizarHistorialUI,
        reabrirFacturaDeHistorial,
        imprimirFactura,
        descargarRespaldoFacturas,
        restaurarRespaldoFacturas,
        exportarFormato606,
        inicializarEventosHistorial
    });
})(window);
