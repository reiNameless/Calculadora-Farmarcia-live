(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const { CONSTANTES, ESTRATEGIAS_CALCULO } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;
    const Almacenamiento = AppFarmacia.Almacenamiento;
    const ServicioIA = AppFarmacia.ServicioIA;

    let sesionActual = Almacenamiento.crearSesionVacia();
    let reglasActivas = Almacenamiento.obtenerReglasNegocio();
    let temporizadoresNotificacion = [];
    let temporizadorDebounceCalculo = null;

    const el = id => document.getElementById(id);
    const escaparHtml = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const iconoSvg = nombre => `<svg class="ico" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

    // --- UX-07: SISTEMA DE NOTIFICACIONES CON ANIMACIÓN Y ACCESIBILIDAD ---
    function mostrarMensaje(texto, tipo = 'info') {
        const banner = el('notificacionGlobal');
        if (!banner) return;

        temporizadoresNotificacion.forEach(clearTimeout);
        temporizadoresNotificacion = [];

        banner.className = `alert-banner mostrar alert-${tipo}`;
        banner.innerHTML = `<span>${escaparHtml(texto)}</span><button type="button" class="action-icon-btn" aria-label="Cerrar notificación">Cerrar</button>`;

        const btnCerrar = banner.querySelector('button');
        if (btnCerrar) {
            btnCerrar.onclick = () => {
                banner.classList.remove('mostrar');
                banner.style.display = 'none';
            };
        }
        banner.style.display = 'flex';

        const duracion = tipo === 'error' ? 8500 : CONSTANTES.DURACION_NOTIFICACION_MS;
        temporizadoresNotificacion.push(
            setTimeout(() => {
                banner.classList.remove('mostrar');
                banner.style.display = 'none';
            }, duracion)
        );
    }

    // --- UX-01: MODALES ACCESIBLES SIN DIÁLOGOS NATIVOS BLOQUEANTES ---
    function mostrarConfirmacion(mensaje, titulo = 'Confirmación') {
        const dialog = el('modalConfirmacion');
        if (!dialog || typeof dialog.showModal !== 'function') {
            return Promise.resolve(window.confirm(mensaje));
        }
        return new Promise(resolve => {
            el('modalConfirmTitulo').textContent = titulo;
            el('modalConfirmMensaje').textContent = mensaje;
            const btnAceptar = el('modalConfirmBtnAceptar');
            const btnCancelar = el('modalConfirmBtnCancelar');

            const limpiar = () => {
                btnAceptar.removeEventListener('click', onAceptar);
                btnCancelar.removeEventListener('click', onCancelar);
                dialog.removeEventListener('close', onClose);
            };
            const onAceptar = () => { limpiar(); dialog.close(); resolve(true); };
            const onCancelar = () => { limpiar(); dialog.close(); resolve(false); };
            const onClose = () => { limpiar(); resolve(false); };

            btnAceptar.addEventListener('click', onAceptar);
            btnCancelar.addEventListener('click', onCancelar);
            dialog.addEventListener('close', onClose);
            dialog.showModal();
        });
    }

    function mostrarPrompt(mensaje, valorInicial = '', titulo = 'Ingresar Valor') {
        const dialog = el('modalPrompt');
        if (!dialog || typeof dialog.showModal !== 'function') {
            return Promise.resolve(window.prompt(mensaje, valorInicial));
        }
        return new Promise(resolve => {
            el('modalPromptTitulo').textContent = titulo;
            el('modalPromptMensaje').textContent = mensaje;
            const input = el('modalPromptInput');
            input.value = valorInicial;
            const form = el('formModalPrompt');
            const btnCancelar = el('modalPromptBtnCancelar');

            const limpiar = () => {
                form.removeEventListener('submit', onSubmit);
                btnCancelar.removeEventListener('click', onCancelar);
                dialog.removeEventListener('close', onClose);
            };
            const onSubmit = (e) => {
                e.preventDefault();
                const val = input.value;
                limpiar();
                dialog.close();
                resolve(val);
            };
            const onCancelar = () => { limpiar(); dialog.close(); resolve(null); };
            const onClose = () => { limpiar(); resolve(null); };

            form.addEventListener('submit', onSubmit);
            btnCancelar.addEventListener('click', onCancelar);
            dialog.addEventListener('close', onClose);
            dialog.showModal();
            input.focus();
            input.select();
        });
    }

    // --- ARQ-03: MUTACIONES CENTRALIZADAS DEL ESTADO DE SESIÓN ---
    function agregarProductoASesion(nuevoProducto) {
        sesionActual.productos.unshift(nuevoProducto);
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function reemplazarProductoEnSesion(idLinea, nuevoProducto) {
        const idx = sesionActual.productos.findIndex(p => String(p.idLinea) === String(idLinea));
        if (idx < 0) return;
        sesionActual.productos[idx] = nuevoProducto;
        Almacenamiento.aprenderProductoEnDiccionario(nuevoProducto);
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function eliminarProductoDeSesion(idLinea) {
        sesionActual.productos = sesionActual.productos.filter(p => String(p.idLinea) !== String(idLinea));
        sincronizarYGuardarSesion();
        sincronizarYRenderizarProductos();
    }

    function vaciarSesion() {
        sesionActual = Almacenamiento.crearSesionVacia();
        Almacenamiento.guardarBorradorActivo(sesionActual);
        renderizarTodo();
        calcularEnVivo();
    }

    // --- CANDADO DE SEGURIDAD Y BÓVEDA DE FÓRMULAS ---
    function establecerBloqueoReglas(bloquear) {
        const fieldset = el('fieldsetReglas');
        const badge = el('estadoCandadoReglas');
        const boton = el('btnToggleCandadoReglas');

        fieldset.disabled = bloquear;
        if (bloquear) {
            badge.className = 'lock-badge lock-closed';
            badge.innerHTML = `${iconoSvg('lock')} Protegido contra cambios accidentales`;
            boton.innerHTML = `${iconoSvg('unlock')} Desbloquear para Editar`;
            boton.setAttribute('aria-label', 'Desbloquear configuración de fórmulas');
        } else {
            badge.className = 'lock-badge lock-open';
            badge.innerHTML = `${iconoSvg('unlock')} Modo Edición Activo`;
            boton.innerHTML = `${iconoSvg('lock')} Cancelar y Bloquear`;
            boton.setAttribute('aria-label', 'Bloquear configuración de fórmulas');
        }
    }

    function renderizarExplicacionDetalladaFormulas(reglasParaSimular) {
        const cont = el('cajaExplicacionFormulas');
        if (!cont) return;

        const r = Dominio.sanitizarReglasNegocio(reglasParaSimular);
        const pCascada = r.perfiles[ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO];
        const pDirecto = r.perfiles[ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO];
        const pFinanciero = r.perfiles[ESTRATEGIAS_CALCULO.MARGEN_BRUTO_FINANCIERO];

        const simCascada = Dominio.calcularDesglosePrecios(100, 10, false, {
            estrategia: ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO,
            porcentajeItbis: r.porcentajeItbis,
            porcentajePrecio1: pCascada.p1,
            porcentajePrecio2: pCascada.p2,
            porcentajePrecio3: pCascada.p3
        });
        const simDirecto = Dominio.calcularDesglosePrecios(100, 10, false, {
            estrategia: ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO,
            porcentajeItbis: r.porcentajeItbis,
            porcentajePrecio1: pDirecto.p1,
            porcentajePrecio2: pDirecto.p2,
            porcentajePrecio3: pDirecto.p3
        });
        const simFinanciero = Dominio.calcularDesglosePrecios(100, 10, false, {
            estrategia: ESTRATEGIAS_CALCULO.MARGEN_BRUTO_FINANCIERO,
            porcentajeItbis: r.porcentajeItbis,
            porcentajePrecio1: pFinanciero.p1,
            porcentajePrecio2: pFinanciero.p2,
            porcentajePrecio3: pFinanciero.p3
        });

        cont.innerHTML = `
            <div>
                <strong>Ejemplo práctico para entender las fórmulas:</strong>
                Imagina que compras <b>1 caja a $100.00</b> y trae <b>10 unidades</b>.
                Al dividir $100 &divide; 10, el <b>Costo Unitario es $10.00000000</b> (8 decimales para exactitud del inventario).
                <i>Nota: Cada fórmula guarda sus propios porcentajes de manera independiente.</i>
            </div>
            <div class="formula-grid">
                <div class="formula-card ${r.estrategia === ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO ? 'activa' : ''}">
                    <strong>1. Cascada (Estándar de la farmacia)</strong>
                    <div style="font-size:0.8rem; margin-top:6px;">
                        Sube el costo para sacar el Precio 1, y luego rebaja sobre el precio anterior:<br>
                        • <b>Precio 1 (+${pCascada.p1}%):</b> $10 + ${pCascada.p1}% = <b>$${simCascada.p1Exacto}</b><br>
                        • <b>Precio 2 (-${pCascada.p2}% a P1):</b> $${simCascada.p1Exacto} - ${pCascada.p2}% = <b>$${simCascada.p2Exacto}</b><br>
                        • <b>Precio 3 (-${pCascada.p3}% a P2):</b> $${simCascada.p2Exacto} - ${pCascada.p3}% = <b>${simCascada.p3Bruto}</b><br>
                        &rarr; Con 2 decimales: <b>$${simCascada.p3Exacto}</b> | Redondeado: <b>$${simCascada.p3Redondeado}</b>
                    </div>
                </div>
                <div class="formula-card ${r.estrategia === ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO ? 'activa' : ''}">
                    <strong>2. Ganancia Directa sobre el Costo</strong>
                    <div style="font-size:0.8rem; margin-top:6px;">
                        Cada precio suma su propio porcentaje de ganancia directamente al Costo ($10.00):<br>
                        • <b>Precio 1 (+${pDirecto.p1}%):</b> $10 + ${pDirecto.p1}% = <b>$${simDirecto.p1Exacto}</b><br>
                        • <b>Precio 2 (+${pDirecto.p2}%):</b> $10 + ${pDirecto.p2}% = <b>$${simDirecto.p2Exacto}</b><br>
                        • <b>Precio 3 (+${pDirecto.p3}%):</b> $10 + ${pDirecto.p3}% = <b>$${simDirecto.p3Exacto}</b>
                    </div>
                </div>
                <div class="formula-card ${r.estrategia === ESTRATEGIAS_CALCULO.MARGEN_BRUTO_FINANCIERO ? 'activa' : ''}">
                    <strong>3. Margen Contable sobre Precio Final</strong>
                    <div style="font-size:0.8rem; margin-top:6px;">
                        Divide el costo entre <code>(100% - ${pFinanciero.p1}%)</code> para ganar el ${pFinanciero.p1}% sobre el total cobrado, y rebaja en cascada:<br>
                        • <b>Precio 1:</b> $10 &divide; ${(1 - pFinanciero.p1 / 100).toFixed(2)} = <b>$${simFinanciero.p1Exacto}</b><br>
                        • <b>Precio 2 (-${pFinanciero.p2}% a P1):</b> <b>$${simFinanciero.p2Exacto}</b><br>
                        • <b>Precio 3 (-${pFinanciero.p3}% a P2):</b> <b>$${simFinanciero.p3Exacto}</b>
                    </div>
                </div>
            </div>
        `;
    }

    // COD-12: Usa el parámetro sanitizado `r` en lugar de la variable global reglasActivas
    function actualizarEtiquetasReglasUI(reglasMostradas = reglasActivas) {
        const r = Dominio.sanitizarReglasNegocio(reglasMostradas);
        el('lblItbisToggle').textContent = `Sumar ${r.porcentajeItbis}% ITBIS al costo`;
        el('lblTituloP1').textContent = `Precio 1 (+${r.porcentajePrecio1}%)`;

        if (r.estrategia === ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO) {
            el('lblTituloP2').textContent = `Precio 2 (Costo +${r.porcentajePrecio2}%)`;
            el('lblTituloP3').textContent = `Precio 3 (Costo +${r.porcentajePrecio3}%)`;
            el('lblCfgP2').textContent = 'Porcentaje Precio 2 (+% sobre Costo)';
            el('lblCfgP3').textContent = 'Porcentaje Precio 3 (+% sobre Costo)';
        } else {
            el('lblTituloP2').textContent = `Precio 2 (Precio 1 -${r.porcentajePrecio2}%)`;
            el('lblTituloP3').textContent = `Precio 3 (Precio 2 -${r.porcentajePrecio3}%)`;
            el('lblCfgP2').textContent = 'Descuento Precio 2 (-% sobre P1)';
            el('lblCfgP3').textContent = 'Descuento Precio 3 (-% sobre P2)';
        }

        el('cfgEstrategia').value = r.estrategia;
        el('cfgItbisPct').value = r.porcentajeItbis;
        el('cfgP1Pct').value = r.porcentajePrecio1;
        el('cfgP2Pct').value = r.porcentajePrecio2;
        el('cfgP3Pct').value = r.porcentajePrecio3;

        renderizarExplicacionDetalladaFormulas(r);
    }

    // --- CÁLCULO EN VIVO CON DEBOUNCE (REN-04) ---
    function calcularEnVivo() {
        const tipo = el('calcTipo').value;
        const vCajas = Dominio.validarCantidadEnteraPositiva(el('calcCajasCompradas').value, 'cajas');
        const vPrecio = Dominio.validarPrecioCompra(el('calcPrecioCaja').value);
        const vUnidades = tipo === CONSTANTES.CATEGORIAS.ENTERO
            ? { esValido: true, valor: 1 }
            : Dominio.validarCantidadEnteraPositiva(el('calcUnidadesCaja').value, 'unidades');

        const resumenActual = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);
        const factorItbis = 1 + (reglasActivas.porcentajeItbis / 100);

        if (vPrecio.esValido && vCajas.esValido) {
            const costoCaja = el('calcItbis').checked ? (vPrecio.valor * factorItbis) : vPrecio.valor;
            const subtotalLinea = Dominio.redondearDecimalExacto(vCajas.valor * costoCaja, CONSTANTES.DECIMALES_MONEDA);
            const acumuladoConLinea = Dominio.redondearDecimalExacto(resumenActual.sumaAcumulada + subtotalLinea, CONSTANTES.DECIMALES_MONEDA);
            el('resSubtotalLinea').textContent = '$' + Dominio.formatearMonedaDosDecimales(subtotalLinea);
            el('resAcumuladoConLinea').textContent = '$' + Dominio.formatearMonedaDosDecimales(acumuladoConLinea);
        } else {
            el('resSubtotalLinea').textContent = '$0.00';
            el('resAcumuladoConLinea').textContent = '$' + Dominio.formatearMonedaDosDecimales(resumenActual.sumaAcumulada);
        }

        if (vCajas.esValido && vUnidades.esValido) {
            el('resTotalUnidadesInventario').textContent = String(vCajas.valor * vUnidades.valor);
        } else {
            el('resTotalUnidadesInventario').textContent = '0';
        }

        if (!vPrecio.esValido || !vUnidades.esValido) {
            el('resCostoUnitario').textContent = '0.00000000';
            [1, 2, 3].forEach(n => {
                el('resPrecio' + n).textContent = '0.00';
                el('subPrecio' + n).textContent = 'Exacto: 0.00 | Redondeado: 0';
            });
            return;
        }

        const desglose = Dominio.calcularDesglosePrecios(
            vPrecio.valor,
            vUnidades.valor,
            el('calcItbis').checked,
            reglasActivas
        );
        const usarRedondeo = el('calcRedondeo').checked;

        el('resCostoUnitario').textContent = desglose.costoUnitario;
        [1, 2, 3].forEach(n => {
            el('resPrecio' + n).textContent = usarRedondeo ? desglose['p' + n + 'Redondeado'] : desglose['p' + n + 'Exacto'];
            el('subPrecio' + n).textContent = `Exacto: ${desglose['p' + n + 'Exacto']} (Bruto: ${desglose['p' + n + 'Bruto']}) | Redondeado: ${desglose['p' + n + 'Redondeado']}`;
        });
    }

    function dispararCalculoDebounced() {
        if (temporizadorDebounceCalculo) clearTimeout(temporizadorDebounceCalculo);
        temporizadorDebounceCalculo = setTimeout(calcularEnVivo, CONSTANTES.DEBOUNCE_CALCULO_MS);
    }

    function actualizarVisibilidadCategoria() {
        const tipo = el('calcTipo').value;
        const contenedor = el('boxUnidadesPorCaja');
        const inputUnidades = el('calcUnidadesCaja');
        if (tipo === CONSTANTES.CATEGORIAS.ENTERO) {
            contenedor.style.display = 'none';
            inputUnidades.value = '1';
        } else {
            contenedor.style.display = 'block';
            if (inputUnidades.value === '1') inputUnidades.value = '';
        }
        calcularEnVivo();
    }

    // --- FLUJO DEL LECTOR DE CÓDIGO DE BARRAS ---
    function procesarEscaneoCodigoBarras() {
        const codigo = Dominio.normalizarCodigoBarras(el('calcCodigoBarras').value);
        if (!codigo) return;

        const aprendido = Almacenamiento.buscarProductoPorCodigo(codigo);
        if (aprendido) {
            el('calcNombre').value = aprendido.nombre;
            el('calcTipo').value = aprendido.tipo;
            actualizarVisibilidadCategoria();
            if (aprendido.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
                el('calcUnidadesCaja').value = aprendido.unidadesPorCaja;
            }
            el('calcItbis').checked = Boolean(aprendido.aplicaItbis);
            calcularEnVivo();
            mostrarMensaje(`Código reconocido: "${aprendido.nombre}". Ingresa Cajas y Precio.`, 'success');
        } else {
            mostrarMensaje(`Código nuevo (${codigo}). Escribe el Nombre y datos para memorizarlo automáticamente.`, 'info');
        }
        el('calcCajasCompradas').focus();
        el('calcCajasCompradas').select();
    }

    async function solicitarConfirmacionCajas(valorCrudo) {
        const texto = String(valorCrudo ?? '').trim();
        if (texto === '') {
            const aceptaUnaCaja = await mostrarConfirmacion(
                'No escribiste cuántas CAJAS compraste en la factura.\n\n¿Compraste 1 sola caja o frasco?',
                'Confirmar Cantidad de Cajas'
            );
            if (aceptaUnaCaja) {
                return { esValido: true, valor: 1 };
            }
            return { esValido: false, error: '' };
        }
        return Dominio.validarCantidadEnteraPositiva(texto, 'la cantidad de cajas en factura');
    }

    async function agregarProductoAFactura() {
        const enfocarConError = (idInput, mensaje) => {
            if (mensaje) mostrarMensaje(mensaje, 'error');
            const input = el(idInput);
            input.focus();
            if (input.select) input.select();
        };

        const vCajas = await solicitarConfirmacionCajas(el('calcCajasCompradas').value);
        if (!vCajas.esValido) return enfocarConError('calcCajasCompradas', vCajas.error);

        const vPrecio = Dominio.validarPrecioCompra(el('calcPrecioCaja').value);
        if (!vPrecio.esValido) return enfocarConError('calcPrecioCaja', vPrecio.error);

        const tipo = el('calcTipo').value;
        let vUnidades = { esValido: true, valor: 1 };
        if (tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
            vUnidades = Dominio.validarCantidadEnteraPositiva(el('calcUnidadesCaja').value, 'las unidades que trae la caja');
            if (!vUnidades.esValido) return enfocarConError('calcUnidadesCaja', vUnidades.error);
        }

        const nuevaLinea = Dominio.crearLineaProductoInmutable({
            codigoBarras: el('calcCodigoBarras').value,
            nombre: el('calcNombre').value.trim() || `Producto #${sesionActual.productos.length + 1}`,
            tipo,
            precioCajaBase: vPrecio.valor,
            unidadesPorCaja: vUnidades.valor,
            cajasCompradas: vCajas.valor,
            aplicaItbis: el('calcItbis').checked
        }, reglasActivas);

        const aprendioCodigo = Almacenamiento.aprenderProductoEnDiccionario(nuevaLinea);
        agregarProductoASesion(nuevaLinea);

        ['calcCodigoBarras', 'calcNombre', 'calcPrecioCaja', 'calcCajasCompradas'].forEach(id => { el(id).value = ''; });
        if (tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) el('calcUnidadesCaja').value = '';
        calcularEnVivo();

        if (aprendioCodigo) {
            mostrarMensaje(`Producto agregado y código "${nuevaLinea.codigoBarras}" memorizado en el diccionario.`, 'success');
            renderizarDiccionarioUI();
        }
        el('calcCajasCompradas').focus();
    }

    // --- ATAJOS DE TECLADO ---
    function configurarAtajosTeclado() {
        const seccionCalc = el('seccionCalculadora');

        seccionCalc.addEventListener('keydown', e => {
            const esCampoTexto = e.target.id === 'calcNombre' || e.target.id === 'calcCodigoBarras';
            const presionaEspacio = (e.code === 'Space' || e.key === ' ') && (!esCampoTexto || e.ctrlKey);

            if (presionaEspacio) {
                e.preventDefault();
                const selectTipo = el('calcTipo');
                selectTipo.value = selectTipo.value === CONSTANTES.CATEGORIAS.DIVISIBLE ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
                actualizarVisibilidadCategoria();
                selectTipo.classList.add('flash');
                setTimeout(() => selectTipo.classList.remove('flash'), 400);
                return;
            }

            if (e.key !== 'Enter') return;

            if (e.target.id === 'calcCodigoBarras') {
                e.preventDefault();
                procesarEscaneoCodigoBarras();
                return;
            }

            if (e.target.id === 'calcNombre') {
                e.preventDefault();
                el('calcCajasCompradas').focus();
                return;
            }

            const ordenFlujoNumerico = ['calcCajasCompradas', 'calcPrecioCaja'].concat(
                el('calcTipo').value === CONSTANTES.CATEGORIAS.DIVISIBLE ? ['calcUnidadesCaja'] : []
            );
            const indiceActual = ordenFlujoNumerico.indexOf(e.target.id);
            if (indiceActual === -1) return;

            e.preventDefault();
            if (indiceActual < ordenFlujoNumerico.length - 1) {
                const siguienteInput = el(ordenFlujoNumerico[indiceActual + 1]);
                siguienteInput.focus();
                if (siguienteInput.select) siguienteInput.select();
            } else {
                agregarProductoAFactura();
            }
        });
    }

    function buscarFacturaDuplicada() {
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
        const alerta = el('alertaFacturaDuplicada');
        const duplicada = buscarFacturaDuplicada();
        if (!duplicada) {
            alerta.style.display = 'none';
            return false;
        }
        alerta.style.display = 'flex';
        alerta.innerHTML = `<span>${iconoSvg('warn')} El proveedor <b>${escaparHtml(sesionActual.proveedor)}</b> ya tiene la factura <b>#${escaparHtml(sesionActual.numeroFactura)}</b>.</span>
            <button class="action-icon-btn" data-reabrir="${escaparHtml(duplicada.id)}">${iconoSvg('folder')} Reabrir Existente</button>`;
        alerta.querySelector('[data-reabrir]').onclick = () => reabrirFacturaDeHistorial(duplicada.id);
        return true;
    }

    function sincronizarYGuardarSesion() {
        Almacenamiento.guardarBorradorActivo(sesionActual);
        if (!sesionActual.id || !sesionActual.proveedor || !sesionActual.numeroFactura || buscarFacturaDuplicada()) return;

        const historial = Almacenamiento.obtenerHistorialFacturas();
        const idx = historial.findIndex(f => f.id === sesionActual.id);
        if (idx < 0) return;

        const resumen = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);
        historial[idx] = {
            ...Dominio.clonarObjetoSeguro(sesionActual),
            totalCalculado: resumen.sumaAcumulada,
            timestampGuardado: Date.now()
        };
        Almacenamiento.guardarHistorialFacturas(historial);
    }

    function actualizarCabeceraFacturaDesdeUI() {
        sesionActual.proveedor = el('facProveedor').value.trim();
        sesionActual.numeroFactura = el('facNumero').value.trim();
        sesionActual.fechaEmision = el('facFechaEmision').value;
        sesionActual.fechaVencimiento = el('facFechaVencimiento').value;
        sesionActual.totalFisico = parseFloat(el('facTotalFisico').value) || 0;

        verificarDuplicadoUI();
        sincronizarYGuardarSesion();
        actualizarBarraSuperior();
        calcularEnVivo();
    }

    function actualizarBarraSuperior() {
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

    // REN-01: Renderizado selectivo de la tabla de productos y barra sin tocar historial ni diccionario
    function sincronizarYRenderizarProductos() {
        actualizarBarraSuperior();
        renderizarTablaProductosActuales();
        calcularEnVivo();
    }

    function renderizarTablaProductosActuales() {
        const tbody = el('tablaProductosActuales');
        const usarRedondeo = el('calcRedondeo').checked;

        if (!sesionActual.productos.length) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center p-18 text-muted">Sin productos registrados en esta factura.</td></tr>`;
            return;
        }

        const celdaPrecio = (p, n) => {
            const exacto = p['p' + n + 'Exacto'];
            const redondeado = p['p' + n + 'Redondeado'];
            const esManual = p.manual && p.manual['p' + n];
            // Sanitización y escape estricto de idLinea
            const idEscapado = escaparHtml(p.idLinea);
            return `<td class="mono celda-edit c-p${n}" data-id="${idEscapado}" data-campo="p${n}">
                ${usarRedondeo ? redondeado : exacto}
                <span class="fs-xs text-muted">(${usarRedondeo ? exacto : redondeado})</span>
                ${esManual ? `<span title="Editado a mano">✎</span><button class="action-icon-btn" data-accion="restaurar" data-campo="p${n}" data-id="${idEscapado}" title="Restaurar cálculo" aria-label="Restaurar cálculo Precio ${n}">↺</button>` : ''}
            </td>`;
        };

        tbody.innerHTML = sesionActual.productos.map(p => {
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
        if (producto.tipo === CONSTANTES.CATEGORIAS.ENTERO) {
            const respuesta = await mostrarPrompt('Cambiar a "Se divide". ¿Cuántas unidades (pastillas/ampollas) trae 1 caja?', '10', 'Unidades por Caja');
            if (respuesta === null) return;
            const validacion = Dominio.validarCantidadEnteraPositiva(respuesta, 'las unidades por caja');
            if (!validacion.esValido) return mostrarMensaje(validacion.error, 'error');

            const actualizado = Dominio.crearLineaProductoInmutable({
                ...producto,
                tipo: CONSTANTES.CATEGORIAS.DIVISIBLE,
                unidadesPorCaja: validacion.valor,
                manual: {}
            }, reglasActivas);
            reemplazarProductoEnSesion(producto.idLinea, actualizado);
        } else {
            const actualizado = Dominio.crearLineaProductoInmutable({
                ...producto,
                tipo: CONSTANTES.CATEGORIAS.ENTERO,
                unidadesPorCaja: 1,
                manual: {}
            }, reglasActivas);
            reemplazarProductoEnSesion(producto.idLinea, actualizado);
        }
    }

    function iniciarEdicionCeldaTabla(td) {
        const producto = sesionActual.productos.find(p => String(p.idLinea) === String(td.dataset.id));
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
        const datosClonados = { ...producto, manual: { ...(producto.manual || {}) } };

        if (campo === 'nombre') {
            if (!nuevoTexto.trim()) return mostrarMensaje('El nombre no puede quedar vacío.', 'error');
            datosClonados.nombre = nuevoTexto.trim();
        } else if (campo === 'cajasCompradas') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las cajas compradas');
            if (!v.esValido) return mostrarMensaje(v.error, 'error');
            datosClonados.cajasCompradas = v.valor;
        } else if (campo === 'unidadesPorCaja') {
            const v = Dominio.validarCantidadEnteraPositiva(nuevoTexto, 'las unidades por caja');
            if (!v.esValido) return mostrarMensaje(v.error, 'error');
            datosClonados.unidadesPorCaja = v.valor;
            datosClonados.tipo = v.valor > 1 ? CONSTANTES.CATEGORIAS.DIVISIBLE : datosClonados.tipo;
            datosClonados.manual = {};
        } else if (campo === 'precioCajaBase') {
            const v = Dominio.validarPrecioCompra(nuevoTexto);
            if (!v.esValido) return mostrarMensaje(v.error, 'error');
            datosClonados.precioCajaBase = v.valor;
            datosClonados.manual = {};
        } else if (['p1', 'p2', 'p3'].includes(campo)) {
            const v = Dominio.validarPrecioCompra(nuevoTexto);
            if (!v.esValido) return mostrarMensaje(v.error, 'error');
            datosClonados.manual[campo] = true;
            datosClonados[campo + 'Exacto'] = Dominio.formatearMonedaDosDecimales(v.valor);
            datosClonados[campo + 'Redondeado'] = String(Math.round(v.valor));
        }

        reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable(datosClonados, reglasActivas));
    }

    async function editarFilaCompletaConDialogo(producto) {
        const nuevoNombre = await mostrarPrompt('Nombre del producto:', producto.nombre, 'Editar Producto');
        if (nuevoNombre === null) return;
        const nuevasCajas = await mostrarPrompt('Cajas en factura:', producto.cajasCompradas, 'Cajas en Factura');
        if (nuevasCajas === null) return;
        const vCajas = Dominio.validarCantidadEnteraPositiva(nuevasCajas, 'cajas');
        if (!vCajas.esValido) return mostrarMensaje(vCajas.error, 'error');

        const nuevoPrecio = await mostrarPrompt('Precio de compra de 1 caja:', producto.precioCajaBase, 'Precio de Compra');
        if (nuevoPrecio === null) return;
        const vPrecio = Dominio.validarPrecioCompra(nuevoPrecio);
        if (!vPrecio.esValido) return mostrarMensaje(vPrecio.error, 'error');

        let unidades = 1;
        if (producto.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
            const nuevasUds = await mostrarPrompt('Unidades por caja:', producto.unidadesPorCaja, 'Unidades por Caja');
            if (nuevasUds === null) return;
            const vUds = Dominio.validarCantidadEnteraPositiva(nuevasUds, 'unidades');
            if (!vUds.esValido) return mostrarMensaje(vUds.error, 'error');
            unidades = vUds.valor;
        }

        reemplazarProductoEnSesion(producto.idLinea, Dominio.crearLineaProductoInmutable({
            ...producto,
            nombre: nuevoNombre.trim() || producto.nombre,
            cajasCompradas: vCajas.valor,
            precioCajaBase: vPrecio.valor,
            unidadesPorCaja: unidades,
            manual: {}
        }, reglasActivas));
    }

    // --- DICCIONARIO DE CÓDIGOS DE BARRAS (COD-06 + SEG-03 + SEG-04 CORREGIDOS) ---
    function renderizarDiccionarioUI() {
        const contenedor = el('contenedorDiccionario');
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const codigos = Object.keys(diccionario);

        if (!codigos.length) {
            contenedor.innerHTML = `<div class="text-center p-18 text-muted">Aún no hay códigos de barra memorizados. Escanea un producto en la calculadora y agrégalo para aprenderlo.</div>`;
            return;
        }

        // Eliminadas las barras de escape en literales de plantilla ${...}
        contenedor.innerHTML = `
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Código de Barras</th>
                            <th>Producto Memorizado</th>
                            <th>Categoría</th>
                            <th>Unidades/Caja</th>
                            <th>Último Costo Caja</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${codigos.map(cod => {
                            const item = diccionario[cod];
                            const codEscapado = escaparHtml(cod);
                            return `<tr>
                                <td class="mono">${escaparHtml(item.codigoBarras)}</td>
                                <td><strong>${escaparHtml(item.nombre)}</strong></td>
                                <td>${item.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}</td>
                                <td class="mono">${item.unidadesPorCaja}</td>
                                <td class="mono">$${Number(item.ultimoPrecioCaja || 0).toFixed(2)}</td>
                                <td>
                                    <button type="button" class="action-icon-btn" data-usar-codigo="${codEscapado}" aria-label="Cargar ${escaparHtml(item.nombre)} en calculadora">Cargar en Calculadora</button>
                                    <button type="button" class="action-icon-btn text-danger" data-borrar-codigo="${codEscapado}" aria-label="Eliminar código ${codEscapado}">${iconoSvg('trash')}</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function descargarDiccionarioJson() {
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        if (Object.keys(diccionario).length === 0) {
            return mostrarMensaje('El diccionario de códigos está vacío. No hay datos para descargar.', 'error');
        }
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            diccionario
        }, `diccionario-codigos-farmacia-${Dominio.obtenerFechaLocalISO()}.json`);
    }

    async function restaurarDiccionarioJson(inputArchivo) {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
        if (!archivo) return;

        try {
            const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
            if (datos.tipo !== CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS || !datos.diccionario || typeof datos.diccionario !== 'object') {
                throw new Error('Ese archivo no es un respaldo válido del diccionario de códigos.');
            }
            const actual = Almacenamiento.obtenerDiccionarioCodigos();
            let agregados = 0;
            Object.entries(datos.diccionario).forEach(([cod, info]) => {
                const codigoLimpio = Dominio.normalizarCodigoBarras(cod);
                if (codigoLimpio && info && info.nombre) {
                    actual[codigoLimpio] = {
                        codigoBarras: codigoLimpio,
                        nombre: String(info.nombre).trim(),
                        tipo: info.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE,
                        unidadesPorCaja: info.tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(info.unidadesPorCaja) || 1),
                        ultimoPrecioCaja: Number(info.ultimoPrecioCaja) || 0,
                        aplicaItbis: Boolean(info.aplicaItbis),
                        actualizadoEn: info.actualizadoEn || new Date().toISOString()
                    };
                    agregados++;
                }
            });
            Almacenamiento.guardarDiccionarioCodigos(actual);
            renderizarDiccionarioUI();
            actualizarBarraSuperior();
            mostrarMensaje(`Diccionario actualizado: ${agregados} códigos importados correctamente.`, 'success');
        } catch (error) {
            mostrarMensaje(error.message, 'error');
        }
    }

    // --- GUARDADO Y CIERRE DE FACTURA ---
    function finalizarYGuardarFactura() {
        actualizarCabeceraFacturaDesdeUI();
        if (!sesionActual.proveedor || !sesionActual.numeroFactura || !sesionActual.fechaEmision) {
            mostrarMensaje('Completa Proveedor, Número de Factura y Fecha de Emisión antes de guardar.', 'error');
            el('seccionDatosFactura').scrollIntoView({ behavior: 'smooth' });
            return;
        }
        if (!sesionActual.productos.length) {
            return mostrarMensaje('Agrega al menos un producto antes de finalizar la factura.', 'error');
        }
        if (verificarDuplicadoUI()) {
            return mostrarMensaje('Este proveedor ya tiene registrada una factura con ese número.', 'error');
        }

        const historial = Almacenamiento.obtenerHistorialFacturas();
        const resumen = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);

        // DAT-05: Guarda qué reglas de cálculo y porcentajes se usaron en esta factura
        const facturaCerrada = {
            ...Dominio.clonarObjetoSeguro(sesionActual),
            id: sesionActual.id || Dominio.generarIdUnico(),
            totalCalculado: resumen.sumaAcumulada,
            timestampGuardado: Date.now(),
            reglasCalculoUsadas: Dominio.clonarObjetoSeguro(reglasActivas)
        };

        const idx = historial.findIndex(f => f.id === facturaCerrada.id);
        if (idx >= 0) historial[idx] = facturaCerrada;
        else historial.unshift(facturaCerrada);

        const guardado = Almacenamiento.guardarHistorialFacturas(historial);
        if (!guardado.exito) {
            return mostrarMensaje(guardado.error || 'Error al guardar la factura en el historial.', 'error');
        }

        sesionActual = Almacenamiento.crearSesionVacia();
        Almacenamiento.guardarBorradorActivo(sesionActual);
        renderizarTodo();
        calcularEnVivo();
        mostrarMensaje('Factura guardada correctamente en el historial.', 'success');
    }

    async function reabrirFacturaDeHistorial(idFactura) {
        const factura = Almacenamiento.obtenerHistorialFacturas().find(x => x.id === idFactura);
        if (!factura) return;
        if (sesionActual.id || sesionActual.productos.length) {
            const descartar = await mostrarConfirmacion('Hay datos en la factura actual. ¿Deseas abrir la factura guardada y descartar el borrador en curso?', 'Reabrir Factura');
            if (!descartar) return;
        }
        sesionActual = Dominio.clonarObjetoSeguro(factura);
        Almacenamiento.guardarBorradorActivo(sesionActual);
        renderizarTodo();
        calcularEnVivo();
        el('seccionProductosRegistrados').scrollIntoView({ behavior: 'smooth' });
    }

    // --- HISTORIAL (7 DÍAS) CON AVISO DE EXPIRACIÓN (DAT-02) ---
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

    function descargarRespaldoFacturas() {
        const historial = Almacenamiento.obtenerHistorialFacturas();
        if (historial.length === 0 && sesionActual.productos.length === 0) {
            return mostrarMensaje('El historial y la factura actual están vacíos. No hay datos para descargar.', 'error');
        }
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_RESPALDO_FACTURAS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            historial,
            borrador: sesionActual
        }, `respaldo-farmacia-${Dominio.obtenerFechaLocalISO()}.json`);
    }

    async function restaurarRespaldoFacturas(inputArchivo) {
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
                    const productosSanitizados = fac.productos.map(p => Dominio.crearLineaProductoInmutable(p, reglasActivas));
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
            mostrarMensaje(`Respaldo restaurado: ${agregadas} facturas añadidas.`, 'success');
        } catch (error) {
            mostrarMensaje(error.message, 'error');
        }
    }

    // --- IMPRESIÓN LIMPIA DE FACTURA (COD-06 CORREGIDO) ---
    function imprimirFactura(factura) {
        if (!factura || !factura.productos.length) {
            return mostrarMensaje('No hay productos para imprimir.', 'error');
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
                        <th>Cajas</th>
                        <th>Uds/Caja</th>
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

    function renderizarTodo() {
        el('facProveedor').value = sesionActual.proveedor;
        el('facNumero').value = sesionActual.numeroFactura;
        el('facFechaEmision').value = sesionActual.fechaEmision;
        el('facFechaVencimiento').value = sesionActual.fechaVencimiento;
        el('facTotalFisico').value = sesionActual.totalFisico || '';
        el('avisoEdicion').style.display = sesionActual.id ? 'flex' : 'none';
        el('txtFinalizar').textContent = sesionActual.id ? 'Guardar cambios y cerrar' : 'Finalizar y Guardar';
        el('txtDescartar').textContent = sesionActual.id ? 'Salir de edición' : 'Descartar factura';

        actualizarEtiquetasReglasUI();
        actualizarBarraSuperior();
        renderizarTablaProductosActuales();
        renderizarDiccionarioUI();
        renderizarHistorialUI();
    }

    // --- QA-04: MANEJADORES GLOBALES DE ERRORES ---
    window.addEventListener('error', event => {
        console.error('Error global capturado:', event.error || event.message);
        mostrarMensaje(`Error inesperado en la interfaz: ${event.message || 'Consulta la consola'}`, 'error');
    });

    window.addEventListener('unhandledrejection', event => {
        console.error('Promesa no controlada:', event.reason);
        const razon = event.reason?.message || String(event.reason || 'Operación no completada');
        mostrarMensaje(`Error en proceso asíncrono: ${razon}`, 'error');
    });

    // --- COD-11: INICIALIZACIÓN PROTEGIDA CON TRY/CATCH ---
    window.addEventListener('DOMContentLoaded', () => {
        try {
            Almacenamiento.limpiarHistorialExpirado7Dias();
            sesionActual = Almacenamiento.cargarBorradorActivo();
            reglasActivas = Almacenamiento.obtenerReglasNegocio();

            // SEG-01: Migrar API Key de localStorage a sessionStorage por seguridad
            const legacyKey = localStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY);
            if (legacyKey) {
                sessionStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY, legacyKey);
                localStorage.removeItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY);
            }
            el('iaApiKey').value = sessionStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY) || '';
            el('iaModelo').value = localStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_MODELO) || CONSTANTES.MODELO_IA_POR_DEFECTO;

            establecerBloqueoReglas(true);
            configurarAtajosTeclado();
            actualizarVisibilidadCategoria();
            renderizarTodo();

            // Eventos Calculadora
            el('calcTipo').addEventListener('change', actualizarVisibilidadCategoria);
            ['calcCajasCompradas', 'calcPrecioCaja', 'calcUnidadesCaja'].forEach(id => {
                el(id).addEventListener('input', dispararCalculoDebounced);
            });
            el('calcItbis').addEventListener('change', calcularEnVivo);
            el('calcRedondeo').addEventListener('change', () => {
                calcularEnVivo();
                renderizarTablaProductosActuales();
            });
            el('btnAgregarProducto').addEventListener('click', agregarProductoAFactura);

            // Eventos Copiar
            document.querySelectorAll('[data-copiar]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const texto = el(btn.dataset.copiar).textContent;
                    navigator.clipboard.writeText(texto).then(() => {
                        const original = btn.innerHTML;
                        btn.innerHTML = `${iconoSvg('check')} Copiado`;
                        setTimeout(() => { btn.innerHTML = original; }, 1100);
                    });
                });
            });

            // Eventos Cabecera Factura
            ['facProveedor', 'facNumero', 'facTotalFisico', 'facFechaEmision', 'facFechaVencimiento'].forEach(id => {
                el(id).addEventListener('input', actualizarCabeceraFacturaDesdeUI);
            });

            // Eventos Tabla Productos
            el('tablaProductosActuales').addEventListener('click', async e => {
                const btnAccion = e.target.closest('[data-accion]');
                if (btnAccion) {
                    const idProd = btnAccion.dataset.id;
                    const prod = sesionActual.productos.find(p => String(p.idLinea) === String(idProd));
                    if (!prod) return;

                    if (btnAccion.dataset.accion === 'editar') {
                        await editarFilaCompletaConDialogo(prod);
                    } else if (btnAccion.dataset.accion === 'eliminar') {
                        eliminarProductoDeSesion(prod.idLinea);
                    } else if (btnAccion.dataset.accion === 'restaurar') {
                        const manual = { ...(prod.manual || {}), [btnAccion.dataset.campo]: false };
                        reemplazarProductoEnSesion(prod.idLinea, Dominio.crearLineaProductoInmutable({ ...prod, manual }, reglasActivas));
                    }
                    return;
                }
                const td = e.target.closest('td.celda-edit');
                if (td && !td.querySelector('input')) iniciarEdicionCeldaTabla(td);
            });

            // Eventos Botones Factura
            el('btnImprimirActual').addEventListener('click', () => imprimirFactura(sesionActual));
            el('btnFinalizarFactura').addEventListener('click', finalizarYGuardarFactura);
            el('btnDescartar').addEventListener('click', async () => {
                if (sesionActual.id || (await mostrarConfirmacion('¿Deseas descartar la factura en curso y limpiar todos los datos?', 'Descartar Factura'))) {
                    vaciarSesion();
                }
            });

            // Eventos Diccionario de Códigos
            el('btnDescargarDiccionario').addEventListener('click', descargarDiccionarioJson);
            el('inputRestaurarDiccionario').addEventListener('change', e => restaurarDiccionarioJson(e.target));
            el('contenedorDiccionario').addEventListener('click', async e => {
                const btnUsar = e.target.closest('[data-usar-codigo]');
                if (btnUsar) {
                    el('calcCodigoBarras').value = btnUsar.dataset.usarCodigo;
                    procesarEscaneoCodigoBarras();
                    el('seccionCalculadora').scrollIntoView({ behavior: 'smooth' });
                    return;
                }
                const btnBorrar = e.target.closest('[data-borrar-codigo]');
                if (btnBorrar) {
                    const confirmarBorrado = await mostrarConfirmacion('¿Eliminar este código y su nombre memorizado del diccionario?', 'Eliminar Código');
                    if (confirmarBorrado) {
                        Almacenamiento.eliminarCodigoDeDiccionario(btnBorrar.dataset.borrarCodigo);
                        renderizarDiccionarioUI();
                        actualizarBarraSuperior();
                    }
                }
            });

            // Eventos Candado y Configuración de Fórmulas
            let borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(reglasActivas.perfiles);

            el('btnToggleCandadoReglas').addEventListener('click', async () => {
                const estaBloqueado = el('fieldsetReglas').disabled;
                if (estaBloqueado) {
                    const desbloquear = await mostrarConfirmacion('¿Deseas desbloquear la configuración de fórmulas matemáticas para editarlas?', 'Desbloquear Fórmulas');
                    if (desbloquear) {
                        borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(reglasActivas.perfiles);
                        establecerBloqueoReglas(false);
                    }
                } else {
                    borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(reglasActivas.perfiles);
                    actualizarEtiquetasReglasUI(reglasActivas);
                    establecerBloqueoReglas(true);
                }
            });

            el('cfgEstrategia').addEventListener('change', () => {
                const nuevaEstrategia = el('cfgEstrategia').value;
                const perfilDeEsaFormula = borradorPerfilesEdicion[nuevaEstrategia] || { p1: 30, p2: 5, p3: 5 };
                actualizarEtiquetasReglasUI({
                    estrategia: nuevaEstrategia,
                    porcentajeItbis: el('cfgItbisPct').value,
                    porcentajePrecio1: perfilDeEsaFormula.p1,
                    porcentajePrecio2: perfilDeEsaFormula.p2,
                    porcentajePrecio3: perfilDeEsaFormula.p3,
                    perfiles: borradorPerfilesEdicion
                });
            });

            const previsualizarCambiosReglas = () => {
                const estActual = el('cfgEstrategia').value;
                borradorPerfilesEdicion[estActual] = {
                    p1: Number(el('cfgP1Pct').value) || 0,
                    p2: Number(el('cfgP2Pct').value) || 0,
                    p3: Number(el('cfgP3Pct').value) || 0
                };
                renderizarExplicacionDetalladaFormulas({
                    estrategia: estActual,
                    porcentajeItbis: el('cfgItbisPct').value,
                    porcentajePrecio1: el('cfgP1Pct').value,
                    porcentajePrecio2: el('cfgP2Pct').value,
                    porcentajePrecio3: el('cfgP3Pct').value,
                    perfiles: borradorPerfilesEdicion
                });
            };

            ['cfgItbisPct', 'cfgP1Pct', 'cfgP2Pct', 'cfgP3Pct'].forEach(id => {
                el(id).addEventListener('input', previsualizarCambiosReglas);
            });

            el('btnGuardarReglas').addEventListener('click', () => {
                const estActual = el('cfgEstrategia').value;
                borradorPerfilesEdicion[estActual] = {
                    p1: Number(el('cfgP1Pct').value) || 0,
                    p2: Number(el('cfgP2Pct').value) || 0,
                    p3: Number(el('cfgP3Pct').value) || 0
                };

                const resGuardado = Almacenamiento.guardarReglasNegocio({
                    estrategia: estActual,
                    porcentajeItbis: el('cfgItbisPct').value,
                    porcentajePrecio1: el('cfgP1Pct').value,
                    porcentajePrecio2: el('cfgP2Pct').value,
                    porcentajePrecio3: el('cfgP3Pct').value,
                    perfiles: borradorPerfilesEdicion
                });

                if (!resGuardado.exito) {
                    return mostrarMensaje(resGuardado.error || 'Error guardando las fórmulas en el almacenamiento.', 'error');
                }

                reglasActivas = resGuardado.reglas;
                sesionActual.productos = sesionActual.productos.map(p => Dominio.crearLineaProductoInmutable(p, reglasActivas));
                sincronizarYGuardarSesion();
                establecerBloqueoReglas(true);
                calcularEnVivo();
                renderizarTodo();
                mostrarMensaje('Fórmula actualizada y bloqueada exitosamente.', 'success');
            });

            el('btnRestaurarReglasDefecto').addEventListener('click', () => {
                const resRestaurado = Almacenamiento.guardarReglasNegocio(AppFarmacia.Configuracion.REGLAS_NEGOCIO_POR_DEFECTO);
                reglasActivas = resRestaurado.reglas;
                borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(reglasActivas.perfiles);
                sesionActual.productos = sesionActual.productos.map(p => Dominio.crearLineaProductoInmutable(p, reglasActivas));
                sincronizarYGuardarSesion();
                establecerBloqueoReglas(true);
                calcularEnVivo();
                renderizarTodo();
                mostrarMensaje('Se restauraron los perfiles originales de todas las fórmulas.', 'info');
            });

            // Eventos IA
            el('iaApiKey').addEventListener('change', e => {
                sessionStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY, e.target.value.trim());
            });
            el('iaModelo').addEventListener('change', e => {
                localStorage.setItem(CONSTANTES.CLAVES_STORAGE.IA_MODELO, e.target.value.trim());
            });

            el('iaImagenInput').addEventListener('change', async e => {
                const archivo = e.target.files[0];
                e.target.value = '';
                if (!archivo) return;

                const contenedorIA = el('seccionEscanerIA');
                contenedorIA.classList.add('btn-loading');
                el('iaEstadoTexto').textContent = 'Analizando factura con IA de Google...';

                try {
                    const apiKey = sessionStorage.getItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY) || el('iaApiKey').value.trim();
                    const modelo = el('iaModelo').value.trim() || CONSTANTES.MODELO_IA_POR_DEFECTO;
                    const res = await ServicioIA.analizarImagenFactura(archivo, apiKey, modelo, reglasActivas);

                    if (res.proveedor && !sesionActual.proveedor) sesionActual.proveedor = res.proveedor;
                    if (res.numeroFactura && !sesionActual.numeroFactura) sesionActual.numeroFactura = res.numeroFactura;
                    if (res.fechaEmision) sesionActual.fechaEmision = res.fechaEmision;
                    if (res.totalFactura && !sesionActual.totalFisico) sesionActual.totalFisico = res.totalFactura;

                    res.productos.forEach(p => sesionActual.productos.push(p));
                    sincronizarYGuardarSesion();
                    renderizarTodo();
                    calcularEnVivo();
                    el('iaEstadoTexto').textContent = `Se cargaron ${res.productos.length} productos desde la imagen.`;
                    mostrarMensaje(`Escaneo completado: ${res.productos.length} productos añadidos.`, 'success');
                } catch (err) {
                    el('iaEstadoTexto').textContent = err.message;
                    mostrarMensaje(err.message, 'error');
                } finally {
                    contenedorIA.classList.remove('btn-loading');
                }
            });

            // Eventos Historial
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
                    const confirmarEliminacion = await mostrarConfirmacion('¿Deseas eliminar permanentemente esta factura del historial?', 'Eliminar Factura');
                    if (confirmarEliminacion) {
                        const filtrado = Almacenamiento.obtenerHistorialFacturas().filter(x => x.id !== btnElim.dataset.histEliminar);
                        Almacenamiento.guardarHistorialFacturas(filtrado);
                        renderizarHistorialUI();
                        mostrarMensaje('Factura eliminada del historial.', 'info');
                    }
                }
            });

            // UX-02: Navegación Superior con marca visual activa
            el('barraNavegacion').addEventListener('click', e => {
                const btn = e.target.closest('[data-ir]');
                if (!btn) return;

                document.querySelectorAll('#barraNavegacion .nav-btn').forEach(b => {
                    b.classList.remove('active');
                    b.removeAttribute('aria-current');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-current', 'page');

                const destino = el(btn.dataset.ir);
                if (destino) {
                    destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        } catch (errorInicializacion) {
            console.error('Fallo en la inicialización de la Calculadora:', errorInicializacion);
            mostrarMensaje(`Error al iniciar la aplicación: ${errorInicializacion.message}`, 'error');
        }
    });
})(window);
