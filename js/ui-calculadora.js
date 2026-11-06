(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES, ESTRATEGIAS_CALCULO } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;
    const Almacenamiento = AppFarmacia.Almacenamiento;

    const el = id => document.getElementById(id);
    const iconoSvg = nombre => `<svg class="ico" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

    let temporizadorDebounceCalculo = null;
    let borradorPerfilesEdicion = null;
    let tasaItbisSeleccionada = 0;
    let tipoDescuentoSeleccionado = 'monto'; // 'monto' ($) o 'porcentaje' (%)

    function fijarItbis(tasa) {
        tasaItbisSeleccionada = tasa;
        if (el('calcItbis')) el('calcItbis').checked = tasa > 0;
        const btn0 = el('btnItbis0');
        const btn18 = el('btnItbis18');
        const btn16 = el('btnItbis16');
        if (btn0) btn0.classList.toggle('activo', tasa === 0);
        if (btn18) btn18.classList.toggle('activo', tasa === 18);
        if (btn16) btn16.classList.toggle('activo', tasa === 16);
        calcularEnVivo();
    }

    function fijarTipoDescuento(tipo) {
        tipoDescuentoSeleccionado = tipo === 'porcentaje' ? 'porcentaje' : 'monto';
        const btnDescMonto = el('btnDescMonto');
        const btnDescPorc = el('btnDescPorc');
        if (btnDescMonto) btnDescMonto.classList.toggle('activo', tipoDescuentoSeleccionado === 'monto');
        if (btnDescPorc) btnDescPorc.classList.toggle('activo', tipoDescuentoSeleccionado === 'porcentaje');
        calcularEnVivo();
    }

    // --- CÁLCULO EN VIVO CON DEBOUNCE (REN-04) ---
    function animarNumero(id) {
        const elemento = el(id);
        if (!elemento) return;
        elemento.classList.remove('numero-actualizado');
        void elemento.offsetWidth;
        elemento.classList.add('numero-actualizado');
    }

    function calcularEnVivo() {
        const Estado = AppFarmacia.Estado;
        const reglasActivas = Estado.reglasActivas;
        const sesionActual = Estado.sesionActual;

        const tipo = el('calcTipo').value;
        const vCajas = Dominio.validarCantidadEnteraPositiva(el('calcCajasCompradas').value, 'cajas');
        const vPrecio = Dominio.validarPrecioCompra(el('calcPrecioCaja').value);
        const vUnidades = tipo === CONSTANTES.CATEGORIAS.ENTERO
            ? { esValido: true, valor: 1 }
            : Dominio.validarCantidadEnteraPositiva(el('calcUnidadesCaja').value, 'unidades');

        const esLeche = Boolean(el('calcEsLeche') && el('calcEsLeche').checked);
        const valDescRaw = el('calcDescuento') ? el('calcDescuento').value : '0';
        const descuentoValor = Math.max(0, parseFloat(valDescRaw) || 0);

        const resumenActual = Dominio.calcularResumenCuadreFactura(sesionActual.productos, sesionActual.totalFisico);
        const aplicaItbis = tasaItbisSeleccionada > 0;
        const reglasEfectivas = {
            ...reglasActivas,
            porcentajeItbis: aplicaItbis ? tasaItbisSeleccionada : reglasActivas.porcentajeItbis
        };
        const desglose = Dominio.calcularDesglosePrecios(
            vPrecio.esValido ? vPrecio.valor : 0,
            vUnidades.esValido ? vUnidades.valor : 1,
            aplicaItbis,
            reglasEfectivas,
            {
                cajasCompradas: vCajas.esValido ? vCajas.valor : 1,
                esLeche,
                descuentoValor,
                tipoDescuento: tipoDescuentoSeleccionado
            }
        );

        if (el('lblTituloP1')) {
            el('lblTituloP1').textContent = esLeche ? 'Precio 1 (+10% Leche)' : `Precio 1 (+${reglasActivas.porcentajePrecio1}%)`;
        }
        if (el('lblDescModoTexto')) {
            el('lblDescModoTexto').textContent = tipoDescuentoSeleccionado === 'porcentaje' ? '% por caja' : 'Total línea ($)';
        }

        const lblItbis = el('lblItbisToggle');
        if (lblItbis) {
            if (vPrecio.esValido && vPrecio.valor > 0) {
                const montoSim = Dominio.redondearDecimalExacto(desglose.precioCajaNeto * (reglasActivas.porcentajeItbis / 100), CONSTANTES.DECIMALES_MONEDA);
                lblItbis.textContent = `Sumar ${reglasActivas.porcentajeItbis}% ITBIS al costo (+$${montoSim.toFixed(2)}/caja)`;
            } else {
                lblItbis.textContent = `Sumar ${reglasActivas.porcentajeItbis}% ITBIS al costo`;
            }
        }

        if (vPrecio.esValido && vCajas.esValido) {
            const itbisLinea = desglose.montoItbisTotal !== undefined ? desglose.montoItbisTotal : Dominio.redondearDecimalExacto(vCajas.valor * desglose.montoItbisPorCaja, CONSTANTES.DECIMALES_MONEDA);
            const subtotalLinea = desglose.subtotalFactura !== undefined ? desglose.subtotalFactura : Dominio.redondearDecimalExacto(vCajas.valor * desglose.costoCajaEfectivo, CONSTANTES.DECIMALES_MONEDA);
            const acumuladoConLinea = Dominio.redondearDecimalExacto(resumenActual.sumaAcumulada + subtotalLinea, CONSTANTES.DECIMALES_MONEDA);

            if (el('resItbisLinea')) {
                el('resItbisLinea').textContent = aplicaItbis
                    ? `+$${Dominio.formatearMonedaDosDecimales(itbisLinea)}${vCajas.valor > 1 ? ` ($${desglose.montoItbisPorCaja.toFixed(2)}/caja)` : ''} (${tasaItbisSeleccionada}%)`
                    : '$0.00 (Exento)';
            }
            el('resSubtotalLinea').textContent = '$' + Dominio.formatearMonedaDosDecimales(subtotalLinea);
            el('resAcumuladoConLinea').textContent = '$' + Dominio.formatearMonedaDosDecimales(acumuladoConLinea);
        } else {
            if (el('resItbisLinea')) el('resItbisLinea').textContent = '$0.00 (Exento)';
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
                el('resPrecio' + n).textContent = '$0.00';
                el('subPrecio' + n).textContent = 'Exacto: 0.00 | Redondeado: 0';
            });
            if (el('resP1Red')) el('resP1Red').textContent = '$0';
            if (el('resP2Red')) el('resP2Red').textContent = '$0';
            if (el('resP3Red')) el('resP3Red').textContent = '$0';
            return;
        }

        const usarRedondeo = el('calcRedondeo').checked;

        el('resCostoUnitario').textContent = desglose.costoUnitario;
        if (el('resP1Red')) el('resP1Red').textContent = '$' + desglose.p1Redondeado;
        if (el('resP2Red')) el('resP2Red').textContent = '$' + desglose.p2Redondeado;
        if (el('resP3Red')) el('resP3Red').textContent = '$' + desglose.p3Redondeado;
        ['resCostoUnitario', 'resPrecio1', 'resPrecio2', 'resPrecio3', 'resSubtotalLinea', 'resAcumuladoConLinea', 'resTotalUnidadesInventario'].forEach(animarNumero);
        [1, 2, 3].forEach(n => {
            el('resPrecio' + n).textContent = usarRedondeo ? '$' + desglose['p' + n + 'Redondeado'] : '$' + desglose['p' + n + 'Exacto'];
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
        const btnDiv = el('btnTipoDivisible');
        const btnEnt = el('btnTipoEntero');

        if (btnDiv && btnEnt) {
            if (tipo === CONSTANTES.CATEGORIAS.ENTERO) {
                btnEnt.classList.add('activo');
                btnDiv.classList.remove('activo');
            } else {
                btnDiv.classList.add('activo');
                btnEnt.classList.remove('activo');
            }
        }

        if (tipo === CONSTANTES.CATEGORIAS.ENTERO) {
            if (contenedor) contenedor.style.opacity = '0.5';
            if (inputUnidades) {
                inputUnidades.value = '1';
                inputUnidades.disabled = true;
                inputUnidades.classList.add('input-bloqueado');
            }
        } else {
            if (contenedor) contenedor.style.opacity = '1';
            if (inputUnidades) {
                inputUnidades.disabled = false;
                inputUnidades.classList.remove('input-bloqueado');
                if (inputUnidades.value === '1') inputUnidades.value = '';
            }
        }
        calcularEnVivo();
    }

    function procesarEscaneoCodigoBarras(mostrarNotificacion = true) {
        const codigo = Dominio.normalizarCodigoBarras(el('calcCodigoBarras').value);
        if (!codigo) return;

        // Validación según estándar oficial GS1 (EAN-13, UPC-A, EAN-8, ITF-14)
        const valEstandar = Dominio.validarCodigoBarrasEstandar(codigo);
        if (!valEstandar.esValido) {
            Dominio.emitirBipError?.();
            if (mostrarNotificacion) {
                UI.Notificaciones.mostrarMensaje(valEstandar.error, 'error');
            }
            return;
        }
        Dominio.emitirBipExito?.();

        const aprendido = Almacenamiento.buscarProductoPorCodigo(codigo);
        if (aprendido) {
            // 1. Nombre y Blindaje de Catálogo Maestro
            const tieneNombreOficial = Boolean(aprendido.nombre && !aprendido.nombre.startsWith('Producto sin nombre') && !/^Producto #\d+$/i.test(aprendido.nombre));
            const inputNombre = el('calcNombre');
            const badgeCat = el('badgeEstadoProducto');
            inputNombre.value = tieneNombreOficial ? aprendido.nombre : '';

            if (tieneNombreOficial) {
                inputNombre.readOnly = true;
                inputNombre.style.backgroundColor = 'var(--color-superficie-resaltada)';
                if (badgeCat) {
                    badgeCat.style.display = 'inline-block';
                    badgeCat.style.background = 'var(--color-exito-fondo)';
                    badgeCat.style.color = 'var(--color-exito)';
                    badgeCat.textContent = 'Catálogo Maestro (Protegido)';
                }
            } else {
                inputNombre.readOnly = false;
                inputNombre.style.backgroundColor = '';
                if (badgeCat) badgeCat.style.display = 'none';
            }

            // 2. Costo Caja Base (autocompletado solicitado expresamente)
            if (aprendido.ultimoPrecioCaja && Number(aprendido.ultimoPrecioCaja) > 0) {
                el('calcPrecioCaja').value = Number(aprendido.ultimoPrecioCaja).toFixed(2);
            }

            // 3. ITBIS
            const tasa = aprendido.tasaItbis !== undefined
                ? Number(aprendido.tasaItbis)
                : (aprendido.aplicaItbis ? 18 : 0);
            fijarItbis(tasa);

            // 4. Es Leche
            if (el('calcEsLeche')) {
                el('calcEsLeche').checked = Boolean(aprendido.esLeche);
            }

            // 5. Forma de Venta (Tipo) y Unidades por Caja (Autocompletado persistente)
            if (aprendido.tipo) {
                el('calcTipo').value = (aprendido.tipo === CONSTANTES.CATEGORIAS.ENTERO)
                    ? CONSTANTES.CATEGORIAS.ENTERO
                    : CONSTANTES.CATEGORIAS.DIVISIBLE;
                actualizarVisibilidadCategoria();
            }
            if (aprendido.tipo === CONSTANTES.CATEGORIAS.ENTERO) {
                el('calcUnidadesCaja').value = '1';
            } else if (aprendido.unidadesPorCaja && Number(aprendido.unidadesPorCaja) > 0) {
                el('calcUnidadesCaja').value = Number(aprendido.unidadesPorCaja);
            }

            if (mostrarNotificacion) {
                const nombreMostrar = (aprendido.nombre && !aprendido.nombre.startsWith('Producto #') && aprendido.nombre !== 'Producto sin nombre')
                    ? `"${aprendido.nombre}"`
                    : `código ${codigo}`;
                const textoCosto = aprendido.ultimoPrecioCaja ? ` | Costo: ${Number(aprendido.ultimoPrecioCaja).toFixed(2)}` : '';
                let textoRadar = '';
                if (aprendido.variacionCosto && Number(aprendido.variacionCosto) !== 0) {
                    const v = Number(aprendido.variacionCosto);
                    textoRadar = v > 0 ? ` [Alza previa: +${v}%]` : ` [Baja previa: ${v}%]`;
                }
                UI.Notificaciones.mostrarMensaje(`Código reconocido (${nombreMostrar}${textoCosto}${textoRadar}). Ingresa Cajas.`, 'success');
            }
            calcularEnVivo();
            el('calcCajasCompradas').focus();
            el('calcCajasCompradas').select();
        } else {
            const inputNombre = el('calcNombre');
            const badgeCat = el('badgeEstadoProducto');
            inputNombre.readOnly = false;
            inputNombre.style.backgroundColor = '';
            if (badgeCat) {
                badgeCat.style.display = 'inline-block';
                badgeCat.style.background = 'var(--color-primario-fondo)';
                badgeCat.style.color = 'var(--color-primario)';
                badgeCat.textContent = 'Nuevo Producto';
            }
            if (mostrarNotificacion) {
                UI.Notificaciones.mostrarMensaje(`Código ${valEstandar.tipo} válido (${codigo}). Ingresa los datos; se memorizará al agregar a la factura.`, 'info');
            }

            // Consultar catálogo abierto en segundo plano (OpenFDA / registros públicos)
            if (AppFarmacia.ServicioCatalogo) {
                AppFarmacia.ServicioCatalogo.consultarCodigoEnLinea(codigo).then(sugerencia => {
                    if (sugerencia && sugerencia.nombre) {
                        el('calcNombre').value = sugerencia.nombre;
                        if (sugerencia.esLeche && el('calcEsLeche')) {
                            el('calcEsLeche').checked = true;
                        }
                        if (sugerencia.aplicaItbis !== undefined) {
                            fijarItbis(sugerencia.tasaItbis || (sugerencia.aplicaItbis ? 18 : 0));
                        }
                        const extraLab = sugerencia.laboratorio ? ` (${sugerencia.laboratorio})` : '';
                        UI.Notificaciones.mostrarMensaje(`Sugerido desde catálogo abierto${extraLab}: "${sugerencia.nombre}".`, 'success');
                        calcularEnVivo();
                        el('calcCajasCompradas').focus();
                        el('calcCajasCompradas').select();
                    }
                });
            }

            if (!el('calcNombre').value) {
                el('calcNombre').focus();
            } else {
                el('calcCajasCompradas').focus();
            }
        }
    }

    async function solicitarConfirmacionCajas(valorCrudo) {
        const texto = String(valorCrudo ?? '').trim();
        if (texto === '') {
            const aceptaUnaCaja = await UI.Notificaciones.mostrarConfirmacion(
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

    let agregandoProductoEnCurso = false;
    async function agregarProductoAFactura() {
        if (agregandoProductoEnCurso) return;
        const btnAgregar = el('btnAgregarProducto');
        try {
            agregandoProductoEnCurso = true;
            if (btnAgregar) {
                btnAgregar.disabled = true;
                btnAgregar.classList.add('btn-loading');
            }

            const Estado = AppFarmacia.Estado;
            const reglasActivas = Estado.reglasActivas;
            const sesionActual = Estado.sesionActual;

        const enfocarConError = (idInput, mensaje) => {
            if (mensaje) UI.Notificaciones.mostrarMensaje(mensaje, 'error');
            const input = el(idInput);
            input.focus();
            if (input.select) input.select();
        };

        const codigoCrudo = el('calcCodigoBarras').value.trim();
        if (codigoCrudo) {
            const valCodigo = Dominio.validarCodigoBarrasEstandar(codigoCrudo);
            if (!valCodigo.esValido) {
                return enfocarConError('calcCodigoBarras', valCodigo.error);
            }
        }

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

        const aplicaItbis = tasaItbisSeleccionada > 0;
        const reglasEfectivas = {
            ...reglasActivas,
            porcentajeItbis: aplicaItbis ? tasaItbisSeleccionada : reglasActivas.porcentajeItbis
        };
        const esLeche = Boolean(el('calcEsLeche') && el('calcEsLeche').checked);
        const valDescRaw = el('calcDescuento') ? el('calcDescuento').value : '0';
        const descuentoValor = Math.max(0, parseFloat(valDescRaw) || 0);

        const nuevaLinea = Dominio.crearLineaProductoInmutable({
            codigoBarras: el('calcCodigoBarras').value,
            nombre: (Dominio && typeof Dominio.sanitizarEntradaTexto === 'function')
                ? (Dominio.sanitizarEntradaTexto(el('calcNombre').value, 120) || `Producto #${sesionActual.productos.length + 1}`)
                : (el('calcNombre').value.trim() || `Producto #${sesionActual.productos.length + 1}`),
            tipo,
            precioCajaBase: vPrecio.valor,
            unidadesPorCaja: vUnidades.valor,
            cajasCompradas: vCajas.valor,
            aplicaItbis,
            tasaItbis: tasaItbisSeleccionada,
            esLeche,
            descuentoValor,
            tipoDescuento: tipoDescuentoSeleccionado
        }, reglasEfectivas);

        const aprendioCodigo = Almacenamiento.aprenderProductoEnDiccionario(nuevaLinea, sesionActual);
        Estado.agregarProductoASesion(nuevaLinea);
        } finally {
            agregandoProductoEnCurso = false;
            if (btnAgregar) {
                btnAgregar.disabled = false;
                btnAgregar.classList.remove('btn-loading');
            }
        }

        // Reset completo de todos los campos de entrada al default solicitado
        ['calcCodigoBarras', 'calcNombre', 'calcPrecioCaja', 'calcCajasCompradas', 'calcDescuento', 'calcUnidadesCaja'].forEach(id => {
            if (el(id)) el(id).value = '';
        });
        if (el('calcNombre')) {
            el('calcNombre').readOnly = false;
            el('calcNombre').style.backgroundColor = '';
        }
        if (el('badgeEstadoProducto')) el('badgeEstadoProducto').style.display = 'none';
        if (el('calcCodigoBarras')) el('calcCodigoBarras').style.borderColor = '';
        if (el('calcEsLeche')) el('calcEsLeche').checked = false;

        // Reset de ITBIS al default (Exento / 0%)
        fijarItbis(0);

        // Reset de Descuento al default (Monto / $)
        fijarTipoDescuento('monto');

        // Reset de Categoría al default (Divisible)
        el('calcTipo').value = CONSTANTES.CATEGORIAS.DIVISIBLE;
        actualizarVisibilidadCategoria();

        calcularEnVivo();

        if (aprendioCodigo) {
            // NOTA: Alerta de guardado en diccionario preparada pero desactivada a solicitud del usuario.
            const ACTIVAR_ALERTA_DICCIONARIO = false;
            if (ACTIVAR_ALERTA_DICCIONARIO) {
                UI.Notificaciones.mostrarMensaje(`Producto agregado y código "${nuevaLinea.codigoBarras}" memorizado en el diccionario.`, 'success');
            }
            UI.Diccionario.renderizarDiccionarioUI();
        }

        // Posicionar cursor listo para el siguiente código o producto
        el('calcCodigoBarras').focus();
    }

    function configurarAtajosTeclado() {
        const seccionCalc = el('seccionCalculadora');

        // Atajos Globales de Mostrador y Operaciones (F1, F2, F4)
        window.addEventListener('keydown', e => {
            if (e.key === 'F1' || (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName))) {
                e.preventDefault();
                const modal = el('modalAtajosAyuda');
                if (modal && typeof modal.showModal === 'function') {
                    if (modal.open) modal.close();
                    else modal.showModal();
                }
                return;
            }
            if (e.key === 'F2') {
                e.preventDefault();
                const inputCod = el('calcCodigoBarras');
                if (inputCod) {
                    inputCod.focus();
                    if (inputCod.select) inputCod.select();
                }
                return;
            }
            if (e.key === 'F4') {
                e.preventDefault();
                iniciarEscaneoCamara('producto');
                return;
            }
        });

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

            if (e.target.id === 'calcDescuento') {
                e.preventDefault();
                agregarProductoAFactura();
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

    // --- BÓVEDA DE FÓRMULAS ---
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

    // COD-12: Usa el parámetro sanitizado `r`
    function actualizarEtiquetasReglasUI(reglasMostradas) {
        const Estado = AppFarmacia.Estado;
        const reglas = reglasMostradas || Estado.reglasActivas;
        const r = Dominio.sanitizarReglasNegocio(reglas);

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

    function inicializarEventosBovedaReglas() {
        const Estado = AppFarmacia.Estado;
        borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(Estado.reglasActivas.perfiles);

        el('btnToggleCandadoReglas').addEventListener('click', async () => {
            const estaBloqueado = el('fieldsetReglas').disabled;
            if (estaBloqueado) {
                const desbloquear = await UI.Notificaciones.mostrarConfirmacion('¿Deseas desbloquear la configuración de fórmulas matemáticas para editarlas?', 'Desbloquear Fórmulas');
                if (desbloquear) {
                    borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(Estado.reglasActivas.perfiles);
                    establecerBloqueoReglas(false);
                }
            } else {
                borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(Estado.reglasActivas.perfiles);
                actualizarEtiquetasReglasUI(Estado.reglasActivas);
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
                return UI.Notificaciones.mostrarMensaje(resGuardado.error || 'Error guardando las fórmulas en el almacenamiento.', 'error');
            }

            Estado.reglasActivas = resGuardado.reglas;
            Estado.sesionActual.productos = Estado.sesionActual.productos.map(p => Dominio.crearLineaProductoInmutable(p, Estado.reglasActivas));
            Estado.sincronizarYGuardarSesion();
            establecerBloqueoReglas(true);
            calcularEnVivo();
            Estado.renderizarTodo();
            UI.Notificaciones.mostrarMensaje('Fórmula actualizada y bloqueada exitosamente.', 'success');
        });

        el('btnRestaurarReglasDefecto').addEventListener('click', () => {
            const resRestaurado = Almacenamiento.guardarReglasNegocio(AppFarmacia.Configuracion.REGLAS_NEGOCIO_POR_DEFECTO);
            Estado.reglasActivas = resRestaurado.reglas;
            borradorPerfilesEdicion = Dominio.clonarObjetoSeguro(Estado.reglasActivas.perfiles);
            Estado.sesionActual.productos = Estado.sesionActual.productos.map(p => Dominio.crearLineaProductoInmutable(p, Estado.reglasActivas));
            Estado.sincronizarYGuardarSesion();
            establecerBloqueoReglas(true);
            calcularEnVivo();
            Estado.renderizarTodo();
            UI.Notificaciones.mostrarMensaje('Se restauraron los perfiles originales de todas las fórmulas.', 'info');
        });
    }

    function inicializarEventosCalculadora() {
        el('calcTipo').addEventListener('change', actualizarVisibilidadCategoria);
        ['calcCajasCompradas', 'calcPrecioCaja', 'calcUnidadesCaja'].forEach(id => {
            el(id).addEventListener('input', dispararCalculoDebounced);
        });

        // UX-08: Bloqueo físico de letras y símbolos en entradas numéricas
        if (typeof UI.configurarFiltroNumerico === 'function') {
            UI.configurarFiltroNumerico(el('calcCodigoBarras'), false);
            UI.configurarFiltroNumerico(el('calcCajasCompradas'), false);
            UI.configurarFiltroNumerico(el('calcUnidadesCaja'), false);
            UI.configurarFiltroNumerico(el('calcPrecioCaja'), true);
            UI.configurarFiltroNumerico(el('cfgItbisPct'), true);
            UI.configurarFiltroNumerico(el('cfgP1Pct'), true);
            UI.configurarFiltroNumerico(el('cfgP2Pct'), true);
            UI.configurarFiltroNumerico(el('cfgP3Pct'), true);
        }

        // Validación estricta y autocompletado reactivo en Código de Barras
        const inputCodigo = el('calcCodigoBarras');
        if (inputCodigo) {
            inputCodigo.setAttribute('inputmode', 'numeric');
            inputCodigo.setAttribute('pattern', '[0-9]*');
            inputCodigo.addEventListener('input', e => {
                // Solo números
                if (!e.target.value.trim()) {
                    if (el('calcNombre')) {
                        el('calcNombre').readOnly = false;
                        el('calcNombre').style.backgroundColor = '';
                    }
                    if (el('badgeEstadoProducto')) el('badgeEstadoProducto').style.display = 'none';
                }
                const soloDigitos = e.target.value.replace(/\D/g, '');
                if (e.target.value !== soloDigitos) {
                    e.target.value = soloDigitos;
                }
                const len = soloDigitos.length;
                if ([8, 12, 13, 14].includes(len)) {
                    const val = Dominio.validarCodigoBarrasEstandar(soloDigitos);
                    if (val.esValido) {
                        inputCodigo.style.borderColor = 'var(--color-exito)';
                        const encontrado = Almacenamiento.buscarProductoPorCodigo(soloDigitos);
                        if (encontrado) {
                            procesarEscaneoCodigoBarras(false);
                        }
                    } else {
                        inputCodigo.style.borderColor = 'var(--color-alerta)';
                    }
                } else {
                    inputCodigo.style.borderColor = '';
                }
            });
            inputCodigo.addEventListener('change', () => {
                procesarEscaneoCodigoBarras(true);
            });
        }

        // Botones de categoría visuales
        const btnDiv = el('btnTipoDivisible');
        const btnEnt = el('btnTipoEntero');
        if (btnDiv) {
            btnDiv.addEventListener('click', () => {
                el('calcTipo').value = CONSTANTES.CATEGORIAS.DIVISIBLE;
                actualizarVisibilidadCategoria();
            });
        }
        if (btnEnt) {
            btnEnt.addEventListener('click', () => {
                el('calcTipo').value = CONSTANTES.CATEGORIAS.ENTERO;
                actualizarVisibilidadCategoria();
            });
        }

        // Botones de ITBIS en orden estricto: Exento (0%), 18%, 16%
        const btnItbis0 = el('btnItbis0');
        const btnItbis18 = el('btnItbis18');
        const btnItbis16 = el('btnItbis16');
        if (btnItbis0) btnItbis0.addEventListener('click', () => fijarItbis(0));
        if (btnItbis18) btnItbis18.addEventListener('click', () => fijarItbis(18));
        if (btnItbis16) btnItbis16.addEventListener('click', () => fijarItbis(16));

        // Autocompletado fonético difuso farmacológico para Nombre de Producto
        const inputNombre = el('calcNombre');
        const datalistSugerencias = el('listaSugerenciasProductos');
        if (inputNombre && datalistSugerencias) {
            inputNombre.addEventListener('input', () => {
                const val = inputNombre.value.trim();
                if (val.length < 2) {
                    datalistSugerencias.innerHTML = '';
                    return;
                }
                const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
                const coincidencias = (Dominio && typeof Dominio.buscarEnCatalogoFuzzy === 'function')
                    ? Dominio.buscarEnCatalogoFuzzy(val, diccionario, 6)
                    : [];

                datalistSugerencias.innerHTML = coincidencias.map(p => {
                    const descCosto = p.ultimoPrecioCaja ? ` - ${Number(p.ultimoPrecioCaja).toFixed(2)}` : '';
                    const nom = Dominio.escaparHtml(p.nombre || p.nombreComercial || '');
                    const cod = Dominio.escaparHtml(p.codigoBarras || '');
                    return `<option value="${nom}" label="${nom} [${cod}]${descCosto}"></option>`;
                }).join('');
            });

            inputNombre.addEventListener('change', () => {
                const val = inputNombre.value.trim();
                if (!val) return;
                const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
                const encontrado = Object.values(diccionario || {}).find(p => p && (p.nombre === val || p.nombreComercial === val));
                if (encontrado) {
                    if (el('calcCodigoBarras') && !el('calcCodigoBarras').value && encontrado.codigoBarras) {
                        el('calcCodigoBarras').value = encontrado.codigoBarras;
                    }
                    if (encontrado.nombre && !encontrado.nombre.startsWith('Producto sin nombre') && !/^Producto #\d+$/i.test(encontrado.nombre)) {
                        inputNombre.readOnly = true;
                        inputNombre.style.backgroundColor = 'var(--color-superficie-resaltada)';
                        if (el('badgeEstadoProducto')) {
                            el('badgeEstadoProducto').style.display = 'inline-block';
                            el('badgeEstadoProducto').style.background = 'var(--color-exito-fondo)';
                            el('badgeEstadoProducto').style.color = 'var(--color-exito)';
                            el('badgeEstadoProducto').textContent = 'Catálogo Maestro (Protegido)';
                        }
                    }
                    if (el('calcPrecioCaja') && !el('calcPrecioCaja').value && encontrado.ultimoPrecioCaja) {
                        el('calcPrecioCaja').value = Number(encontrado.ultimoPrecioCaja).toFixed(2);
                    }
                    if (encontrado.tipo && el('calcTipo')) {
                        el('calcTipo').value = encontrado.tipo;
                        actualizarVisibilidadCategoria();
                    }
                    if (encontrado.unidadesPorCaja && el('calcUnidadesCaja')) {
                        el('calcUnidadesCaja').value = encontrado.unidadesPorCaja;
                    }
                    if (encontrado.esLeche && el('calcEsLeche')) {
                        el('calcEsLeche').checked = true;
                    }
                    const tasa = encontrado.tasaItbis !== undefined ? Number(encontrado.tasaItbis) : (encontrado.aplicaItbis ? 18 : 0);
                    fijarItbis(tasa);
                    calcularEnVivo();
                }
            });
        }

        // Selector y eventos de Descuento ($ vs %)
        const btnDescMonto = el('btnDescMonto');
        const btnDescPorc = el('btnDescPorc');
        if (btnDescMonto) btnDescMonto.addEventListener('click', () => fijarTipoDescuento('monto'));
        if (btnDescPorc) btnDescPorc.addEventListener('click', () => fijarTipoDescuento('porcentaje'));

        const inputDescuento = el('calcDescuento');
        if (inputDescuento) {
            inputDescuento.addEventListener('input', dispararCalculoDebounced);
            if (typeof UI.configurarFiltroNumerico === 'function') {
                UI.configurarFiltroNumerico(inputDescuento, true);
            }
        }

        // Checkbox Es Leche
        const chkEsLeche = el('calcEsLeche');
        if (chkEsLeche) {
            chkEsLeche.addEventListener('change', () => {
                calcularEnVivo();
            });
        }

        el('calcItbis').addEventListener('change', () => {
            fijarItbis(el('calcItbis').checked ? 18 : 0);
        });
        el('calcRedondeo').addEventListener('change', () => {
            calcularEnVivo();
            UI.Factura.renderizarTablaProductosActuales();
        });
        el('btnAgregarProducto').addEventListener('click', agregarProductoAFactura);

        // Copiado con micro-animación táctil y checkmark
        document.querySelectorAll('[data-copiar]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idTarget = btn.getAttribute('data-copiar');
                const elemento = el(idTarget);
                if (!elemento) return;
                const texto = elemento.textContent.replace('$', '').trim();
                Dominio.copiarAlPortapapeles(texto).then(() => {
                    const original = btn.innerHTML;
                    btn.classList.add('copiado');
                    btn.innerHTML = `${iconoSvg('check')} ¡Copiado!`;
                    setTimeout(() => {
                        btn.innerHTML = original;
                        btn.classList.remove('copiado');
                    }, 1200);
                }).catch(() => {
                    const original = btn.innerHTML;
                    btn.innerHTML = `${iconoSvg('check')} ¡Copiado!`;
                    setTimeout(() => { btn.innerHTML = original; }, 1000);
                });
            });
        });

        configurarAtajosTeclado();
        inicializarEventosBovedaReglas();
        configurarEscaneoCamara();
    }

    // --- FASE 3: ESCÁNER DE CÓDIGOS DE BARRA Y QR DGII CON CÁMARA (BarcodeDetector & ZXing) ---
    let streamCamaraActivo = null;
    let detectorIntervalo = null;
    let detectorCodigos = null;
    let zxingReader = null;
    let escaneoEnCurso = false;
    let modoEscaneoActual = 'producto'; // 'producto' | 'factura'
    let temporizadorTimeoutCamara = null;

    function emitirFeedbackEscaneo() {
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([80]);
            }
        } catch (e) {}

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
                setTimeout(() => { ctx.close(); }, 200);
            }
        } catch (e) {}
    }

    async function iniciarEscaneoCamara(modo = 'producto') {
        modoEscaneoActual = (modo === 'factura') ? 'factura' : 'producto';
        const modal = el('modalCamaraEscaneo');
        const video = el('videoCamaraEscaneo');
        const estadoTexto = el('camaraEstadoTexto');
        const modalTitulo = el('modalCamaraTitulo');

        // 1. Verificación de entorno seguro (HTTPS o localhost)
        if (typeof window !== 'undefined' && window.isSecureContext === false && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            UI.Notificaciones.mostrarMensaje('El escaneo con cámara requiere una conexión segura (HTTPS o localhost). En red local HTTP, ingresa los datos manualmente o usa una pistola lectora USB.', 'warning');
            return;
        }

        // 2. Verificación de soporte de API MediaDevices
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            UI.Notificaciones.mostrarMensaje('Tu dispositivo o navegador no admite acceso a la cámara. Usa una pistola lectora o ingreso manual.', 'error');
            return;
        }

        // 3. Verificación de cámaras físicas conectadas
        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
            try {
                const dispositivos = await navigator.mediaDevices.enumerateDevices();
                const tieneCamara = dispositivos.some(d => d.kind === 'videoinput');
                if (dispositivos.length > 0 && !tieneCamara) {
                    UI.Notificaciones.mostrarMensaje('No se detectó ninguna cámara de video en este equipo. Puedes seleccionar una foto o captura de la factura desde tus archivos.', 'info');
                    const inputArchivo = el('inputArchivoEscaneoLocal');
                    if (inputArchivo) inputArchivo.click();
                    return;
                }
            } catch (e) {
                // Continuar a getUserMedia si el navegador exige permiso previo para listar
            }
        }

        const tieneBarcodeDetector = ('BarcodeDetector' in window);
        const tieneZXing = Boolean(global.ZXing && global.ZXing.BrowserMultiFormatReader);

        if (!tieneBarcodeDetector && !tieneZXing) {
            UI.Notificaciones.mostrarMensaje('Tu navegador no admite decodificación de códigos por cámara. Usa una pistola lectora o escribe el código manualmente.', 'warning');
            return;
        }

        // Limpiar cualquier residuo previo de cámara antes de abrir
        detenerEscaneoCamara();

        try {
            escaneoEnCurso = true;
            if (modal) modal.showModal();

            if (modalTitulo) {
                modalTitulo.textContent = (modoEscaneoActual === 'factura')
                    ? 'Escanear QR de Factura DGII'
                    : 'Escanear Código con Cámara';
            }

            const guiaVisual = el('guiaEscaneoVisual');
            if (guiaVisual) {
                if (modoEscaneoActual === 'factura') {
                    guiaVisual.style.width = '65%';
                    guiaVisual.style.height = '65%';
                    guiaVisual.style.aspectRatio = '1 / 1';
                    guiaVisual.style.borderRadius = '14px';
                } else {
                    guiaVisual.style.width = '80%';
                    guiaVisual.style.height = '42%';
                    guiaVisual.style.aspectRatio = 'auto';
                    guiaVisual.style.borderRadius = '8px';
                }
            }

            if (estadoTexto) {
                estadoTexto.textContent = (modoEscaneoActual === 'factura')
                    ? 'Iniciando cámara... Apunta al recuadro QR impreso en la factura fiscal (e-CF).'
                    : 'Iniciando cámara... Apunta al código de barras del medicamento.';
            }

            // Temporizador de inactividad preventiva: 45 segundos
            if (temporizadorTimeoutCamara) clearTimeout(temporizadorTimeoutCamara);
            temporizadorTimeoutCamara = setTimeout(() => {
                if (escaneoEnCurso) {
                    detenerEscaneoCamara();
                    UI.Notificaciones.mostrarMensaje('Tiempo de escaneo agotado (45 segundos). Puedes reintentar o ingresar los datos mediante el teclado.', 'info');
                }
            }, 45000);

            const procesarCodigoDetectado = (rawCode) => {
                if (!escaneoEnCurso) return;
                const textoLimpio = String(rawCode || '').trim();
                if (!textoLimpio) return;

                if (modoEscaneoActual === 'factura') {
                    const resDgii = Dominio.parsearQrFacturaDgii(textoLimpio);
                    if (resDgii.esDgii && resDgii.esValido) {
                        detenerEscaneoCamara();
                        emitirFeedbackEscaneo();
                        UI.Factura.cargarDatosDesdeQrDgii(resDgii.datos);
                    } else {
                        if (estadoTexto) {
                            estadoTexto.textContent = 'El código enfocado no es un comprobante fiscal DGII válido. Mantén enfocado el QR de la factura.';
                        }
                    }
                    return;
                }

                // Modo Producto
                const checkDgii = Dominio.parsearQrFacturaDgii(textoLimpio);
                if (checkDgii.esDgii && checkDgii.esValido) {
                    detenerEscaneoCamara();
                    emitirFeedbackEscaneo();
                    UI.Factura.cargarDatosDesdeQrDgii(checkDgii.datos);
                    UI.Notificaciones.mostrarMensaje('Se detectó un QR de factura fiscal DGII. Datos aplicados a la factura en curso.', 'info');
                    return;
                }

                const codigoNormalizado = Dominio.normalizarCodigoBarras(textoLimpio);
                const val = Dominio.validarCodigoBarrasEstandar(codigoNormalizado);

                if (val.esValido) {
                    detenerEscaneoCamara();
                    emitirFeedbackEscaneo();
                    const inputCodigo = el('calcCodigoBarras');
                    if (inputCodigo) {
                        inputCodigo.value = codigoNormalizado;
                    }
                    procesarEscaneoCodigoBarras(true);
                }
            };

            // Solicitud de MediaStream con degradación elegante
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
            } catch (errConstraints) {
                // Fallback para webcams genéricas de PC o terminales POS
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
            }

            if (!escaneoEnCurso) {
                if (stream && typeof stream.getTracks === 'function') {
                    stream.getTracks().forEach(t => {
                        try { t.enabled = false; } catch (e) {}
                        try { t.stop(); } catch (e) {}
                    });
                }
                return;
            }

            streamCamaraActivo = stream;

            if (tieneBarcodeDetector) {
                if (!detectorCodigos) {
                    const formatosSoportados = await BarcodeDetector.getSupportedFormats();
                    const formatosDeseados = ['ean_13', 'upc_a', 'ean_8', 'itf', 'qr_code'].filter(f => formatosSoportados.includes(f));
                    detectorCodigos = new BarcodeDetector({ formats: formatosDeseados.length > 0 ? formatosDeseados : ['ean_13', 'upc_a', 'qr_code'] });
                }

                if (video) {
                    video.srcObject = streamCamaraActivo;
                    await video.play();
                }

                if (estadoTexto) {
                    estadoTexto.textContent = (modoEscaneoActual === 'factura')
                        ? 'Buscando QR de Factura DGII... Centra el recuadro QR en la guía.'
                        : 'Buscando código (EAN-13, UPC-A, EAN-8)... Mantén el código centrado.';
                }

                let detectando = false;
                detectorIntervalo = setInterval(async () => {
                    if (!escaneoEnCurso || detectando || !streamCamaraActivo || !video || video.readyState < 2) return;
                    detectando = true;
                    try {
                        const codigos = await detectorCodigos.detect(video);
                        if (codigos && codigos.length > 0) {
                            procesarCodigoDetectado(codigos[0].rawValue);
                        }
                    } catch (err) {
                        // Silencioso entre cuadros
                    } finally {
                        detectando = false;
                    }
                }, 120);

            } else if (tieneZXing) {
                if (!zxingReader) {
                    zxingReader = new global.ZXing.BrowserMultiFormatReader();
                }

                if (estadoTexto) {
                    estadoTexto.textContent = (modoEscaneoActual === 'factura')
                        ? 'Cámara web activa en PC... Enfoca el QR de la factura fiscal.'
                        : 'Cámara web activa en PC... Enfoca el código de barras.';
                }

                zxingReader.decodeFromStream(streamCamaraActivo, video, (result, err) => {
                    if (!escaneoEnCurso) return;
                    if (result && result.getText()) {
                        procesarCodigoDetectado(result.getText());
                    }
                }).catch(err => {
                    if (escaneoEnCurso) {
                        console.warn('Error en escaneo continuo ZXing:', err);
                        detenerEscaneoCamara();
                        UI.Notificaciones.mostrarMensaje('Error de captura en cámara web de PC.', 'error');
                    }
                });
            }

        } catch (err) {
            detenerEscaneoCamara();
            console.warn('Error accediendo a la cámara:', err);
            const nombreError = err?.name || '';
            if (nombreError === 'NotAllowedError' || nombreError === 'PermissionDeniedError') {
                UI.Notificaciones.mostrarMensaje('Acceso a la cámara bloqueado. Permite el permiso de video en el icono de candado de tu navegador para usar el escáner.', 'error');
            } else if (nombreError === 'NotFoundError' || nombreError === 'DevicesNotFoundError') {
                UI.Notificaciones.mostrarMensaje('No se detectó ninguna cámara disponible en este equipo.', 'warning');
            } else if (nombreError === 'NotReadableError' || nombreError === 'TrackStartError') {
                UI.Notificaciones.mostrarMensaje('La cámara está en uso por otra aplicación o pestaña. Ciérrala para continuar.', 'error');
            } else if (nombreError === 'SecurityError') {
                UI.Notificaciones.mostrarMensaje('El navegador bloqueó la cámara por políticas de seguridad (requiere HTTPS o localhost).', 'error');
            } else {
                UI.Notificaciones.mostrarMensaje('No se pudo acceder a la cámara (' + (err.message || 'error de dispositivo') + ').', 'error');
            }
        }
    }

    function detenerEscaneoCamara() {
        escaneoEnCurso = false;

        if (temporizadorTimeoutCamara) {
            clearTimeout(temporizadorTimeoutCamara);
            temporizadorTimeoutCamara = null;
        }

        // 1. Detener intervalo de detección nativa
        if (detectorIntervalo) {
            clearInterval(detectorIntervalo);
            detectorIntervalo = null;
        }

        // 2. Detener lector ZXing por completo y sus pistas internas
        if (zxingReader) {
            try {
                if (typeof zxingReader.stopContinuousDecode === 'function') {
                    zxingReader.stopContinuousDecode();
                }
            } catch (e) {}
            try {
                if (typeof zxingReader.stopStreams === 'function') {
                    zxingReader.stopStreams();
                }
            } catch (e) {}
            try {
                if (typeof zxingReader.reset === 'function') {
                    zxingReader.reset();
                }
            } catch (e) {}
            if (zxingReader.stream && typeof zxingReader.stream.getTracks === 'function') {
                try {
                    zxingReader.stream.getTracks().forEach(track => {
                        try { track.enabled = false; } catch (e) {}
                        try { track.stop(); } catch (e) {}
                    });
                } catch (e) {}
                zxingReader.stream = null;
            }
        }

        // 3. Detener de forma forzada TODOS los tracks de hardware en streamCamaraActivo
        if (streamCamaraActivo) {
            try {
                const tracks = typeof streamCamaraActivo.getTracks === 'function' ? streamCamaraActivo.getTracks() : [];
                tracks.forEach(track => {
                    try { track.enabled = false; } catch (e) {}
                    try { track.stop(); } catch (e) {}
                });
            } catch (e) {}
            streamCamaraActivo = null;
        }

        // 4. Detener tracks y limpiar elemento <video>
        const video = el('videoCamaraEscaneo');
        if (video) {
            try {
                if (video.srcObject && typeof video.srcObject.getTracks === 'function') {
                    video.srcObject.getTracks().forEach(track => {
                        try { track.enabled = false; } catch (e) {}
                        try { track.stop(); } catch (e) {}
                    });
                }
            } catch (e) {}
            try {
                video.pause();
            } catch (e) {}
            video.srcObject = null;
        }

        // 5. Cerrar diálogo modal nativo
        const modal = el('modalCamaraEscaneo');
        if (modal) {
            try {
                if (modal.open && typeof modal.close === 'function') {
                    modal.close();
                } else {
                    modal.removeAttribute('open');
                }
            } catch (e) {}
        }
    }

    async function procesarArchivoImagenEscaneo(archivo, modo = modoEscaneoActual) {
        if (!archivo) return;
        try {
            // 0. Auditoría previa y validación de seguridad de imagen
            if (Dominio && typeof Dominio.validarArchivoSeguro === 'function') {
                const resVal = await Dominio.validarArchivoSeguro(archivo, { tipoPermitido: 'imagen' });
                if (!resVal.valido) {
                    UI.Notificaciones.mostrarMensaje('Archivo de imagen rechazado por seguridad: ' + resVal.error, 'error');
                    if (Dominio.emitirBipError) Dominio.emitirBipError();
                    const inputArchivo = el('inputArchivoEscaneoLocal');
                    if (inputArchivo) inputArchivo.value = '';
                    return;
                }
            }

            UI.Notificaciones.mostrarMensaje('Analizando imagen en busca de códigos...', 'info');

            const img = new Image();
            const objectUrl = URL.createObjectURL(archivo);

            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('No se pudo cargar la imagen seleccionada.'));
                img.src = objectUrl;
            });

            let codigoDetectado = null;

            // 1. Detección nativa con BarcodeDetector si está soportada
            if ('BarcodeDetector' in window) {
                try {
                    const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'upc_a', 'ean_8', 'itf'] });
                    const resultados = await detector.detect(img);
                    if (resultados && resultados.length > 0 && resultados[0].rawValue) {
                        codigoDetectado = resultados[0].rawValue;
                    }
                } catch (e) {}
            }

            // 2. Detección universal con ZXing si BarcodeDetector no halló código
            if (!codigoDetectado && global.ZXing && global.ZXing.BrowserMultiFormatReader) {
                try {
                    const reader = new global.ZXing.BrowserMultiFormatReader();
                    const resZXing = await reader.decodeFromImageElement(img);
                    if (resZXing && resZXing.getText()) {
                        codigoDetectado = resZXing.getText();
                    }
                } catch (e) {}
            }

            URL.revokeObjectURL(objectUrl);

            if (!codigoDetectado) {
                UI.Notificaciones.mostrarMensaje('No se detectó ningún código QR o de barras en la imagen. Asegúrate de que el código esté bien enfocado y legible.', 'warning');
                return;
            }

            detenerEscaneoCamara();
            emitirFeedbackEscaneo();

            if (modo === 'factura' || Dominio.parsearQrFacturaDgii(codigoDetectado).esDgii) {
                const resDgii = Dominio.parsearQrFacturaDgii(codigoDetectado);
                if (resDgii.esDgii && resDgii.esValido) {
                    UI.Factura.cargarDatosDesdeQrDgii(resDgii.datos);
                } else {
                    UI.Notificaciones.mostrarMensaje('El código en la imagen no es un comprobante fiscal DGII válido.', 'warning');
                }
            } else {
                const codigoNormalizado = Dominio.normalizarCodigoBarras(codigoDetectado);
                const val = Dominio.validarCodigoBarrasEstandar(codigoNormalizado);
                if (val.esValido) {
                    const inputCodigo = el('calcCodigoBarras');
                    if (inputCodigo) inputCodigo.value = codigoNormalizado;
                    procesarEscaneoCodigoBarras(true);
                } else {
                    UI.Notificaciones.mostrarMensaje('Código de barras no estándar o inválido en la imagen.', 'warning');
                }
            }

        } catch (err) {
            console.warn('Error decodificando imagen subida:', err);
            UI.Notificaciones.mostrarMensaje('Error al leer el archivo de imagen (' + (err.message || 'formato no soportado') + ').', 'error');
        } finally {
            const inputArchivo = el('inputArchivoEscaneoLocal');
            if (inputArchivo) inputArchivo.value = '';
        }
    }

    function configurarEscaneoCamara() {
        const btnEscanear = el('btnEscanearCamara');
        if (btnEscanear) {
            btnEscanear.addEventListener('click', () => iniciarEscaneoCamara('producto'));
        }

        const inputArchivo = el('inputArchivoEscaneoLocal');
        if (inputArchivo) {
            inputArchivo.addEventListener('change', e => {
                if (e.target.files && e.target.files[0]) {
                    procesarArchivoImagenEscaneo(e.target.files[0], modoEscaneoActual);
                }
            });
        }
        const btnQrFactura = el('btnEscanearQrFactura');
        if (btnQrFactura) {
            btnQrFactura.addEventListener('click', () => iniciarEscaneoCamara('factura'));
        }

        const btnCerrar = el('btnCerrarModalCamara');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                detenerEscaneoCamara();
            });
        }

        const btnCancelar = el('btnCancelarCamara');
        if (btnCancelar) {
            btnCancelar.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                detenerEscaneoCamara();
            });
        }

        const modal = el('modalCamaraEscaneo');
        if (modal) {
            modal.addEventListener('close', detenerEscaneoCamara);
            modal.addEventListener('cancel', e => {
                e.preventDefault();
                detenerEscaneoCamara();
            });
            modal.addEventListener('click', e => {
                if (e.target === modal) {
                    detenerEscaneoCamara();
                }
            });
        }

        // Intercepción inteligente para pistolas lectoras 2D USB (escaneo directo a inputs)
        if (typeof document !== 'undefined') {
            document.addEventListener('input', e => {
                const target = e.target;
                if (!target || typeof target.value !== 'string') return;
                const val = target.value.trim();
                if (val.length > 20 && (val.includes('ConsultaTimbre') || val.includes('eNCF='))) {
                    const parsed = Dominio.parsearQrFacturaDgii(val);
                    if (parsed.esDgii && parsed.esValido) {
                        target.value = '';
                        emitirFeedbackEscaneo();
                        UI.Factura.cargarDatosDesdeQrDgii(parsed.datos);
                    }
                }
            });
        }

        // Apagar la cámara si el usuario cambia de pestaña o cierra la ventana
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', detenerEscaneoCamara);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && escaneoEnCurso) {
                    detenerEscaneoCamara();
                }
            });
        }
    }

    UI.Calculadora = Object.freeze({
        procesarArchivoImagenEscaneo,
        calcularEnVivo,
        dispararCalculoDebounced,
        actualizarVisibilidadCategoria,
        procesarEscaneoCodigoBarras,
        establecerBloqueoReglas,
        actualizarEtiquetasReglasUI,
        inicializarEventosCalculadora,
        iniciarEscaneoCamara,
        detenerEscaneoCamara
    });
})(window);
