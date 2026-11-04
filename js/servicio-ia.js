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

    function optimizarImagenParaIA(archivo) {
        // En entornos sin DOM/Canvas o para PDFs, usar lectura directa
        if (typeof document === 'undefined' || typeof Image === 'undefined' || !archivo.type || !archivo.type.startsWith('image/')) {
            return convertirArchivoABase64(archivo).then(base64 => ({
                mimeType: archivo.type || 'application/octet-stream',
                data: base64
            }));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            const urlObjeto = URL.createObjectURL(archivo);

            img.onload = () => {
                URL.revokeObjectURL(urlObjeto);
                try {
                    const MAX_DIM = 1600;
                    let { width, height } = img;

                    if (width > MAX_DIM || height > MAX_DIM) {
                        if (width > height) {
                            height = Math.round((height * MAX_DIM) / width);
                            width = MAX_DIM;
                        } else {
                            width = Math.round((width * MAX_DIM) / height);
                            height = MAX_DIM;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        throw new Error('No se pudo inicializar el lienzo para compresión.');
                    }

                    // Fondo blanco por si la imagen tiene transparencia
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    const base64 = dataUrl.split(',')[1];
                    resolve({
                        mimeType: 'image/jpeg',
                        data: base64
                    });
                } catch (e) {
                    convertirArchivoABase64(archivo)
                        .then(base64 => resolve({ mimeType: archivo.type, data: base64 }))
                        .catch(reject);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(urlObjeto);
                reject(new Error(`No se pudo cargar la imagen "${archivo.name}".`));
            };

            img.src = urlObjeto;
        });
    }

    function traducirErrorHttp(status, modelo) {
        if (status === 404) return `El modelo "${modelo}" no existe o ya no está disponible en la API. Cámbialo en el campo Modelo de IA (ej: gemini-2.5-flash).`;
        if (status === 400 || status === 403) return 'La clave de API de Gemini no es válida o no tiene permisos habilitados.';
        if (status === 429) return 'Se alcanzó el límite de cuota de la API de Gemini. Espera unos momentos e intenta de nuevo.';
        return `El servidor de IA devolvió un error (${status}).`;
    }

    async function analizarImagenFactura(archivosEntrada, apiKey, modelo, reglasNegocio) {
        if (!apiKey) throw new Error('Primero ingresa tu API Key de Gemini en el menú de Ajustes.');

        // Normalizar entrada a array (soporte para 1 o múltiples páginas/archivos)
        const listaArchivos = Array.isArray(archivosEntrada)
            ? archivosEntrada
            : (archivosEntrada instanceof FileList ? Array.from(archivosEntrada) : [archivosEntrada]);

        const archivosValidos = listaArchivos.filter(Boolean);
        if (archivosValidos.length === 0) {
            throw new Error('Selecciona al menos una foto de factura válida.');
        }

        // Optimizar todas las imágenes en paralelo (Canvas rescale a 1600px + JPEG 0.85)
        const partesImagenes = await Promise.all(archivosValidos.map(optimizarImagenParaIA));

        const promptIA = `Eres un auditor fiscal farmacéutico experto en República Dominicana.
Analiza con máxima precisión la(s) imagen(es) de la factura de droguería/farmacia adjunta(s). Si hay varias imágenes, corresponden a páginas consecutivas de la misma factura.

Instrucciones de auditoría:
1. Identifica el nombre del Proveedor / Droguería y el Número de Factura o NCF (Comprobante Fiscal: B01, B02, E31, etc.).
2. Identifica la fecha de emisión en formato YYYY-MM-DD y el Total General Facturado.
3. Si son múltiples páginas, consolida en una sola lista continua todos los medicamentos o renglones facturados sin omitir ninguno y sin duplicar encabezados intermedios.
4. Tipo de producto:
   - "divisible": pastillas, cápsulas, comprimidos, blisters que se pueden vender por unidad suelta.
   - "entero": frascos, jarabes, gotas, colirios, pomadas o insumos que se venden únicamente enteros por caja/unidad.
5. ITBIS en República Dominicana:
   - En RD los medicamentos para consumo humano están 100% EXENTOS de ITBIS (aplicaItbis = false).
   - Solo productos no medicinales (higiene, cosméticos, golosinas, bebidas, cuidado personal) llevan ITBIS 18% (aplicaItbis = true).
6. Precios y Cantidades:
   - cajasCompradas: cantidad de bultos o cajas adquiridas (entero >= 1).
   - unidadesPorCaja: pastillas/unidades contenidas en cada caja si se especifica (por defecto 1).
   - precioUnitarioCaja: costo pactado por caja antes o después de descuento.
   - descuentoValor y tipoDescuento: si existe descuento en la línea (monto $ o porcentaje %), refléjalo; si no, 0.`;

        const partesContenido = [
            { text: promptIA },
            ...partesImagenes.map(img => ({
                inline_data: {
                    mime_type: img.mimeType,
                    data: img.data
                }
            }))
        ];

        const modeloActivo = modelo || CONSTANTES.MODELO_IA_POR_DEFECTO;
        const url = `${CONSTANTES.URL_GEMINI_API_BASE}${encodeURIComponent(modeloActivo)}:generateContent`;

        const respuesta = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: partesContenido }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            proveedor: { type: 'STRING', description: 'Nombre o razón social de la droguería / distribuidora' },
                            numeroFactura: { type: 'STRING', description: 'Número de factura o NCF (ej. B01..., B02..., E31...)' },
                            fechaEmision: { type: 'STRING', description: 'Fecha de emisión en formato YYYY-MM-DD' },
                            totalFactura: { type: 'NUMBER', description: 'Monto total monetario a pagar de la factura' },
                            productos: {
                                type: 'ARRAY',
                                description: 'Lista completa de renglones o productos facturados',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        nombre: { type: 'STRING', description: 'Nombre y concentración del medicamento o producto' },
                                        tipo: { type: 'STRING', enum: ['divisible', 'entero'], description: 'divisible para tabletas/blisters, entero para jarabes/cremas' },
                                        cajasCompradas: { type: 'INTEGER', description: 'Cantidad facturada de cajas o empaques' },
                                        unidadesPorCaja: { type: 'INTEGER', description: 'Unidades o pastillas por caja (por defecto 1)' },
                                        precioUnitarioCaja: { type: 'NUMBER', description: 'Precio de compra unitario por caja' },
                                        descuentoValor: { type: 'NUMBER', description: 'Monto o porcentaje de descuento por línea si aplica, o 0' },
                                        tipoDescuento: { type: 'STRING', enum: ['monto', 'porcentaje'], description: 'Tipo de descuento' },
                                        aplicaItbis: { type: 'BOOLEAN', description: 'false para medicamentos humanos en RD (exentos), true para cosméticos/higiene/golosinas' }
                                    },
                                    required: ['nombre', 'cajasCompradas', 'precioUnitarioCaja']
                                }
                            }
                        },
                        required: ['totalFactura', 'productos']
                    }
                }
            })
        });

        if (!respuesta.ok) {
            throw new Error(traducirErrorHttp(respuesta.status, modeloActivo));
        }

        const data = await respuesta.json();
        let textoCrudo = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        textoCrudo = textoCrudo.trim();

        // Limpiar posibles bloques de código markdown de forma defensiva
        if (textoCrudo.startsWith('```json')) {
            textoCrudo = textoCrudo.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        } else if (textoCrudo.startsWith('```')) {
            textoCrudo = textoCrudo.replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        }

        let resultado;
        try {
            resultado = JSON.parse(textoCrudo);
        } catch (e) {
            const coincidenciaJson = textoCrudo.match(/\{[\s\S]*\}/);
            if (!coincidenciaJson) {
                throw new Error('La IA no devolvió datos estructurados legibles. Intenta con una fotografía más nítida e iluminada.');
            }
            resultado = JSON.parse(coincidenciaJson[0]);
        }

        const productosValidos = [];

        if (Array.isArray(resultado.productos)) {
            resultado.productos.forEach(prod => {
                const vPrecio = Dominio.validarPrecioCompra(prod.precioUnitarioCaja);
                const vCajas = Dominio.validarCantidadEnteraPositiva(prod.cajasCompradas, 'cajas');
                const tipo = prod.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
                const vUnidades = tipo === CONSTANTES.CATEGORIAS.ENTERO
                    ? { esValido: true, valor: 1 }
                    : Dominio.validarCantidadEnteraPositiva(prod.unidadesPorCaja || 1, 'unidades');

                const descuentoValor = Math.max(0, Number(prod.descuentoValor) || 0);
                const tipoDescuento = prod.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto';
                const aplicaItbis = Boolean(prod.aplicaItbis);

                if (vPrecio.esValido && vCajas.esValido && vUnidades.esValido) {
                    productosValidos.push(Dominio.crearLineaProductoInmutable({
                        nombre: String(prod.nombre || 'Producto IA').trim(),
                        tipo,
                        precioCajaBase: vPrecio.valor,
                        unidadesPorCaja: vUnidades.valor,
                        cajasCompradas: vCajas.valor,
                        aplicaItbis,
                        descuentoValor,
                        tipoDescuento
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
