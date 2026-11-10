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

        // Con ITBIS (18%) - El ITBIS grava el producto en venta, no el costo de compra
        const casoCascadaItbis = Dominio.calcularDesglosePrecios(100, 10, true, REGLAS_NEGOCIO_POR_DEFECTO);
        afirmarIgualdad(casoCascadaItbis.costoCajaEfectivo, 100, 'Cascada + ITBIS: Costo neto de compra sin ITBIS');
        afirmarIgualdad(casoCascadaItbis.montoItbisPorCaja, 18, 'Cascada + ITBIS: Monto ITBIS por caja');
        afirmarIgualdad(casoCascadaItbis.costoUnitario, '10.00000000', 'Cascada + ITBIS: Costo fiscal neto a 8 decimales (sin ITBIS)');
        afirmarIgualdad(casoCascadaItbis.p1Exacto, '13.00', 'Cascada + ITBIS: Precio 1 neto por defecto (Opción 1)');
        afirmarIgualdad(casoCascadaItbis.p1ConItbisExacto, '15.34', 'Cascada + ITBIS: Precio 1 con ITBIS calculado');

        const casoCascadaConItbisOpcion = Dominio.calcularDesglosePrecios(100, 10, true, REGLAS_NEGOCIO_POR_DEFECTO, { mostrarPreciosConItbis: true });
        afirmarIgualdad(casoCascadaConItbisOpcion.p1Exacto, '15.34', 'Cascada + ITBIS (Opción Activa): Precio 1 con ITBIS');

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

        // 11. Desglose canónico unificado en calcularResumenCuadreFactura (DRY)
        const productosDesglosePrueba = [
            {
                cajasCompradas: 2,
                precioCajaBase: 500,
                descuentoTotalLinea: 50,
                aplicaItbis: false,
                tasaItbis: 0,
                subtotalFactura: 950
            },
            {
                cajasCompradas: 1,
                precioCajaBase: 1000,
                descuentoTotalLinea: 0,
                aplicaItbis: true,
                tasaItbis: 18,
                montoItbisLinea: 180,
                subtotalFactura: 1180
            }
        ];
        const resumenDesglose = Dominio.calcularResumenCuadreFactura(productosDesglosePrueba, 2130);
        afirmarIgualdad(resumenDesglose.totalBrutoAcumulado, 2000, "Cuadre DRY: Total bruto acumulado");
        afirmarIgualdad(resumenDesglose.totalDescuentoAcumulado, 50, "Cuadre DRY: Total descuento acumulado");
        afirmarIgualdad(resumenDesglose.totalExentoAcumulado, 950, "Cuadre DRY: Total exento (500*2 - 50)");
        afirmarIgualdad(resumenDesglose.totalGravadoAcumulado, 1000, "Cuadre DRY: Total gravado (1000)");
        afirmarIgualdad(resumenDesglose.totalItbisAcumulado, 180, "Cuadre DRY: Total ITBIS acumulado");
        afirmarIgualdad(resumenDesglose.sumaAcumulada, 2130, "Cuadre DRY: Suma acumulada exacta");
        afirmarIgualdad(resumenDesglose.cuadreExacto, true, "Cuadre DRY: Cuadre exacto con total físico");

        // 12. Redondeo exponencial exacto en montos elevados (Anti-sesgo IEEE 754)
        afirmarIgualdad(Dominio.redondearDecimalExacto(1000.005, 2), 1000.01, "Redondeo: 1000.005 exacto");
        afirmarIgualdad(Dominio.redondearDecimalExacto(-1000.005, 2), -1000.01, "Redondeo: -1000.005 simétrico exacto");
        afirmarIgualdad(Dominio.redondearDecimalExacto(15840.505, 2), 15840.51, "Redondeo: Factura alta $15,840.505");

        // 13. Seguridad de Archivos y Mitigación de Amenazas (Magic Bytes, Path Traversal, PDF Exploits, Bomba Descompresión)
        // 13.1 Sanitización de nombres y detección de doble extensión (CWE-434, CWE-22)
        afirmarIgualdad(Dominio.sanitizarNombreArchivo('../../facturas/factura_marzo.pdf'), 'factura_marzo.pdf', 'Seguridad: Elimina Path Traversal (../../)');
        afirmarIgualdad(Dominio.sanitizarNombreArchivo('factura_legal.PDF'), 'factura_legal.PDF', 'Seguridad: Preserva nombre legítimo');
        
        let dobleExtBloqueada = false;
        try {
            Dominio.sanitizarNombreArchivo('factura.php.pdf');
        } catch (_) {
            dobleExtBloqueada = true;
        }
        afirmarIgualdad(dobleExtBloqueada, true, 'Seguridad: Bloquea doble extensión ejecutable (.php.pdf)');

        // 13.2 Inspección de firmas binarias (Magic Numbers)
        const bytesPdfValidos = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]); // %PDF-1.7
        afirmarIgualdad(Dominio.detectarFirmaMagica(bytesPdfValidos)?.mime, 'application/pdf', 'Seguridad: Detecta firma mágica legítima de PDF');

        const bytesExeDisfrazado = new Uint8Array([0x4D, 0x5A, 0x90, 0x00]); // MZ
        afirmarIgualdad(Dominio.detectarFirmaMagica(bytesExeDisfrazado), null, 'Seguridad: Rechaza ejecutable MZ disfrazado de documento');

        const bytesJpgValidos = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
        afirmarIgualdad(Dominio.detectarFirmaMagica(bytesJpgValidos)?.mime, 'image/jpeg', 'Seguridad: Detecta firma mágica de JPEG');

        const bytesPngValidos = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        afirmarIgualdad(Dominio.detectarFirmaMagica(bytesPngValidos)?.mime, 'image/png', 'Seguridad: Detecta firma mágica de PNG');

        // 13.3 Auditoría profunda de estructura PDF y vectores de ataque activos
        const pdfGenuinoStr = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
        const bytesPdfGenuino = new Uint8Array(pdfGenuinoStr.split('').map(ch => ch.charCodeAt(0)));
        const resPdfGenuino = Dominio.auditarEstructuraPdf(bytesPdfGenuino);
        afirmarIgualdad(resPdfGenuino.valido, true, 'Seguridad: Aprueba PDF estructuralmente íntegro y limpio');

        const pdfMaliciosoJsStr = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Names << /JavaScript 2 0 R >> >>\nendobj\ntrailer\n%%EOF';
        const bytesPdfMaliciosoJs = new Uint8Array(pdfMaliciosoJsStr.split('').map(ch => ch.charCodeAt(0)));
        const resPdfMaliciosoJs = Dominio.auditarEstructuraPdf(bytesPdfMaliciosoJs);
        afirmarIgualdad(resPdfMaliciosoJs.valido, false, 'Seguridad: Bloquea PDF con payload /JavaScript activo');

        const pdfMaliciosoLaunchStr = '%PDF-1.7\n1 0 obj\n<< /Action << /S /Launch /F (calc.exe) >> >>\nendobj\ntrailer\n%%EOF';
        const bytesPdfMaliciosoLaunch = new Uint8Array(pdfMaliciosoLaunchStr.split('').map(ch => ch.charCodeAt(0)));
        const resPdfMaliciosoLaunch = Dominio.auditarEstructuraPdf(bytesPdfMaliciosoLaunch);
        afirmarIgualdad(resPdfMaliciosoLaunch.valido, false, 'Seguridad: Bloquea PDF con acción ejecutable /Launch');

        const pdfTruncadoStr = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer';
        const bytesPdfTruncado = new Uint8Array(pdfTruncadoStr.split('').map(ch => ch.charCodeAt(0)));
        const resPdfTruncado = Dominio.auditarEstructuraPdf(bytesPdfTruncado);
        afirmarIgualdad(resPdfTruncado.valido, false, 'Seguridad: Bloquea PDF incompleto sin marcador %%EOF');

        // 13.4 Detección de bomba de descompresión (Pixel Flood) en imágenes
        const pngBombBytes = new Uint8Array(32);
        pngBombBytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
        pngBombBytes.set([0x00, 0x00, 0x00, 0x0D], 8);
        pngBombBytes.set([0x49, 0x48, 0x44, 0x52], 12);
        pngBombBytes[18] = 0x75; pngBombBytes[19] = 0x30;
        pngBombBytes[22] = 0x75; pngBombBytes[23] = 0x30;
        const resPngBomb = Dominio.auditarDimensionesImagen(pngBombBytes, 'image/png');
        afirmarIgualdad(resPngBomb.valido, false, 'Seguridad: Detecta bomba de descompresión PNG (30,000 x 30,000 px)');

        // 14. Sellos Criptográficos de Integridad y Autenticidad (HMAC-SHA256 Digital Envelope)
        const datosPruebaRespaldo = {
            medicamentos: [
                { codigo: '7461234567890', nombre: 'Amoxicilina 500mg', precio: 350.50 }
            ],
            total: 350.50
        };
        const sobreFirmado = Dominio.firmarSobreDatos(datosPruebaRespaldo, 'respaldo-farmacia-completo');
        const verifLegitima = Dominio.verificarSobreDatos(sobreFirmado, 'respaldo-farmacia-completo');
        afirmarIgualdad(verifLegitima.esValido, true, 'Cripto: Verifica sobre sellado legítimo de Chroniris OS');
        afirmarIgualdad(verifLegitima.datos.total, 350.50, 'Cripto: Recupera datos íntegros del payload');

        // 14.1 Detección de adulteración (Tampering)
        const sobreAlterado = JSON.parse(JSON.stringify(sobreFirmado));
        sobreAlterado.datos.total = 50.00;
        const verifAlterada = Dominio.verificarSobreDatos(sobreAlterado);
        afirmarIgualdad(verifAlterada.esValido, false, 'Cripto: Detecta manipulación en los datos del respaldo');
        afirmarIgualdad(verifAlterada.codigo, 'INTEGRIDAD_COMPROMETIDA', 'Cripto: Código INTEGRIDAD_COMPROMETIDA por huella rota');

        // 14.2 Detección de firma falsa
        const sobreFirmaFalsa = JSON.parse(JSON.stringify(sobreFirmado));
        sobreFirmaFalsa._chroniris_sello.firmaHmac = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        const verifFirmaFalsa = Dominio.verificarSobreDatos(sobreFirmaFalsa);
        afirmarIgualdad(verifFirmaFalsa.esValido, false, 'Cripto: Rechaza firma HMAC espuria');
        afirmarIgualdad(verifFirmaFalsa.codigo, 'FIRMA_INVALIDA', 'Cripto: Código FIRMA_INVALIDA');

        // 14.3 Detección de archivo no firmado
        const archivoSinFirma = { medicamentos: [] };
        const verifSinFirma = Dominio.verificarSobreDatos(archivoSinFirma);
        afirmarIgualdad(verifSinFirma.esValido, false, 'Cripto: Rechaza archivo sin sello criptográfico');
        afirmarIgualdad(verifSinFirma.codigo, 'SOBRE_NO_FIRMADO', 'Cripto: Código SOBRE_NO_FIRMADO');

        // 15. Blindaje de Límites de Campos y Sanitización contra Inyecciones
        const vPrecioAstronomico = Dominio.validarPrecioCompra('60000000');
        afirmarIgualdad(vPrecioAstronomico.esValido, false, 'Campos: Rechaza precio astronómico que excede límite ($50M)');

        const vCajasAstronomico = Dominio.validarCantidadEnteraPositiva('200000', 'cajas');
        afirmarIgualdad(vCajasAstronomico.esValido, false, 'Campos: Rechaza cantidad que excede límite (100k cajas)');

        const textoConXss = 'Medicamento <script>alert(1)</script>\x00\x1F';
        const textoLimpio = Dominio.sanitizarEntradaTexto(textoConXss, 30);
        afirmarIgualdad(textoLimpio.includes('\x00'), false, 'Campos: Elimina bytes nulos');
        afirmarIgualdad(textoLimpio.length <= 30, true, 'Campos: Respeta longitud máxima del campo');

        // 16. Búsqueda Fonética Difusa Farmacéutica (Fuzzy Search & Levenshtein)
        const mockCatalogoFuzzy = {
            '746001': {
                codigoBarras: '746001',
                nombre: 'Amoxicilina 500mg Comprimidos',
                nombreComercial: 'Amoxil',
                principioActivo: 'Amoxicilina',
                laboratorio: 'GlaxoSmithKline',
                ultimoPrecioCaja: 320
            },
            '746002': {
                codigoBarras: '746002',
                nombre: 'Acetaminofén 500mg Tabletas',
                nombreComercial: 'Tylenol',
                principioActivo: 'Paracetamol',
                laboratorio: 'Johnson & Johnson',
                ultimoPrecioCaja: 150
            },
            '746003': {
                codigoBarras: '746003',
                nombre: 'Losartán Potásico 50mg',
                nombreComercial: 'Losartán 50mg',
                principioActivo: 'Losartán Potásico',
                laboratorio: 'Sued Farmacéutica',
                ultimoPrecioCaja: 285
            }
        };

        // 16.1 Tolerancia a errores tipográficos fonéticos ("amoxisilina" -> Amoxicilina)
        const resFuzzy1 = Dominio.buscarEnCatalogoFuzzy('amoxisilina', mockCatalogoFuzzy);
        afirmarIgualdad(resFuzzy1.length > 0, true, 'Fuzzy: Encuentra medicamento con falta ortográfica típica');
        afirmarIgualdad(resFuzzy1[0].codigoBarras, '746001', 'Fuzzy: Resuelve código correcto para Amoxicilina');

        // 16.2 Búsqueda por Principio Activo ("paracetamol" -> Acetaminofén)
        const resFuzzy2 = Dominio.buscarEnCatalogoFuzzy('paracetamol', mockCatalogoFuzzy);
        afirmarIgualdad(resFuzzy2.length > 0, true, 'Fuzzy: Encuentra producto por Principio Activo cruzado');
        afirmarIgualdad(resFuzzy2[0].codigoBarras, '746002', 'Fuzzy: Resuelve Acetaminofén desde Paracetamol');

        // 16.3 Búsqueda por Laboratorio ("sued" -> Losartán de Sued)
        const resFuzzy3 = Dominio.buscarEnCatalogoFuzzy('sued', mockCatalogoFuzzy);
        afirmarIgualdad(resFuzzy3.length > 0, true, 'Fuzzy: Encuentra producto por fabricante/laboratorio');
        afirmarIgualdad(resFuzzy3[0].codigoBarras, '746003', 'Fuzzy: Resuelve producto de Sued');

        // 17. Radar de Variación de Costos y Alzas de Precios
        const alza20 = Dominio.calcularVariacionCostoPorcentaje(360, 300);
        afirmarIgualdad(alza20, 20, 'Radar: Calcula alza de costo del +20% con exactitud');

        const baja5 = Dominio.calcularVariacionCostoPorcentaje(285, 300);
        afirmarIgualdad(baja5, -5, 'Radar: Calcula reducción de costo del -5% con exactitud');

        const primerIngreso = Dominio.calcularVariacionCostoPorcentaje(300, 0);
        afirmarIgualdad(primerIngreso, 0, 'Radar: Sin variación en primer ingreso sin costo previo');

        // 18. Exportador Sanitario Público de Catálogo Maestro (CSV Purgado + Anti-Inyección de Fórmulas)
        const mockDictCsv = {
            '746001': {
                codigoBarras: '746001',
                nombre: 'Amoxil 500mg',
                nombreComercial: 'Amoxil',
                principioActivo: 'Amoxicilina',
                concentracion: '500mg',
                formaFarmaceutica: 'Cápsulas',
                presentacion: 'Caja x 30',
                laboratorio: 'GlaxoSmithKline',
                categoria: 'Antibióticos',
                proveedorHabitual: 'Droguería Betances',
                rncProveedor: '101023456',
                tipo: 'divisible',
                unidadesPorCaja: 30,
                ultimoPrecioCaja: 360,
                costoAnteriorCaja: 300,
                variacionCosto: 20,
                costoUnitarioFiscal: '12.00000000',
                preciosVenta: { p1Exacto: '15.60', p2Exacto: '14.80', p3Exacto: '14.00' },
                historialCostos: [{ fecha: '2024-01-15', costoCaja: 360 }],
                aplicaItbis: false,
                tasaItbis: 0,
                esLeche: false,
                condicionVenta: 'Receta Médica',
                registroSanitario: 'RD-12345',
                ubicacion: 'Tramo A-2'
            },
            '746002': {
                codigoBarras: '746002',
                nombre: '=SUM(A1)',
                principioActivo: '+cmd',
                laboratorio: '-TestLab',
                categoria: '@alert'
            }
        };

        const csvGenerado = Dominio.generarCsvCatalogoMaestro(mockDictCsv);
        const encabezadoCsv = csvGenerado.split(/\r?\n/)[0];
        afirmarIgualdad(encabezadoCsv.includes('codigo_barras,nombre,nombre_comercial,principio_activo'), true, 'CSV Público: Encabezados sanitarios normalizados');
        afirmarIgualdad(encabezadoCsv.includes('proveedor_habitual') || encabezadoCsv.includes('rnc_proveedor') || encabezadoCsv.includes('ultimo_costo_caja'), false, 'CSV Público: Encabezados excluyen columnas comerciales privadas');
        afirmarIgualdad(csvGenerado.includes('"Amoxil 500mg"'), true, 'CSV Público: Fila de producto sanitario preservada');
        afirmarIgualdad(csvGenerado.includes('"GlaxoSmithKline"'), true, 'CSV Público: Preservación de laboratorio');
        afirmarIgualdad(csvGenerado.includes('"Droguería Betances"'), false, 'CSV Público: Purga proveedor habitual');
        afirmarIgualdad(csvGenerado.includes('101023456'), false, 'CSV Público: Purga RNC del proveedor');
        afirmarIgualdad(csvGenerado.includes('12.00000000'), false, 'CSV Público: Purga costo unitario fiscal');
        afirmarIgualdad(csvGenerado.includes('360.00'), false, 'CSV Público: Purga último costo por caja');
        afirmarIgualdad(csvGenerado.includes('20.00%'), false, 'CSV Público: Purga variación de costo');
        afirmarIgualdad(csvGenerado.includes('15.60'), false, 'CSV Público: Purga precios de venta');
        afirmarIgualdad(csvGenerado.includes('ultimoPrecioCaja') || csvGenerado.includes('historialCostos') || csvGenerado.includes('proveedorHabitual') || csvGenerado.includes('2024-01-15'), false, 'CSV Público: Purga historial y claves internas');
        afirmarIgualdad(csvGenerado.includes('"\'=SUM(A1)"'), true, 'CSV Público: Neutraliza inyección de fórmula =SUM(A1)');
        afirmarIgualdad(csvGenerado.includes('"\'+cmd"') && csvGenerado.includes('"\'-TestLab"') && csvGenerado.includes('"\'@alert"'), true, 'CSV Público: Neutraliza prefijos +, - y @ en celdas CSV');


                // 19. Blindaje de Catálogo Maestro y Protección contra Sobreescritura Accidental
        // Simular un catálogo con producto oficial
        const codigoPruebaBlindaje = '7469999990011';
        const productoMaestro = {
            codigoBarras: codigoPruebaBlindaje,
            nombre: 'Amoxicilina 500mg MK Oficial',
            tipo: 'divisible',
            unidadesPorCaja: 30,
            ultimoPrecioCaja: 300,
            aplicaItbis: false
        };

        if (AppFarmacia.Almacenamiento && typeof AppFarmacia.Almacenamiento.guardarFichaProductoCatalogo === 'function') {
            AppFarmacia.Almacenamiento.guardarFichaProductoCatalogo(productoMaestro);

            // Simular que el operador casualmente escribe otro nombre en la calculadora al recibir factura
            const lineaOperador = {
                codigoBarras: codigoPruebaBlindaje,
                nombre: 'amoxi casual sobreescritura',
                tipo: 'entero',
                unidadesPorCaja: 1,
                precioCajaBase: 350,
                aplicaItbis: true
            };

            AppFarmacia.Almacenamiento.aprenderProductoEnDiccionario(lineaOperador);
            const recuperado = AppFarmacia.Almacenamiento.buscarProductoPorCodigo(codigoPruebaBlindaje);

            const nombreEsperado = (Dominio && typeof Dominio.normalizarNombreProductoMayusculas === 'function')
                ? Dominio.normalizarNombreProductoMayusculas('Amoxicilina 500mg MK Oficial')
                : 'Amoxicilina 500mg MK Oficial';
            afirmarIgualdad(recuperado.nombre, nombreEsperado, 'Blindaje: Preserva nombre oficial e impide sobreescritura casual');
            afirmarIgualdad(recuperado.tipo, 'divisible', 'Blindaje: Preserva empaque divisible oficial');
            afirmarIgualdad(recuperado.unidadesPorCaja, 30, 'Blindaje: Preserva unidades por caja oficiales (30)');
            afirmarIgualdad(recuperado.ultimoPrecioCaja, 350, 'Blindaje: Actualiza costo de compra correctamente (350)');
            afirmarIgualdad(recuperado.costoAnteriorCaja, 300, 'Blindaje: Registra costo anterior de compra (300)');

            // Edición deliberada desde Catálogo / Ajustes
            const edicionDeliberada = {
                codigoBarras: codigoPruebaBlindaje,
                nombre: 'Amoxicilina 500mg MK Ficha Editada',
                categoria: 'Antibiótico / Betalactámico',
                principioActivo: 'Amoxicilina Trihidrato'
            };
            AppFarmacia.Almacenamiento.guardarFichaProductoCatalogo(edicionDeliberada);
            const recuperadoEditado = AppFarmacia.Almacenamiento.buscarProductoPorCodigo(codigoPruebaBlindaje);
            const nombreEditadoEsperado = (Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function')
                ? Dominio.estandarizarNombreFarmaceutico('Amoxicilina 500mg MK Ficha Editada')
                : 'Amoxicilina 500mg MK Ficha Editada';
            afirmarIgualdad(recuperadoEditado.nombre, nombreEditadoEsperado, 'Catálogo: Permite actualización deliberada desde ficha de catálogo');
            afirmarIgualdad(recuperadoEditado.categoria, 'Antibiótico / Betalactámico', 'Catálogo: Guarda categoría terapéutica');

            // Limpieza
            AppFarmacia.Almacenamiento.eliminarCodigoDeDiccionario(codigoPruebaBlindaje);
        }

        // 20. Organización Determinística por Categoría y Nombre Ascendente (A-Z)
        const listaDesordenada = [
            { nombre: 'Omeprazol 20mg', categoria: 'Gastrointestinal' },
            { nombre: 'Acetaminofén 500mg', categoria: 'Analgésico / Antipirético' },
            { nombre: 'Ibuprofeno 400mg', categoria: 'Analgésico / Antipirético' },
            { nombre: 'Amlodipina 5mg', categoria: 'Cardiovascular' },
            { nombre: 'Alcohol 70%', categoria: 'General / Otros' }
        ];

        listaDesordenada.sort((a, b) => {
            const catA = (a.categoria || 'General / Otros').trim();
            const catB = (b.categoria || 'General / Otros').trim();
            const cmpCat = catA.localeCompare(catB, 'es', { sensitivity: 'base' });
            if (cmpCat !== 0) return cmpCat;
            return a.nombre.trim().localeCompare(b.nombre.trim(), 'es', { sensitivity: 'base' });
        });

        afirmarIgualdad(listaDesordenada[0].nombre, 'Acetaminofén 500mg', 'Orden Catálogo: Primer producto es Acetaminofén en Analgésicos');
        afirmarIgualdad(listaDesordenada[1].nombre, 'Ibuprofeno 400mg', 'Orden Catálogo: Segundo producto es Ibuprofeno en Analgésicos');
        afirmarIgualdad(listaDesordenada[2].nombre, 'Amlodipina 5mg', 'Orden Catálogo: Tercero es Amlodipina en Cardiovascular');
        afirmarIgualdad(listaDesordenada[3].nombre, 'Omeprazol 20mg', 'Orden Catálogo: Cuarto es Omeprazol en Gastrointestinal');
        afirmarIgualdad(listaDesordenada[4].nombre, 'Alcohol 70%', 'Orden Catálogo: Quinto es Alcohol en General / Otros');

        // 21. Radar de Variación e Inflación de Costos de Droguerías (EGM Feature 1)
        const alzaTest = Dominio.analizarVariacionCosto(108.50, 100);
        afirmarIgualdad(alzaTest.tieneHistorial, true, 'Radar Costo: Detecta historial existente');
        afirmarIgualdad(alzaTest.porcentaje, 8.5, 'Radar Costo: Calcula +8.50% de variación');
        afirmarIgualdad(alzaTest.esAlza, true, 'Radar Costo: Identifica alza de costo');
        afirmarIgualdad(alzaTest.esAlertaCritica, true, 'Radar Costo: Activa alerta crítica por incremento >= 5%');
        afirmarIgualdad(alzaTest.diferenciaMonto, 8.5, 'Radar Costo: Monto de diferencia exacto (+8.50)');

        const bajaTest = Dominio.analizarVariacionCosto(95, 100);
        afirmarIgualdad(bajaTest.esBaja, true, 'Radar Costo: Identifica reducción de costo (-5%)');
        afirmarIgualdad(bajaTest.porcentaje, -5, 'Radar Costo: Porcentaje negativo');
        afirmarIgualdad(bajaTest.esAlertaCritica, false, 'Radar Costo: No es alerta crítica');

        const igualTest = Dominio.analizarVariacionCosto(100, 100);
        afirmarIgualdad(igualTest.direccion, 'IGUAL', 'Radar Costo: Detecta paridad exacta de costo');

        const sinHistorialTest = Dominio.analizarVariacionCosto(150, 0);
        afirmarIgualdad(sinHistorialTest.tieneHistorial, false, 'Radar Costo: Maneja producto sin historial previo');

        // 22. Exportador Fiscal Oficial DGII Formato 606 en 23 Columnas (EGM Feature 2)
        const mockFacturas606 = [
            {
                id: 'fac_606_01',
                proveedor: 'Droguería Betances',
                rnc: '101001559',
                numeroFactura: 'B0100000045',
                fechaEmision: '2026-11-05',
                totalFisico: 1180,
                productos: [
                    Dominio.crearLineaProductoInmutable({
                        codigoBarras: '7461234567890',
                        nombre: 'Alcohol Isopropílico 70%',
                        tipo: 'entero',
                        precioCajaBase: 1000,
                        cajasCompradas: 1,
                        unidadesPorCaja: 1,
                        aplicaItbis: true,
                        tasaItbis: 18
                    })
                ]
            },
            {
                id: 'fac_606_02',
                proveedor: 'Laboratorios Feltrex',
                rnc: '101012345',
                numeroFactura: 'E310000000123',
                fechaEmision: '2026-11-06',
                totalFisico: 500,
                productos: [
                    Dominio.crearLineaProductoInmutable({
                        codigoBarras: '7469876543210',
                        nombre: 'Amoxicilina 500mg Exenta',
                        tipo: 'divisible',
                        precioCajaBase: 500,
                        cajasCompradas: 1,
                        unidadesPorCaja: 20,
                        aplicaItbis: false
                    })
                ]
            }
        ];

        const res606 = Dominio.generarTextoFormato606(mockFacturas606, '130999999', '202611');
        afirmarIgualdad(res606.exito, true, 'Formato 606: Generación exitosa de archivo');
        afirmarIgualdad(res606.totalFacturas, 2, 'Formato 606: Procesa 2 comprobantes fiscales (B01 y E31)');
        afirmarIgualdad(res606.nombreArchivo, 'DGII_606_202611.txt', 'Formato 606: Nombre de archivo estándar DGII');

        const lineas606 = res606.texto606.split('\r\n');
        afirmarIgualdad(lineas606.length, 2, 'Formato 606: Genera exactamente 2 líneas de datos');

        const columnasL1 = lineas606[0].split('|');
        afirmarIgualdad(columnasL1.length, 23, 'Formato 606: Estructura canónica de exactamente 23 columnas');
        afirmarIgualdad(columnasL1[0], '101001559', 'Formato 606: RNC proveedor en columna 1');
        afirmarIgualdad(columnasL1[1], '1', 'Formato 606: Tipo ID RNC Persona Jurídica (1)');
        afirmarIgualdad(columnasL1[2], '09', 'Formato 606: Tipo Bienes 09 (Costo de venta farmacia)');
        afirmarIgualdad(columnasL1[3], 'B0100000045', 'Formato 606: NCF B01 preservado');
        afirmarIgualdad(columnasL1[5], '20261105', 'Formato 606: Fecha AAAAMMDD');
        afirmarIgualdad(columnasL1[8], '1000.00', 'Formato 606: Monto facturado en bienes (1000.00)');
        afirmarIgualdad(columnasL1[10], '180.00', 'Formato 606: ITBIS facturado (180.00)');
        afirmarIgualdad(columnasL1[14], '180.00', 'Formato 606: ITBIS llevado a adelantar (180.00)');

        const columnasL2 = lineas606[1].split('|');
        afirmarIgualdad(columnasL2[3], 'E310000000123', 'Formato 606: Soporte de comprobante electrónico e-CF E31');
        afirmarIgualdad(columnasL2[8], '500.00', 'Formato 606: Medicamento exento en bienes (500.00)');
        afirmarIgualdad(columnasL2[10], '0.00', 'Formato 606: Medicamento exento ITBIS 0.00 (DGII Art. 343)');

        // Rechazo de facturas sin comprobante fiscal válido
        const resVacio = Dominio.generarTextoFormato606([{ productos: [{}] }], '130999999');
        afirmarIgualdad(resVacio.exito, false, 'Formato 606: Rechaza lote sin comprobantes fiscales válidos');

        // 23. Semáforo FEFO de Lote, Vencimiento y Parser GS1 DataMatrix 2D (EGM Feature 3)
        // Umbral configurable de alerta de inflación en radar de costo
        const alzaConUmbralPersonalizado = Dominio.analizarVariacionCosto(108, 100, 10);
        afirmarIgualdad(alzaConUmbralPersonalizado.esAlertaCritica, false, 'Radar Costo: Con umbral 10%, un alza de 8% no es alerta crítica');

        const alzaSuperaUmbralPersonalizado = Dominio.analizarVariacionCosto(112, 100, 10);
        afirmarIgualdad(alzaSuperaUmbralPersonalizado.esAlertaCritica, true, 'Radar Costo: Con umbral 10%, un alza de 12% sí es alerta crítica');

        // Semáforo FEFO con fecha de referencia fija (8 de Noviembre de 2026)
        const fechaBaseRef = new Date(2026, 10, 8);

        // Vencido
        const fefoVencido = Dominio.evaluarSemaforoFefo('2026-10-15', fechaBaseRef);
        afirmarIgualdad(fefoVencido.esVencido, true, 'Semáforo FEFO: Detecta producto vencido');
        afirmarIgualdad(fefoVencido.estado, Dominio.ESTADOS_FEFO.VENCIDO, 'Semáforo FEFO: Estado VENCIDO');

        // Crítico (< 90 días) -> 30 días al 8 de Dic 2026
        const fefoCritico = Dominio.evaluarSemaforoFefo('2026-12-08', fechaBaseRef);
        afirmarIgualdad(fefoCritico.esCritico, true, 'Semáforo FEFO: Detecta riesgo sanitario crítico (< 90 días)');
        afirmarIgualdad(fefoCritico.estado, Dominio.ESTADOS_FEFO.CRITICO_90D, 'Semáforo FEFO: Estado CRITICO_90D');

        // Alerta preventiva (entre 91 y 180 días) -> ~120 días al 8 de Marzo 2027
        const fefoAlerta = Dominio.evaluarSemaforoFefo('2027-03-08', fechaBaseRef);
        afirmarIgualdad(fefoAlerta.estado, Dominio.ESTADOS_FEFO.ALERTA_180D, 'Semáforo FEFO: Estado ALERTA_180D para venta prioritaria');
        afirmarIgualdad(fefoAlerta.esVencido, false, 'Semáforo FEFO: Alerta 180D no está vencido');

        // Óptimo (> 180 días) -> Vence a finales de 2027
        const fefoOptimo = Dominio.evaluarSemaforoFefo('2027-11-08', fechaBaseRef);
        afirmarIgualdad(fefoOptimo.estado, Dominio.ESTADOS_FEFO.OPTIMO, 'Semáforo FEFO: Estado OPTIMO con caducidad lejana');

        // Entrada vacía
        const fefoVacio = Dominio.evaluarSemaforoFefo('');
        afirmarIgualdad(fefoVacio.estado, Dominio.ESTADOS_FEFO.SIN_FECHA, 'Semáforo FEFO: Maneja fecha vacía sin romper estado');

        // Parser GS1 DataMatrix 2D con paréntesis: (01)GTIN(17)AAMMDD(10)LOTE
        const rawDmParen = '(01)07461234567890(17)271231(10)LT9942A';
        const parsedDm1 = Dominio.parsearCodigoGs1DataMatrix(rawDmParen);
        afirmarIgualdad(parsedDm1.esGs1, true, 'Parser GS1 DataMatrix: Reconoce identificadores de aplicación con paréntesis');
        afirmarIgualdad(parsedDm1.gtin, '07461234567890', 'Parser GS1 DataMatrix: Extrae GTIN-14');
        afirmarIgualdad(parsedDm1.gtinNormalizado, '7461234567890', 'Parser GS1 DataMatrix: Normaliza GTIN a 13 dígitos para catálogo');
        afirmarIgualdad(parsedDm1.vencimiento, '2027-12-31', 'Parser GS1 DataMatrix: Convierte fecha YYMMDD a formato ISO YYYY-MM-DD');
        afirmarIgualdad(parsedDm1.lote, 'LT9942A', 'Parser GS1 DataMatrix: Extrae Lote alfanumérico');

        // Parser GS1 DataMatrix 2D flujo continuo sin paréntesis
        const rawDmContinuo = '01074612345678901726051510LOTE-K7';
        const parsedDm2 = Dominio.parsearCodigoGs1DataMatrix(rawDmContinuo);
        afirmarIgualdad(parsedDm2.esGs1, true, 'Parser GS1 DataMatrix: Reconoce flujo continuo sin paréntesis');
        afirmarIgualdad(parsedDm2.vencimiento, '2026-05-15', 'Parser GS1 DataMatrix: Extrae fecha en flujo continuo');
        afirmarIgualdad(parsedDm2.lote, 'LOTE-K7', 'Parser GS1 DataMatrix: Extrae Lote en flujo continuo');

        // Código 1D estándar
        const parsed1D = Dominio.parsearCodigoGs1DataMatrix('7461234567890');
        afirmarIgualdad(parsed1D.esGs1, false, 'Parser GS1 DataMatrix: Identifica que código 1D estándar no es 2D DataMatrix');

        // Integración inmutable de línea de producto con FEFO
        const prodFefoLinea = Dominio.crearLineaProductoInmutable({
            codigoBarras: '7461234567890',
            nombre: 'Ceftriaxona 1g IV',
            tipo: 'divisible',
            precioCajaBase: 450,
            cajasCompradas: 2,
            unidadesPorCaja: 10,
            lote: 'L-2026-X',
            fechaVencimiento: '2027-12-31'
        });
        afirmarIgualdad(prodFefoLinea.lote, 'L-2026-X', 'Línea Inmutable: Preserva Lote sanitario');
        afirmarIgualdad(prodFefoLinea.fechaVencimiento, '2027-12-31', 'Línea Inmutable: Preserva Fecha de Vencimiento');
        afirmarIgualdad(typeof prodFefoLinea.estadoFefo, 'string', 'Línea Inmutable: Calcula estado FEFO en la línea');

        // 24. Fusión Diferencial Inteligente de Catálogo entre Cajas (EGM Smart Delta)
        const dicLocalMock = {
            '7461111111111': {
                codigoBarras: '7461111111111',
                nombre: 'Paracetamol 500mg',
                ultimoPrecioCaja: 150,
                ubicacion: 'Pasillo 1 - Estante A',
                actualizadoEn: '2026-11-01T10:00:00.000Z',
                historialCostos: [
                    { fecha: '2026-11-01', precioCaja: 150, proveedor: 'Betances' }
                ]
            },
            '7462222222222': {
                codigoBarras: '7462222222222',
                nombre: 'Ibuprofeno 400mg',
                ultimoPrecioCaja: 200,
                ubicacion: 'Pasillo 2',
                actualizadoEn: '2026-11-05T12:00:00.000Z'
            }
        };

        const dicEntranteMock = {
            // Producto preexistente con precio más nuevo e historial diferente
            '7461111111111': {
                codigoBarras: '7461111111111',
                nombre: 'Paracetamol 500mg Genérico',
                ultimoPrecioCaja: 165,
                ubicacion: '', // vacío en la otra máquina
                actualizadoEn: '2026-11-08T15:00:00.000Z',
                historialCostos: [
                    { fecha: '2026-11-08', precioCaja: 165, proveedor: 'Farach' }
                ]
            },
            // Producto totalmente nuevo en la Caja 2
            '7463333333333': {
                codigoBarras: '7463333333333',
                nombre: 'Amoxicilina 500mg',
                ultimoPrecioCaja: 320,
                actualizadoEn: '2026-11-08T16:00:00.000Z',
                historialCostos: [
                    { fecha: '2026-11-08', precioCaja: 320, proveedor: 'Rowe' }
                ]
            }
        };

        const resFusion = Dominio.fusionarDiccionarios(dicLocalMock, dicEntranteMock, { modo: 'fusion' });
        afirmarIgualdad(resFusion.estadisticas.agregados, 1, 'Fusión Inteligente: Agrega exactamente 1 producto nuevo');
        afirmarIgualdad(resFusion.estadisticas.actualizados, 1, 'Fusión Inteligente: Actualiza exactamente 1 producto en conflicto');
        afirmarIgualdad(resFusion.estadisticas.conservados, 1, 'Fusión Inteligente: Conserva intacto el producto exclusivo de la PC local');
        afirmarIgualdad(resFusion.estadisticas.totalFinal, 3, 'Fusión Inteligente: Total de 3 fármacos sin pérdidas');

        const prodFusionado = resFusion.diccionarioFusionado['7461111111111'];
        afirmarIgualdad(prodFusionado.ultimoPrecioCaja, 165, 'Fusión Inteligente: Adopta precio más reciente');
        afirmarIgualdad(prodFusionado.ubicacion, 'Pasillo 1 - Estante A', 'Fusión Inteligente: Preserva ubicación física de estante local');
        afirmarIgualdad(prodFusionado.historialCostos.length, 2, 'Fusión Inteligente: Combina los historiales de compra sin duplicados');

        // Prueba de sobre de intercambio (Smart Delta Sobre - Purga en Caliente)
        const sobreGenerado = Dominio.generarSobreParcheCatalogo(dicLocalMock);
        afirmarIgualdad(sobreGenerado.tipo, 'parche-farmacia-catalogo', 'Sobre de Intercambio: Tipo estándar parche-farmacia-catalogo');
        afirmarIgualdad(sobreGenerado.resumen.totalProductos, 2, 'Sobre de Intercambio: Registra conteo correcto en resumen');
        afirmarIgualdad(sobreGenerado.resumen.sanitizadoPublico, true, 'Sobre de Intercambio: Marca bandera sanitizadoPublico');

        const dicLocalConPrivados = {
            '746888': {
                codigoBarras: '746888',
                nombre: 'Ibuprofeno 400mg',
                principioActivo: 'Ibuprofeno',
                laboratorio: 'LabLocal',
                ultimoPrecioCaja: 450,
                costoAnteriorCaja: 400,
                variacionCosto: 12.5,
                costoUnitarioFiscal: '15.00000000',
                preciosVenta: { p1Exacto: '19.50', p2Exacto: '18.50', p3Exacto: '17.50' },
                historialCostos: [{ fecha: '2024-05-01', costoCaja: 450 }],
                proveedorHabitual: 'Droguería Betances',
                rncProveedor: '101023456',
                _segCifrado: { _segCifrado: true, v: 1, alg: 'AES-256-GCM', iv: 'iv', ct: 'secreto' }
            }
        };
        const sobrePrivado = Dominio.generarSobreParcheCatalogo(dicLocalConPrivados);
        const sobreJsonStr = JSON.stringify(sobrePrivado);
        afirmarIgualdad(sobreJsonStr.includes('Ibuprofeno 400mg') && sobreJsonStr.includes('LabLocal'), true, 'Sobre de Intercambio: Conserva ficha sanitaria pública');
        afirmarIgualdad(
            sobreJsonStr.includes('Droguería Betances') ||
            sobreJsonStr.includes('101023456') ||
            sobreJsonStr.includes('ultimoPrecioCaja') ||
            sobreJsonStr.includes('historialCostos') ||
            sobreJsonStr.includes('proveedorHabitual') ||
            sobreJsonStr.includes('15.00000000') ||
            sobreJsonStr.includes('19.50') ||
            sobreJsonStr.includes('_segCifrado'),
            false,
            'Sobre de Intercambio: Purga costos, historial, proveedores, precios y blobs cifrados'
        );

        const parchePublicoEntrante = {
            '746888': {
                codigoBarras: '746888',
                nombre: 'Ibuprofeno 400mg Caja x 30',
                principioActivo: 'Ibuprofeno'
            }
        };
        const resFusionPriv = Dominio.fusionarDiccionarios(dicLocalConPrivados, parchePublicoEntrante, { modo: 'fusion' });
        const fichaTrasFusion = resFusionPriv.diccionarioFusionado['746888'];
        afirmarIgualdad(fichaTrasFusion.nombre, 'Ibuprofeno 400mg Caja x 30', 'Fusión Sanitaria: Actualiza campo sanitario desde parche público');
        afirmarIgualdad(fichaTrasFusion.ultimoPrecioCaja, 450, 'Fusión Sanitaria: Preserva último costo local sin sobrescribir');
        afirmarIgualdad(Array.isArray(fichaTrasFusion.historialCostos) && fichaTrasFusion.historialCostos[0].costoCaja === 450, true, 'Fusión Sanitaria: Preserva historialCostos local');
        afirmarIgualdad(fichaTrasFusion.proveedorHabitual, 'Droguería Betances', 'Fusión Sanitaria: Preserva proveedor local');
        afirmarIgualdad(Boolean(fichaTrasFusion._segCifrado && fichaTrasFusion._segCifrado.ct === 'secreto'), true, 'Fusión Sanitaria: Preserva sobre _segCifrado local intacto');


                // 27. Macro-Categorización Farmacéutica EGM (Rol 01 / UX)
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Antibiótico Fluoroquinolona'), 'Antibióticos', 'MacroCat: Fluoroquinolona -> Antibióticos');
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Antibióticos Macrólidos'), 'Antibióticos', 'MacroCat: Macrólidos -> Antibióticos');
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Antidiabético Oral'), 'Antidiabéticos', 'MacroCat: Antidiabético Oral -> Antidiabéticos');
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Cardiovascular / Antihipertensivo'), 'Cardiovascular & Hipertensión', 'MacroCat: Antihipertensivo -> Cardiovascular & Hipertensión');
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Analgésico / Antipirético'), 'Analgésicos & Antiinflamatorios', 'MacroCat: Antipirético -> Analgésicos & Antiinflamatorios');
        afirmarIgualdad(Dominio.obtenerMacroCategoria('Fórmulas Infantiles / Leches'), 'Pediatría & Cuidado Infantil', 'MacroCat: Fórmulas -> Pediatría & Cuidado Infantil');

        // 28. Preservación y Ciclo de Tasa ITBIS (Exento 0% -> 18% -> 16%)
        const prodExento = Dominio.crearLineaProductoInmutable({
            nombre: 'Amoxicilina 500mg',
            tipo: 'divisible',
            cajasCompradas: 2,
            precioCajaBase: 100,
            unidadesPorCaja: 10,
            aplicaItbis: false,
            tasaItbis: 0
        });
        afirmarIgualdad(prodExento.aplicaItbis, false, 'ITBIS 0%: aplicaItbis es false');
        afirmarIgualdad(prodExento.tasaItbis, 0, 'ITBIS 0%: tasaItbis es 0');
        afirmarIgualdad(prodExento.montoItbisLinea, 0, 'ITBIS 0%: montoItbisLinea es 0');

        const prodGravado18 = Dominio.crearLineaProductoInmutable({
            ...prodExento,
            aplicaItbis: true,
            tasaItbis: 18
        });
        afirmarIgualdad(prodGravado18.aplicaItbis, true, 'ITBIS 18%: aplicaItbis es true');
        afirmarIgualdad(prodGravado18.tasaItbis, 18, 'ITBIS 18%: tasaItbis es 18');
        afirmarIgualdad(prodGravado18.montoItbisLinea, 36, 'ITBIS 18%: montoItbisLinea es $36.00');

        const prodGravado16 = Dominio.crearLineaProductoInmutable({
            ...prodGravado18,
            aplicaItbis: true,
            tasaItbis: 16
        });
        afirmarIgualdad(prodGravado16.aplicaItbis, true, 'ITBIS 16%: aplicaItbis es true');
        afirmarIgualdad(prodGravado16.tasaItbis, 16, 'ITBIS 16%: tasaItbis es 16');
        afirmarIgualdad(prodGravado16.montoItbisLinea, 32, 'ITBIS 16%: montoItbisLinea es $32.00');

        // 29. Estandarización Universal de Nombres Farmacéuticos (Rol 01 / EGM)
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('AMOXICILINA 500 MG'), 'Amoxicilina 500mg', 'Estandar: Mayúsculas a Title Case con 500mg');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('amoxicilina 500mg'), 'Amoxicilina 500mg', 'Estandar: Minúsculas a Title Case con 500mg');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('  ibuprofeno   400   mg  tab  '), 'Ibuprofeno 400mg Tab', 'Estandar: Colapso de espacios y forma Tab');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('METFORMINA XR 500 MG'), 'Metformina XR 500mg', 'Estandar: Preservar sigla XR en mayúsculas');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('acetaminofen 120mg / 5ml jbe'), 'Acetaminofen 120mg/5ml Jbe', 'Estandar: Concentración líquida y forma Jbe');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico('CLORURO DE SODIO 0.9 % SOLUCION'), 'Cloruro de Sodio 0.9% Solución', 'Estandar: Conectores y porcentaje con solución');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico(''), '', 'Estandar: Cadena vacía');
        afirmarIgualdad(Dominio.estandarizarNombreFarmaceutico(null), '', 'Estandar: Manejo de null');

        // 30. Micro-Sintaxis de Ofertas de Droguerías (Compradas + Bonificadas)
        const parseEstandar = Dominio.parsearExpresionCajas('10');
        afirmarIgualdad(parseEstandar.esValido, true, 'Parse Cajas 10: esValido true');
        afirmarIgualdad(parseEstandar.cajasCompradas, 10, 'Parse Cajas 10: compradas 10');
        afirmarIgualdad(parseEstandar.cajasBonificadas, 0, 'Parse Cajas 10: bonificadas 0');
        afirmarIgualdad(parseEstandar.totalCajasFisicas, 10, 'Parse Cajas 10: total 10');
        afirmarIgualdad(parseEstandar.esOferta, false, 'Parse Cajas 10: no es oferta');

        const parseOferta10Mas2 = Dominio.parsearExpresionCajas('10+2');
        afirmarIgualdad(parseOferta10Mas2.esValido, true, 'Parse Cajas 10+2: esValido true');
        afirmarIgualdad(parseOferta10Mas2.cajasCompradas, 10, 'Parse Cajas 10+2: compradas 10');
        afirmarIgualdad(parseOferta10Mas2.cajasBonificadas, 2, 'Parse Cajas 10+2: bonificadas 2');
        afirmarIgualdad(parseOferta10Mas2.totalCajasFisicas, 12, 'Parse Cajas 10+2: total 12');
        afirmarIgualdad(parseOferta10Mas2.esOferta, true, 'Parse Cajas 10+2: es oferta true');

        const parseOfertaEspacios = Dominio.parsearExpresionCajas('  5 + 1  ');
        afirmarIgualdad(parseOfertaEspacios.esValido, true, 'Parse Cajas con espacios: esValido true');
        afirmarIgualdad(parseOfertaEspacios.cajasCompradas, 5, 'Parse Cajas con espacios: compradas 5');
        afirmarIgualdad(parseOfertaEspacios.cajasBonificadas, 1, 'Parse Cajas con espacios: bonificadas 1');
        afirmarIgualdad(parseOfertaEspacios.totalCajasFisicas, 6, 'Parse Cajas con espacios: total 6');

        afirmarIgualdad(Dominio.parsearExpresionCajas('').esValido, false, 'Parse Cajas vacio: esValido false');
        afirmarIgualdad(Dominio.parsearExpresionCajas('abc').esValido, false, 'Parse Cajas texto: esValido false');
        afirmarIgualdad(Dominio.parsearExpresionCajas('-5').esValido, false, 'Parse Cajas negativo: esValido false');
        afirmarIgualdad(Dominio.parsearExpresionCajas('10+2+1').esValido, false, 'Parse Cajas multiple mas: esValido false');
        afirmarIgualdad(Dominio.parsearExpresionCajas('10+').esValido, true, 'Parse Cajas 10+: acepta con 0 bonificadas');
        afirmarIgualdad(Dominio.parsearExpresionCajas('10+').cajasBonificadas, 0, 'Parse Cajas 10+: bonificadas 0');

        // 31. Desglose de Precios con Bonificación (Oferta 10 + 2): Dilución Fiscal y Retención de Margen
        // 10 compradas a $100 + 2 bonificadas (Total: 12 cajas de 10 pastillas = 120 pastillas)
        // Total factura: 10 * $100 = $1,000.00
        // Costo Unitario Real (Diluido): 1,000 / 120 = $8.33333333
        // Costo Base PVP: $100 / 10 = $10.00000000 -> P1 = $13.00 (+30% sobre lista)
        const casoOferta10Mas2 = Dominio.calcularDesglosePrecios(100, 10, false, REGLAS_NEGOCIO_POR_DEFECTO, {
            cajasCompradas: 10,
            cajasBonificadas: 2
        });
        afirmarIgualdad(casoOferta10Mas2.subtotalFactura, 1000, 'Oferta 10+2: Subtotal factura es estrictamente $1000.00 (10 cajas)');
        afirmarIgualdad(casoOferta10Mas2.totalCajasFisicas, 12, 'Oferta 10+2: Total cajas fisicas es 12');
        afirmarIgualdad(casoOferta10Mas2.totalUnidadesFisicas, 120, 'Oferta 10+2: Total unidades fisicas es 120');
        afirmarIgualdad(casoOferta10Mas2.costoUnitario, '8.33333333', 'Oferta 10+2: Costo fiscal diluido es 8.33333333');
        afirmarIgualdad(casoOferta10Mas2.costoUnitarioVenta, '10.00000000', 'Oferta 10+2: Costo base fijacion PVP protegido en 10.00000000');
        afirmarIgualdad(casoOferta10Mas2.p1Exacto, '13.00', 'Oferta 10+2: Precio 1 de venta protegido en $13.00 (+30% sobre costo lista)');
        afirmarIgualdad(casoOferta10Mas2.esOfertaBonificacion, true, 'Oferta 10+2: Flag esOfertaBonificacion es true');

        // Línea inmutable con micro-sintaxis '10+2' embebida
        const lineaConSintaxis = Dominio.crearLineaProductoInmutable({
            nombre: 'Amoxicilina 500mg',
            tipo: 'divisible',
            cajasCompradas: '10+2',
            precioCajaBase: 100,
            unidadesPorCaja: 10,
            aplicaItbis: false
        });
        afirmarIgualdad(lineaConSintaxis.cajasCompradas, 10, 'Linea Inmutable 10+2: cajasCompradas es 10');
        afirmarIgualdad(lineaConSintaxis.cajasBonificadas, 2, 'Linea Inmutable 10+2: cajasBonificadas es 2');
        afirmarIgualdad(lineaConSintaxis.totalCajasFisicas, 12, 'Linea Inmutable 10+2: totalCajasFisicas es 12');
        afirmarIgualdad(lineaConSintaxis.totalUnidadesInventario, 120, 'Linea Inmutable 10+2: totalUnidadesInventario es 120 (Kardex real)');
        afirmarIgualdad(lineaConSintaxis.subtotalFactura, 1000, 'Linea Inmutable 10+2: subtotalFactura es $1000.00');

        // 32. Descuento Global a Pie de Factura y Cuadre Fiscal DGII
        const listaFactura = [
            Dominio.crearLineaProductoInmutable({ nombre: 'Prod A', tipo: 'divisible', cajasCompradas: 2, precioCajaBase: 500, unidadesPorCaja: 10, aplicaItbis: false }), // 1000
            Dominio.crearLineaProductoInmutable({ nombre: 'Prod B', tipo: 'divisible', cajasCompradas: 1, precioCajaBase: 500, unidadesPorCaja: 10, aplicaItbis: false })  // 500
        ];
        // Suma lineas = 1500. Descuento global a pie = $150 (o 10%). Total neto esperado = 1350
        const cuadreConDescMonto = Dominio.calcularResumenCuadreFactura(listaFactura, 1350, {
            descuentoGlobalValor: 150,
            descuentoGlobalTipo: 'monto'
        });
        afirmarIgualdad(cuadreConDescMonto.sumaAcumuladaLineas, 1500, 'Cuadre Desc Pie: Suma bruta de lineas es $1500.00');
        afirmarIgualdad(cuadreConDescMonto.montoDescuentoGlobal, 150, 'Cuadre Desc Pie: Descuento global monto es $150.00');
        afirmarIgualdad(cuadreConDescMonto.sumaAcumulada, 1350, 'Cuadre Desc Pie: Total neto calculado con descuento pie es $1350.00');
        afirmarIgualdad(cuadreConDescMonto.cuadreExacto, true, 'Cuadre Desc Pie: Factura cuadra exactamente al centavo con total fisico');

        // Descuento global porcentaje (5% de 1500 = $75 -> Total = $1425)
        const cuadreConDescPorc = Dominio.calcularResumenCuadreFactura(listaFactura, 1425, {
            descuentoGlobalValor: 5,
            descuentoGlobalTipo: 'porcentaje'
        });
        afirmarIgualdad(cuadreConDescPorc.montoDescuentoGlobal, 75, 'Cuadre Desc Porc 5%: Monto descontado es $75.00');
        afirmarIgualdad(cuadreConDescPorc.sumaAcumulada, 1425, 'Cuadre Desc Porc 5%: Total neto calculado es $1425.00');
        afirmarIgualdad(cuadreConDescPorc.cuadreExacto, true, 'Cuadre Desc Porc 5%: Cuadre exacto true');

        // 33. Normalización en Mayúsculas y Validación de Datos Mínimos de Producto (EGM / DIGEMAPS)
        afirmarIgualdad(Dominio.normalizarNombreProductoMayusculas('amoxicilina 500mg'), 'AMOXICILINA 500 MG', 'Normalizar Mayúsculas: 500mg a 500 MG');
        afirmarIgualdad(Dominio.normalizarNombreProductoMayusculas('  ibuprofeno   400   mg  tab  '), 'IBUPROFENO 400 MG TABLETAS', 'Normalizar Mayúsculas: Espacios y TABLETAS');
        afirmarIgualdad(Dominio.normalizarNombreProductoMayusculas('acetaminofen 120mg / 5ml jbe'), 'ACETAMINOFEN 120 MG / 5 ML JARABE', 'Normalizar Mayúsculas: JARABE y 120 MG / 5 ML');
        afirmarIgualdad(Dominio.normalizarNombreProductoMayusculas(''), '', 'Normalizar Mayúsculas: Vacío');

        // Validación datos mínimos: Fármaco sin concentración/unidad
        const valSinConc = Dominio.validarDatosMinimosProducto({
            nombre: 'AMOXICILINA',
            laboratorio: 'FELTREX',
            tipo: 'entero',
            aplicaItbis: false
        });
        afirmarIgualdad(valSinConc.esValido, false, 'Validar Minimos: Rechaza fármaco sin concentración');
        afirmarIgualdad(valSinConc.campo, 'concentracion', 'Validar Minimos: Campo faltante es concentracion');

        // Validación datos mínimos: Fármaco sin laboratorio
        const valSinLab = Dominio.validarDatosMinimosProducto({
            nombre: 'AMOXICILINA 500 MG',
            laboratorio: '',
            tipo: 'entero',
            aplicaItbis: false
        });
        afirmarIgualdad(valSinLab.esValido, false, 'Validar Minimos: Rechaza fármaco sin laboratorio');

        // Validación datos mínimos: Fármaco válido con concentración en nombre
        const valValido = Dominio.validarDatosMinimosProducto({
            nombre: 'AMOXICILINA 500 MG',
            laboratorio: 'FELTREX',
            tipo: 'entero',
            precioCajaBase: 150,
            aplicaItbis: false
        });
        afirmarIgualdad(valValido.esValido, true, 'Validar Minimos: Fármaco válido aprobado');

        // Validación datos mínimos: Conveniencia (no requiere concentración médica)
        const valConveniencia = Dominio.validarDatosMinimosProducto({
            nombre: 'DORITOS MEGA QUESO',
            laboratorio: 'FRITO-LAY',
            tipo: 'entero',
            precioCajaBase: 65,
            aplicaItbis: true
        });
        afirmarIgualdad(valConveniencia.esValido, true, 'Validar Minimos: Conveniencia aprobada');

        // 34. Bonificación Cruzada (Regalo a Costo $0.00 con Precios de Venta Protegidos por Costo de Referencia)
        const casoBonifCruzada = Dominio.calcularDesglosePrecios(0, 2, false, REGLAS_NEGOCIO_POR_DEFECTO, {
            costoReferencia: 200,
            cajasCompradas: 5
        });
        afirmarIgualdad(casoBonifCruzada.subtotalFactura, 0, 'Bonif Cruzada: Subtotal factura es exactamente $0.00');
        afirmarIgualdad(casoBonifCruzada.costoUnitario, '0.00000000', 'Bonif Cruzada: Costo fiscal de inventario es 0.00000000');
        afirmarIgualdad(casoBonifCruzada.esBonificacionCruzada, true, 'Bonif Cruzada: Flag esBonificacionCruzada es true');
        afirmarIgualdad(casoBonifCruzada.costoUnitarioVenta, '100.00000000', 'Bonif Cruzada: Costo de referencia para PVP es $100.00000000 ($200 / 2)');
        afirmarIgualdad(casoBonifCruzada.p1Exacto, '130.00', 'Bonif Cruzada: P1 protegido en $130.00 (+30% sobre costo de lista)');

        // Línea inmutable con costo 0
        const lineaBonifCruzada = Dominio.crearLineaProductoInmutable({
            nombre: 'ACETAMINOFEN 120 MG / 5 ML JARABE',
            laboratorio: 'ROWE',
            tipo: 'entero',
            precioCajaBase: 0,
            costoReferencia: 150,
            unidadesPorCaja: 1,
            cajasCompradas: 5,
            aplicaItbis: false
        });
        afirmarIgualdad(lineaBonifCruzada.precioCajaBase, 0, 'Linea Bonif Cruzada: precioCajaBase es 0');
        afirmarIgualdad(lineaBonifCruzada.subtotalFactura, 0, 'Linea Bonif Cruzada: subtotalFactura es 0');
        afirmarIgualdad(lineaBonifCruzada.esBonificacionCruzada, true, 'Linea Bonif Cruzada: esBonificacionCruzada es true');
        afirmarIgualdad(lineaBonifCruzada.p1Exacto, '195.00', 'Linea Bonif Cruzada: P1 calculado sobre costo referencia $150 (+30% = $195.00)');

        // 35. Arquitectura de Catálogos Relacionales y Normalización de Categorías Terapéuticas
        if (Dominio && typeof Dominio.obtenerMacroCategoria === 'function') {
            afirmarIgualdad(Dominio.obtenerMacroCategoria('Antibiótico Oral'), 'Antibióticos', 'Macrocategoría: Antibiótico mapea a Antibióticos');
            afirmarIgualdad(Dominio.obtenerMacroCategoria('Antihipertensivo'), 'Cardiovascular & Hipertensión', 'Macrocategoría: Antihipertensivo mapea a Cardiovascular');
            afirmarIgualdad(Dominio.obtenerMacroCategoria('Vitamina C'), 'Vitaminas & Suplementos', 'Macrocategoría: Vitamina mapea a Vitaminas & Suplementos');
        }

        // Validación de Catálogos Ampliados de Proveedores (20) y Laboratorios (30)
        if (typeof Almacenamiento !== 'undefined' && typeof Almacenamiento.obtenerDirectorioProveedores === 'function') {
            const provs = Almacenamiento.obtenerDirectorioProveedores();
            afirmarIgualdad(provs.length >= 20, true, 'Directorio Proveedores: Catálogo ampliado cuenta con al menos 20 distribuidores oficiales');
            const betances = provs.find(p => p.nombre.includes('Betances'));
            afirmarIgualdad(Boolean(betances && betances.rnc), true, 'Directorio Proveedores: Betances tiene RNC válido');
        }
        if (typeof Almacenamiento !== 'undefined' && typeof Almacenamiento.obtenerDirectorioLaboratorios === 'function') {
            const labs = Almacenamiento.obtenerDirectorioLaboratorios();
            afirmarIgualdad(labs.length >= 30, true, 'Directorio Laboratorios: Catálogo ampliado cuenta con al menos 30 laboratorios oficiales');
            const rowe = labs.find(l => l.nombre.includes('Rowe'));
            afirmarIgualdad(Boolean(rowe && rowe.origen === 'Nacional RD'), true, 'Directorio Laboratorios: Rowe registrado como Nacional RD');
        }

        // 36. Carga y Persistencia de Vademécum Maestro Oficial DIGEMAPS (Cero fallos por db)
        if (typeof Almacenamiento !== 'undefined' && typeof Almacenamiento.guardarVademecumMaestro === 'function') {
            const vadMuestra = [
                {
                    id: 'VAD-TEST-01',
                    nombreComercial: 'Aceta-Felt 500 mg',
                    principioActivo: 'Paracetamol (Acetaminofén)',
                    laboratorio: 'Laboratorios Feltrex',
                    registroSanitario: '2021-0142'
                },
                {
                    id: 'VAD-TEST-02',
                    nombreComercial: 'Amoxil 500 mg',
                    principioActivo: 'Amoxicilina',
                    laboratorio: 'GSK',
                    registroSanitario: '2019-0331'
                }
            ];
            const resGuardar = Almacenamiento.guardarVademecumMaestro(vadMuestra);
            afirmarIgualdad(resGuardar.exito, true, 'Vademécum DIGEMAPS: Guardado exitoso sin lanzar ejecutarConDb');
            afirmarIgualdad(resGuardar.total, 2, 'Vademécum DIGEMAPS: Total de medicamentos almacenados es 2');

            const resultadosBusqueda = Almacenamiento.buscarEnVademecum('aceta-felt');
            afirmarIgualdad(resultadosBusqueda.length > 0, true, 'Vademécum DIGEMAPS: Búsqueda por nombre comercial exitosa');
            afirmarIgualdad(resultadosBusqueda[0].principioActivo, 'Paracetamol (Acetaminofén)', 'Vademécum DIGEMAPS: Principio activo coincide');

            // Detección polimórfica en importador
            if (typeof Almacenamiento.fusionarCatalogoDesdeArchivo === 'function') {
                const resImport = Almacenamiento.fusionarCatalogoDesdeArchivo({
                    tipo: 'vademecum-digemaps',
                    medicamentos: vadMuestra
                });
                afirmarIgualdad(resImport.exito, true, 'Importación Vademécum DIGEMAPS polimórfico exitosa');
                afirmarIgualdad(resImport.tipo, 'vademecum-digemaps', 'Tipo detectado es vademecum-digemaps');
            }
        }

        // 37. Allowlist Sanitaria en sanitizarFichaPublicaCatalogo (Cero Costos / Cero Proveedores / Anti-Proto)
        const fichaSucia = {
            codigoBarras: '746555',
            nombre: 'Azitromicina 500mg',
            principioActivo: 'Azitromicina',
            laboratorio: 'Pfizer',
            categoria: 'Antibióticos',
            tipo: 'divisible',
            unidadesPorCaja: 3,
            aplicaItbis: false,
            tasaItbis: 0,
            esLeche: false,
            condicionVenta: 'Receta Médica',
            registroSanitario: 'RD-99887',
            ubicacion: 'Tramo B-4',
            ultimoPrecioCaja: 500,
            costoAnteriorCaja: 450,
            variacionCosto: 11.11,
            costoUnitarioFiscal: '166.66666667',
            preciosVenta: { p1Exacto: '216.67' },
            historialCostos: [{ fecha: '2024-02-10', costoCaja: 500 }],
            proveedorHabitual: 'Droguería Confidencial',
            rncProveedor: '131000111',
            _segCifrado: { ct: 'cipher' }
        };
        Object.defineProperty(fichaSucia, '__proto__', { value: { evil: true }, enumerable: true });
        const fichaSaneada = Dominio.sanitizarFichaPublicaCatalogo(fichaSucia);
        afirmarIgualdad(fichaSaneada.nombre, 'Azitromicina 500mg', 'Sanitizador Ficha: Conserva nombre sanitario');
        afirmarIgualdad(fichaSaneada.registroSanitario, 'RD-99887', 'Sanitizador Ficha: Conserva registro sanitario');
        afirmarIgualdad(
            'ultimoPrecioCaja' in fichaSaneada ||
            'costoAnteriorCaja' in fichaSaneada ||
            'variacionCosto' in fichaSaneada ||
            'costoUnitarioFiscal' in fichaSaneada ||
            'preciosVenta' in fichaSaneada ||
            'historialCostos' in fichaSaneada ||
            'proveedorHabitual' in fichaSaneada ||
            'rncProveedor' in fichaSaneada ||
            '_segCifrado' in fichaSaneada ||
            'evil' in fichaSaneada,
            false,
            'Sanitizador Ficha: Excluye campos comerciales sensibles y propiedades heredadas'
        );

        // 38. Sanitizador de Diccionario Público y Defensa contra Prototype Pollution
        const jsonHostil = '{"__proto__":{"codigoBarras":"__proto__","nombre":"EvilProto"},"constructor":{"nombre":"EvilCtor"},"prototype":{"nombre":"EvilPrototype"},"746111":{"codigoBarras":"746111","nombre":"Vitamina C 1000mg","laboratorio":"Bayer","ultimoPrecioCaja":999,"proveedorHabitual":"SecretProv","historialCostos":[{"fecha":"2024-03-01","costoCaja":999}],"_segCifrado":{"ct":"secret"}}}';
        const dicHostil = JSON.parse(jsonHostil);
        const dicLimpio = Dominio.sanitizarDiccionarioPublico(dicHostil);
        const clavesLimpio = Object.keys(dicLimpio);
        afirmarIgualdad(clavesLimpio.length, 1, 'Sanitizador Diccionario: Filtra claves peligrosas __proto__/constructor/prototype');
        afirmarIgualdad(clavesLimpio[0], '746111', 'Sanitizador Diccionario: Mantiene únicamente código válido 746111');
        afirmarIgualdad(({}).nombre === undefined, true, 'Sanitizador Diccionario: Cero contaminación de Object.prototype');
        const dicLimpioJson = JSON.stringify(dicLimpio);
        afirmarIgualdad(
            dicLimpioJson.includes('SecretProv') ||
            dicLimpioJson.includes('ultimoPrecioCaja') ||
            dicLimpioJson.includes('historialCostos') ||
            dicLimpioJson.includes('proveedorHabitual') ||
            dicLimpioJson.includes('_segCifrado'),
            false,
            'Sanitizador Diccionario: Elimina 100% de costos, proveedores y sobres cifrados'
        );

        console.info('%c[Todas las pruebas de cálculo, validación y estrategias superadas exitosamente]', 'color:#146c2e;font-weight:bold;');
        console.groupEnd();
        return true;
    }

    async function ejecutarPruebasSeguridad() {
        console.group('Suite de Pruebas de Cifrado y Bóveda (Web Crypto AES-256-GCM)');
        const Seg = AppFarmacia.Seguridad;
        afirmarIgualdad(Boolean(Seg && typeof Seg.configurarContrasenaMaestra === 'function'), true, 'Seguridad: Módulo AppFarmacia.Seguridad disponible');
        afirmarIgualdad(Seg.soportaWebCrypto(), true, 'Seguridad: Web Crypto API soportada en el entorno');

        if (Seg.estaConfigurado()) {
            console.warn('[Pruebas Seguridad] Bóveda ya configurada en sesión activa; omitiendo pruebas destructivas en vivo.');
            console.groupEnd();
            return true;
        }

        try {
            // S1. Configuración de contraseña maestra sin texto plano en metadatos
            const resSetup = await Seg.configurarContrasenaMaestra('ClaveMaestra#2026', { minutosAutoBloqueo: 10 });
            afirmarIgualdad(resSetup.exito, true, 'Seguridad S1: Configuración maestra exitosa');
            afirmarIgualdad(typeof resSetup.codigoRecuperacion === 'string' && resSetup.codigoRecuperacion.length >= 24, true, 'Seguridad S1: Emite código de recuperación robusto');
            const metaStr = JSON.stringify(resSetup.metadatos || {});
            afirmarIgualdad(metaStr.includes('ClaveMaestra#2026'), false, 'Seguridad S1: Metadatos jamás almacenan la contraseña en texto plano');
            afirmarIgualdad(Seg.estaConfigurado() && !Seg.estaBloqueado(), true, 'Seguridad S1: Bóveda configurada y desbloqueada');

            // S2. Cifrado AES-256-GCM oculta los datos confidenciales
            const cargaSensible = {
                proveedorHabitual: 'Drogueria Privada SRL',
                ultimoPrecioCaja: 1850.25,
                rncProveedor: '101999888'
            };
            const sobreCifrado = await Seg.cifrarJson(cargaSensible);
            afirmarIgualdad(sobreCifrado._segCifrado, true, 'Seguridad S2: Sobre marcado con _segCifrado');
            afirmarIgualdad(sobreCifrado.alg, 'AES-256-GCM', 'Seguridad S2: Algoritmo AES-256-GCM');
            const sobreCifradoStr = JSON.stringify(sobreCifrado);
            afirmarIgualdad(
                sobreCifradoStr.includes('Drogueria Privada SRL') ||
                sobreCifradoStr.includes('1850.25') ||
                sobreCifradoStr.includes('101999888') ||
                sobreCifradoStr.includes('ultimoPrecioCaja'),
                false,
                'Seguridad S2: El texto cifrado oculta proveedor, RNC y costo'
            );

            // S3. Descifrado recupera exactamente los datos originales
            const datosDescifrados = await Seg.descifrarJson(sobreCifrado);
            afirmarIgualdad(datosDescifrados.proveedorHabitual, 'Drogueria Privada SRL', 'Seguridad S3: Descifra proveedorHabitual exacto');
            afirmarIgualdad(datosDescifrados.ultimoPrecioCaja, 1850.25, 'Seguridad S3: Descifra ultimoPrecioCaja exacto');
            afirmarIgualdad(datosDescifrados.rncProveedor, '101999888', 'Seguridad S3: Descifra rncProveedor exacto');

            // S4. El bloqueo impide cifrar y descifrar en RAM
            Seg.bloquear();
            afirmarIgualdad(Seg.estaBloqueado(), true, 'Seguridad S4: Estado bloqueado activo tras bloquear()');
            let bloqueoCifrado = false;
            try { await Seg.cifrarJson({ test: 1 }); } catch (_) { bloqueoCifrado = true; }
            let bloqueoDescifrado = false;
            try { await Seg.descifrarJson(sobreCifrado); } catch (_) { bloqueoDescifrado = true; }
            afirmarIgualdad(bloqueoCifrado && bloqueoDescifrado, true, 'Seguridad S4: Bloqueo impide cifrarJson y descifrarJson');

            // S5. Contraseña errónea rechazada e incrementa intentosFallidos
            let rechazoClaveMala = false;
            try { await Seg.desbloquear('ClaveEquivocada99'); } catch (_) { rechazoClaveMala = true; }
            afirmarIgualdad(rechazoClaveMala, true, 'Seguridad S5: Contraseña incorrecta rechazada');
            afirmarIgualdad(Seg.obtenerEstado().intentosFallidos, 1, 'Seguridad S5: Incrementa contador intentosFallidos');
            afirmarIgualdad(Seg.estaBloqueado(), true, 'Seguridad S5: Permanece bloqueada tras fallo');

            // S6. Contraseña correcta desbloquea y reinicia contador
            await Seg.desbloquear('ClaveMaestra#2026');
            afirmarIgualdad(Seg.estaBloqueado(), false, 'Seguridad S6: Desbloqueo exitoso con contraseña maestra');
            afirmarIgualdad(Seg.obtenerEstado().intentosFallidos, 0, 'Seguridad S6: Reinicia intentosFallidos a 0');

            // S7. Cambio de contraseña conserva el acceso al sobre cifrado (envelope DEK)
            await Seg.cambiarContrasena('ClaveMaestra#2026', 'ClaveNueva#2027');
            Seg.bloquear();
            let falloClaveVieja = false;
            try { await Seg.desbloquear('ClaveMaestra#2026'); } catch (_) { falloClaveVieja = true; }
            afirmarIgualdad(falloClaveVieja, true, 'Seguridad S7: Contraseña anterior invalidada tras cambio');
            await Seg.desbloquear('ClaveNueva#2027');
            const descifradoTrasCambio = await Seg.descifrarJson(sobreCifrado);
            afirmarIgualdad(descifradoTrasCambio.ultimoPrecioCaja, 1850.25, 'Seguridad S7: DEK preservada permite descifrar sobres previos');

            // S8. Código de recuperación restablece acceso y rota el código anterior
            Seg.bloquear();
            const resRecup = await Seg.recuperarConCodigo(resSetup.codigoRecuperacion, 'ClaveRecuperada#2028');
            afirmarIgualdad(resRecup.exito, true, 'Seguridad S8: Recuperación de emergencia exitosa');
            afirmarIgualdad(resRecup.nuevoCodigoRecuperacion !== resSetup.codigoRecuperacion, true, 'Seguridad S8: Rota el código de recuperación tras su uso');
            Seg.bloquear();
            await Seg.desbloquear('ClaveRecuperada#2028');
            const descifradoTrasRecup = await Seg.descifrarJson(sobreCifrado);
            afirmarIgualdad(descifradoTrasRecup.proveedorHabitual, 'Drogueria Privada SRL', 'Seguridad S8: Mantiene integridad de datos cifrados tras recuperación');

            console.info('%c[Todas las pruebas de cifrado AES-256-GCM superadas exitosamente]', 'color:#146c2e;font-weight:bold;');
            console.groupEnd();
            return true;
        } finally {
            Seg.bloquear();
            Seg.establecerMetadatosPersistidos(null);
        }
    }

    AppFarmacia.ejecutarSuitePruebas = ejecutarSuitePruebas;
    AppFarmacia.ejecutarPruebasSeguridad = ejecutarPruebasSeguridad;

    // CAL-01: Ejecutar solo si se solicita explícitamente en la URL (?test=true o ?debug=1) o en consola
    if (typeof window !== 'undefined' && window.location?.search && (window.location.search.includes('test=true') || window.location.search.includes('debug=1'))) {
        window.addEventListener('DOMContentLoaded', () => {
            ejecutarSuitePruebas();
            if (AppFarmacia.Seguridad && typeof AppFarmacia.Seguridad.soportaWebCrypto === 'function') {
                ejecutarPruebasSeguridad().catch(err => console.error('[Fallo Pruebas Seguridad]', err));
            }
        });
    }
})(window);
