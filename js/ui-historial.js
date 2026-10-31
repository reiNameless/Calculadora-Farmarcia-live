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
                    <button type="button" class="action-icon-btn" data-hist-imprimir="${idEscapado}" aria-label="Imprimir factura de ${escaparHtml(f.proveedor)}">${iconoSvg('print')} Imprimir</button>
                    <button type="button" class="action-icon-btn" data-hist-editar="${idEscapado}" aria-label="Editar factura de ${escaparHtml(f.proveedor)}">${iconoSvg('edit')} Editar</button>
                    <button type="button" class="action-icon-btn text-danger" data-hist-eliminar="${idEscapado}" aria-label="Eliminar factura de ${escaparHtml(f.proveedor)}">${iconoSvg('trash')} Eliminar</button>
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
                        <th>Subtotal</th>
                        <th>Costo Unitario (8 dec)</th>
                        <th>Precio 1 (Ex/Red)</th>
                        <th>Precio 2 (Ex/Red)</th>
                        <th>Precio 3 (Ex/Red)</th>
                    </tr>
                </thead>
                <tbody>
                    ${factura.productos.map(p => `<tr>
                        <td><strong>${escaparHtml(p.nombre)}</strong></td>
                        <td>${p.cajasCompradas}</td>
                        <td>${p.unidadesPorCaja}</td>
                        <td><b>${p.totalUnidadesInventario}</b></td>
                        <td>$${Number(p.subtotalFactura || 0).toFixed(2)}</td>
                        <td>${p.costoUnitario}</td>
                        <td>$${p.p1Exacto} / <b>$${p.p1Redondeado}</b></td>
                        <td>$${p.p2Exacto} / <b>$${p.p2Redondeado}</b></td>
                        <td>$${p.p3Exacto} / <b>$${p.p3Redondeado}</b></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="print-totals">
                <b>Total Factura Físico:</b> $${Number(factura.totalFisico || 0).toFixed(2)} &nbsp;&nbsp;|&nbsp;&nbsp;
                <b>Total Calculado Acumulado:</b> $${resumen.sumaAcumulada.toFixed(2)}
                ${resumen.totalFisico > 0 ? `<br><small style="color:${resumen.cuadreExacto ? 'green' : 'orange'};">${resumen.cuadreExacto ? '✔ Factura Cuadra Exactamente' : `Diferencia: $${resumen.diferencia.toFixed(2)}`}</small>` : ''}
            </div>`;
        window.print();
    }

    function descargarRespaldoFacturas() {
        const Estado = AppFarmacia.Estado;
        const historial = Almacenamiento.obtenerHistorialFacturas();
        if (historial.length === 0 && Estado.sesionActual.productos.length === 0) {
            return UI.Notificaciones.mostrarMensaje('El historial y la factura actual están vacíos. No hay datos para descargar.', 'error');
        }
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_RESPALDO_FACTURAS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            historial,
            borrador: Estado.sesionActual
        }, `respaldo-farmacia-${Dominio.obtenerFechaLocalISO()}.json`);
    }

    async function restaurarRespaldoFacturas(inputArchivo) {
        const Estado = AppFarmacia.Estado;
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
        if (!archivo) return;

        try {
            const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
            if ((datos.tipo !== 'respaldo-farmacia' && datos.tipo !== CONSTANTES.TIPO_ARCHIVO_RESPALDO_FACTURAS) || !Array.isArray(datos.historial)) {
                throw new Error('Archivo de respaldo de facturas no válido.');
            }
            const historialActual = Almacenamiento.obtenerHistorialFacturas();
            const idsExistentes = new Set(historialActual.map(x => x.id));
            let agregadas = 0;

            datos.historial.forEach(fac => {
                if (fac && Array.isArray(fac.productos) && !idsExistentes.has(fac.id)) {
                    const productosSanitizados = fac.productos.map(p => Dominio.crearLineaProductoInmutable(p, Estado.reglasActivas));
                    const resumen = Dominio.calcularResumenCuadreFactura(productosSanitizados, fac.totalFisico);
                    const idNuevo = fac.id || Dominio.generarIdUnico();
                    historialActual.push({
                        id: idNuevo,
                        proveedor: String(fac.proveedor || ''),
                        numeroFactura: String(fac.numeroFactura || ''),
                        fechaEmision: String(fac.fechaEmision || ''),
                        fechaVencimiento: String(fac.fechaVencimiento || ''),
                        totalFisico: Number(fac.totalFisico) || 0,
                        productos: productosSanitizados,
                        totalCalculado: resumen.sumaAcumulada,
                        timestampGuardado: Number(fac.timestampGuardado) || Date.now()
                    });
                    idsExistentes.add(idNuevo);
                    agregadas++;
                }
            });

            Almacenamiento.guardarHistorialFacturas(historialActual);
            renderizarHistorialUI();
            UI.Notificaciones.mostrarMensaje(`Respaldo restaurado: ${agregadas} facturas añadidas.`, 'success');
        } catch (error) {
            UI.Notificaciones.mostrarMensaje(error.message, 'error');
        }
    }

    function inicializarEventosHistorial() {
        el('btnDescargarRespaldo').addEventListener('click', descargarRespaldoFacturas);
        el('inputRestaurarRespaldo').addEventListener('change', e => restaurarRespaldoFacturas(e.target));
        el('contenedorHistorial').addEventListener('click', async e => {
            const btnImp = e.target.closest('[data-hist-imprimir]');
            if (btnImp) {
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
        inicializarEventosHistorial
    });
})(window);
