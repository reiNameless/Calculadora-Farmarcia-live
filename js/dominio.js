(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const { CONSTANTES, ESTRATEGIAS_CALCULO, REGLAS_NEGOCIO_POR_DEFECTO } = AppFarmacia.Configuracion;

    // Clonado profundo seguro (structuredClone nativo con fallback)
    function clonarObjetoSeguro(objeto) {
        if (objeto === undefined || objeto === null) return objeto;
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(objeto);
            } catch (e) {
                // Fallback si contiene elementos no clonables por structuredClone
            }
        }
        return JSON.parse(JSON.stringify(objeto));
    }

    function generarIdUnico() {
        if (typeof crypto !== 'undefined') {
            if (typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            if (typeof crypto.getRandomValues === 'function') {
                const arr = new Uint32Array(3);
                crypto.getRandomValues(arr);
                return 'id_' + arr[0].toString(36) + '_' + arr[1].toString(36) + arr[2].toString(36);
            }
        }
        return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 11);
    }

    function obtenerFechaLocalISO() {
        const hoy = new Date();
        const anio = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const dia = String(hoy.getDate()).padStart(2, '0');
        return `${anio}-${mes}-${dia}`;
    }

    function sumarDiasAFechaISO(fechaIso, dias = 30) {
        if (!fechaIso || typeof fechaIso !== 'string' || !fechaIso.includes('-')) {
            return obtenerFechaLocalISO();
        }
        const partes = fechaIso.split('-').map(Number);
        if (partes.length !== 3 || partes.some(isNaN)) {
            return obtenerFechaLocalISO();
        }
        const fecha = new Date(partes[0], partes[1] - 1, partes[2]);
        fecha.setDate(fecha.getDate() + Number(dias));
        const anio = fecha.getFullYear();
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const dia = String(fecha.getDate()).padStart(2, '0');
        return `${anio}-${mes}-${dia}`;
    }

    function redondearDecimalExacto(numero, cantidadDecimales) {
        const valorNumerico = Number(numero);
        if (!Number.isFinite(valorNumerico)) return 0;
        const dec = Math.max(0, Math.min(20, Math.floor(cantidadDecimales || 0)));
        const signo = valorNumerico < 0 ? -1 : 1;
        const valorAbsoluto = Math.abs(valorNumerico);
        if (dec === 0) return signo * Math.round(valorAbsoluto);
        // Notación exponencial exacta en base 10 para neutralizar sesgo de coma flotante IEEE 754
        const partes = String(valorAbsoluto).split('e');
        const valorAlineado = Number(partes[0] + 'e' + (partes[1] ? Number(partes[1]) + dec : dec));
        const redondeado = Math.round(valorAlineado);
        const partesRedondeadas = String(redondeado).split('e');
        return signo * Number(partesRedondeadas[0] + 'e' + (partesRedondeadas[1] ? Number(partesRedondeadas[1]) - dec : -dec));
    }

    const formateadorMoneda = (typeof Intl !== 'undefined' && Intl.NumberFormat)
        ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : null;

    function formatearMonedaDosDecimales(numero) {
        const redondeado = redondearDecimalExacto(numero, CONSTANTES.DECIMALES_MONEDA);
        if (formateadorMoneda) {
            return formateadorMoneda.format(redondeado);
        }
        return redondeado.toFixed(CONSTANTES.DECIMALES_MONEDA);
    }

    function formatearCostoFiscalOchoDecimales(numero) {
        const valorNumerico = Number(numero);
        if (!Number.isFinite(valorNumerico)) return '0.00000000';
        return valorNumerico.toFixed(CONSTANTES.DECIMALES_COSTO_UNITARIO);
    }

    // Validación numérica pura sin expresiones regulares frágiles
    function validarPrecioCompra(entradaCruda) {
        const textoLimpio = String(entradaCruda ?? '').trim().replace(',', '.');
        if (textoLimpio === '') {
            return { esValido: false, error: 'Escribe el precio de compra de 1 caja o frasco.' };
        }
        const numero = Number(textoLimpio);
        const maxPrecio = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS)
            ? AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS.MAX_PRECIO_COMPRA
            : 50000000;
        if (!Number.isFinite(numero) || numero <= 0) {
            return { esValido: false, error: 'El precio de compra debe ser un número mayor que 0.' };
        }
        if (numero > maxPrecio) {
            return { esValido: false, error: 'El precio de compra no puede superar RD$ ' + maxPrecio.toLocaleString() + '.' };
        }
        return { esValido: true, valor: numero };
    }

    function validarCantidadEnteraPositiva(entradaCruda, descripcionCampo) {
        const textoLimpio = String(entradaCruda ?? '').trim();
        if (textoLimpio === '') {
            return { esValido: false, error: 'Escribe ' + descripcionCampo + '.' };
        }
        const numero = Number(textoLimpio);
        const maxCantidad = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS)
            ? AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS.MAX_CAJAS
            : 100000;
        if (!Number.isFinite(numero) || !Number.isInteger(numero) || textoLimpio.includes('.') || textoLimpio.includes(',')) {
            return { esValido: false, error: 'Revisa ' + descripcionCampo + ': debe ser un número entero sin decimales.' };
        }
        if (numero < 1) {
            return { esValido: false, error: 'Revisa ' + descripcionCampo + ': debe ser de 1 en adelante.' };
        }
        if (numero > maxCantidad) {
            return { esValido: false, error: 'Revisa ' + descripcionCampo + ': el valor máximo permitido es ' + maxCantidad.toLocaleString() + '.' };
        }
        return { esValido: true, valor: numero };
    }

    function normalizarCodigoBarras(entradaCruda) {
        return String(entradaCruda ?? '').trim().split(' ').join('');
    }

    function validarCodigoBarrasEstandar(entradaCruda) {
        const codigo = normalizarCodigoBarras(entradaCruda);
        if (!codigo) {
            return { esValido: false, error: 'Escribe o escanea un código de barras.', tipo: null, codigo: '' };
        }
        if (!/^\d+$/.test(codigo)) {
            return { esValido: false, error: 'El código de barras debe contener solo números.', tipo: null, codigo };
        }
        const len = codigo.length;
        const tiposPorLongitud = {
            8: 'EAN-8',
            12: 'UPC-A',
            13: 'EAN-13',
            14: 'ITF-14'
        };
        const tipoEstandar = tiposPorLongitud[len];
        if (!tipoEstandar) {
            return {
                esValido: false,
                error: `Longitud no estándar (${len} dígitos). Los estándares comerciales usan 8 (EAN-8), 12 (UPC-A) o 13 dígitos (EAN-13).`,
                tipo: 'LONGITUD_NO_ESTANDAR',
                codigo
            };
        }

        // Algoritmo oficial GS1 Check Digit (Modulo 10)
        const digitos = codigo.split('').map(Number);
        const digitoControlIngresado = digitos[len - 1];
        let suma = 0;
        let peso = 3;
        for (let i = len - 2; i >= 0; i--) {
            suma += digitos[i] * peso;
            peso = (peso === 3) ? 1 : 3;
        }
        const digitoControlEsperado = (10 - (suma % 10)) % 10;

        if (digitoControlIngresado !== digitoControlEsperado) {
            return {
                esValido: false,
                error: `Dígito verificador incorrecto para estándar ${tipoEstandar}. Termina en ${digitoControlIngresado}, pero debería ser ${digitoControlEsperado}.`,
                tipo: tipoEstandar,
                digitoIngresado: digitoControlIngresado,
                digitoEsperado: digitoControlEsperado,
                codigo
            };
        }

        return {
            esValido: true,
            tipo: tipoEstandar,
            codigo,
            error: null
        };
    }

    function sanitizarReglasNegocio(reglasCandidatas) {
        const { PERFILES_POR_DEFECTO } = AppFarmacia.Configuracion;
        if (!reglasCandidatas || typeof reglasCandidatas !== 'object') {
            return clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO);
        }

        const estrategiasValidas = Object.values(ESTRATEGIAS_CALCULO);
        const estrategia = estrategiasValidas.includes(reglasCandidatas.estrategia)
            ? reglasCandidatas.estrategia
            : REGLAS_NEGOCIO_POR_DEFECTO.estrategia;

        const leerPorcentaje = (valor, porDefecto) => {
            const num = Number(valor);
            return (Number.isFinite(num) && num >= 0 && num <= 500) ? num : porDefecto;
        };

        // Clona y valida los perfiles independientes de cada fórmula
        const perfilesPrevios = reglasCandidatas.perfiles || {};
        const perfilesLimpios = {};

        estrategiasValidas.forEach(claveEst => {
            const def = PERFILES_POR_DEFECTO[claveEst];
            const prev = perfilesPrevios[claveEst] || {};
            perfilesLimpios[claveEst] = {
                p1: leerPorcentaje(prev.p1, def.p1),
                p2: leerPorcentaje(prev.p2, def.p2),
                p3: leerPorcentaje(prev.p3, def.p3)
            };
        });

        // Si se enviaron porcentajes directos para la estrategia activa, actualiza el perfil de esa estrategia
        const perfilActivo = perfilesLimpios[estrategia];
        const p1Activo = reglasCandidatas.porcentajePrecio1 !== undefined
            ? leerPorcentaje(reglasCandidatas.porcentajePrecio1, perfilActivo.p1)
            : perfilActivo.p1;
        const p2Activo = reglasCandidatas.porcentajePrecio2 !== undefined
            ? leerPorcentaje(reglasCandidatas.porcentajePrecio2, perfilActivo.p2)
            : perfilActivo.p2;
        const p3Activo = reglasCandidatas.porcentajePrecio3 !== undefined
            ? leerPorcentaje(reglasCandidatas.porcentajePrecio3, perfilActivo.p3)
            : perfilActivo.p3;

        perfilesLimpios[estrategia] = Object.freeze({ p1: p1Activo, p2: p2Activo, p3: p3Activo });

        return Object.freeze({
            estrategia,
            porcentajeItbis: leerPorcentaje(reglasCandidatas.porcentajeItbis, REGLAS_NEGOCIO_POR_DEFECTO.porcentajeItbis),
            porcentajePrecio1: p1Activo,
            porcentajePrecio2: p2Activo,
            porcentajePrecio3: p3Activo,
            perfiles: Object.freeze(perfilesLimpios)
        });
    }

    // Patrón Strategy para el cálculo de precios brutos
    const ESTRATEGIAS_DISPATCH = Object.freeze({
        [ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO]: (costoUnitarioReal, f1, f2, f3) => ({
            p1Bruto: costoUnitarioReal * (1 + f1),
            p2Bruto: costoUnitarioReal * (1 + f2),
            p3Bruto: costoUnitarioReal * (1 + f3)
        }),
        [ESTRATEGIAS_CALCULO.MARGEN_BRUTO_FINANCIERO]: (costoUnitarioReal, f1, f2, f3) => {
            const divisor = Math.max(0.01, 1 - f1);
            const p1 = costoUnitarioReal / divisor;
            const p2 = p1 * (1 - f2);
            const p3 = p2 * (1 - f3);
            return { p1Bruto: p1, p2Bruto: p2, p3Bruto: p3 };
        },
        [ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO]: (costoUnitarioReal, f1, f2, f3) => {
            const p1 = costoUnitarioReal * (1 + f1);
            const p2 = p1 * (1 - f2);
            const p3 = p2 * (1 - f3);
            return { p1Bruto: p1, p2Bruto: p2, p3Bruto: p3 };
        }
    });

    function calcularDesglosePrecios(precioCajaBase, unidadesPorCaja, aplicaItbis, reglas = REGLAS_NEGOCIO_POR_DEFECTO, opciones = {}) {
        const reglasSeguras = sanitizarReglasNegocio(reglas);
        const unidades = Math.max(1, Number(unidadesPorCaja) || 1);
        const cajas = Math.max(1, Number(opciones.cajasCompradas) || 1);
        const esLeche = Boolean(opciones.esLeche);
        const descuentoValor = Math.max(0, Number(opciones.descuentoValor) || 0);
        const tipoDescuento = opciones.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto';

        // 1. Descuento aplicado al costo de compra
        let descuentoPorCaja = 0;
        let descuentoTotalLinea = 0;
        if (descuentoValor > 0) {
            if (tipoDescuento === 'porcentaje') {
                descuentoPorCaja = redondearDecimalExacto(precioCajaBase * (descuentoValor / 100), CONSTANTES.DECIMALES_MONEDA);
                descuentoTotalLinea = redondearDecimalExacto(descuentoPorCaja * cajas, CONSTANTES.DECIMALES_MONEDA);
            } else {
                descuentoTotalLinea = redondearDecimalExacto(descuentoValor, CONSTANTES.DECIMALES_MONEDA);
                descuentoPorCaja = cajas > 0 ? (descuentoValor / cajas) : 0;
            }
        }

        // 2. Costo Efectivo de Compra Fiscal (Precisión pura sin redondeo prematuro intermedio)
        const totalBaseCompra = precioCajaBase * cajas;
        const totalNetoCompra = Math.max(0, totalBaseCompra - descuentoTotalLinea);
        const montoItbisTotal = aplicaItbis
            ? redondearDecimalExacto(totalNetoCompra * (reglasSeguras.porcentajeItbis / 100), CONSTANTES.DECIMALES_MONEDA)
            : 0;
        const subtotalFactura = redondearDecimalExacto(totalNetoCompra + montoItbisTotal, CONSTANTES.DECIMALES_MONEDA);
        const montoItbisPorCaja = cajas > 0 ? redondearDecimalExacto(montoItbisTotal / cajas, CONSTANTES.DECIMALES_MONEDA) : 0;
        const costoCajaEfectivo = cajas > 0 ? redondearDecimalExacto(subtotalFactura / cajas, CONSTANTES.DECIMALES_MONEDA) : 0;

        // Costo unitario real: división directa exacta de la inversión real entre el total de unidades
        const totalUnidades = cajas * unidades;
        const costoUnitarioReal = totalUnidades > 0 ? ((totalNetoCompra + montoItbisTotal) / totalUnidades) : 0;
        const precioCajaNeto = cajas > 0 ? (totalNetoCompra / cajas) : 0;

        // 3. Precios de Venta (P1, P2, P3): calculados sobre precio base SIN descuento (regla farmacia)
        const totalBaseVenta = precioCajaBase * cajas;
        const montoItbisVentaTotal = aplicaItbis
            ? redondearDecimalExacto(totalBaseVenta * (reglasSeguras.porcentajeItbis / 100), CONSTANTES.DECIMALES_MONEDA)
            : 0;
        const totalVentaBase = totalBaseVenta + montoItbisVentaTotal;
        const costoUnitarioVentaReal = totalUnidades > 0 ? (totalVentaBase / totalUnidades) : 0;

        // Margen P1: Leche usa 10% (costo * 1.10), otros productos usan porcentajePrecio1 activo (ej: +30%)
        const f1 = esLeche ? 0.10 : (reglasSeguras.porcentajePrecio1 / 100);
        const f2 = reglasSeguras.porcentajePrecio2 / 100;
        const f3 = reglasSeguras.porcentajePrecio3 / 100;

        const calculador = ESTRATEGIAS_DISPATCH[reglasSeguras.estrategia] || ESTRATEGIAS_DISPATCH[ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO];
        const { p1Bruto, p2Bruto, p3Bruto } = calculador(costoUnitarioVentaReal, f1, f2, f3);

        return Object.freeze({
            precioCajaBase,
            precioCajaNeto: redondearDecimalExacto(precioCajaNeto, CONSTANTES.DECIMALES_MONEDA),
            descuentoValor,
            tipoDescuento,
            descuentoPorCaja: redondearDecimalExacto(descuentoPorCaja, CONSTANTES.DECIMALES_MONEDA),
            descuentoTotalLinea: redondearDecimalExacto(descuentoTotalLinea, CONSTANTES.DECIMALES_MONEDA),
            esLeche,
            costoCajaEfectivo,
            montoItbisPorCaja,
            montoItbisTotal,
            subtotalFactura,
            porcentajeItbis: reglasSeguras.porcentajeItbis,
            costoUnitarioReal,
            costoUnitario: formatearCostoFiscalOchoDecimales(costoUnitarioReal),
            costoUnitarioVentaReal,
            costoUnitarioVenta: formatearCostoFiscalOchoDecimales(costoUnitarioVentaReal),
            p1Bruto: redondearDecimalExacto(p1Bruto, CONSTANTES.DECIMALES_AUDITORIA),
            p2Bruto: redondearDecimalExacto(p2Bruto, CONSTANTES.DECIMALES_AUDITORIA),
            p3Bruto: redondearDecimalExacto(p3Bruto, CONSTANTES.DECIMALES_AUDITORIA),
            p1Exacto: formatearMonedaDosDecimales(p1Bruto),
            p2Exacto: formatearMonedaDosDecimales(p2Bruto),
            p3Exacto: formatearMonedaDosDecimales(p3Bruto),
            p1Redondeado: String(Math.round(p1Bruto)),
            p2Redondeado: String(Math.round(p2Bruto)),
            p3Redondeado: String(Math.round(p3Bruto))
        });
    }

    function crearLineaProductoInmutable(datosEntrada, reglas = REGLAS_NEGOCIO_POR_DEFECTO) {
        const esEntero = datosEntrada.tipo === CONSTANTES.CATEGORIAS.ENTERO;
        const tipo = esEntero ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        const unidadesPorCaja = esEntero ? 1 : Number(datosEntrada.unidadesPorCaja);
        const cajasCompradas = Number(datosEntrada.cajasCompradas);
        const precioCajaBase = Number(datosEntrada.precioCajaBase);
        const aplicaItbis = Boolean(datosEntrada.aplicaItbis);
        const esLeche = Boolean(datosEntrada.esLeche);
        const descuentoValor = Number(datosEntrada.descuentoValor) || 0;
        const tipoDescuento = datosEntrada.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto';
        const manual = { ...(datosEntrada.manual || {}) };

        const calculos = calcularDesglosePrecios(precioCajaBase, unidadesPorCaja, aplicaItbis, reglas, {
            cajasCompradas,
            esLeche,
            descuentoValor,
            tipoDescuento
        });
        const montoItbisLinea = calculos.montoItbisTotal;

        return Object.freeze({
            idLinea: datosEntrada.idLinea || generarIdUnico(),
            codigoBarras: normalizarCodigoBarras(datosEntrada.codigoBarras),
            nombre: String(datosEntrada.nombre || 'Producto').trim(),
            tipo,
            precioCajaBase,
            descuentoValor,
            tipoDescuento,
            descuentoTotalLinea: calculos.descuentoTotalLinea,
            descuentoPorCaja: calculos.descuentoPorCaja,
            esLeche,
            unidadesPorCaja,
            cajasCompradas,
            aplicaItbis,
            montoItbisPorCaja: calculos.montoItbisPorCaja,
            montoItbisLinea,
            costoCajaEfectivo: calculos.costoCajaEfectivo,
            porcentajeItbis: calculos.porcentajeItbis,
            manual: Object.freeze(manual),
            costoUnitario: calculos.costoUnitario,
            costoUnitarioVenta: calculos.costoUnitarioVenta,
            p1Exacto: manual.p1 ? datosEntrada.p1Exacto : calculos.p1Exacto,
            p2Exacto: manual.p2 ? datosEntrada.p2Exacto : calculos.p2Exacto,
            p3Exacto: manual.p3 ? datosEntrada.p3Exacto : calculos.p3Exacto,
            p1Redondeado: manual.p1 ? datosEntrada.p1Redondeado : calculos.p1Redondeado,
            p2Redondeado: manual.p2 ? datosEntrada.p2Redondeado : calculos.p2Redondeado,
            p3Redondeado: manual.p3 ? datosEntrada.p3Redondeado : calculos.p3Redondeado,
            totalUnidadesInventario: cajasCompradas * unidadesPorCaja,
            subtotalFactura: calculos.subtotalFactura
        });
    }

    function calcularResumenCuadreFactura(listaProductos, totalFisicoEsperado) {
        const productos = listaProductos || [];
        let totalBrutoAcumulado = 0;
        let totalDescuentoAcumulado = 0;
        let totalExentoAcumulado = 0;
        let totalGravadoAcumulado = 0;
        let totalItbisAcumulado = 0;
        let sumaAcumulada = 0;

        productos.forEach(prod => {
            const cajas = Math.max(1, Number(prod.cajasCompradas) || 1);
            const precioBase = Math.max(0, Number(prod.precioCajaBase) || 0);
            const descLinea = Math.max(0, Number(prod.descuentoTotalLinea) || 0);
            const brutoLinea = redondearDecimalExacto(cajas * precioBase, CONSTANTES.DECIMALES_MONEDA);
            const netoLinea = Math.max(0, redondearDecimalExacto(brutoLinea - descLinea, CONSTANTES.DECIMALES_MONEDA));

            totalBrutoAcumulado = redondearDecimalExacto(totalBrutoAcumulado + brutoLinea, CONSTANTES.DECIMALES_MONEDA);
            totalDescuentoAcumulado = redondearDecimalExacto(totalDescuentoAcumulado + descLinea, CONSTANTES.DECIMALES_MONEDA);

            const aplicaItbis = Boolean(prod.aplicaItbis);
            const tasa = (prod.tasaItbis !== undefined) ? Number(prod.tasaItbis) : (aplicaItbis ? 18 : 0);
            if (!aplicaItbis || tasa === 0) {
                totalExentoAcumulado = redondearDecimalExacto(totalExentoAcumulado + netoLinea, CONSTANTES.DECIMALES_MONEDA);
            } else {
                totalGravadoAcumulado = redondearDecimalExacto(totalGravadoAcumulado + netoLinea, CONSTANTES.DECIMALES_MONEDA);
            }

            const itbisLinea = (prod.montoItbisLinea !== undefined)
                ? Number(prod.montoItbisLinea)
                : (aplicaItbis ? redondearDecimalExacto(netoLinea * (tasa / 100), CONSTANTES.DECIMALES_MONEDA) : 0);

            totalItbisAcumulado = redondearDecimalExacto(totalItbisAcumulado + itbisLinea, CONSTANTES.DECIMALES_MONEDA);

            const subtotalLinea = (prod.subtotalFactura !== undefined)
                ? Number(prod.subtotalFactura)
                : redondearDecimalExacto(netoLinea + itbisLinea, CONSTANTES.DECIMALES_MONEDA);

            sumaAcumulada = redondearDecimalExacto(sumaAcumulada + subtotalLinea, CONSTANTES.DECIMALES_MONEDA);
        });

        const subtotalBaseAcumulado = redondearDecimalExacto(
            totalExentoAcumulado + totalGravadoAcumulado,
            CONSTANTES.DECIMALES_MONEDA
        );
        const totalFisico = Number(totalFisicoEsperado) || 0;
        const diferencia = redondearDecimalExacto(sumaAcumulada - totalFisico, CONSTANTES.DECIMALES_MONEDA);
        const cuadreExacto = totalFisico > 0 && Math.abs(diferencia) <= CONSTANTES.TOLERANCIA_CUADRE_FACTURA;

        return Object.freeze({
            totalBrutoAcumulado,
            totalDescuentoAcumulado,
            totalExentoAcumulado,
            totalGravadoAcumulado,
            totalItbisAcumulado,
            subtotalBaseAcumulado,
            sumaAcumulada,
            totalFisico,
            diferencia,
            cuadreExacto
        });
    }

    /**
     * Copia texto al portapapeles con degradación elegante a execCommand para entornos HTTP o permisos denegados.
     * @param {string|number} texto
     * @returns {Promise<void>}
     */
        /**
     * Sanitiza cadenas para renderizado seguro en DOM contra XSS.
     * @param {string|number} texto
     * @returns {string}
     */
    function escaparHtml(texto) {
        return String(texto ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    /**
     * Inmunización recursiva contra Prototype Pollution en objetos deserializados de JSON.
     * @param {any} obj
     * @returns {any}
     */
    function sanitizarJsonSeguro(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            return obj.map(sanitizarJsonSeguro);
        }
        const limpio = {};
        for (const [clave, valor] of Object.entries(obj)) {
            if (clave === '__proto__' || clave === 'constructor' || clave === 'prototype') {
                continue;
            }
            limpio[clave] = sanitizarJsonSeguro(valor);
        }
        return limpio;
    }

    function copiarAlPortapapeles(texto) {
        const textoStr = String(texto ?? '');
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(textoStr).catch(() => fallbackCopiar(textoStr));
        }
        return fallbackCopiar(textoStr);
    }

    function fallbackCopiar(texto) {
        return new Promise((resolve, reject) => {
            try {
                if (typeof document === 'undefined') return reject(new Error('No DOM'));
                const area = document.createElement('textarea');
                area.value = texto;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.left = '-9999px';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.focus();
                area.select();
                const exito = document.execCommand('copy');
                document.body.removeChild(area);
                if (exito) resolve();
                else reject(new Error('Fallo al copiar al portapapeles'));
            } catch (err) {
                reject(err);
            }
        });
    }


    // --- VALIDACIÓN DE RNC Y CÉDULA DE LA REPÚBLICA DOMINICANA (DGII) ---
    function validarRnc(rncCrudo) {
        const rnc = String(rncCrudo ?? '').replace(/\D/g, '');
        if (!rnc) {
            return { esValido: false, motivo: 'RNC vacío.', tipo: null, rnc: '' };
        }
        if (rnc.length === 9) {
            // Persona Jurídica (Módulo 11 DGII)
            const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
            let suma = 0;
            for (let i = 0; i < 8; i++) {
                suma += parseInt(rnc.charAt(i), 10) * pesos[i];
            }
            const resto = suma % 11;
            let digitoEsperado;
            if (resto === 0) {
                digitoEsperado = 2;
            } else if (resto === 1) {
                digitoEsperado = 1;
            } else {
                digitoEsperado = 11 - resto;
            }
            const digitoReal = parseInt(rnc.charAt(8), 10);
            const esValido = digitoEsperado === digitoReal;
            return {
                esValido,
                tipo: 'RNC Jurídico (9 dígitos)',
                rnc,
                digitoEsperado,
                digitoReal,
                motivo: esValido ? 'RNC válido según Módulo 11 DGII.' : 'Dígito verificador incorrecto.'
            };
        } else if (rnc.length === 11) {
            // Persona Física / Cédula (Luhn / Módulo 10 DGII)
            if (rnc.startsWith('000')) {
                return { esValido: false, motivo: 'Secuencia inicial no válida.', tipo: 'Cédula / RNC Físico (11 dígitos)', rnc };
            }
            const pesos = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
            let suma = 0;
            for (let i = 0; i < 10; i++) {
                const mult = parseInt(rnc.charAt(i), 10) * pesos[i];
                suma += mult >= 10 ? Math.floor(mult / 10) + (mult % 10) : mult;
            }
            const digitoEsperado = (10 - (suma % 10)) % 10;
            const digitoReal = parseInt(rnc.charAt(10), 10);
            const esValido = digitoEsperado === digitoReal;
            return {
                esValido,
                tipo: 'Cédula / RNC Físico (11 dígitos)',
                rnc,
                digitoEsperado,
                digitoReal,
                motivo: esValido ? 'Cédula/RNC válido según algoritmo DGII.' : 'Dígito verificador incorrecto.'
            };
        }
        return {
            esValido: false,
            tipo: 'Desconocido',
            rnc,
            motivo: 'El RNC debe contener 9 dígitos (empresas) u 11 dígitos (personas físicas).'
        };
    }

    // --- DECODIFICADOR DE CÓDIGOS QR DE COMPROBANTES FISCALES ELECTRÓNICOS (e-CF / DGII) ---
    function parsearQrFacturaDgii(textoCrudo) {
        const texto = String(textoCrudo ?? '').trim();
        if (!texto) {
            return { esValido: false, esDgii: false, error: 'Código QR vacío.' };
        }

        let params = null;
        try {
            if (/^https?:\/\//i.test(texto)) {
                const urlObj = new URL(texto);
                params = urlObj.searchParams;
            } else if (texto.includes('?') || texto.includes('=')) {
                const queryPart = texto.includes('?') ? texto.split('?')[1] : texto;
                params = new URLSearchParams(queryPart);
            }
        } catch (e) {
            params = null;
        }

        const obtenerParametro = (nombres) => {
            if (params) {
                for (const n of nombres) {
                    const val = params.get(n);
                    if (val !== null && val !== undefined && String(val).trim() !== '') return String(val).trim();
                }
            }
            for (const n of nombres) {
                const regex = new RegExp('(?:[?&]|^)' + n + '=([^&\\s]+)', 'i');
                const match = texto.match(regex);
                if (match && match[1]) {
                    try {
                        return decodeURIComponent(match[1]).trim();
                    } catch (e) {
                        return match[1].trim();
                    }
                }
            }
            return '';
        };

        const rncEmisor = obtenerParametro(['RncEmisor', 'rncemisor', 'RNC_EMISOR', 'rnc_emisor', 'Rnc', 'rnc']);
        const rncComprador = obtenerParametro(['RncComprador', 'rnccomprador', 'RNC_COMPRADOR', 'rnc_comprador']);
        const encf = obtenerParametro(['eNCF', 'encf', 'ENCF', 'NCF', 'ncf']);
        const fechaEmisionCruda = obtenerParametro(['FechaEmision', 'fechaemision', 'FechaFirma', 'fechafirma', 'Fecha', 'fecha']);
        const montoTotalCrudo = obtenerParametro(['MontoTotal', 'montototal', 'Total', 'total', 'monto']);
        const codigoSeguridad = obtenerParametro(['CodigoSeguridad', 'codigoseguridad', 'Codigo', 'codigo', 'timbre']);
        const totalItbisCrudo = obtenerParametro(['TotalITBIS', 'totalitbis', 'MontoITBIS', 'montoitbis', 'ITBIS', 'itbis']);

        const esUrlDgii = /dgii\.gov\.do/i.test(texto) || /ConsultaTimbre/i.test(texto);
        const tieneCamposDgii = Boolean(encf && (rncEmisor || montoTotalCrudo));

        if (!esUrlDgii && !tieneCamposDgii) {
            return {
                esValido: false,
                esDgii: false,
                error: 'El código escaneado no corresponde a un comprobante fiscal electrónico de la DGII.'
            };
        }

        let fechaEmision = '';
        if (fechaEmisionCruda) {
            const matchIso = fechaEmisionCruda.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
            const matchLat = fechaEmisionCruda.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
            const matchCompact = fechaEmisionCruda.match(/^(\d{4})(\d{2})(\d{2})$/);
            if (matchIso) {
                fechaEmision = matchIso[1] + '-' + matchIso[2] + '-' + matchIso[3];
            } else if (matchLat) {
                fechaEmision = matchLat[3] + '-' + matchLat[2] + '-' + matchLat[1];
            } else if (matchCompact) {
                fechaEmision = matchCompact[1] + '-' + matchCompact[2] + '-' + matchCompact[3];
            }
        }

        const montoTotal = parseFloat(String(montoTotalCrudo || '').replace(/,/g, '')) || 0;
        const totalItbis = parseFloat(String(totalItbisCrudo || '').replace(/,/g, '')) || 0;

        return {
            esValido: Boolean(encf || rncEmisor || montoTotal > 0),
            esDgii: true,
            datos: {
                rncEmisor: String(rncEmisor || '').replace(/\D/g, ''),
                rncComprador: String(rncComprador || '').replace(/\D/g, ''),
                encf: encf.toUpperCase(),
                fechaEmision,
                montoTotal,
                totalItbis,
                codigoSeguridad: (codigoSeguridad || '').toUpperCase()
            }
        };
    }

    // --- SINTETIZADOR DE TONOS WEB AUDIO API PARA LECTURAS GS1 (CERO DEPENDENCIAS) ---

    // --- FASE 7: MOTOR CRIPTOGRÁFICO DE INTEGRIDAD Y SELLOS DIGITALES (CHRONIRIS SEAL) ---

    function sanitizarEntradaTexto(texto, maxLongitud = 120) {
        if (typeof texto !== 'string') return '';
        let limpio = texto.trim();
        limpio = limpio.replace(/[\x00-\x1F\x7F]/g, '');
        if (limpio.length > maxLongitud) {
            limpio = limpio.slice(0, maxLongitud);
        }
        return limpio;
    }

    function sha256Pure(asciiOrBytes) {
        let bytes;
        if (typeof asciiOrBytes === 'string') {
            const str = unescape(encodeURIComponent(asciiOrBytes));
            bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
        } else {
            bytes = new Uint8Array(asciiOrBytes);
        }

        const K = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];

        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

        const bitLen = bytes.length * 8;
        const padLen = (bytes.length % 64 < 56) ? (56 - (bytes.length % 64)) : (120 - (bytes.length % 64));
        const totalLen = bytes.length + padLen + 8;
        const msg = new Uint8Array(totalLen);
        msg.set(bytes, 0);
        msg[bytes.length] = 0x80;

        const highBits = Math.floor(bitLen / 0x100000000);
        const lowBits = bitLen >>> 0;
        msg[totalLen - 8] = (highBits >>> 24) & 0xff;
        msg[totalLen - 7] = (highBits >>> 16) & 0xff;
        msg[totalLen - 6] = (highBits >>> 8) & 0xff;
        msg[totalLen - 5] = highBits & 0xff;
        msg[totalLen - 4] = (lowBits >>> 24) & 0xff;
        msg[totalLen - 3] = (lowBits >>> 16) & 0xff;
        msg[totalLen - 2] = (lowBits >>> 8) & 0xff;
        msg[totalLen - 1] = lowBits & 0xff;

        const W = new Int32Array(64);
        for (let i = 0; i < totalLen; i += 64) {
            for (let t = 0; t < 16; t++) {
                const j = i + t * 4;
                W[t] = ((msg[j] << 24) | (msg[j+1] << 16) | (msg[j+2] << 8) | (msg[j+3])) | 0;
            }
            for (let t = 16; t < 64; t++) {
                const s0 = (((W[t-15] >>> 7) | (W[t-15] << 25)) ^ ((W[t-15] >>> 18) | (W[t-15] << 14)) ^ (W[t-15] >>> 3)) | 0;
                const s1 = (((W[t-2] >>> 17) | (W[t-2] << 15)) ^ ((W[t-2] >>> 19) | (W[t-2] << 13)) ^ (W[t-2] >>> 10)) | 0;
                W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
            }

            let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
            for (let t = 0; t < 64; t++) {
                const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) | 0;
                const ch = ((e & f) ^ ((~e) & g)) | 0;
                const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
                const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) | 0;
                const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
                const temp2 = (S0 + maj) | 0;

                h = g; g = f; f = e; e = (d + temp1) | 0;
                d = c; c = b; b = a; a = (temp1 + temp2) | 0;
            }

            h0 = (h0 + a) | 0;
            h1 = (h1 + b) | 0;
            h2 = (h2 + c) | 0;
            h3 = (h3 + d) | 0;
            h4 = (h4 + e) | 0;
            h5 = (h5 + f) | 0;
            h6 = (h6 + g) | 0;
            h7 = (h7 + h) | 0;
        }

        const toHex = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
        return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
    }

    function hmacSha256Pure(keyStr, messageStr) {
        const blockSize = 64;
        let keyBytes;
        if (typeof keyStr === 'string') {
            const str = unescape(encodeURIComponent(keyStr));
            keyBytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) keyBytes[i] = str.charCodeAt(i);
        } else {
            keyBytes = new Uint8Array(keyStr);
        }

        if (keyBytes.length > blockSize) {
            const hex = sha256Pure(keyBytes);
            keyBytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        }
        const paddedKey = new Uint8Array(blockSize);
        paddedKey.set(keyBytes, 0);

        const oPad = new Uint8Array(blockSize);
        const iPad = new Uint8Array(blockSize);
        for (let i = 0; i < blockSize; i++) {
            oPad[i] = paddedKey[i] ^ 0x5c;
            iPad[i] = paddedKey[i] ^ 0x36;
        }

        let msgBytes;
        if (typeof messageStr === 'string') {
            const str = unescape(encodeURIComponent(messageStr));
            msgBytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) msgBytes[i] = str.charCodeAt(i);
        } else {
            msgBytes = new Uint8Array(messageStr);
        }

        const inner = new Uint8Array(blockSize + msgBytes.length);
        inner.set(iPad, 0);
        inner.set(msgBytes, blockSize);
        const innerHashHex = sha256Pure(inner);
        const innerHashBytes = new Uint8Array(innerHashHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        const outer = new Uint8Array(blockSize + innerHashBytes.length);
        outer.set(oPad, 0);
        outer.set(innerHashBytes, blockSize);
        return sha256Pure(outer);
    }

    function serializarJsonCanonico(obj) {
        if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
        }
        if (Array.isArray(obj)) {
            return '[' + obj.map(serializarJsonCanonico).join(',') + ']';
        }
        const claves = Object.keys(obj).sort();
        return '{' + claves.map(k => JSON.stringify(k) + ':' + serializarJsonCanonico(obj[k])).join(',') + '}';
    }

    function firmarSobreDatos(datos, tipoArchivo = 'respaldo-farmacia-completo') {
        const semilla = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_CRIPTO)
            ? AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_CRIPTO.CLAVE_SISTEMA_SEMILLA
            : 'Chroniris-OS::reiNameless::FiscalPharmacy::v1';

        const timestamp = new Date().toISOString();
        const canonico = serializarJsonCanonico(datos);
        const huellaPayload = sha256Pure(canonico);
        const mensajeFirma = tipoArchivo + ':' + timestamp + ':' + huellaPayload;
        const firmaHmac = hmacSha256Pure(semilla, mensajeFirma);

        return {
            _chroniris_sello: {
                version: 1,
                emisor: 'Chroniris OS',
                autor: 'reiNameless',
                tipo: tipoArchivo,
                timestamp,
                huellaPayload,
                firmaHmac
            },
            datos
        };
    }

    function verificarSobreDatos(objetoCandidato, tipoEsperado = null) {
        if (!objetoCandidato || typeof objetoCandidato !== 'object') {
            return { esValido: false, codigo: 'PAYLOAD_INVALIDO', error: 'El archivo no contiene una estructura de datos válida.' };
        }

        const sello = objetoCandidato._chroniris_sello;
        if (!sello || typeof sello !== 'object') {
            return {
                esValido: false,
                codigo: 'SOBRE_NO_FIRMADO',
                error: 'Archivo sin firma digital. Solo se admiten archivos generados legítimamente por Chroniris OS con sello criptográfico.',
                esLegacy: true,
                datos: objetoCandidato.datos || objetoCandidato
            };
        }

        const { tipo, timestamp, huellaPayload, firmaHmac } = sello;
        if (!tipo || !timestamp || !huellaPayload || !firmaHmac) {
            return { esValido: false, codigo: 'SELLO_INCOMPLETO', error: 'El sello de seguridad del archivo está incompleto o dañado.' };
        }

        if (tipoEsperado && tipo !== tipoEsperado) {
            return {
                esValido: false,
                codigo: 'TIPO_INCORRECTO',
                error: 'El archivo corresponde a "' + tipo + '", pero se esperaba "' + tipoEsperado + '".'
            };
        }

        const canonico = serializarJsonCanonico(objetoCandidato.datos);
        const huellaCalculada = sha256Pure(canonico);
        if (huellaCalculada !== huellaPayload) {
            return {
                esValido: false,
                codigo: 'INTEGRIDAD_COMPROMETIDA',
                error: 'Alerta de Ciberseguridad: El archivo fue modificado o adulterado externamente (Huella SHA-256 no coincide).'
            };
        }

        const semilla = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_CRIPTO)
            ? AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_CRIPTO.CLAVE_SISTEMA_SEMILLA
            : 'Chroniris-OS::reiNameless::FiscalPharmacy::v1';

        const mensajeFirma = tipo + ':' + timestamp + ':' + huellaPayload;
        const firmaCalculada = hmacSha256Pure(semilla, mensajeFirma);
        if (firmaCalculada !== firmaHmac) {
            return {
                esValido: false,
                codigo: 'FIRMA_INVALIDA',
                error: 'Firma criptográfica inválida. El archivo no fue firmado por Chroniris OS o la firma es espuria.'
            };
        }

        return {
            esValido: true,
            tipo,
            timestamp,
            datos: objetoCandidato.datos
        };
    }

    function emitirBip(frecuencia = 880, duracionMs = 80, tipo = "sine") {
        try {
            if (typeof window === "undefined") return;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = tipo;
            osc.frequency.setValueAtTime(frecuencia, ctx.currentTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (duracionMs / 1000));
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + (duracionMs / 1000));
            setTimeout(() => { ctx.close().catch(() => {}); }, duracionMs + 100);
        } catch (_) {}
    }

    function emitirBipExito() {
        emitirBip(880, 80, "sine");
    }

    // --- FASE 6: AUDITORÍA Y VALIDACIÓN DE SEGURIDAD DE ARCHIVOS (DEFENSA EN PROFUNDIDAD) ---

    const FIRMAS_MAGICAS_ESTANDAR = Object.freeze([
        {
            mime: 'application/pdf',
            extension: 'pdf',
            verificar: (bytes) => (
                bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2D // %PDF-
            )
        },
        {
            mime: 'image/jpeg',
            extension: 'jpg',
            verificar: (bytes) => (
                bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
            )
        },
        {
            mime: 'image/png',
            extension: 'png',
            verificar: (bytes) => (
                bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
                bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
            )
        },
        {
            mime: 'image/webp',
            extension: 'webp',
            verificar: (bytes) => (
                bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
                bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50    // WEBP
            )
        },
        {
            mime: 'image/gif',
            extension: 'gif',
            verificar: (bytes) => (
                bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
                (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
            )
        }
    ]);

    const EXTENSIONES_PELIGROSAS_DEFAULT = new Set([
        'exe', 'bat', 'cmd', 'sh', 'php', 'phtml', 'php3', 'php4', 'php5',
        'js', 'vbs', 'ps1', 'jar', 'jsp', 'asp', 'aspx', 'cgi', 'pl', 'py', 'dll', 'so'
    ]);

    const PATRONES_PDF_MALICIOSOS_DEFAULT = Object.freeze([
        { regex: /\/JavaScript\b/i, motivo: 'Código JavaScript embebido no permitido en PDF (/JavaScript).' },
        { regex: /\/JS\s*(?:<<|\/|\()/i, motivo: 'Objeto ejecutable JS embebido (/JS).' },
        { regex: /\/Launch\b/i, motivo: 'Acción de ejecución de comandos externos (/Launch).' },
        { regex: /\/EmbeddedFiles\b/i, motivo: 'Archivos ejecutables o adjuntos embebidos (/EmbeddedFiles).' },
        { regex: /\/RichMedia\b/i, motivo: 'Contenido multimedia ejecutable (/RichMedia).' },
        { regex: /\/SubmitForm\b/i, motivo: 'Envío no controlado de formularios externos (/SubmitForm).' },
        { regex: /\/ImportData\b/i, motivo: 'Importación externa de datos (/ImportData).' },
        { regex: /\/URI\s*\([^)]*javascript\s*:/i, motivo: 'Enlace URI a pseudo-protocolo javascript:.' }
    ]);

    function sanitizarNombreArchivo(nombreOriginal) {
        if (typeof nombreOriginal !== 'string') return 'archivo_sin_nombre';
        let nombre = nombreOriginal.trim();
        nombre = nombre.replace(/[\x00-\x1F\x7F]/g, '');
        nombre = nombre.replace(/^.*[\\\/]/, '');
        const partes = nombre.split('.');
        if (partes.length > 2) {
            for (let i = 1; i < partes.length - 1; i++) {
                const extIntermedia = partes[i].toLowerCase();
                if (EXTENSIONES_PELIGROSAS_DEFAULT.has(extIntermedia)) {
                    throw new Error('Nombre de archivo sospechoso con doble extensión ejecutable (.' + extIntermedia + ').');
                }
            }
        }
        if (nombre.length > 255) {
            const ext = partes.length > 1 ? '.' + partes[partes.length - 1] : '';
            nombre = nombre.slice(0, 255 - ext.length) + ext;
        }
        return nombre || 'archivo_sanitizado';
    }

    function detectarFirmaMagica(bytes) {
        if (!bytes || bytes.length < 4) return null;
        for (const firma of FIRMAS_MAGICAS_ESTANDAR) {
            if (firma.verificar(bytes)) {
                return { mime: firma.mime, extension: firma.extension };
            }
        }
        return null;
    }

    function auditarEstructuraPdf(bytes) {
        if (!bytes || bytes.length < 16) {
            return { valido: false, error: 'El archivo es demasiado pequeño o está truncado para ser un PDF válido.' };
        }
        const limiteCabecera = Math.min(bytes.length, 1024);
        let cabeceraValida = false;
        let versionPdf = '';
        for (let i = 0; i <= limiteCabecera - 5; i++) {
            if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 && bytes[i+3] === 0x46 && bytes[i+4] === 0x2D) {
                cabeceraValida = true;
                let vStr = '';
                for (let j = i; j < Math.min(i + 12, bytes.length); j++) {
                    const c = String.fromCharCode(bytes[j]);
                    if (c === '\r' || c === '\n' || c === ' ') break;
                    vStr += c;
                }
                versionPdf = vStr;
                break;
            }
        }
        if (!cabeceraValida) {
            return { valido: false, error: 'Cabecera de archivo PDF corrupta o ausente (%PDF- no encontrado).' };
        }

        const inicioTrailer = Math.max(0, bytes.length - 2048);
        let tieneEof = false;
        for (let i = inicioTrailer; i <= bytes.length - 5; i++) {
            if (bytes[i] === 0x25 && bytes[i+1] === 0x25 && bytes[i+2] === 0x45 && bytes[i+3] === 0x4F && bytes[i+4] === 0x46) {
                tieneEof = true;
                break;
            }
        }
        if (!tieneEof) {
            return { valido: false, error: 'Estructura PDF incompleta o truncada (marcador %%EOF no encontrado en el pie).' };
        }

        let textoPdf = '';
        const tamanoLectura = bytes.length;
        const bloque = 8192;
        for (let i = 0; i < tamanoLectura; i += bloque) {
            const sub = bytes.subarray(i, Math.min(i + bloque, tamanoLectura));
            textoPdf += String.fromCharCode.apply(null, sub);
        }

        for (const patron of PATRONES_PDF_MALICIOSOS_DEFAULT) {
            if (patron.regex.test(textoPdf)) {
                return { valido: false, error: 'Amenaza de seguridad detectada en PDF: ' + patron.motivo };
            }
        }

        return { valido: true, versionPdf };
    }

    function auditarDimensionesImagen(bytes, mime) {
        const MAX_PIXELES = 64000000;
        if (mime === 'image/png') {
            if (bytes.length < 24) return { valido: false, error: 'Imagen PNG truncada.' };
            const ancho = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
            const alto = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
            if (ancho <= 0 || alto <= 0) return { valido: false, error: 'Dimensiones de imagen PNG inválidas.' };
            if (ancho * alto > MAX_PIXELES) {
                return { valido: false, error: 'Dimensiones de imagen excesivas (' + ancho + 'x' + alto + '). Riesgo de agotamiento de memoria (Decompression Bomb).' };
            }
            return { valido: true, ancho, alto };
        }
        if (mime === 'image/jpeg') {
            let i = 2;
            while (i < bytes.length - 8) {
                if (bytes[i] === 0xFF) {
                    const marker = bytes[i + 1];
                    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
                        const alto = (bytes[i + 5] << 8) | bytes[i + 6];
                        const ancho = (bytes[i + 7] << 8) | bytes[i + 8];
                        if (ancho * alto > MAX_PIXELES) {
                            return { valido: false, error: 'Dimensiones de imagen excesivas (' + ancho + 'x' + alto + '). Riesgo de agotamiento de memoria.' };
                        }
                        return { valido: true, ancho, alto };
                    }
                    const length = (bytes[i + 2] << 8) | bytes[i + 3];
                    i += 2 + length;
                } else {
                    i++;
                }
            }
        }
        return { valido: true };
    }

    async function extraerBytesDeArchivo(archivo, inicio = 0, fin = null) {
        if (!archivo) return new Uint8Array(0);
        if (archivo instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(archivo))) {
            const u8 = new Uint8Array(archivo);
            return fin !== null ? u8.subarray(inicio, fin) : u8.subarray(inicio);
        }
        if (archivo.buffer) {
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer(archivo.buffer)) {
                const u8 = new Uint8Array(archivo.buffer);
                return fin !== null ? u8.subarray(inicio, fin) : u8.subarray(inicio);
            }
            if (archivo.buffer instanceof ArrayBuffer) {
                const u8 = new Uint8Array(archivo.buffer);
                return fin !== null ? u8.subarray(inicio, fin) : u8.subarray(inicio);
            }
            if (archivo.buffer instanceof Uint8Array) {
                return fin !== null ? archivo.buffer.subarray(inicio, fin) : archivo.buffer.subarray(inicio);
            }
        }
        if (typeof archivo.slice === 'function') {
            const sub = fin !== null ? archivo.slice(inicio, fin) : archivo.slice(inicio);
            if (typeof sub.arrayBuffer === 'function') {
                const ab = await sub.arrayBuffer();
                return new Uint8Array(ab);
            }
        }
        if (typeof FileReader !== 'undefined') {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(new Uint8Array(r.result));
                r.onerror = () => reject(new Error('No se pudieron extraer los bytes del archivo.'));
                const sub = fin !== null ? archivo.slice(inicio, fin) : archivo.slice(inicio);
                r.readAsArrayBuffer(sub);
            });
        }
        return new Uint8Array(0);
    }

    async function validarArchivoSeguro(archivo, opciones = {}) {
        const configSeg = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_ARCHIVOS)
            ? AppFarmacia.Configuracion.CONSTANTES.SEGURIDAD_ARCHIVOS
            : null;

        const {
            tipoPermitido = 'factura',
            maxBytes = configSeg
                ? (tipoPermitido === 'json' ? configSeg.MAX_BYTES_JSON : configSeg.MAX_BYTES_FACTURA)
                : ((tipoPermitido === 'json' ? 5 : 15) * 1024 * 1024),
            nombreForzado = null
        } = opciones;

        if (!archivo) {
            return { valido: false, error: 'No se suministró ningún archivo para validación.', codigo: 'ARCHIVO_NULO' };
        }

        const tamano = archivo.size !== undefined ? archivo.size : (archivo.length || 0);
        if (tamano <= 0) {
            return { valido: false, error: 'El archivo está vacío (0 bytes).', codigo: 'ARCHIVO_VACIO' };
        }

        if (tamano > maxBytes) {
            const mbLimite = (maxBytes / (1024 * 1024)).toFixed(0);
            return {
                valido: false,
                error: 'El archivo supera el tamaño máximo permitido de seguridad (' + mbLimite + ' MB).',
                codigo: 'LIMITE_TAMANO_EXCEDIDO'
            };
        }

        const nombreOriginal = nombreForzado || archivo.name || 'archivo_desconocido';
        let nombreSanitizado;
        try {
            nombreSanitizado = sanitizarNombreArchivo(nombreOriginal);
        } catch (e) {
            return { valido: false, error: e.message, codigo: 'NOMBRE_SOSPECHOSO' };
        }

        const partes = nombreSanitizado.split('.');
        const extension = partes.length > 1 ? partes.pop().toLowerCase() : '';

        if (tipoPermitido === 'json') {
            if (extension !== 'json') {
                return { valido: false, error: 'La extensión del archivo debe ser .json.', codigo: 'EXTENSION_INVALIDA' };
            }
            const cabecera = await extraerBytesDeArchivo(archivo, 0, Math.min(tamano, 1024));
            for (let i = 0; i < cabecera.length; i++) {
                if (cabecera[i] === 0x00) {
                    return { valido: false, error: 'El archivo JSON contiene bytes nulos binarios no válidos.', codigo: 'JSON_BINARIO' };
                }
            }
            return { valido: true, nombreSanitizado, extension: 'json', mimeDetectado: 'application/json', tamanoBytes: tamano };
        }

        const extensionesPermitidas = tipoPermitido === 'imagen'
            ? ['jpg', 'jpeg', 'png', 'webp']
            : ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

        if (!extensionesPermitidas.includes(extension)) {
            return {
                valido: false,
                error: 'Extensión .' + extension + ' no permitida. Formatos válidos: ' + extensionesPermitidas.join(', ') + '.',
                codigo: 'EXTENSION_NO_PERMITIDA'
            };
        }

        const cabecera = await extraerBytesDeArchivo(archivo, 0, Math.min(tamano, 1024));
        const firma = detectarFirmaMagica(cabecera);

        if (!firma) {
            return {
                valido: false,
                error: 'Firma binaria del archivo no reconocida o corrupta. El contenido no coincide con un formato seguro.',
                codigo: 'FIRMA_DESCONOCIDA'
            };
        }

        if (extension === 'pdf' && firma.mime !== 'application/pdf') {
            return {
                valido: false,
                error: 'Suplantación de formato detectada: el archivo tiene extensión .pdf pero su contenido real es ' + firma.mime + '.',
                codigo: 'SUPLANTACION_MIME'
            };
        }

        if ((extension === 'jpg' || extension === 'jpeg') && firma.mime !== 'image/jpeg') {
            return {
                valido: false,
                error: 'Suplantación de formato detectada: el archivo tiene extensión .' + extension + ' pero su firma es ' + firma.mime + '.',
                codigo: 'SUPLANTACION_MIME'
            };
        }

        if (extension === 'png' && firma.mime !== 'image/png') {
            return {
                valido: false,
                error: 'Suplantación de formato detectada: el archivo tiene extensión .png pero su firma es ' + firma.mime + '.',
                codigo: 'SUPLANTACION_MIME'
            };
        }

        if (extension === 'webp' && firma.mime !== 'image/webp') {
            return {
                valido: false,
                error: 'Suplantación de formato detectada: el archivo tiene extensión .webp pero su firma es ' + firma.mime + '.',
                codigo: 'SUPLANTACION_MIME'
            };
        }

        if (firma.mime === 'application/pdf') {
            const bytesCompletos = await extraerBytesDeArchivo(archivo, 0, tamano);
            const resPdf = auditarEstructuraPdf(bytesCompletos);
            if (!resPdf.valido) {
                return { valido: false, error: resPdf.error, codigo: 'PDF_ESTRUCTURA_INVALIDA' };
            }
        } else if (firma.mime.startsWith('image/')) {
            const bytesAnalisis = await extraerBytesDeArchivo(archivo, 0, Math.min(tamano, 65536));
            const resImg = auditarDimensionesImagen(bytesAnalisis, firma.mime);
            if (!resImg.valido) {
                return { valido: false, error: resImg.error, codigo: 'IMAGEN_PELIGROSA' };
            }
        }

        return {
            valido: true,
            nombreSanitizado,
            extension,
            mimeDetectado: firma.mime,
            tamanoBytes: tamano
        };
    }

    function emitirBipError() {
        emitirBip(240, 100, "sawtooth");
        setTimeout(() => emitirBip(180, 140, "sawtooth"), 120);
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            try { navigator.vibrate([80, 60, 80]); } catch (_) {}
        }
    }

    
    // --- MOTOR DE BÚSQUEDA FONÉTICA DIFUSA FARMACÉUTICA (FUZZY SEARCH & LEVENSHTEIN) ---
    function normalizarTextoFoneticoFarmacia(texto) {
        if (!texto || typeof texto !== 'string') return '';
        let t = texto.toLowerCase().trim();
        // 1. Quitar tildes y diacríticos
        t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // 2. Fonética farmacológica hispana
        t = t.replace(/ph/g, 'f');
        t = t.replace(/v/g, 'b');
        t = t.replace(/z/g, 's');
        t = t.replace(/c(?=[ei])/g, 's');
        t = t.replace(/k/g, 'c');
        t = t.replace(/qu(?=[ei])/g, 'c');
        t = t.replace(/h/g, ''); // H muda en español
        t = t.replace(/y(?=[aeiou]|$)/g, 'i');
        // 3. Reducir consonantes duplicadas
        t = t.replace(/([a-z])\1+/g, '$1');
        // 4. Limpiar caracteres especiales
        t = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return t;
    }

    function distanciaLevenshtein(a, b) {
        if (a === b) return 0;
        if (!a || a.length === 0) return b ? b.length : 0;
        if (!b || b.length === 0) return a ? a.length : 0;

        let v0 = new Int32Array(b.length + 1);
        let v1 = new Int32Array(b.length + 1);

        for (let i = 0; i <= b.length; i++) v0[i] = i;

        for (let i = 0; i < a.length; i++) {
            v1[0] = i + 1;
            for (let j = 0; j < b.length; j++) {
                const cost = a[i] === b[j] ? 0 : 1;
                v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
            }
            for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
        }
        return v1[b.length];
    }

    function buscarEnCatalogoFuzzy(termino, catalogo, limiteResultados = 8) {
        if (!termino || typeof termino !== 'string') return [];
        const qRaw = termino.trim();
        if (qRaw.length < 2) return [];

        const qFonetico = normalizarTextoFoneticoFarmacia(qRaw);
        const lista = Object.values(catalogo || {});
        const resultados = [];

        for (const prod of lista) {
            if (!prod) continue;
            let score = 0;
            let coincidenciaEn = '';

            // 1. Coincidencia exacta o parcial de código de barras
            if (prod.codigoBarras && prod.codigoBarras.includes(qRaw)) {
                score = prod.codigoBarras === qRaw ? 100 : 90;
                coincidenciaEn = 'codigoBarras';
            } else {
                // 2. Coincidencia fonética en nombres, principio activo o laboratorio
                const fNombre = normalizarTextoFoneticoFarmacia(prod.nombre || '');
                const fComercial = normalizarTextoFoneticoFarmacia(prod.nombreComercial || '');
                const fPrincipio = normalizarTextoFoneticoFarmacia(prod.principioActivo || '');
                const fLab = normalizarTextoFoneticoFarmacia(prod.laboratorio || '');

                if (fNombre === qFonetico || fComercial === qFonetico) {
                    score = 95;
                    coincidenciaEn = 'nombreExacto';
                } else if (fNombre.includes(qFonetico) || fComercial.includes(qFonetico)) {
                    score = 80;
                    coincidenciaEn = 'nombreSubcadena';
                } else if (fPrincipio.includes(qFonetico)) {
                    score = 75;
                    coincidenciaEn = 'principioActivo';
                } else if (fLab.includes(qFonetico)) {
                    score = 70;
                    coincidenciaEn = 'laboratorio';
                } else {
                    // 3. Levenshtein difuso por palabras clave
                    const palabrasQuery = qFonetico.split(' ');
                    const palabrasProd = (fNombre + ' ' + fPrincipio).split(' ');
                    let menorDistancia = 999;

                    for (const qw of palabrasQuery) {
                        if (qw.length < 4) continue;
                        for (const pw of palabrasProd) {
                            if (pw.length < 4) continue;
                            const dist = distanciaLevenshtein(qw, pw);
                            if (dist < menorDistancia) menorDistancia = dist;
                        }
                    }

                    if (menorDistancia <= 1) {
                        score = 65;
                        coincidenciaEn = 'fuzzyCercano';
                    } else if (menorDistancia === 2 && qFonetico.length >= 6) {
                        score = 50;
                        coincidenciaEn = 'fuzzyMedio';
                    }
                }
            }

            if (score > 0) {
                resultados.push({ producto: prod, score, coincidenciaEn });
            }
        }

        resultados.sort((a, b) => b.score - a.score);
        return resultados.slice(0, limiteResultados).map(r => r.producto);
    }

    // --- RADAR DE VARIACIÓN DE COSTOS Y ANÁLISIS DE PRECIOS ---
    function calcularVariacionCostoPorcentaje(precioNuevo, precioAnterior) {
        const nuevo = Number(precioNuevo) || 0;
        const anterior = Number(precioAnterior) || 0;
        if (anterior <= 0 || nuevo <= 0) return 0;
        const variacion = ((nuevo - anterior) / anterior) * 100;
        return Math.round(variacion * 100) / 100; // 2 decimales exactos
    }

    // --- EXPORTADOR RELACIONAL DE CATÁLOGO MAESTRO PARA ERP (26 COLUMNAS) ---
    function generarCsvCatalogoMaestro(diccionario) {
        const columnas = [
            'codigo_barras',
            'nombre',
            'nombre_comercial',
            'principio_activo',
            'concentracion',
            'forma_farmaceutica',
            'presentacion',
            'laboratorio',
            'proveedor_habitual',
            'rnc_proveedor',
            'tipo',
            'unidades_por_caja',
            'costo_caja_actual',
            'costo_caja_anterior',
            'variacion_costo_porc',
            'costo_unitario_fiscal',
            'precio_p1_detalle',
            'precio_p2_farmacia',
            'precio_p3_mayorista',
            'aplica_itbis',
            'tasa_itbis',
            'es_leche',
            'condicion_venta',
            'registro_sanitario',
            'ubicacion',
            'actualizado_en'
        ];

        const escapeCsv = (val) => {
            if (val === null || val === undefined) return '""';
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        };

        const filas = [columnas.join(',')];
        const items = Object.values(diccionario || {});

        items.forEach(p => {
            if (!p) return;
            const pVenta = p.preciosVenta || {};
            const fila = [
                escapeCsv(p.codigoBarras),
                escapeCsv(p.nombre),
                escapeCsv(p.nombreComercial || p.nombre),
                escapeCsv(p.principioActivo || ''),
                escapeCsv(p.concentracion || ''),
                escapeCsv(p.formaFarmaceutica || ''),
                escapeCsv(p.presentacion || ''),
                escapeCsv(p.laboratorio || ''),
                escapeCsv(p.proveedorHabitual || ''),
                escapeCsv(p.rncProveedor || ''),
                escapeCsv(p.tipo || 'divisible'),
                escapeCsv(p.unidadesPorCaja || 1),
                escapeCsv((Number(p.ultimoPrecioCaja) || 0).toFixed(2)),
                escapeCsv((Number(p.costoAnteriorCaja) || 0).toFixed(2)),
                escapeCsv((Number(p.variacionCosto) || 0).toFixed(2) + '%'),
                escapeCsv(p.costoUnitarioFiscal || (p.ultimoPrecioCaja / (p.unidadesPorCaja || 1)).toFixed(8)),
                escapeCsv(pVenta.p1Exacto || ''),
                escapeCsv(pVenta.p2Exacto || ''),
                escapeCsv(pVenta.p3Exacto || ''),
                escapeCsv(p.aplicaItbis ? 'SÍ' : 'NO'),
                escapeCsv(p.tasaItbis || 0),
                escapeCsv(p.esLeche ? 'SÍ' : 'NO'),
                escapeCsv(p.condicionVenta || 'OTC'),
                escapeCsv(p.registroSanitario || ''),
                escapeCsv(p.ubicacion || ''),
                escapeCsv(p.actualizadoEn || new Date().toISOString())
            ];
            filas.push(fila.join(','));
        });

        return filas.join('\r\n');
    }

    AppFarmacia.Dominio = Object.freeze({
        normalizarTextoFoneticoFarmacia,
        distanciaLevenshtein,
        buscarEnCatalogoFuzzy,
        calcularVariacionCostoPorcentaje,
        generarCsvCatalogoMaestro,

        validarRnc,
        emitirBipExito,
        emitirBipError,
        parsearQrFacturaDgii,
        escaparHtml,
        sanitizarJsonSeguro,
        copiarAlPortapapeles,
        clonarObjetoSeguro,
        generarIdUnico,
        obtenerFechaLocalISO,
        sumarDiasAFechaISO,
        redondearDecimalExacto,
        formatearMonedaDosDecimales,
        formatearCostoFiscalOchoDecimales,
        validarPrecioCompra,
        validarCantidadEnteraPositiva,
        normalizarCodigoBarras,
        validarCodigoBarrasEstandar,
        sanitizarReglasNegocio,
        calcularDesglosePrecios,
        crearLineaProductoInmutable,
        calcularResumenCuadreFactura,
        sanitizarNombreArchivo,
        detectarFirmaMagica,
        auditarEstructuraPdf,
        auditarDimensionesImagen,
        extraerBytesDeArchivo,
        validarArchivoSeguro,
        sanitizarEntradaTexto,
        sha256Pure,
        hmacSha256Pure,
        serializarJsonCanonico,
        firmarSobreDatos,
        verificarSobreDatos
    });
})(window);
