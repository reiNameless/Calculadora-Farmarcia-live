(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const Dominio = AppFarmacia.Dominio;
    const { REGLAS_NEGOCIO_POR_DEFECTO, ESTRATEGIAS_CALCULO } = AppFarmacia.Configuracion;

    function afirmarIgualdad(actual, esperado, descripcion) {
        if (actual !== esperado) {
            console.error(`[FALLO PRUEBA] ${descripcion}`, { actual, esperado });
            throw new Error(`[FALLO PRUEBA] ${descripcion} | Esperado: "${esperado}", Recibido: "${actual}"`);
        }
    }

    function afirmarCierto(condicion, descripcion) {
        if (!condicion) {
            console.error(`[FALLO PRUEBA] ${descripcion}`);
            throw new Error(`[FALLO PRUEBA] ${descripcion} | Se esperaba verdadero`);
        }
    }

    function ejecutarSuitePruebas() {
        console.group('Suite de Pruebas Automatizadas - Calculadora de Farmacia');

        // 1. Validaciones básicas de entrada
        const valCajaUno = Dominio.validarCantidadEnteraPositiva('1', 'cajas');
        afirmarIgualdad(valCajaUno.esValido, true, 'Acepta 1 en Cajas en Factura');
        afirmarIgualdad(valCajaUno.valor, 1, 'Valor numérico 1 en Cajas');

        const valInvalidoDecimal = Dominio.validarCantidadEnteraPositiva('2.5', 'cajas');
        afirmarIgualdad(valInvalidoDecimal.esValido, false, 'Rechaza decimales en Cajas');

        const valPrecioValido = Dominio.validarPrecioCompra('150.50');
        afirmarIgualdad(valPrecioValido.esValido, true, 'Acepta precio con punto');
        afirmarIgualdad(valPrecioValido.valor, 150.50, 'Convierte precio a float');

        const valPrecioComa = Dominio.validarPrecioCompra('150,50');
        afirmarIgualdad(valPrecioComa.esValido, true, 'Acepta precio con coma');
        afirmarIgualdad(valPrecioComa.valor, 150.50, 'Convierte coma a punto correctamente');

        // 2. Estrategia 1: CASCADA_DESCUENTO (Por defecto)
        // Precio base = 100, Unidades = 10, Sin ITBIS -> Costo Unitario = 10 -> P1 = 13 (+30%), P2 = 12.35 (-5%), P3 = 11.73 (-5%)
        const casoCascada = Dominio.calcularDesglosePrecios(100, 10, false, REGLAS_NEGOCIO_POR_DEFECTO);
        afirmarIgualdad(casoCascada.costoUnitario, '10.00000000', 'Cascada: Costo unitario 8 decimales');
        afirmarIgualdad(casoCascada.p1Exacto, '13.00', 'Cascada: Precio 1 (+30%)');
        afirmarIgualdad(casoCascada.p2Exacto, '12.35', 'Cascada: Precio 2 (13 - 5%)');
        afirmarIgualdad(casoCascada.p3Exacto, '11.73', 'Cascada: Precio 3 Exacto (11.73)');
        afirmarIgualdad(casoCascada.p3Redondeado, '12', 'Cascada: Precio 3 Redondeado (12)');

        // Con ITBIS (18%)
        const casoCascadaItbis = Dominio.calcularDesglosePrecios(100, 10, true, REGLAS_NEGOCIO_POR_DEFECTO);
        afirmarIgualdad(casoCascadaItbis.costoCajaEfectivo, 118, 'Cascada + ITBIS: Costo caja con 18%');
        afirmarIgualdad(casoCascadaItbis.montoItbisPorCaja, 18, 'Cascada + ITBIS: Monto ITBIS por caja');
        afirmarIgualdad(casoCascadaItbis.costoUnitario, '11.80000000', 'Cascada + ITBIS: Costo unitario');
        afirmarIgualdad(casoCascadaItbis.p1Exacto, '15.34', 'Cascada + ITBIS: Precio 1');

        // Línea inmutable con ITBIS
        const lineaItbis = Dominio.crearLineaProductoInmutable({
            nombre: 'Amoxicilina 500mg',
            tipo: 'DIVISIBLE',
            cajasCompradas: 2,
            unidadesPorCaja: 10,
            precioCajaBase: 100,
            aplicaItbis: true
        }, REGLAS_NEGOCIO_POR_DEFECTO);
        afirmarIgualdad(lineaItbis.montoItbisPorCaja, 18, 'Línea Inmutable: ITBIS por caja');
        afirmarIgualdad(lineaItbis.montoItbisLinea, 36, 'Línea Inmutable: Total ITBIS línea 2 cajas');
        afirmarIgualdad(lineaItbis.subtotalFactura, 236, 'Línea Inmutable: Subtotal línea con ITBIS');

        // 3. Estrategia 2: MARGEN_DIRECTO_COSTO
        const reglasMargenDirecto = {
            estrategia: ESTRATEGIAS_CALCULO.MARGEN_DIRECTO_COSTO,
            porcentajeItbis: 18,
            porcentajePrecio1: 30,
            porcentajePrecio2: 25,
            porcentajePrecio3: 20
        };
        const casoMargenDirecto = Dominio.calcularDesglosePrecios(100, 10, false, reglasMargenDirecto);
        afirmarIgualdad(casoMargenDirecto.p1Exacto, '13.00', 'Margen Directo: P1 = Costo + 30%');
        afirmarIgualdad(casoMargenDirecto.p2Exacto, '12.50', 'Margen Directo: P2 = Costo + 25%');
        afirmarIgualdad(casoMargenDirecto.p3Exacto, '12.00', 'Margen Directo: P3 = Costo + 20%');

        // 4. Estrategia 3: MARGEN_BRUTO_FINANCIERO
        const reglasFinanciero = {
            estrategia: ESTRATEGIAS_CALCULO.MARGEN_BRUTO_FINANCIERO,
            porcentajeItbis: 18,
            porcentajePrecio1: 30,
            porcentajePrecio2: 5,
            porcentajePrecio3: 5
        };
        const casoFinanciero = Dominio.calcularDesglosePrecios(100, 10, false, reglasFinanciero);
        // Costo = 10, P1 = 10 / (1 - 0.3) = 14.2857 -> 14.29
        afirmarIgualdad(casoFinanciero.p1Exacto, '14.29', 'Margen Financiero: P1 = Costo / (1 - Margin)');

        // 5. Verificación de Regex COD-05 (reconocimiento de nombres genéricos)
        const regexGenerico = /^Producto #\d+$/i;
        afirmarCierto(regexGenerico.test('Producto #1'), 'COD-05: Reconoce Producto #1');
        afirmarCierto(regexGenerico.test('producto #129'), 'COD-05: Reconoce producto #129 en minúsculas');
        afirmarCierto(!regexGenerico.test('Amoxicilina 500mg'), 'COD-05: No es genérico Amoxicilina');
        afirmarCierto(!regexGenerico.test('Producto #1 con extra'), 'COD-05: No es genérico con texto adicional');

        // 6. Resumen de cuadre de factura
        const productosPrueba = [
            { subtotalFactura: 100.50 },
            { subtotalFactura: 50.25 }
        ];
        const cuadre = Dominio.calcularResumenCuadreFactura(productosPrueba, 150.75);
        afirmarIgualdad(cuadre.sumaAcumulada, 150.75, 'Cuadre: Suma acumulada exacta');
        afirmarIgualdad(cuadre.cuadreExacto, true, 'Cuadre: Coincide con total físico');

        // 7. Cálculo especial de LECHE: Margen 10% (Costo * 1.10)
        const casoLeche = Dominio.calcularDesglosePrecios(1000, 1, false, REGLAS_NEGOCIO_POR_DEFECTO, { esLeche: true });
        afirmarIgualdad(casoLeche.costoUnitario, '1000.00000000', 'Leche: Costo fiscal unitario base');
        afirmarIgualdad(casoLeche.p1Exacto, '1,100.00', 'Leche: P1 = Costo * 1.10 (10% ganancia)');
        afirmarIgualdad(casoLeche.p1Redondeado, '1100', 'Leche: P1 Redondeado = 1100');

        // 8. Caso real de usuario: 2 latas de leche a $1000 c/u con $90 de descuento total
        const casoLecheConDescuento = Dominio.calcularDesglosePrecios(1000, 1, false, REGLAS_NEGOCIO_POR_DEFECTO, {
            cajasCompradas: 2,
            esLeche: true,
            descuentoValor: 90,
            tipoDescuento: 'monto'
        });
        // Descuento por unidad = 90 / 2 = 45 -> Costo compra efectivo = 955
        afirmarIgualdad(casoLecheConDescuento.costoCajaEfectivo, 955, 'Leche + Desc: Costo caja efectivo con descuento ($1000 - $45)');
        afirmarIgualdad(casoLecheConDescuento.costoUnitario, '955.00000000', 'Leche + Desc: Costo fiscal unitario para el sistema de farmacia');
        // Venta se calcula sobre base $1000 sin descuento * 1.10 = $1100
        afirmarIgualdad(casoLecheConDescuento.costoUnitarioVenta, '1000.00000000', 'Leche + Desc: Base para venta sin descuento');
        afirmarIgualdad(casoLecheConDescuento.p1Exacto, '1,100.00', 'Leche + Desc: P1 mantiene cálculo sobre base ($1100.00)');

        // 9. Descuento en modalidad Porcentaje (%)
        const casoDescPorcentaje = Dominio.calcularDesglosePrecios(200, 10, false, REGLAS_NEGOCIO_POR_DEFECTO, {
            cajasCompradas: 1,
            descuentoValor: 10, // 10%
            tipoDescuento: 'porcentaje'
        });
        // 10% de 200 = 20 de descuento -> Caja efectiva = 180 -> Unitario compra = 18
        afirmarIgualdad(casoDescPorcentaje.costoCajaEfectivo, 180, 'Desc %: Costo caja con 10% de descuento ($180)');
        afirmarIgualdad(casoDescPorcentaje.costoUnitario, '18.00000000', 'Desc %: Costo unitario compra fiscal');
        afirmarIgualdad(casoDescPorcentaje.p1Exacto, '26.00', 'Desc %: P1 calculado sobre base $20 * 1.30 = $26.00');

        // 10. Línea Inmutable con Leche y Descuento
        const lineaLeche = Dominio.crearLineaProductoInmutable({
            nombre: 'Leche Nan Pro 1 800g',
            tipo: 'ENTERO',
            cajasCompradas: 2,
            unidadesPorCaja: 1,
            precioCajaBase: 1000,
            aplicaItbis: false,
            esLeche: true,
            descuentoValor: 90,
            tipoDescuento: 'monto'
        }, REGLAS_NEGOCIO_POR_DEFECTO);
        afirmarIgualdad(lineaLeche.subtotalFactura, 1910, 'Línea Leche: Subtotal factura exacto 2 x 955 = 1910');
        afirmarIgualdad(lineaLeche.costoUnitario, '955.00000000', 'Línea Leche: Costo unitario compra 955');
        afirmarIgualdad(lineaLeche.p1Exacto, '1,100.00', 'Línea Leche: P1 venta 1100.00');

        // 11. Caso exacto sin redondeo prematuro: 3 latas de leche a $200 c/u con $40 de descuento
        // Total compra = (3 * 200) - 40 = 560 -> Costo unitario = 560 / 3 = 186.66666667 (NO 186.67000000)
        const casoLeche3Latas = Dominio.calcularDesglosePrecios(200, 1, false, REGLAS_NEGOCIO_POR_DEFECTO, {
            cajasCompradas: 3,
            esLeche: true,
            descuentoValor: 40,
            tipoDescuento: 'monto'
        });
        afirmarIgualdad(casoLeche3Latas.costoUnitario, '186.66666667', 'Leche 3 Latas: Costo unitario fiscal exacto con 8 decimales (186.66666667)');
        afirmarIgualdad(casoLeche3Latas.subtotalFactura, 560, 'Leche 3 Latas: Subtotal compra exacto 560.00');
        afirmarIgualdad(casoLeche3Latas.p1Exacto, '220.00', 'Leche 3 Latas: P1 venta calculado sobre base 200 * 1.10 = 220.00');

        // 12. Sumar 30 días a fecha de emisión para fecha de vencimiento por defecto
        afirmarIgualdad(Dominio.sumarDiasAFechaISO('2026-11-04', 30), '2026-12-04', 'Fecha: Suma 30 días en el mismo mes/siguiente');
        afirmarIgualdad(Dominio.sumarDiasAFechaISO('2026-12-15', 30), '2027-01-14', 'Fecha: Suma 30 días cruzando fin de año');
        afirmarIgualdad(Dominio.sumarDiasAFechaISO('2026-01-15', 30), '2026-02-14', 'Fecha: Suma 30 días en enero');

        // 13. Normalización y limpieza de código de barras
        afirmarIgualdad(Dominio.normalizarCodigoBarras(' 746 123 456 '), '746123456', 'Código: Remueve espacios');
        afirmarIgualdad(Dominio.normalizarCodigoBarras(''), '', 'Código: Vacío devuelve cadena vacía');

        // 14. Validación de Código de Barras según Estándar GS1 (Modulo 10)
        const vEan13 = Dominio.validarCodigoBarrasEstandar('7461234567890');
        afirmarIgualdad(vEan13.esValido, true, 'GS1: Valida EAN-13 correcto (7461234567890)');
        afirmarIgualdad(vEan13.tipo, 'EAN-13', 'GS1: Identifica tipo EAN-13');

        const vUpcA = Dominio.validarCodigoBarrasEstandar('012345678905');
        afirmarIgualdad(vUpcA.esValido, true, 'GS1: Valida UPC-A correcto (012345678905)');
        afirmarIgualdad(vUpcA.tipo, 'UPC-A', 'GS1: Identifica tipo UPC-A');

        const vEan8 = Dominio.validarCodigoBarrasEstandar('96385074');
        afirmarIgualdad(vEan8.esValido, true, 'GS1: Valida EAN-8 correcto (96385074)');
        afirmarIgualdad(vEan8.tipo, 'EAN-8', 'GS1: Identifica tipo EAN-8');

        const vChecksumInvalido = Dominio.validarCodigoBarrasEstandar('7461234567891');
        afirmarIgualdad(vChecksumInvalido.esValido, false, 'GS1: Detecta checksum incorrecto');
        afirmarIgualdad(vChecksumInvalido.digitoEsperado, 0, 'GS1: Calcula dígito esperado correcto (0)');

        const vLongitudInvalida = Dominio.validarCodigoBarrasEstandar('12345');
        afirmarIgualdad(vLongitudInvalida.esValido, false, 'GS1: Rechaza longitud no estándar (5 dígitos)');


        // 9. Validaciones de RNC dominicano (DGII Módulo 11 y Cédula Módulo 10)
        const rncClaro = Dominio.validarRnc('101-00157-7');
        afirmarIgualdad(rncClaro.esValido, true, 'RNC: Valida RNC jurídico 101-00157-7 con guiones');
        afirmarIgualdad(rncClaro.tipo, 'RNC Jurídico (9 dígitos)', 'RNC: Identifica tipo jurídico');

        const rncPopular = Dominio.validarRnc('101010632');
        afirmarIgualdad(rncPopular.esValido, true, 'RNC: Valida RNC 101010632 (resto 0 -> esperado 2)');

        const rncInvalido = Dominio.validarRnc('101001570');
        afirmarIgualdad(rncInvalido.esValido, false, 'RNC: Detecta dígito verificador incorrecto');

        const cedulaValida = Dominio.validarRnc('001-1645428-1');
        afirmarIgualdad(cedulaValida.esValido, true, 'RNC: Valida Cédula / RNC físico 001-1645428-1');
        afirmarIgualdad(cedulaValida.tipo, 'Cédula / RNC Físico (11 dígitos)', 'RNC: Identifica tipo físico');

        const cedulaInvalida = Dominio.validarRnc('00116454289');
        afirmarIgualdad(cedulaInvalida.esValido, false, 'RNC: Detecta cédula con dígito inválido');

        // 10. Decodificador de QR de Factura Fiscal Electrónica DGII (e-CF)
        const urlDgii = 'https://dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=101001577&RncComprador=130000001&eNCF=E3100028491&FechaEmision=15-10-2024&MontoTotal=15840.50&CodigoSeguridad=A8F12C';
        const parsedDgii = Dominio.parsearQrFacturaDgii(urlDgii);
        afirmarIgualdad(parsedDgii.esValido, true, 'QR-DGII: Reconoce URL válida de ConsultaTimbre');
        afirmarIgualdad(parsedDgii.esDgii, true, 'QR-DGII: Marca bandera esDgii');
        afirmarIgualdad(parsedDgii.datos.encf, 'E3100028491', 'QR-DGII: Extrae e-NCF E3100028491');
        afirmarIgualdad(parsedDgii.datos.rncEmisor, '101001577', 'QR-DGII: Extrae RNC Emisor');
        afirmarIgualdad(parsedDgii.datos.fechaEmision, '2024-10-15', 'QR-DGII: Normaliza fecha a YYYY-MM-DD');
        afirmarIgualdad(parsedDgii.datos.montoTotal, 15840.5, 'QR-DGII: Extrae total numérico');
        afirmarIgualdad(parsedDgii.datos.codigoSeguridad, 'A8F12C', 'QR-DGII: Extrae timbre digital de seguridad');

        const urlNoDgii = 'https://ejemplo.com/producto/12345';
        const parsedNoDgii = Dominio.parsearQrFacturaDgii(urlNoDgii);
        afirmarIgualdad(parsedNoDgii.esDgii, false, 'QR-DGII: Rechaza URL ajena a DGII');

        const vacioDgii = Dominio.parsearQrFacturaDgii('');
        afirmarIgualdad(vacioDgii.esValido, false, 'QR-DGII: Manejo resiliente de entrada vacía');

        console.info('%c[Todas las pruebas de cálculo, validación y estrategias superadas exitosamente]', 'color:#146c2e;font-weight:bold;');
        console.groupEnd();
        return true;
    }

    AppFarmacia.ejecutarSuitePruebas = ejecutarSuitePruebas;

    // CAL-01: Ejecutar solo si se solicita explícitamente en la URL (?test=true o ?debug=1) o en consola
    if (typeof window !== 'undefined' && window.location?.search && (window.location.search.includes('test=true') || window.location.search.includes('debug=1'))) {
        window.addEventListener('DOMContentLoaded', ejecutarSuitePruebas);
    }
})(window);
