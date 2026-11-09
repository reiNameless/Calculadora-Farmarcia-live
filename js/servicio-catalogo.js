(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const Dominio = AppFarmacia.Dominio;

    // Caché en memoria para evitar llamadas de red redundantes al mismo código
    const cacheConsultas = new Map();

    async function consultarCodigoEnLinea(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        if (!codigo || codigo.length < 8) return null;

        if (cacheConsultas.has(codigo)) {
            return cacheConsultas.get(codigo);
        }

        // Si el dispositivo está sin conexión a internet, retornar null silenciosamente
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return null;
        }

        try {
            // 1. Intentar consulta en Open Products / Open Food Facts (Excelente cobertura de EAN-13 y UPC-A)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5 segundos máximo para no demorar al cajero

            const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}.json?fields=product_name,generic_name,brands,categories,quantity,packaging`;
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (resp.ok) {
                const data = await resp.json();
                if (data && data.status === 1 && data.product) {
                    const prod = data.product;
                    const nombreComercial = String(prod.product_name || '').trim();
                    const principioActivo = String(prod.generic_name || '').trim();
                    const laboratorio = String(prod.brands || '').trim();
                    const presentacion = String(prod.packaging || prod.quantity || '').trim();
                    const categoria = String(prod.categories || 'Medicamentos Generales').split(',')[0].trim();

                    if (nombreComercial) {
                        const resultado = {
                            codigoBarras: codigo,
                            nombre: nombreComercial,
                            nombreComercial,
                            principioActivo,
                            laboratorio,
                            presentacion,
                            categoria,
                            formaFarmaceutica: 'Unidad estándar',
                            tipo: 'entero',
                            unidadesPorCaja: 1,
                            aplicaItbis: false,
                            tasaItbis: 0,
                            esLeche: /leche|formula|infantil|nan|enfamil|similac/i.test(nombreComercial + ' ' + categoria),
                            origenDatos: 'api_publica_abierta'
                        };
                        cacheConsultas.set(codigo, resultado);
                        return resultado;
                    }
                }
            }
        } catch (e) {
            // Silencioso ante errores de red o timeouts para no interrumpir el flujo offline
        }

        return null;
    }

    AppFarmacia.ServicioCatalogo = Object.freeze({
        consultarCodigoEnLinea
    });
})(window);
