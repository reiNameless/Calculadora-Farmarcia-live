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
        console.group('🧪 Suite de Pruebas Automatizadas - Calculadora de Farmacia');

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
        afirmarIgualdad(casoCascadaItbis.costoUnitario, '11.80000000', 'Cascada + ITBIS: Costo unitario');
        afirmarIgualdad(casoCascadaItbis.p1Exacto, '15.34', 'Cascada + ITBIS: Precio 1');

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

        console.info('%c[Todas las pruebas de cálculo, validación y estrategias superadas exitosamente]', 'color:#146c2e;font-weight:bold;');
        console.groupEnd();
        return true;
    }

    AppFarmacia.ejecutarSuitePruebas = ejecutarSuitePruebas;

    // CAL-01: Ejecutar solo si se solicita explícitamente en la URL (?test=true o ?debug=1) o en consola
    if (typeof window !== 'undefined' && (window.location.search.includes('test=true') || window.location.search.includes('debug=1'))) {
        window.addEventListener('DOMContentLoaded', ejecutarSuitePruebas);
    }
})(window);
