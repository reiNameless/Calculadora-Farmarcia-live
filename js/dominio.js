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
        const factor = Math.pow(10, cantidadDecimales);
        return Math.round((valorNumerico + Number.EPSILON) * factor) / factor;
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
        if (!Number.isFinite(numero) || numero <= 0) {
            return { esValido: false, error: 'El precio de compra debe ser un número mayor que 0.' };
        }
        return { esValido: true, valor: numero };
    }

    function validarCantidadEnteraPositiva(entradaCruda, descripcionCampo) {
        const textoLimpio = String(entradaCruda ?? '').trim();
        if (textoLimpio === '') {
            return { esValido: false, error: `Escribe ${descripcionCampo}.` };
        }
        const numero = Number(textoLimpio);
        if (!Number.isFinite(numero) || !Number.isInteger(numero) || textoLimpio.includes('.') || textoLimpio.includes(',')) {
            return { esValido: false, error: `Revisa ${descripcionCampo}: debe ser un número entero sin decimales.` };
        }
        if (numero < 1) {
            return { esValido: false, error: `Revisa ${descripcionCampo}: debe ser de 1 en adelante.` };
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
        const sumaAcumulada = redondearDecimalExacto(
            productos.reduce((acumulado, prod) => acumulado + (Number(prod.subtotalFactura) || 0), 0),
            CONSTANTES.DECIMALES_MONEDA
        );
        const totalItbisAcumulado = redondearDecimalExacto(
            productos.reduce((acumulado, prod) => {
                if (prod.montoItbisLinea !== undefined) return acumulado + Number(prod.montoItbisLinea);
                if (prod.aplicaItbis && prod.precioCajaBase && prod.cajasCompradas) {
                    return acumulado + (prod.precioCajaBase * 0.18 * prod.cajasCompradas);
                }
                return acumulado;
            }, 0),
            CONSTANTES.DECIMALES_MONEDA
        );
        const subtotalBaseAcumulado = redondearDecimalExacto(
            sumaAcumulada - totalItbisAcumulado,
            CONSTANTES.DECIMALES_MONEDA
        );
        const totalFisico = Number(totalFisicoEsperado) || 0;
        const diferencia = redondearDecimalExacto(sumaAcumulada - totalFisico, CONSTANTES.DECIMALES_MONEDA);
        const cuadreExacto = totalFisico > 0 && Math.abs(diferencia) <= CONSTANTES.TOLERANCIA_CUADRE_FACTURA;

        return Object.freeze({
            sumaAcumulada,
            totalItbisAcumulado,
            subtotalBaseAcumulado,
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

    AppFarmacia.Dominio = Object.freeze({
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
        calcularResumenCuadreFactura
    });
})(window);
