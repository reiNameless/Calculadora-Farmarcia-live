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

        if (resumen.totalFisico > 0) {
            if (resumen.cuadreExacto) {
                badge.style.background = 'var(--success-bg)';
                badge.style.color = 'var(--success)';
                texto.textContent = `Cuadre Exacto: $${resumen.sumaAcumulada.toFixed(2)}`;
            } else {
                badge.style.background = 'var(--warning-bg)';
                badge.style.color = 'var(--warning)';
                const signo = resumen.diferencia > 0 ? '+' : '';
                texto.textContent = `Acumulado: $${resumen.sumaAcumulada.toFixed(2)} (Dif: $${signo}${resumen.diferencia.toFixed(2)})`;
            }
        } else {
            badge.style.background = '#f1f3f4';
            badge.style.color = '#333';
            texto.textContent = `Acumulado: $${resumen.sumaAcumulada.toFixed(2)}`;
        }
    }

    function renderizarTablaProductosActuales() {
        const Estado = AppFarmacia.Estado;
        const tbody = el('tablaProductosActuales');
        const usarRedondeo = el('calcRedondeo').checked;

        if (!Estado.sesionActual.productos.length) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center p-18 text-muted">Sin productos registrados en esta factura.</td></tr>`;
            return;
        }

        const celdaPrecio = (p, n) => {
            const exacto = p['p' + n + 'Exacto'];
            const redondeado = p['p' + n + 'Redondeado'];
            const esManual = p.manual && p.manual['p' + n];
            const idEscapado = escaparHtml(p.idLinea);
            return `<td class="mono celda-edit c-p${n}" data-id="${idEscapado}" data-campo="p${n}">
                ${usarRedondeo ? redondeado : exacto}
                <span class="fs-xs text-muted">(${usarRedondeo ? exacto : redondeado})</span>
                ${esManual ? `<span title="Editado a mano">✎</span><button type="button" class="action-icon-btn" data-accion="restaurar" data-campo="p${n}" data-id="${idEscapado}" title="Restaurar cálculo" aria-label="Restaurar cálculo Precio ${n}">↺</button>` : ''}
            </td>`;
        };

        tbody.innerHTML = Estado.sesionActual.productos.map(p => {
            const attrId = `data-id="${escaparHtml(p.idLinea)}"`;
            const etiquetaCodigo = p.codigoBarras ? `<div class="fs-xs text-muted">${iconoSvg('barcode')} ${escaparHtml(p.codigoBarras)}</div>` : '';
            return `<tr>
                <td class="celda-edit" ${attrId} data-campo="nombre"><strong>${escaparHtml(p.nombre)}</strong>${etiquetaCodigo}</td>
                <td class="celda-edit" ${attrId} data-campo="tipo">
                    <span class="action-icon-btn" style="pointer-events:none">
                        ${iconoSvg(p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'grid' : 'drop')}
                        ${p.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}
                    </span>
                </td>
                <td class="mono celda-edit" ${attrId} data-campo="cajasCompradas">${p.cajasCompradas}</td>
                <td class="mono celda-edit" ${attrId} data-campo="unidadesPorCaja">${p.unidadesPorCaja}</td>
                <td class="mono c-inv">${p.totalUnidadesInventario} uds</td>
                <td class="mono celda-edit c-caja" ${attrId} data-campo="precioCajaBase">$${p.precioCajaBase.toFixed(2)}${p.aplicaItbis ? ' +ITBIS' : ''}</td>
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

    async function alternarTipoEnTabla(producto) {
        const Estado = AppFarmacia.Estado;
        if (producto.tipo === CONSTANTES.CATEGORIAS.ENTERO) {
            const respuesta = await UI.Notificaciones.mostrarPrompt('Cambiar a "Se divide". ¿Cuántas unidades (pastillas/ampollas) trae 1 caja?', '10', 'Unidades por Caja');
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

        const mapaValores = {
            nombre: producto.nombre,
            cajasCompradas: producto.cajasCompradas,
            unidadesPorCaja: producto.unidadesPorCaja,
            precioCajaBase: producto.precioCajaBase,
            p1: producto.p1Exacto,
            p2: producto.p2Exacto,
            p3: producto.p3Exacto
        };
        const valorActual = mapaValores[campo];
        const input = document.createElement('input');
        input.value = valorActual;
        input.style.cssText = 'width:100%;min-width:70px;padding:4px 6px;border:2px solid var(--primary);border-radius:4px;font:inherit';

        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();

        let finalizado = false;
        const cerrarEdicion = guardar => {
            if (finalizado) return;
            finalizado = true;
            if (guardar && input.value.trim() !== String(valorActual)) {
                aplicarCambioCampoIndividual(producto, campo, input.value);
            } else {
                renderizarTablaProductosActuales();
            }
        };

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); cerrarEdicion(true); }
            else if (e.key === 'Escape') cerrarEdicion(false);
        });
        input.addEventListener('blur', () => cerrarEdicion(true));
    }

    function aplicarCambioCampoIndividual(producto, campo, nuevoTexto) {
        const Estado = AppFarmacia.Estado;
        const datosClonados = { ...producto, manual: { ...(producto.manual || {}) } };

        if (campo === 'nombre') {
            if (!nuevoTexto.trim()) return UI.Notificaciones.mostrarMensaje('El nombre no puede quedar vacío.', 'error');
            datosClonados.nombre = nuevoTexto.trim();
        } else if (campo === 'cajasCompradas') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las cajas compradas');
            if (!v.esValido) return UI.Notificaciones.mostrarMensaje(v.error, 'error');
            datosClonados.cajasCompradas = v.valor;
        } else if (campo === 'unidadesPorCaja') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las unidades por caja');
            if (!v.esValido) return UI.Notificaciones.mostrarMensaje(v.error, 'error');
            datosClonados.unidadesPorCaja = v.valor;
            datosClonados.tipo = v.valor > 1 ? CONSTANTES.CATEGORIAS.DIVISIBLE : datosClonados.tipo;
            datosClonados.manual = {};
        } else if (campo === 'precioCajaBase') {
            const v = Dominio.validarPrecioCompra(nuevoTexto);
            if (!v.esValido) return UI.Notificaciones.mostrarMensaje(v.error, 'error');
            datosClonados.precioCajaBase = v.valor;
            datosClonados.manual = {};
        } else if (['p1', 'p2', 'p3'].includes(campo)) {
            const v = Dominio.validarPrecioCompra(nuevoTexto);
            if (!v.esValido) return UI.Notificaciones.mostrarMensaje(v.error, 'error');
            datosClonados.manual[campo] = true;
            datosClonados[campo + 'Exacto'] = Dominio.formatearMonedaDosDecimales(v.valor);
            datosClonados[campo + 'Redondeado'] = String(Math.round(v.valor));
        }

        Estado.reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable(datosClonados, Estado.reglasActivas));
    }

    async function editarFilaCompletaConDialogo(producto) {
        const Estado = AppFarmacia.Estado;
        const nuevoNombre = await UI.Notificaciones.mostrarPrompt('Nombre del producto:', producto.nombre, 'Editar Producto');
        if (nuevoNombre === null) return;
        const nuevasCajas = await UI.Notificaciones.mostrarPrompt('Cajas en factura:', producto.cajasCompradas, 'Cajas en Factura');
        if (nuevasCajas === null) return;
        const vCajas = Dominio.validarCantidadEnteraPositiva(nuevasCajas, 'cajas');
        if (!vCajas.esValido) return UI.Notificaciones.mostrarMensaje(vCajas.error, 'error');

        const nuevoPrecio = await UI.Notificaciones.mostrarPrompt('Precio de compra de 1 caja:', producto.precioCajaBase, 'Precio de Compra');
        if (nuevoPrecio === null) return;
        const vPrecio = Dominio.validarPrecioCompra(nuevoPrecio);
        if (!vPrecio.esValido) return UI.Notificaciones.mostrarMensaje(vPrecio.error, 'error');

        let unidades = 1;
        if (producto.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
            const nuevasUds = await UI.Notificaciones.mostrarPrompt('Unidades por caja:', producto.unidadesPorCaja, 'Unidades por Caja');
            if (nuevasUds === null) return;
            const vUds = Dominio.validarCantidadEnteraPositiva(nuevasUds, 'unidades');
            if (!vUds.esValido) return UI.Notificaciones.mostrarMensaje(vUds.error, 'error');
            unidades = vUds.valor;
        }

        Estado.reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable({
            ...producto,
            nombre: nuevoNombre.trim() || producto.nombre,
            cajasCompradas: vCajas.valor,
            precioCajaBase: vPrecio.valor,
            unidadesPorCaja: unidades,
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
                } else if (btnAccion.dataset.accion === 'restaurar') {
                    const manual = { ...(prod.manual || {}), [btnAccion.dataset.campo]: false };
                    Estado.reemplazarProductoEnSesion(prod.idLinea, Dominio.crearLineaProductoInmutable({ ...prod, manual }, Estado.reglasActivas));
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
