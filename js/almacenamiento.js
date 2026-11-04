(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const { CONSTANTES, REGLAS_NEGOCIO_POR_DEFECTO } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;

    // Caché en memoria para evitar llamadas redundantes a JSON.parse en localStorage (REN-02)
    const cacheStorage = new Map();

    function leerJsonSeguro(claveStorage, valorPorDefecto) {
        if (cacheStorage.has(claveStorage)) {
            return Dominio.clonarObjetoSeguro(cacheStorage.get(claveStorage));
        }
        try {
            const texto = localStorage.getItem(claveStorage);
            if (!texto) {
                cacheStorage.set(claveStorage, valorPorDefecto);
                return Dominio.clonarObjetoSeguro(valorPorDefecto);
            }
            const parseado = JSON.parse(texto);
            cacheStorage.set(claveStorage, parseado);
            return Dominio.clonarObjetoSeguro(parseado);
        } catch (error) {
            console.warn(`Error leyendo ${claveStorage} en localStorage:`, error);
            return Dominio.clonarObjetoSeguro(valorPorDefecto);
        }
    }

    function escribirJsonSeguro(claveStorage, datos) {
        try {
            localStorage.setItem(claveStorage, JSON.stringify(datos));
            cacheStorage.set(claveStorage, Dominio.clonarObjetoSeguro(datos));
            return { exito: true };
        } catch (error) {
            return { exito: false, error: 'El almacenamiento local del navegador está lleno o bloqueado.' };
        }
    }

    function invalidarCacheStorage(claveStorage) {
        if (claveStorage) {
            cacheStorage.delete(claveStorage);
        } else {
            cacheStorage.clear();
        }
    }

    // --- GESTIÓN DE REGLAS DE CÁLCULO ---
    function obtenerReglasNegocio() {
        const guardadas = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, REGLAS_NEGOCIO_POR_DEFECTO);
        return Dominio.sanitizarReglasNegocio(guardadas);
    }

    function guardarReglasNegocio(nuevasReglas) {
        const sanitizadas = Dominio.sanitizarReglasNegocio(nuevasReglas);
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, sanitizadas);
        return {
            ...resultado,
            reglas: sanitizadas
        };
    }

    // --- DICCIONARIO PERMANENTE DE CÓDIGOS DE BARRA ---
    function obtenerDiccionarioCodigos() {
        const dic = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
        return (dic && typeof dic === 'object' && !Array.isArray(dic)) ? dic : {};
    }

    function guardarDiccionarioCodigos(diccionario) {
        return escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);
    }

    function buscarProductoPorCodigo(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        if (!codigo) return null;
        const diccionario = obtenerDiccionarioCodigos();
        return diccionario[codigo] || null;
    }

    function aprenderProductoEnDiccionario(lineaProducto) {
        const codigo = Dominio.normalizarCodigoBarras(lineaProducto.codigoBarras);
        const nombreCandidato = String(lineaProducto.nombre || '').trim();
        // COD-05: Regex para identificar nombres temporales genéricos
        const esNombreGenerico = !nombreCandidato || /^Producto #\d+$/i.test(nombreCandidato) || nombreCandidato === 'Producto IA' || nombreCandidato === 'Producto';
        if (!codigo) return false;

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo];

        // DAT-03: No sobrescribir nombres previos personalizados si el nuevo es genérico
        let nombreFinal = nombreCandidato;
        if (esNombreGenerico && existente && existente.nombre && !/^Producto #\d+$/i.test(existente.nombre)) {
            nombreFinal = existente.nombre;
        } else if (!nombreFinal) {
            nombreFinal = 'Producto sin nombre';
        }

        const tipo = lineaProducto.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        const tasaItbis = (lineaProducto.tasaItbis !== undefined && Number.isFinite(Number(lineaProducto.tasaItbis)))
            ? Number(lineaProducto.tasaItbis)
            : (lineaProducto.aplicaItbis ? 18 : 0);

        diccionario[codigo] = {
            ...(existente || {}),
            codigoBarras: codigo,
            nombre: nombreFinal,
            tipo,
            unidadesPorCaja: tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Number(lineaProducto.unidadesPorCaja) || 1,
            ultimoPrecioCaja: Number(lineaProducto.precioCajaBase) || 0,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche: Boolean(lineaProducto.esLeche),
            descuentoValor: Number(lineaProducto.descuentoValor) || 0,
            tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
            actualizadoEn: new Date().toISOString()
        };
        guardarDiccionarioCodigos(diccionario);
        return true;
    }

    function eliminarCodigoDeDiccionario(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        const diccionario = obtenerDiccionarioCodigos();
        if (!diccionario[codigo]) return false;
        delete diccionario[codigo];
        guardarDiccionarioCodigos(diccionario);
        return true;
    }

    // --- HISTORIAL (7 DÍAS) Y BORRADOR ACTIVO ---
    function obtenerHistorialFacturas() {
        const lista = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        return Array.isArray(lista) ? lista : [];
    }

    function guardarHistorialFacturas(listaFacturas) {
        return escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, listaFacturas);
    }

    function limpiarHistorialExpirado7Dias() {
        const ahora = Date.now();
        const vigentes = obtenerHistorialFacturas().filter(
            fac => (ahora - (Number(fac.timestampGuardado) || ahora)) <= CONSTANTES.DIAS_RETENCION_HISTORIAL_MS
        );
        guardarHistorialFacturas(vigentes);
    }

    function crearSesionVacia() {
        const fechaEmision = Dominio.obtenerFechaLocalISO();
        return {
            id: null,
            proveedor: '',
            numeroFactura: '',
            fechaEmision,
            fechaVencimiento: Dominio.sumarDiasAFechaISO(fechaEmision, 30),
            totalFisico: 0,
            productos: []
        };
    }

    function cargarBorradorActivo() {
        const borrador = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, null);
        if (!borrador || typeof borrador !== 'object') return crearSesionVacia();
        const fechaEmision = borrador.fechaEmision || Dominio.obtenerFechaLocalISO();
        const fechaVencimiento = borrador.fechaVencimiento || Dominio.sumarDiasAFechaISO(fechaEmision, 30);
        return {
            ...crearSesionVacia(),
            ...borrador,
            fechaEmision,
            fechaVencimiento,
            productos: Array.isArray(borrador.productos) ? borrador.productos : []
        };
    }

    function guardarBorradorActivo(sesionActual) {
        return escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, sesionActual);
    }

    // --- UTILIDADES DRY PARA EXPORTAR E IMPORTAR ARCHIVOS JSON ---
    function descargarObjetoComoJson(objetoDatos, nombreArchivo) {
        const contenido = JSON.stringify(objetoDatos, null, 2);
        const blob = new Blob([contenido], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombreArchivo;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), CONSTANTES.TIEMPO_REVOCAR_URL_MS);
    }

    function leerArchivoJsonSubido(archivo) {
        return new Promise((resolve, reject) => {
            if (!archivo) {
                reject(new Error('No se seleccionó ningún archivo.'));
                return;
            }
            // SEG-05: Validación de tamaño máximo de archivo
            if (archivo.size > CONSTANTES.LIMITE_ARCHIVO_JSON_BYTES) {
                const mbPermitido = (CONSTANTES.LIMITE_ARCHIVO_JSON_BYTES / (1024 * 1024)).toFixed(0);
                reject(new Error(`El archivo supera el límite de seguridad de ${mbPermitido} MB.`));
                return;
            }
            const lector = new FileReader();
            lector.onload = () => {
                try {
                    resolve(JSON.parse(lector.result));
                } catch (e) {
                    reject(new Error('El archivo seleccionado no tiene un formato JSON válido.'));
                }
            };
            lector.onerror = () => reject(new Error('No se pudo leer el archivo del disco.'));
            lector.readAsText(archivo);
        });
    }

    AppFarmacia.Almacenamiento = Object.freeze({
        leerJsonSeguro,
        escribirJsonSeguro,
        invalidarCacheStorage,
        obtenerReglasNegocio,
        guardarReglasNegocio,
        obtenerDiccionarioCodigos,
        guardarDiccionarioCodigos,
        buscarProductoPorCodigo,
        aprenderProductoEnDiccionario,
        eliminarCodigoDeDiccionario,
        obtenerHistorialFacturas,
        guardarHistorialFacturas,
        limpiarHistorialExpirado7Dias,
        crearSesionVacia,
        cargarBorradorActivo,
        guardarBorradorActivo,
        descargarObjetoComoJson,
        leerArchivoJsonSubido
    });
})(window);
