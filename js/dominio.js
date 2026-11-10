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
    function validarPrecioCompra(entradaCruda, opciones = {}) {
        const textoLimpio = String(entradaCruda ?? '').trim().replace(',', '.');
        if (textoLimpio === '') {
            return { esValido: false, error: 'Escribe el precio de compra de 1 caja o frasco.' };
        }
        const numero = Number(textoLimpio);
        const maxPrecio = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS)
            ? AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS.MAX_PRECIO_COMPRA
            : 50000000;
        const permitirCero = Boolean(opciones && (opciones.permitirCero || opciones.esBonificacion));
        if (!Number.isFinite(numero) || (permitirCero ? numero < 0 : numero <= 0)) {
            return { esValido: false, error: permitirCero ? 'El precio de compra debe ser un número mayor o igual a 0.' : 'El precio de compra debe ser un número mayor que 0.' };
        }
        if (numero > maxPrecio) {
            return { esValido: false, error: 'El precio de compra no puede superar RD$ ' + maxPrecio.toLocaleString() + '.' };
        }
        return { esValido: true, valor: numero };
    }

    /**
     * Parsea expresiones de cajas con soporte para micro-sintaxis de bonificación de droguerías (ej. "10", "10+2", "5+1").
     * @param {string|number} entrada
     * @returns {{ esValido: boolean, cajasCompradas: number, cajasBonificadas: number, totalCajasFisicas: number, esOferta: boolean, textoNormalizado: string, error?: string, vacio?: boolean }}
     */
    function parsearExpresionCajas(entrada) {
        if (entrada === null || entrada === undefined) {
            return { esValido: false, vacio: true, error: 'La cantidad de cajas no puede estar vacía.', cajasCompradas: 1, cajasBonificadas: 0, totalCajasFisicas: 1, esOferta: false, textoNormalizado: '' };
        }
        const texto = String(entrada).trim();
        if (texto === '') {
            return { esValido: false, vacio: true, error: 'La cantidad de cajas no puede estar vacía.', cajasCompradas: 1, cajasBonificadas: 0, totalCajasFisicas: 1, esOferta: false, textoNormalizado: '' };
        }

        const maxCajas = (AppFarmacia && AppFarmacia.Configuracion && AppFarmacia.Configuracion.CONSTANTES && AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS)
            ? AppFarmacia.Configuracion.CONSTANTES.LIMITES_CAMPOS.MAX_CAJAS
            : 100000;

        // Si contiene más de un signo +, es sintaxis inválida
        const partesMas = texto.split('+');
        if (partesMas.length > 2) {
            return {
                esValido: false,
                error: 'Formato de oferta inválido. Usa la estructura Compradas+Bonificadas (ej. 10+2).',
                cajasCompradas: 1,
                cajasBonificadas: 0,
                totalCajasFisicas: 1,
                esOferta: false,
                textoNormalizado: texto
            };
        }

        // Caso estándar: número entero sin bonificación (ej: "10")
        if (partesMas.length === 1) {
            const num = Number(texto);
            if (!Number.isFinite(num) || !Number.isInteger(num) || texto.includes('.') || texto.includes(',') || num <= 0) {
                return {
                    esValido: false,
                    error: 'La cantidad de cajas debe ser un número entero mayor que cero.',
                    cajasCompradas: 1,
                    cajasBonificadas: 0,
                    totalCajasFisicas: 1,
                    esOferta: false,
                    textoNormalizado: texto
                };
            }
            if (num > maxCajas) {
                return {
                    esValido: false,
                    error: 'La cantidad de cajas no puede superar ' + maxCajas.toLocaleString() + '.',
                    cajasCompradas: 1,
                    cajasBonificadas: 0,
                    totalCajasFisicas: 1,
                    esOferta: false,
                    textoNormalizado: texto
                };
            }
            return {
                esValido: true,
                cajasCompradas: num,
                cajasBonificadas: 0,
                totalCajasFisicas: num,
                esOferta: false,
                textoNormalizado: String(num)
            };
        }

        // Caso oferta: expresión con + (ej: "10+2" o "10 + 2")
        const strCompradas = partesMas[0].trim();
        const strBonificadas = partesMas[1].trim();

        if (strCompradas === '') {
            return {
                esValido: false,
                error: 'Indica cuántas cajas fueron compradas antes del signo + (ej. 10+2).',
                cajasCompradas: 1,
                cajasBonificadas: 0,
                totalCajasFisicas: 1,
                esOferta: false,
                textoNormalizado: texto
            };
        }

        const numCompradas = Number(strCompradas);
        if (!Number.isFinite(numCompradas) || !Number.isInteger(numCompradas) || strCompradas.includes('.') || strCompradas.includes(',') || numCompradas <= 0) {
            return {
                esValido: false,
                error: 'Las cajas compradas deben ser un número entero mayor que cero.',
                cajasCompradas: 1,
                cajasBonificadas: 0,
                totalCajasFisicas: 1,
                esOferta: false,
                textoNormalizado: texto
            };
        }

        const numBonificadas = strBonificadas === '' ? 0 : Number(strBonificadas);
        if (!Number.isFinite(numBonificadas) || !Number.isInteger(numBonificadas) || strBonificadas.includes('.') || strBonificadas.includes(',') || numBonificadas < 0) {
            return {
                esValido: false,
                error: 'Las cajas bonificadas deben ser un número entero mayor o igual a cero.',
                cajasCompradas: numCompradas,
                cajasBonificadas: 0,
                totalCajasFisicas: numCompradas,
                esOferta: false,
                textoNormalizado: texto
            };
        }

        const totalFisicas = numCompradas + numBonificadas;
        if (totalFisicas > maxCajas) {
            return {
                esValido: false,
                error: 'El total de cajas físicas no puede superar ' + maxCajas.toLocaleString() + '.',
                cajasCompradas: numCompradas,
                cajasBonificadas: numBonificadas,
                totalCajasFisicas: totalFisicas,
                esOferta: numBonificadas > 0,
                textoNormalizado: texto
            };
        }

        return {
            esValido: true,
            cajasCompradas: numCompradas,
            cajasBonificadas: numBonificadas,
            totalCajasFisicas: totalFisicas,
            esOferta: numBonificadas > 0,
            textoNormalizado: numBonificadas > 0 ? (numCompradas + '+' + numBonificadas) : String(numCompradas)
        };
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

        const porcentajeAlertaInflacion = leerPorcentaje(
            reglasCandidatas.porcentajeAlertaInflacion,
            REGLAS_NEGOCIO_POR_DEFECTO.porcentajeAlertaInflacion !== undefined ? REGLAS_NEGOCIO_POR_DEFECTO.porcentajeAlertaInflacion : 5
        );

        return Object.freeze({
            estrategia,
            porcentajeItbis: leerPorcentaje(reglasCandidatas.porcentajeItbis, REGLAS_NEGOCIO_POR_DEFECTO.porcentajeItbis),
            porcentajeAlertaInflacion: Math.max(0.1, Math.min(100, porcentajeAlertaInflacion)),
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
        const cajasBonificadas = Math.max(0, Number(opciones.cajasBonificadas) || 0);
        const totalCajasFisicas = cajas + cajasBonificadas;
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

        // 2. Factura de Compra (Cuadre con Droguería / Proveedor y DGII 606 - Estrictamente sobre cajas cobradas)
        const totalBaseCompra = precioCajaBase * cajas;
        const totalNetoCompra = Math.max(0, totalBaseCompra - descuentoTotalLinea);
        const tasaEfectiva = aplicaItbis ? Number(reglasSeguras.porcentajeItbis) : 0;
        const montoItbisTotal = aplicaItbis
            ? redondearDecimalExacto(totalNetoCompra * (tasaEfectiva / 100), CONSTANTES.DECIMALES_MONEDA)
            : 0;
        const subtotalFactura = redondearDecimalExacto(totalNetoCompra + montoItbisTotal, CONSTANTES.DECIMALES_MONEDA);
        const montoItbisPorCaja = cajas > 0 ? redondearDecimalExacto(montoItbisTotal / cajas, CONSTANTES.DECIMALES_MONEDA) : 0;
        const costoCajaEfectivo = cajas > 0 ? redondearDecimalExacto(totalNetoCompra / cajas, CONSTANTES.DECIMALES_MONEDA) : 0;

        // 3. Costo Unitario Fiscal REAL (Sin ITBIS): Inversión neta en mercancía entre el total de unidades FÍSICAS recibidas
        const totalUnidadesFacturadas = cajas * unidades;
        const totalUnidadesFisicas = totalCajasFisicas * unidades;
        const costoUnitarioReal = totalUnidadesFisicas > 0 ? (totalNetoCompra / totalUnidadesFisicas) : 0;
        const precioCajaNeto = cajas > 0 ? (totalNetoCompra / cajas) : 0;

        // 4. Precios de Venta (P1, P2, P3): calculados sobre el costo base de compra (sin descuento y sin dilución de oferta)
        // La farmacia retiene la bonificación como utilidad comercial legítima (a menos que configure 'trasladar')
        const esBonificacionCruzada = precioCajaBase <= 0;
        const costoBaseReferencia = (esBonificacionCruzada && Number(opciones.costoReferencia) > 0)
            ? Number(opciones.costoReferencia)
            : precioCajaBase;
        const costoUnitarioBaseVenta = (totalUnidadesFacturadas > 0 || (esBonificacionCruzada && unidades > 0))
            ? (costoBaseReferencia / unidades)
            : 0;
        const costoParaPvp = (reglasSeguras.politicaOferta === 'trasladar' && !esBonificacionCruzada) ? costoUnitarioReal : costoUnitarioBaseVenta;

        // Margen P1: Leche usa 10% (costo * 1.10), otros productos usan porcentajePrecio1 activo (ej: +30%)
        const f1 = esLeche ? 0.10 : (reglasSeguras.porcentajePrecio1 / 100);
        const f2 = reglasSeguras.porcentajePrecio2 / 100;
        const f3 = reglasSeguras.porcentajePrecio3 / 100;

        const calculador = ESTRATEGIAS_DISPATCH[reglasSeguras.estrategia] || ESTRATEGIAS_DISPATCH[ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO];
        const { p1Bruto: p1Neto, p2Bruto: p2Neto, p3Bruto: p3Neto } = calculador(costoParaPvp, f1, f2, f3);

        // 5. ITBIS aplicado al producto en sí (no al costo de compra)
        const factorItbis = (aplicaItbis && tasaEfectiva > 0) ? (1 + (tasaEfectiva / 100)) : 1;
        const p1ConItbis = p1Neto * factorItbis;
        const p2ConItbis = p2Neto * factorItbis;
        const p3ConItbis = p3Neto * factorItbis;

        const itbisP1Monto = aplicaItbis ? redondearDecimalExacto(p1ConItbis - p1Neto, CONSTANTES.DECIMALES_MONEDA) : 0;
        const itbisP2Monto = aplicaItbis ? redondearDecimalExacto(p2ConItbis - p2Neto, CONSTANTES.DECIMALES_MONEDA) : 0;
        const itbisP3Monto = aplicaItbis ? redondearDecimalExacto(p3ConItbis - p3Neto, CONSTANTES.DECIMALES_MONEDA) : 0;

        // El usuario elige: por defecto precios SIN ITBIS (Netos); si activa mostrarPreciosConItbis, muestra precios con ITBIS
        const mostrarConItbis = opciones.mostrarPreciosConItbis !== undefined
            ? Boolean(opciones.mostrarPreciosConItbis)
            : Boolean(reglasSeguras.mostrarPreciosConItbis);

        const p1Bruto = mostrarConItbis ? p1ConItbis : p1Neto;
        const p2Bruto = mostrarConItbis ? p2ConItbis : p2Neto;
        const p3Bruto = mostrarConItbis ? p3ConItbis : p3Neto;

        const ahorroDilucionMonto = redondearDecimalExacto(Math.max(0, costoUnitarioBaseVenta - costoUnitarioReal), 8);

        return Object.freeze({
            precioCajaBase,
            precioCajaNeto: redondearDecimalExacto(precioCajaNeto, CONSTANTES.DECIMALES_MONEDA),
            cajasCompradas: cajas,
            cajasBonificadas,
            totalCajasFisicas,
            totalUnidadesFacturadas,
            totalUnidadesFisicas,
            esOfertaBonificacion: cajasBonificadas > 0 || esBonificacionCruzada,
            esBonificacionCruzada,
            costoReferencia: Number(opciones.costoReferencia) || 0,
            ahorroDilucionMonto,
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
            costoUnitarioVentaReal: costoUnitarioBaseVenta,
            costoUnitarioVenta: formatearCostoFiscalOchoDecimales(costoUnitarioBaseVenta),
            mostrarPreciosConItbis: mostrarConItbis,
            // Precios Netos sin ITBIS
            p1NetoBruto: redondearDecimalExacto(p1Neto, CONSTANTES.DECIMALES_AUDITORIA),
            p2NetoBruto: redondearDecimalExacto(p2Neto, CONSTANTES.DECIMALES_AUDITORIA),
            p3NetoBruto: redondearDecimalExacto(p3Neto, CONSTANTES.DECIMALES_AUDITORIA),
            p1NetoExacto: formatearMonedaDosDecimales(p1Neto),
            p2NetoExacto: formatearMonedaDosDecimales(p2Neto),
            p3NetoExacto: formatearMonedaDosDecimales(p3Neto),
            // Precios Con ITBIS
            p1ConItbisBruto: redondearDecimalExacto(p1ConItbis, CONSTANTES.DECIMALES_AUDITORIA),
            p2ConItbisBruto: redondearDecimalExacto(p2ConItbis, CONSTANTES.DECIMALES_AUDITORIA),
            p3ConItbisBruto: redondearDecimalExacto(p3ConItbis, CONSTANTES.DECIMALES_AUDITORIA),
            p1ConItbisExacto: formatearMonedaDosDecimales(p1ConItbis),
            p2ConItbisExacto: formatearMonedaDosDecimales(p2ConItbis),
            p3ConItbisExacto: formatearMonedaDosDecimales(p3ConItbis),
            itbisP1Monto,
            itbisP2Monto,
            itbisP3Monto,
            // Precios Activos según preferencia
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

        // Soporte para micro-sintaxis en datosEntrada.cajasCompradas (ej: "10+2")
        let cajasCompradas = 1;
        let cajasBonificadas = Math.max(0, Number(datosEntrada.cajasBonificadas) || 0);
        if (typeof datosEntrada.cajasCompradas === 'string' && datosEntrada.cajasCompradas.includes('+')) {
            const p = parsearExpresionCajas(datosEntrada.cajasCompradas);
            if (p.esValido) {
                cajasCompradas = p.cajasCompradas;
                cajasBonificadas = p.cajasBonificadas;
            } else {
                cajasCompradas = Math.max(1, Number(datosEntrada.cajasCompradas) || 1);
            }
        } else {
            cajasCompradas = Math.max(1, Number(datosEntrada.cajasCompradas) || 1);
        }

        const precioCajaBase = Number(datosEntrada.precioCajaBase);
        const aplicaItbis = Boolean(datosEntrada.aplicaItbis);
        const tasaItbisEntrada = (datosEntrada.tasaItbis !== undefined && datosEntrada.tasaItbis !== null)
            ? Number(datosEntrada.tasaItbis)
            : (aplicaItbis ? (Number(reglas.porcentajeItbis) || 18) : 0);
        const tasaItbisEfectiva = aplicaItbis ? (tasaItbisEntrada > 0 ? tasaItbisEntrada : 18) : 0;
        const aplicaItbisEfectivo = aplicaItbis && tasaItbisEfectiva > 0;

        const reglasEfectivas = {
            ...reglas,
            porcentajeItbis: aplicaItbisEfectivo ? tasaItbisEfectiva : (Number(reglas.porcentajeItbis) || 18)
        };

        const esLeche = Boolean(datosEntrada.esLeche);
        const descuentoValor = Number(datosEntrada.descuentoValor) || 0;
        const tipoDescuento = datosEntrada.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto';
        const manual = { ...(datosEntrada.manual || {}) };

        const calculos = calcularDesglosePrecios(precioCajaBase, unidadesPorCaja, aplicaItbisEfectivo, reglasEfectivas, {
            cajasCompradas,
            cajasBonificadas,
            esLeche,
            descuentoValor,
            tipoDescuento,
            costoReferencia: datosEntrada.costoReferencia
        });
        const montoItbisLinea = calculos.montoItbisTotal;
        const costoAnteriorCaja = (datosEntrada.costoAnteriorCaja !== undefined && Number(datosEntrada.costoAnteriorCaja) > 0)
            ? Number(datosEntrada.costoAnteriorCaja)
            : undefined;
        const variacionCosto = (datosEntrada.variacionCosto !== undefined && Number.isFinite(Number(datosEntrada.variacionCosto)))
            ? Number(datosEntrada.variacionCosto)
            : undefined;

        const lote = String(datosEntrada.lote || '').trim();
        const fefo = evaluarSemaforoFefo(datosEntrada.fechaVencimiento);

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
            cajasCompradas: calculos.cajasCompradas,
            cajasBonificadas: calculos.cajasBonificadas,
            totalCajasFisicas: calculos.totalCajasFisicas,
            esOfertaBonificacion: calculos.esOfertaBonificacion,
            esBonificacionCruzada: Boolean(calculos.esBonificacionCruzada || precioCajaBase === 0),
            costoReferencia: Number(datosEntrada.costoReferencia) || 0,
            ahorroDilucionMonto: calculos.ahorroDilucionMonto,
            aplicaItbis: aplicaItbisEfectivo,
            tasaItbis: tasaItbisEfectiva,
            montoItbisPorCaja: calculos.montoItbisPorCaja,
            montoItbisLinea,
            costoCajaEfectivo: calculos.costoCajaEfectivo,
            porcentajeItbis: calculos.porcentajeItbis,
            manual: Object.freeze(manual),
            costoUnitario: calculos.costoUnitario,
            costoUnitarioVenta: calculos.costoUnitarioVenta,
            costoAnteriorCaja,
            variacionCosto,
            lote,
            fechaVencimiento: fefo.fechaNormalizada || (datosEntrada.fechaVencimiento ? String(datosEntrada.fechaVencimiento).trim() : ''),
            estadoFefo: fefo.estado,
            diasParaVencer: fefo.diasRestantes,
            p1Exacto: manual.p1 ? datosEntrada.p1Exacto : calculos.p1Exacto,
            p2Exacto: manual.p2 ? datosEntrada.p2Exacto : calculos.p2Exacto,
            p3Exacto: manual.p3 ? datosEntrada.p3Exacto : calculos.p3Exacto,
            p1Redondeado: manual.p1 ? datosEntrada.p1Redondeado : calculos.p1Redondeado,
            p2Redondeado: manual.p2 ? datosEntrada.p2Redondeado : calculos.p2Redondeado,
            p3Redondeado: manual.p3 ? datosEntrada.p3Redondeado : calculos.p3Redondeado,
            p1NetoExacto: calculos.p1NetoExacto,
            p1ConItbisExacto: calculos.p1ConItbisExacto,
            itbisP1Monto: calculos.itbisP1Monto,
            mostrarPreciosConItbis: calculos.mostrarPreciosConItbis,
            totalUnidadesInventario: calculos.totalUnidadesFisicas,
            subtotalFactura: calculos.subtotalFactura
        });
    }

    function calcularResumenCuadreFactura(listaProductos, totalFisicoEsperado, opciones = {}) {
        const productos = listaProductos || [];
        let totalBrutoAcumulado = 0;
        let totalDescuentoAcumulado = 0;
        let totalExentoAcumulado = 0;
        let totalGravadoAcumulado = 0;
        let totalItbisAcumulado = 0;
        let sumaAcumuladaLineas = 0;

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

            sumaAcumuladaLineas = redondearDecimalExacto(sumaAcumuladaLineas + subtotalLinea, CONSTANTES.DECIMALES_MONEDA);
        });

        // Descuento Global a pie de factura (opcional)
        const descGlobalValor = Math.max(0, Number(opciones.descuentoGlobalValor) || 0);
        const descGlobalTipo = opciones.descuentoGlobalTipo === 'porcentaje' ? 'porcentaje' : 'monto';
        let montoDescuentoGlobal = 0;
        if (descGlobalValor > 0 && sumaAcumuladaLineas > 0) {
            if (descGlobalTipo === 'porcentaje') {
                montoDescuentoGlobal = redondearDecimalExacto(sumaAcumuladaLineas * (descGlobalValor / 100), CONSTANTES.DECIMALES_MONEDA);
            } else {
                montoDescuentoGlobal = redondearDecimalExacto(Math.min(descGlobalValor, sumaAcumuladaLineas), CONSTANTES.DECIMALES_MONEDA);
            }
        }

        const sumaAcumulada = redondearDecimalExacto(Math.max(0, sumaAcumuladaLineas - montoDescuentoGlobal), CONSTANTES.DECIMALES_MONEDA);
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
            sumaAcumuladaLineas,
            descuentoGlobalValor: descGlobalValor,
            descuentoGlobalTipo: descGlobalTipo,
            montoDescuentoGlobal,
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

    function emitirBipAlerta() {
        emitirBip(587, 60, "triangle");
        setTimeout(() => emitirBip(784, 80, "triangle"), 70);
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

    function analizarVariacionCosto(precioNuevo, precioAnterior, umbralAlerta = 5) {
        const nuevo = Number(precioNuevo) || 0;
        const anterior = Number(precioAnterior) || 0;
        const umbral = (umbralAlerta !== undefined && Number.isFinite(Number(umbralAlerta)) && Number(umbralAlerta) > 0)
            ? Number(umbralAlerta)
            : 5;
        if (anterior <= 0 || nuevo <= 0) {
            return {
                tieneHistorial: false,
                precioAnterior: 0,
                precioNuevo: nuevo,
                porcentaje: 0,
                diferenciaMonto: 0,
                direccion: 'SIN_HISTORIAL',
                esAlza: false,
                esBaja: false,
                esAlertaCritica: false,
                umbralUtilizado: umbral,
                mensaje: 'Primer registro de costo'
            };
        }
        const diferenciaMonto = redondearDecimalExacto(nuevo - anterior, CONSTANTES.DECIMALES_MONEDA);
        const porcentaje = redondearDecimalExacto(((nuevo - anterior) / anterior) * 100, 2);
        const esAlza = porcentaje > 0;
        const esBaja = porcentaje < 0;
        const esAlertaCritica = porcentaje >= umbral;

        let direccion = 'IGUAL';
        let mensaje = 'Sin variación de costo';
        if (esAlza) {
            direccion = 'ALZA';
            mensaje = `Alza de +${porcentaje}% (+$${diferenciaMonto.toFixed(2)})`;
        } else if (esBaja) {
            direccion = 'BAJA';
            mensaje = `Baja de ${porcentaje}% (-$${Math.abs(diferenciaMonto).toFixed(2)})`;
        }

        return {
            tieneHistorial: true,
            precioAnterior,
            precioNuevo: nuevo,
            porcentaje,
            diferenciaMonto,
            direccion,
            esAlza,
            esBaja,
            esAlertaCritica,
            umbralUtilizado: umbral,
            mensaje
        };
    }

    // --- SEMÁFORO FEFO (FIRST-EXPIRED, FIRST-OUT) Y TRAZABILIDAD SANITARIA MISPAS ---
    const ESTADOS_FEFO = Object.freeze({
        VENCIDO: 'VENCIDO',
        CRITICO_90D: 'CRITICO_90D',
        ALERTA_180D: 'ALERTA_180D',
        OPTIMO: 'OPTIMO',
        SIN_FECHA: 'SIN_FECHA'
    });

    /**
     * Evalúa los días restantes para el vencimiento y determina el estado semafórico FEFO.
     * @param {string} fechaVencimiento - Fecha en formato AAAA-MM-DD o AAAA-MM
     * @param {string} [fechaReferencia] - Fecha actual de comparación (ISO AAAA-MM-DD)
     * @returns {Object} { estado, diasRestantes, esCritico, esAlerta, esVencido, texto, fechaNormalizada }
     */
    function evaluarSemaforoFefo(fechaVencimiento, fechaReferencia) {
        if (!fechaVencimiento || typeof fechaVencimiento !== 'string') {
            return {
                estado: ESTADOS_FEFO.SIN_FECHA,
                diasRestantes: null,
                esCritico: false,
                esAlerta: false,
                esVencido: false,
                texto: '',
                fechaNormalizada: ''
            };
        }

        const texto = fechaVencimiento.trim();
        let partes = texto.split('-');
        let anio, mes, dia;
        if (partes.length === 2) {
            anio = parseInt(partes[0], 10);
            mes = parseInt(partes[1], 10);
            dia = new Date(anio, mes, 0).getDate(); // Último día del mes de vencimiento
        } else if (partes.length === 3) {
            anio = parseInt(partes[0], 10);
            mes = parseInt(partes[1], 10);
            dia = parseInt(partes[2], 10);
        } else {
            return {
                estado: ESTADOS_FEFO.SIN_FECHA,
                diasRestantes: null,
                esCritico: false,
                esAlerta: false,
                esVencido: false,
                texto: '',
                fechaNormalizada: ''
            };
        }

        if (isNaN(anio) || isNaN(mes) || isNaN(dia) || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
            return {
                estado: ESTADOS_FEFO.SIN_FECHA,
                diasRestantes: null,
                esCritico: false,
                esAlerta: false,
                esVencido: false,
                texto: '',
                fechaNormalizada: ''
            };
        }

        const fechaObj = new Date(anio, mes - 1, dia, 23, 59, 59);
        const refObj = fechaReferencia ? new Date(fechaReferencia) : new Date();
        refObj.setHours(0, 0, 0, 0);

        const diffMs = fechaObj.getTime() - refObj.getTime();
        const diasRestantes = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const fechaNormalizada = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

        const umbralCritico = (CONSTANTES && CONSTANTES.UMBRAL_FEFO_DIAS_CRITICO) || 90;
        const umbralAlerta = (CONSTANTES && CONSTANTES.UMBRAL_FEFO_DIAS_ALERTA) || 180;

        if (diasRestantes < 0) {
            return {
                estado: ESTADOS_FEFO.VENCIDO,
                diasRestantes,
                esCritico: true,
                esAlerta: true,
                esVencido: true,
                texto: `⛔ VENCIDO (${Math.abs(diasRestantes)}d)`,
                fechaNormalizada
            };
        }

        if (diasRestantes <= umbralCritico) {
            return {
                estado: ESTADOS_FEFO.CRITICO_90D,
                diasRestantes,
                esCritico: true,
                esAlerta: true,
                esVencido: false,
                texto: `⚠️ Vence en ${diasRestantes}d (<90d MISPAS)`,
                fechaNormalizada
            };
        }

        if (diasRestantes <= umbralAlerta) {
            return {
                estado: ESTADOS_FEFO.ALERTA_180D,
                diasRestantes,
                esCritico: false,
                esAlerta: true,
                esVencido: false,
                texto: `🟡 Vence en ${Math.ceil(diasRestantes / 30)} meses`,
                fechaNormalizada
            };
        }

        return {
            estado: ESTADOS_FEFO.OPTIMO,
            diasRestantes,
            esCritico: false,
            esAlerta: false,
            esVencido: false,
            texto: `🟢 Vence en ${fechaNormalizada}`,
            fechaNormalizada
        };
    }

    /**
     * Parsea códigos 2D / GS1 DataMatrix para extraer GTIN, Lote y Vencimiento.
     * Soporta formatos con AIs entre paréntesis y flujos continuos GS1.
     * @param {string} textoCrudo
     * @returns {Object} { esGs1Compuesto, gtin, codigoBarras, lote, fechaVencimiento, fechaVencimientoIso }
     */
    function parsearCodigoGs1DataMatrix(textoCrudo) {
        if (!textoCrudo || typeof textoCrudo !== 'string') {
            return { esGs1Compuesto: false, gtin: '', codigoBarras: '', lote: '', fechaVencimiento: '', fechaVencimientoIso: '' };
        }
        const limpio = textoCrudo.trim();

        let gtin = '';
        let lote = '';
        let fechaVencimientoIso = '';

        if (limpio.includes('(01)') || limpio.includes('(17)') || limpio.includes('(10)')) {
            const m01 = limpio.match(/\(01\)(\d{14})/);
            const m17 = limpio.match(/\(17\)(\d{6})/);
            const m10 = limpio.match(/\(10\)([^\(\s]+)/);

            if (m01) gtin = m01[1];
            if (m10) lote = m10[1];
            if (m17) {
                const rawYymmdd = m17[1];
                const yy = parseInt(rawYymmdd.substring(0, 2), 10);
                const mm = parseInt(rawYymmdd.substring(2, 4), 10);
                const dd = parseInt(rawYymmdd.substring(4, 6), 10);
                const fullYear = 2000 + yy;
                const finalDay = dd === 0 ? new Date(fullYear, mm, 0).getDate() : dd;
                fechaVencimientoIso = `${fullYear}-${String(mm).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
            }
        } else if (limpio.startsWith('01') && limpio.length >= 16) {
            gtin = limpio.substring(2, 16);
            const resto = limpio.substring(16);

            const idx17 = resto.indexOf('17');
            if (idx17 !== -1 && resto.length >= idx17 + 8) {
                const rawYymmdd = resto.substring(idx17 + 2, idx17 + 8);
                if (/^\d{6}$/.test(rawYymmdd)) {
                    const yy = parseInt(rawYymmdd.substring(0, 2), 10);
                    const mm = parseInt(rawYymmdd.substring(2, 4), 10);
                    const dd = parseInt(rawYymmdd.substring(4, 6), 10);
                    const fullYear = 2000 + yy;
                    const finalDay = dd === 0 ? new Date(fullYear, mm, 0).getDate() : dd;
                    fechaVencimientoIso = `${fullYear}-${String(mm).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
                }
            }

            const idx10 = resto.indexOf('10');
            if (idx10 !== -1) {
                const subLote = resto.substring(idx10 + 2).split(/[\x1d\s]/)[0];
                if (subLote) lote = subLote.substring(0, 20);
            }
        }

        let codigoBarras = gtin;
        if (gtin.length === 14 && gtin.startsWith('0')) {
            codigoBarras = gtin.substring(1);
        }

        const esGs1Compuesto = Boolean(gtin && (lote || fechaVencimientoIso));

        return {
            esGs1: esGs1Compuesto,
            esGs1Compuesto,
            gtin,
            codigoBarras: codigoBarras || limpio,
            gtinNormalizado: codigoBarras || limpio,
            lote,
            fechaVencimiento: fechaVencimientoIso,
            fechaVencimientoIso,
            vencimiento: fechaVencimientoIso
        };
    }

    const CAMPOS_PUBLICOS_CATALOGO_DEFECTO = Object.freeze([
        'codigoBarras',
        'nombre',
        'nombreComercial',
        'principioActivo',
        'concentracion',
        'formaFarmaceutica',
        'presentacion',
        'laboratorio',
        'categoria',
        'tipo',
        'unidadesPorCaja',
        'aplicaItbis',
        'tasaItbis',
        'esLeche',
        'condicionVenta',
        'registroSanitario',
        'ubicacion',
        'actualizadoEn'
    ]);

    /**
     * Purga en caliente (Allowlist estricta): extrae exclusivamente campos sanitarios públicos
     * y erradica costos de compra, márgenes, proveedores, RNCs e historiales financieros.
     * @param {Object} producto
     * @returns {Object|null}
     */
    function sanitizarFichaPublicaCatalogo(producto) {
        if (!producto || typeof producto !== 'object') return null;
        const allowlist = (CONSTANTES && Array.isArray(CONSTANTES.CAMPOS_PUBLICOS_CATALOGO))
            ? CONSTANTES.CAMPOS_PUBLICOS_CATALOGO
            : CAMPOS_PUBLICOS_CATALOGO_DEFECTO;

        const limpia = {};
        for (const campo of allowlist) {
            if (!Object.prototype.hasOwnProperty.call(producto, campo)) continue;
            const val = producto[campo];
            if (campo === 'codigoBarras') {
                limpia.codigoBarras = normalizarCodigoBarras(val);
            } else if (campo === 'unidadesPorCaja') {
                limpia.unidadesPorCaja = Math.max(1, parseInt(val, 10) || 1);
            } else if (campo === 'aplicaItbis' || campo === 'esLeche') {
                limpia[campo] = Boolean(val);
            } else if (campo === 'tasaItbis') {
                limpia.tasaItbis = Number.isFinite(Number(val)) ? Number(val) : (producto.aplicaItbis ? 18 : 0);
            } else if (campo === 'tipo') {
                limpia.tipo = (val === CONSTANTES.CATEGORIAS.ENTERO)
                    ? CONSTANTES.CATEGORIAS.ENTERO
                    : CONSTANTES.CATEGORIAS.DIVISIBLE;
            } else if (typeof val === 'string') {
                limpia[campo] = sanitizarEntradaTexto(val, 255);
            } else if (val !== undefined && val !== null) {
                limpia[campo] = clonarObjetoSeguro(val);
            }
        }
        return limpia;
    }

    /**
     * Sanitiza un diccionario completo dejando únicamente fichas públicas sanitarias.
     * @param {Object} diccionario
     * @returns {Object}
     */
    function sanitizarDiccionarioPublico(diccionario) {
        const origen = (diccionario && typeof diccionario === 'object' && !Array.isArray(diccionario))
            ? diccionario
            : {};
        const resultado = {};
        for (const [cod, item] of Object.entries(origen)) {
            if (cod === '__proto__' || cod === 'constructor' || cod === 'prototype') continue;
            const limpia = sanitizarFichaPublicaCatalogo(item);
            const codNormalizado = normalizarCodigoBarras(cod || (limpia && limpia.codigoBarras));
            if (!codNormalizado || codNormalizado === '__proto__' || codNormalizado === 'constructor' || codNormalizado === 'prototype') continue;
            if (limpia) {
                limpia.codigoBarras = codNormalizado;
                resultado[codNormalizado] = limpia;
            }
        }
        return resultado;
    }

    // --- EXPORTADOR SANITARIO PÚBLICO DE CATÁLOGO MAESTRO (.CSV - PURGA EN CALIENTE DE COSTOS) ---
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
            'categoria',
            'tipo',
            'unidades_por_caja',
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
            let str = String(val);
            // Mitigación contra CSV Formula Injection (CWE-1236) en Excel/LibreOffice
            if (/^[=+\-@\t\r]/.test(str)) {
                str = "'" + str;
            }
            return `"${str.replace(/"/g, '""')}"`;
        };

        const filas = [columnas.join(',')];
        const items = Object.values(diccionario || {});

        items.forEach(itemCrudo => {
            const p = sanitizarFichaPublicaCatalogo(itemCrudo);
            if (!p) return;
            const fila = [
                escapeCsv(p.codigoBarras || ''),
                escapeCsv(p.nombre || ''),
                escapeCsv(p.nombreComercial || p.nombre || ''),
                escapeCsv(p.principioActivo || ''),
                escapeCsv(p.concentracion || ''),
                escapeCsv(p.formaFarmaceutica || ''),
                escapeCsv(p.presentacion || ''),
                escapeCsv(p.laboratorio || ''),
                escapeCsv(p.categoria || 'General / Otros'),
                escapeCsv(p.tipo || 'divisible'),
                escapeCsv(p.unidadesPorCaja || 1),
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

    // --- EXPORTADOR FISCAL OFICIAL DGII FORMATO 606 (COMPRAS EN 23 COLUMNAS) ---
    function generarTextoFormato606(facturas, rncReportante = '', periodo = '') {
        const lista = Array.isArray(facturas) ? facturas : [];
        const facturasFiltradas = lista.filter(f => {
            if (!f || !f.productos || !f.productos.length) return false;
            const ncf = String(f.numeroFactura || '').trim();
            // Facturas con NCF dominicano estándar (B01, B02, B14, B15, E31, E32, etc.)
            return /^[BE]\d{2}/i.test(ncf);
        });

        if (!facturasFiltradas.length) {
            return {
                exito: false,
                totalFacturas: 0,
                texto606: '',
                motivo: 'No hay facturas con comprobantes fiscales (NCF tipo B01, B02 o E31) registradas para exportar en Formato 606.'
            };
        }

        let periodoCalculado = String(periodo || '').replace(/\D/g, '');
        if (periodoCalculado.length !== 6) {
            const fechaPrimera = facturasFiltradas[0].fechaEmision || obtenerFechaLocalISO();
            periodoCalculado = fechaPrimera.replace(/\D/g, '').substring(0, 6);
        }

        const rncNormalizado = String(rncReportante || '').replace(/\D/g, '');

        const lineas = facturasFiltradas.map(f => {
            const rncProveedor = String(f.rnc || f.rncProveedor || '').replace(/\D/g, '');
            const tipoId = rncProveedor.length === 9 ? '1' : (rncProveedor.length === 11 ? '2' : '1');
            const tipoBienes = '09'; // 09: Compras y gastos que forman parte del costo de venta (Farmacias)
            const ncf = String(f.numeroFactura || '').trim().toUpperCase();
            const ncfModificado = '';

            const fechaEmiIso = f.fechaEmision || obtenerFechaLocalISO();
            const fechaComprobante = fechaEmiIso.replace(/\D/g, '').padEnd(8, '0').slice(0, 8);
            const fechaPago = fechaComprobante;

            const resumen = calcularResumenCuadreFactura(f.productos, f.totalFisico);
            const montoServicios = '0.00';
            const montoBienes = redondearDecimalExacto(resumen.subtotalBaseAcumulado || (resumen.totalGravadoAcumulado + resumen.totalExentoAcumulado), 2).toFixed(2);
            const totalFacturado = montoBienes;
            const itbisFacturado = redondearDecimalExacto(resumen.totalItbisAcumulado, 2).toFixed(2);
            const itbisRetenido = '0.00';
            const itbisProporcionalidad = '0.00';
            const itbisCosto = '0.00';
            const itbisAdelantar = itbisFacturado;
            const itbisPercibido = '0.00';
            const tipoRetencionIsr = '';
            const montoRetencionIsr = '0.00';
            const isrPercibido = '0.00';
            const isc = '0.00';
            const otrosImpuestos = '0.00';
            const propinaLegal = '0.00';
            const formaPago = '04'; // 04: Compra a Crédito comercial

            return [
                rncProveedor || '000000000',
                tipoId,
                tipoBienes,
                ncf,
                ncfModificado,
                fechaComprobante,
                fechaPago,
                montoServicios,
                montoBienes,
                totalFacturado,
                itbisFacturado,
                itbisRetenido,
                itbisProporcionalidad,
                itbisCosto,
                itbisAdelantar,
                itbisPercibido,
                tipoRetencionIsr,
                montoRetencionIsr,
                isrPercibido,
                isc,
                otrosImpuestos,
                propinaLegal,
                formaPago
            ].join('|');
        });

        const texto606 = lineas.join('\r\n');

        return {
            exito: true,
            totalFacturas: facturasFiltradas.length,
            periodo: periodoCalculado,
            rncReportante: rncNormalizado,
            texto606,
            nombreArchivo: `DGII_606_${periodoCalculado}.txt`
        };
    }

    // --- FUSIÓN DIFERENCIAL INTELIGENTE DE CATÁLOGOS ENTRE COMPUTADORAS (SMART DELTA PATCH) ---
    /**
     * Fusiona dos diccionarios farmacéuticos de forma no destructiva.
     * Añade productos nuevos, actualiza precios/costos inteligentemente y une el historial de compras
     * de droguerías sin perder los datos ni la ubicación física de mostrador de ninguna de las computadoras.
     * @param {Object} diccionarioLocal - Catálogo residente en la máquina actual
     * @param {Object} diccionarioEntrante - Catálogo recibido desde otra máquina o archivo
     * @param {Object} [opciones={}] - Opciones de fusión ({ modo: 'fusion' | 'reemplazo' })
     * @returns {{ diccionarioFusionado: Object, estadisticas: { agregados: number, actualizados: number, conservados: number, totalFinal: number } }}
     */
    function fusionarDiccionarios(diccionarioLocal, diccionarioEntrante, opciones = {}) {
        const local = clonarObjetoSeguro(diccionarioLocal || {});
        const entrante = diccionarioEntrante || {};
        const modo = (opciones && opciones.modo === 'reemplazo') ? 'reemplazo' : 'fusion';

        if (modo === 'reemplazo') {
            const reemplazado = {};
            let total = 0;
            for (const [cod, item] of Object.entries(entrante)) {
                const codigoLimpio = normalizarCodigoBarras(cod);
                if (codigoLimpio && item && typeof item === 'object') {
                    reemplazado[codigoLimpio] = clonarObjetoSeguro(item);
                    reemplazado[codigoLimpio].codigoBarras = codigoLimpio;
                    total++;
                }
            }
            return {
                diccionarioFusionado: reemplazado,
                estadisticas: { agregados: total, actualizados: 0, conservados: 0, totalFinal: total }
            };
        }

        let agregados = 0;
        let actualizados = 0;
        const clavesLocalesIniciales = new Set(Object.keys(local));

        for (const [cod, item] of Object.entries(entrante)) {
            const codigoLimpio = normalizarCodigoBarras(cod);
            if (!codigoLimpio || !item || typeof item !== 'object') continue;

            const existente = local[codigoLimpio];

            if (!existente) {
                // Producto totalmente nuevo para esta computadora
                local[codigoLimpio] = clonarObjetoSeguro(item);
                local[codigoLimpio].codigoBarras = codigoLimpio;
                agregados++;
            } else {
                // Producto preexistente en ambas computadoras: resolver conflicto inteligentemente
                const fechaLocal = new Date(existente.actualizadoEn || 0).getTime();
                const fechaEntrante = new Date(item.actualizadoEn || 0).getTime();
                const entranteEsMasReciente = fechaEntrante >= fechaLocal;

                // Fusión de historial de costos de droguerías (hasta 20 registros, sin duplicados)
                const historialCombinado = [];
                const clavesVistas = new Set();
                const listaA = Array.isArray(item.historialCostos) ? item.historialCostos : [];
                const listaB = Array.isArray(existente.historialCostos) ? existente.historialCostos : [];
                const todosHistoriales = [...listaA, ...listaB];

                todosHistoriales.sort((a, b) => {
                    const fa = new Date(a.fecha || 0).getTime();
                    const fb = new Date(b.fecha || 0).getTime();
                    return fb - fa;
                });

                for (const h of todosHistoriales) {
                    if (!h || typeof h !== 'object') continue;
                    const c = `${h.fecha || ''}|${h.precioCaja || 0}|${h.numeroFactura || ''}|${h.proveedor || ''}`;
                    if (!clavesVistas.has(c)) {
                        clavesVistas.add(c);
                        historialCombinado.push(clonarObjetoSeguro(h));
                    }
                    if (historialCombinado.length >= 20) break;
                }

                const baseFuente = entranteEsMasReciente ? item : existente;
                const baseSecundaria = entranteEsMasReciente ? existente : item;

                const fusionado = {
                    ...clonarObjetoSeguro(baseSecundaria),
                    ...clonarObjetoSeguro(baseFuente),
                    codigoBarras: codigoLimpio,
                    // Preservar ubicación de estante local si el archivo entrante no la tiene especificada
                    ubicacion: (existente.ubicacion && !item.ubicacion) ? existente.ubicacion : (item.ubicacion || existente.ubicacion || ''),
                    historialCostos: historialCombinado,
                    actualizadoEn: new Date(Math.max(fechaLocal || 0, fechaEntrante || 0, Date.now())).toISOString()
                };

                // Protección ante parches públicos purgados: jamás sobreescribir secretos comerciales locales con vacíos/ceros
                if (existente.ultimoPrecioCaja > 0 && !(item.ultimoPrecioCaja > 0)) {
                    fusionado.ultimoPrecioCaja = existente.ultimoPrecioCaja;
                    fusionado.costoAnteriorCaja = existente.costoAnteriorCaja || 0;
                    fusionado.variacionCosto = existente.variacionCosto || 0;
                    fusionado.costoUnitarioFiscal = existente.costoUnitarioFiscal || '';
                }
                if (existente.preciosVenta && !item.preciosVenta) {
                    fusionado.preciosVenta = clonarObjetoSeguro(existente.preciosVenta);
                }
                if (existente.proveedorHabitual && !item.proveedorHabitual) {
                    fusionado.proveedorHabitual = existente.proveedorHabitual;
                }
                if (existente.rncProveedor && !item.rncProveedor) {
                    fusionado.rncProveedor = existente.rncProveedor;
                }
                if (existente._segCifrado && !item._segCifrado) {
                    fusionado._segCifrado = clonarObjetoSeguro(existente._segCifrado);
                }

                local[codigoLimpio] = fusionado;

                actualizados++;
            }
        }

        let conservados = 0;
        for (const cod of clavesLocalesIniciales) {
            if (!entrante[cod]) conservados++;
        }

        return {
            diccionarioFusionado: local,
            estadisticas: {
                agregados,
                actualizados,
                conservados,
                totalFinal: Object.keys(local).length
            }
        };
    }

    /**
     * Construye un sobre público sanitario seguro para transferir catálogo a otra computadora.
     * Aplica purga en caliente eliminando costos, proveedores, RNCs e historiales confidenciales.
     * @param {Object} diccionario - Diccionario actual
     * @param {Object} [opciones={}] - Opciones adicionales
     * @returns {Object} Sobre de datos estandarizado y purgado
     */
    function generarSobreParcheCatalogo(diccionario, opciones = {}) {
        const productos = sanitizarDiccionarioPublico(diccionario || {});
        const total = Object.keys(productos).length;
        const fechaIso = obtenerFechaLocalISO();

        return {
            tipo: CONSTANTES.TIPO_ARCHIVO_PARCHE_CATALOGO,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO || 2,
            fechaGeneracion: new Date().toISOString(),
            descripcion: 'Parche Sanitario Público de Catálogo Farmacéutico (Cero Costos / Cero Proveedores)',
            resumen: {
                totalProductos: total,
                fechaCorte: fechaIso,
                sanitizadoPublico: true
            },
            datos: {
                diccionario: productos
            }
        };
    }

    function obtenerMacroCategoria(cat) {
        if (!cat || typeof cat !== 'string') return 'General / Otros';
        const c = cat.trim();
        const cLower = c.toLowerCase();

        if (cLower.startsWith('antibiótic') || cLower.startsWith('antibiotic')) return 'Antibióticos';
        if (cLower.startsWith('antidiabétic') || cLower.startsWith('antidiabetic')) return 'Antidiabéticos';
        if (cLower.startsWith('antihipertensiv') || cLower.startsWith('cardiovascular') || cLower.includes('colesterol') || cLower.includes('plaquetario')) return 'Cardiovascular & Hipertensión';
        if (cLower.startsWith('analgésic') || cLower.startsWith('analgesic') || cLower.includes('antiinflamatorio')) return 'Analgésicos & Antiinflamatorios';
        if (cLower.startsWith('antihistamínic') || cLower.includes('antialérgico') || cLower.includes('antitusivo') || cLower.includes('descongestionante')) return 'Antialérgicos & Respiratorio';
        if (cLower.startsWith('gastro') || cLower.startsWith('digestiv') || cLower.startsWith('probiótico') || cLower.includes('suero') || cLower.includes('rehidratación')) return 'Gastrointestinal & Digestivo';
        if (cLower.startsWith('fórmula') || cLower.startsWith('formula') || cLower.startsWith('leche') || cLower.includes('cuidado infantil') || cLower.includes('accesorios infantiles')) return 'Pediatría & Cuidado Infantil';
        if (cLower.startsWith('dermocosmética') || cLower.startsWith('dermocosmetica') || cLower.includes('cuidado personal') || cLower.includes('cuidado capilar') || cLower.includes('higiene personal') || cLower.includes('afeitado') || cLower.includes('higiene femenina')) return 'Cuidado Personal & Cosmética';
        if (cLower.startsWith('salud bucodental') || cLower.includes('dental') || cLower.includes('bucal')) return 'Salud Bucodental';
        if (cLower.startsWith('primeros auxilios') || cLower.includes('quirúrgic') || cLower.includes('diagnóstico médico')) return 'Primeros Auxilios & Material Médico';
        if (cLower.startsWith('suplemento') || cLower.includes('vitamina') || cLower.includes('neuroprotector')) return 'Vitaminas & Suplementos';
        if (cLower.startsWith('conveniencia') || cLower.includes('golosina') || cLower.includes('snack') || cLower.includes('bebida') || cLower.includes('agua') || cLower.includes('higiene / conveniencia')) return 'Conveniencia & Bebidas';

        if (c.includes('/')) {
            const macroSegmento = c.split('/')[0].trim();
            if (macroSegmento.length > 2) return macroSegmento;
        }

        return c;
    }

    // --- NORMALIZACIÓN EN MAYÚSCULAS Y ESTANDARIZACIÓN DE MEDICAMENTOS ---
    function normalizarNombreProductoMayusculas(nombreRaw) {
        if (!nombreRaw || typeof nombreRaw !== 'string') return '';
        let s = nombreRaw.trim();
        if (!s) return '';

        // 1. Colapsar espacios múltiples y saltos
        s = s.replace(/\s+/g, ' ');

        // 2. Normalizar operadores (+, /) con espaciado uniforme
        s = s.replace(/\s*\/\s*/g, ' / ');
        s = s.replace(/\s*\+\s*/g, ' + ');
        s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1%');

        // 3. Normalizar unidades de dosificación en MAYÚSCULAS separadas por espacio: 500mg -> 500 MG, 1g -> 1 G
        s = s.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|l|ui|iu|meq|cm3|mm|kg|µg|ug)\b/gi, (match, num, unit) => {
            return num + ' ' + unit.toUpperCase();
        });

        // 4. Formas farmacéuticas abreviadas normalizadas en mayúsculas
        s = s.replace(/\bTABS?\b/gi, 'TABLETAS');
        s = s.replace(/\bCAPS?\b/gi, 'CÁPSULAS');
        s = s.replace(/\bJBE\b/gi, 'JARABE');
        s = s.replace(/\bSUSP\b/gi, 'SUSPENSIÓN');
        s = s.replace(/\bAMP\b/gi, 'AMPOLLAS');
        s = s.replace(/\bCOMP?\b/gi, 'COMPRIMIDOS');
        s = s.replace(/\bGTS?\b/gi, 'GOTAS');
        s = s.replace(/\bUNG\b/gi, 'UNGÜENTO');
        s = s.replace(/\bSOL\b/gi, 'SOLUCIÓN');

        return s.toUpperCase().replace(/\s+/g, ' ').trim();
    }

    // --- VALIDACIÓN DE DATOS MÍNIMOS OBLIGATORIOS PARA PRODUCTOS ---
    function validarDatosMinimosProducto(producto) {
        if (!producto || typeof producto !== 'object') {
            return { esValido: false, campo: 'nombre', error: 'Datos de producto inválidos.' };
        }

        const nombre = String(producto.nombre || producto.nombreComercial || '').trim();
        if (!nombre || nombre.length < 3) {
            return {
                esValido: false,
                campo: 'nombre',
                error: 'El nombre del producto es obligatorio (mínimo 3 caracteres).'
            };
        }

        if (/^Producto(\s*#\d+)?$/i.test(nombre) || nombre.toLowerCase() === 'producto sin nombre') {
            return {
                esValido: false,
                campo: 'nombre',
                error: 'Debes ingresar un nombre descriptivo real para el producto.'
            };
        }

        const esConveniencia = Boolean(
            producto.aplicaItbis === true ||
            (producto.categoria && /conveniencia|snack|bebida|helado|higiene|golosina/i.test(producto.categoria))
        );

        // Si es medicamento (no conveniencia), verificar que tenga dosificación o potencia
        if (!esConveniencia) {
            const concentracion = String(producto.concentracion || '').trim();
            const regexUnidades = /\b(\d+(?:\.\d+)?)\s*(MG|MCG|G|ML|L|UI|IU|MEQ|%)\b/i;
            const tieneUnidadEnNombre = regexUnidades.test(nombre);
            const tieneUnidadEnConc = regexUnidades.test(concentracion);

            if (!tieneUnidadEnNombre && !tieneUnidadEnConc) {
                return {
                    esValido: false,
                    campo: 'concentracion',
                    error: 'En medicamentos es obligatorio especificar la concentración o unidad (ej. 500 MG, 1 G, 250 MG / 5 ML, 10 UI).'
                };
            }
        }

        // Laboratorio o Fabricante obligatorio (a menos que se permita sin laboratorio)
        const lab = String(producto.laboratorio || '').trim();
        if ((!lab || lab.length < 2) && producto.permitirSinLaboratorio !== true) {
            return {
                esValido: false,
                campo: 'laboratorio',
                error: 'Debes indicar el Laboratorio fabricante o Distribuidor del producto.'
            };
        }

        // Si se define tipo divisible, unidades por caja debe ser >= 2
        const tipo = String(producto.tipo || '').toLowerCase();
        if (tipo === 'divisible' || tipo === 'divide') {
            const u = Number(producto.unidadesPorCaja);
            if (!Number.isInteger(u) || u < 2) {
                return {
                    esValido: false,
                    campo: 'unidadesPorCaja',
                    error: 'Si el producto se divide por pastillas o ampollas, debe traer al menos 2 unidades por caja.'
                };
            }
        }

        // Si se provee precio/costo, debe ser > 0 (o >= 0 si es bonificación cruzada / regalo)
        const costo = producto.precioCajaBase !== undefined ? producto.precioCajaBase : producto.ultimoPrecioCaja;
        if (costo !== undefined && costo !== null && costo !== '') {
            const numCosto = Number(costo);
            const esCeroPermitido = Boolean(producto.permitirCero || producto.esBonificacionCruzada || numCosto === 0);
            if (!Number.isFinite(numCosto) || (esCeroPermitido ? numCosto < 0 : numCosto <= 0)) {
                return {
                    esValido: false,
                    campo: 'precioCaja',
                    error: esCeroPermitido ? 'El costo de adquisición debe ser mayor o igual a 0.' : 'El costo de adquisición debe ser mayor a 0.'
                };
            }
        }

        return { esValido: true };
    }

    function estandarizarNombreFarmaceutico(nombreRaw) {
        if (!nombreRaw || typeof nombreRaw !== 'string') return '';
        let s = nombreRaw.trim();
        if (!s) return '';

        // 1. Colapsar espacios múltiples y saltos
        s = s.replace(/\s+/g, ' ');

        // 2. Normalizar diagonales y operadores: ej '250mg / 5ml' -> '250mg/5ml', 'A + B' -> 'A + B'
        s = s.replace(/\s*\/\s*/g, '/');
        s = s.replace(/\s*\+\s*/g, ' + ');
        s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, (m, g1) => g1 + '%');

        // 3. Normalizar unidades de dosificación pegadas al valor numérico: 500 mg -> 500mg, 1 G -> 1g, etc.
        s = s.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|l|ui|iu|meq|cm3|mm|kg|µg|ug)\b/gi, (match, num, unit) => {
            return num + unit.toLowerCase();
        });

        // 4. Siglas y acrónimos médicos/farmacéuticos que deben permanecer en MAYÚSCULAS
        const siglasMayusculas = new Set([
            'XR', 'SR', 'LP', 'ODT', 'CR', 'ER', 'LA', 'HFA', 'AINE', 'IBP',
            'IV', 'IM', 'VO', 'SL', 'OTC', 'FORTE', 'PLUS', 'MAX', 'NF',
            'B01', 'B02', 'B14', 'B15', 'E31', 'E32', 'GS1', 'DGII',
            'B12', 'B6', 'B1', 'D3', 'II', 'III', 'IV', 'VI', 'VII', 'VIII'
        ]);

        // Conectores que van en minúsculas si no son la primera palabra
        const conectoresMinusculas = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'o', 'con', 'para', 'por', 'al', 'a']);

        // Formas farmacéuticas estándar
        const formasFarmaceuticas = {
            'tab': 'Tab', 'tabs': 'Tab', 'tableta': 'Tabletas', 'tabletas': 'Tabletas',
            'cap': 'Cap', 'caps': 'Caps', 'capsula': 'Cápsulas', 'capsulas': 'Cápsulas',
            'jbe': 'Jbe', 'jarabe': 'Jarabe',
            'susp': 'Susp', 'suspension': 'Suspensión',
            'amp': 'Amp', 'ampolla': 'Ampollas', 'ampollas': 'Ampollas',
            'gts': 'Gotas', 'gtas': 'Gotas', 'gotas': 'Gotas',
            'ung': 'Ung', 'unguento': 'Ungüento',
            'crm': 'Crema', 'crema': 'Crema',
            'sol': 'Sol', 'solucion': 'Solución',
            'comp': 'Comp', 'comprimido': 'Comprimidos', 'comprimidos': 'Comprimidos',
            'ovul': 'Óvulos', 'ovulos': 'Óvulos',
            'sob': 'Sobres', 'sobres': 'Sobres'
        };

        // 5. Procesar token a token
        const palabras = s.split(' ');
        const procesadas = palabras.map((pal, idx) => {
            // Manejar unidades compuestas como 250mg/5ml
            if (pal.includes('/')) {
                return pal.split('/').map(sub => {
                    const subUpper = sub.toUpperCase();
                    if (siglasMayusculas.has(subUpper)) return subUpper;
                    return sub;
                }).join('/');
            }

            const upper = pal.toUpperCase();
            const lower = pal.toLowerCase();

            // Si es una sigla médica reconocida
            if (siglasMayusculas.has(upper)) return upper;

            // Si es una forma farmacéutica común
            const lowerSinPunto = lower.replace(/\.$/, '');
            if (formasFarmaceuticas[lowerSinPunto]) {
                const formaBase = formasFarmaceuticas[lowerSinPunto];
                return pal.endsWith('.') ? formaBase + '.' : formaBase;
            }

            // Si es un conector y no es la primera palabra
            if (idx > 0 && conectoresMinusculas.has(lower)) {
                return lower;
            }

            // Si ya contiene números con unidades (ej: 500mg, 10ml, 50ui)
            if (/\d+(?:mg|mcg|g|ml|l|ui|iu|meq|%)/i.test(pal)) {
                return lower;
            }

            // Si tiene caracteres especiales como paréntesis: (100mg)
            if (pal.startsWith('(') && pal.endsWith(')')) {
                const contenido = pal.slice(1, -1);
                return '(' + estandarizarNombreFarmaceutico(contenido) + ')';
            }

            // Por defecto: Title Case (primera letra mayúscula, resto minúscula)
            return pal.charAt(0).toUpperCase() + pal.slice(1).toLowerCase();
        });

        return procesadas.join(' ');
    }

    AppFarmacia.Dominio = Object.freeze({
        normalizarNombreProductoMayusculas,
        validarDatosMinimosProducto,
        estandarizarNombreFarmaceutico,
        obtenerMacroCategoria,
        normalizarTextoFoneticoFarmacia,
        distanciaLevenshtein,
        buscarEnCatalogoFuzzy,
        calcularVariacionCostoPorcentaje,
        analizarVariacionCosto,
        ESTADOS_FEFO,
        evaluarSemaforoFefo,
        parsearCodigoGs1DataMatrix,
        sanitizarFichaPublicaCatalogo,
        sanitizarDiccionarioPublico,
        generarCsvCatalogoMaestro,
        generarTextoFormato606,
        fusionarDiccionarios,
        generarSobreParcheCatalogo,

        validarRnc,
        emitirBipExito,
        emitirBipError,
        emitirBipAlerta,
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
        parsearExpresionCajas,
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
