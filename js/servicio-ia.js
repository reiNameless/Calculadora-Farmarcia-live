(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;

    function convertirArchivoABase64(archivo) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
            reader.readAsDataURL(archivo);
        });
    }

    function traducirErrorHttp(status, modelo) {
        if (status === 404) return `El modelo "${modelo}" no existe o ya no está disponible en la API. Cámbialo en el campo Modelo de IA (ej: gemini-1.5-flash).`;
        if (status === 400 || status === 403) return 'La clave de API de Gemini no es válida o no tiene permisos habilitados.';
        if (status === 429) return 'Se alcanzó el límite de cuota de la API de Gemini. Espera unos momentos e intenta de nuevo.';
        return `El servidor de IA devolvió un error (${status}).`;
    }

    async function analizarImagenFactura(archivo, apiKey, modelo, reglasNegocio) {
        if (!apiKey) throw new Error('Primero ingresa tu API Key de Gemini.');
        if (!archivo) throw new Error('Selecciona una imagen de factura válida.');

        const base64Data = await convertirArchivoABase64(archivo);
        const promptIA = `Analiza esta imagen de una factura de farmacia y devuelve ÚNICAMENTE un objeto JSON válido sin decoradores markdown:
{"proveedor": "","numeroFactura": "","fechaEmision": "YYYY-MM-DD","totalFactura": 0,"productos": [{"nombre": "","tipo": "divisible" o "entero","cajasCompradas": 1,"unidadesPorCaja": 1,"precioUnitarioCaja": 0}]}`;

        const url = `${CONSTANTES.URL_GEMINI_API_BASE}${encodeURIComponent(modelo)}:generateContent`;
        const respuesta = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: promptIA },
                        { inline_data: { mime_type: archivo.type, data: base64Data } }
                    ]
                }]
            })
        });

        if (!respuesta.ok) {
            throw new Error(traducirErrorHttp(respuesta.status, modelo));
        }

        const data = await respuesta.json();
        const textoCrudo = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const coincidenciaJson = textoCrudo.match(/\{[\s\S]*\}/);
        if (!coincidenciaJson) {
            throw new Error('La IA no devolvió datos estructurados legibles. Intenta con una fotografía más nítida e iluminada.');
        }

        const resultado = JSON.parse(coincidenciaJson[0]);
        const productosValidos = [];

        if (Array.isArray(resultado.productos)) {
            resultado.productos.forEach(prod => {
                const vPrecio = Dominio.validarPrecioCompra(prod.precioUnitarioCaja);
                const vCajas = Dominio.validarCantidadEnteraPositiva(prod.cajasCompradas, 'cajas');
                const tipo = prod.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
                const vUnidades = tipo === CONSTANTES.CATEGORIAS.ENTERO
                    ? { esValido: true, valor: 1 }
                    : Dominio.validarCantidadEnteraPositiva(prod.unidadesPorCaja, 'unidades');

                if (vPrecio.esValido && vCajas.esValido && vUnidades.esValido) {
                    productosValidos.push(Dominio.crearLineaProductoInmutable({
                        nombre: prod.nombre || 'Producto IA',
                        tipo,
                        precioCajaBase: vPrecio.valor,
                        unidadesPorCaja: vUnidades.valor,
                        cajasCompradas: vCajas.valor,
                        aplicaItbis: false
                    }, reglasNegocio));
                }
            });
        }

        return {
            proveedor: String(resultado.proveedor || '').trim(),
            numeroFactura: String(resultado.numeroFactura || '').trim(),
            fechaEmision: String(resultado.fechaEmision || '').trim(),
            totalFactura: Number(resultado.totalFactura) || 0,
            productos: productosValidos
        };
    }

    AppFarmacia.ServicioIA = Object.freeze({
        analizarImagenFactura
    });
})(window);
