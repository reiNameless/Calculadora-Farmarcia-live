(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const { CONSTANTES, REGLAS_NEGOCIO_POR_DEFECTO } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;

    // Referencia segura a IndexedDB (compatible con navegadores y entornos headless)
    const indexedDBRef = (typeof indexedDB !== 'undefined')
        ? indexedDB
        : (global.indexedDB || null);

    const DB_NOMBRE = 'CalculadoraFarmaciaDB';
    const DB_VERSION = 1;
    const STORES = Object.freeze({
        BORRADOR: 'borrador',
        HISTORIAL: 'historial_facturas',
        DICCIONARIO: 'diccionario_productos',
        CONFIGURACION: 'configuracion_reglas'
    });

    let dbInstancia = null;
    let dbPromesa = null;

    // Caché en memoria de acceso ultra-rápido (0ms) para operaciones síncronas de UI
    const cacheStorage = new Map();

    // --- CONEXIÓN Y CREACIÓN DE ESQUEMA INDEXEDDB ---
    function abrirBaseDatos() {
        if (dbInstancia) return Promise.resolve(dbInstancia);
        if (dbPromesa) return dbPromesa;
        if (!indexedDBRef) return Promise.resolve(null);

        dbPromesa = new Promise((resolve) => {
            try {
                const peticion = indexedDBRef.open(DB_NOMBRE, DB_VERSION);

                peticion.onupgradeneeded = event => {
                    const db = event.target.result;

                    // 1. Borrador activo (factura en curso)
                    if (!db.objectStoreNames.contains(STORES.BORRADOR)) {
                        db.createObjectStore(STORES.BORRADOR);
                    }

                    // 2. Historial de facturas (7 días o más)
                    if (!db.objectStoreNames.contains(STORES.HISTORIAL)) {
                        const storeHistorial = db.createObjectStore(STORES.HISTORIAL, { keyPath: 'id' });
                        storeHistorial.createIndex('fechaEmision', 'fechaEmision', { unique: false });
                        storeHistorial.createIndex('proveedor', 'proveedor', { unique: false });
                        storeHistorial.createIndex('numeroFactura', 'numeroFactura', { unique: false });
                        storeHistorial.createIndex('timestampGuardado', 'timestampGuardado', { unique: false });
                    }

                    // 3. Diccionario permanente de productos
                    if (!db.objectStoreNames.contains(STORES.DICCIONARIO)) {
                        const storeDic = db.createObjectStore(STORES.DICCIONARIO, { keyPath: 'codigoBarras' });
                        storeDic.createIndex('nombre', 'nombre', { unique: false });
                        storeDic.createIndex('ultimoPrecioCaja', 'ultimoPrecioCaja', { unique: false });
                        storeDic.createIndex('actualizadoEn', 'actualizadoEn', { unique: false });
                    }

                    // 4. Configuración y reglas fiscales
                    if (!db.objectStoreNames.contains(STORES.CONFIGURACION)) {
                        db.createObjectStore(STORES.CONFIGURACION);
                    }
                };

                peticion.onsuccess = event => {
                    dbInstancia = event.target.result;
                    resolve(dbInstancia);
                };

                peticion.onerror = event => {
                    console.warn('[IndexedDB] No se pudo inicializar la base de datos local:', event.target.error);
                    resolve(null);
                };
            } catch (error) {
                console.warn('[IndexedDB] Excepción al abrir base de datos local:', error);
                resolve(null);
            }
        });

        return dbPromesa;
    }

    // --- LECTURA Y ESCRITURA EN CACHÉ / LOCALSTORAGE FALLBACK ---
    function leerJsonSeguro(claveStorage, valorPorDefecto) {
        if (cacheStorage.has(claveStorage)) {
            return Dominio.clonarObjetoSeguro(cacheStorage.get(claveStorage));
        }
        try {
            if (typeof localStorage === 'undefined') {
                cacheStorage.set(claveStorage, valorPorDefecto);
                return Dominio.clonarObjetoSeguro(valorPorDefecto);
            }
            const texto = localStorage.getItem(claveStorage);
            if (!texto) {
                cacheStorage.set(claveStorage, valorPorDefecto);
                return Dominio.clonarObjetoSeguro(valorPorDefecto);
            }
            const parseado = Dominio.sanitizarJsonSeguro(JSON.parse(texto));
            cacheStorage.set(claveStorage, parseado);
            return Dominio.clonarObjetoSeguro(parseado);
        } catch (error) {
            console.warn(`Error leyendo ${claveStorage} en almacenamiento:`, error);
            return Dominio.clonarObjetoSeguro(valorPorDefecto);
        }
    }

    function escribirJsonSeguro(claveStorage, datos) {
        cacheStorage.set(claveStorage, Dominio.clonarObjetoSeguro(datos));
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(claveStorage, JSON.stringify(datos));
            }
            return { exito: true };
        } catch (error) {
            // Si localStorage excede su cuota (5MB), IndexedDB mantiene los datos a salvo
            console.info('[Almacenamiento] Cuota de localStorage alcanzada; persistiendo en IndexedDB...');
            return { exito: true, advertencia: 'Cuota de localStorage superada, persistido en base de datos local.' };
        }
    }

    function invalidarCacheStorage(claveStorage) {
        if (claveStorage) {
            cacheStorage.delete(claveStorage);
        } else {
            cacheStorage.clear();
        }
    }

    // --- SEMBRADO AUTOMÁTICO DE CATÁLOGO INICIAL DOMINICANO ---
    async function sembrarCatalogoInicial(forzar = false) {
        try {
            const dicActual = obtenerDiccionarioCodigos();
            const totalActual = Object.keys(dicActual || {}).length;
            if (!forzar && totalActual > 0) {
                return { sembrado: false, motivo: "Diccionario ya contiene productos.", totalProductos: totalActual };
            }
            if (typeof fetch !== "function") {
                return { sembrado: false, motivo: "Entorno sin soporte de fetch.", totalProductos: 0 };
            }
            const respuesta = await fetch("./catalogo_rd_inicial.json");
            if (!respuesta.ok) {
                return { sembrado: false, motivo: "HTTP " + respuesta.status + " al leer catalogo_rd_inicial.json", totalProductos: 0 };
            }
            const contenido = await respuesta.json();
            if (!contenido || !contenido.diccionario || typeof contenido.diccionario !== "object") {
                return { sembrado: false, motivo: "Estructura inválida en archivo de catálogo.", totalProductos: 0 };
            }
            const dicSemilla = Dominio.sanitizarJsonSeguro(contenido.diccionario);
            const totalSemilla = Object.keys(dicSemilla).length;
            if (totalSemilla === 0) {
                return { sembrado: false, motivo: "Catálogo semilla sin productos.", totalProductos: 0 };
            }
            const dicFinal = forzar ? dicSemilla : { ...dicSemilla, ...dicActual };
            guardarDiccionarioCodigos(dicFinal);
            console.info("[Almacenamiento] Catálogo dominicano sembrado con éxito: " + totalSemilla + " productos.");
            return { sembrado: true, totalProductos: Object.keys(dicFinal).length, totalSemilla };
        } catch (error) {
            console.warn("[Almacenamiento] Error durante sembrado de catálogo:", error.message);
            return { sembrado: false, error: error.message, totalProductos: 0 };
        }
    }
    // --- BLINDAJE DE PERSISTENCIA CONTRA PURGA AUTOMÁTICA DEL NAVEGADOR ---
    async function solicitarPersistenciaAlmacenamiento() {
        if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.persist === "function") {
            try {
                const persistente = await navigator.storage.persist();
                console.info("[Almacenamiento] Persistencia de almacenamiento:", persistente ? "BLINDADA (PROTEGIDA)" : "ESTÁNDAR");
                return persistente;
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    // --- INICIALIZACIÓN ASÍNCRONA Y MIGRACIÓN AUTOMÁTICA ---
    async function inicializarPersistencia() {
        const db = await abrirBaseDatos();
        solicitarPersistenciaAlmacenamiento();
        if (!db) {
            console.info('[Almacenamiento] IndexedDB no soportada; operando con almacenamiento estándar.');
            return false;
        }

        return new Promise((resolve) => {
            try {
                const tx = db.transaction([STORES.BORRADOR, STORES.HISTORIAL, STORES.DICCIONARIO, STORES.CONFIGURACION], 'readonly');
                const reqCountDic = tx.objectStore(STORES.DICCIONARIO).count();
                const reqCountHist = tx.objectStore(STORES.HISTORIAL).count();

                tx.oncomplete = () => {
                    const cantDic = reqCountDic.result || 0;
                    const cantHist = reqCountHist.result || 0;

                    // Si IndexedDB está vacía, migrar automáticamente los datos previos de localStorage
                    if (cantDic === 0 && cantHist === 0) {
                        const dicPrevio = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
                        const histPrevio = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
                        const borradorPrevio = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, null);
                        const reglasPrevias = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, null);

                        const txMigrar = db.transaction([STORES.BORRADOR, STORES.HISTORIAL, STORES.DICCIONARIO, STORES.CONFIGURACION], 'readwrite');
                        if (borradorPrevio) txMigrar.objectStore(STORES.BORRADOR).put(borradorPrevio, 'activo');
                        if (reglasPrevias) txMigrar.objectStore(STORES.CONFIGURACION).put(reglasPrevias, 'reglas_activas');
                        (histPrevio || []).forEach(fac => {
                            if (fac && fac.id) txMigrar.objectStore(STORES.HISTORIAL).put(fac);
                        });
                        Object.values(dicPrevio || {}).forEach(item => {
                            if (item && item.codigoBarras) txMigrar.objectStore(STORES.DICCIONARIO).put(item);
                        });

                        txMigrar.oncomplete = () => {
                            console.info('[IndexedDB] Migración transparente completada.');
                            const tieneDicPrevio = Object.keys(dicPrevio || {}).length > 0;
                            if (!tieneDicPrevio) {
                                sembrarCatalogoInicial(false).then(res => resolve(res.sembrado)).catch(() => resolve(false));
                            } else {
                                resolve(false);
                            }
                        };
                        txMigrar.onerror = () => resolve(false);
                    } else {
                        // Cargar los registros autoritativos de IndexedDB a la caché síncrona
                        const txCargar = db.transaction([STORES.BORRADOR, STORES.HISTORIAL, STORES.DICCIONARIO, STORES.CONFIGURACION], 'readonly');
                        const reqGetAllDic = txCargar.objectStore(STORES.DICCIONARIO).getAll();
                        const reqGetAllHist = txCargar.objectStore(STORES.HISTORIAL).getAll();
                        const reqGetBorrador = txCargar.objectStore(STORES.BORRADOR).get('activo');
                        const reqGetReglas = txCargar.objectStore(STORES.CONFIGURACION).get('reglas_activas');

                        txCargar.oncomplete = () => {
                            const dicMap = {};
                            (reqGetAllDic.result || []).forEach(item => {
                                if (item && item.codigoBarras) dicMap[item.codigoBarras] = item;
                            });
                            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicMap);
                            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, reqGetAllHist.result || []);

                            if (reqGetBorrador.result) {
                                cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, reqGetBorrador.result);
                            }
                            if (reqGetReglas.result) {
                                cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, reqGetReglas.result);
                            }

                            console.info(`[IndexedDB] Activo: ${Object.keys(dicMap).length} medicamentos y ${(reqGetAllHist.result || []).length} facturas.`);
                            resolve(true);
                        };
                        txCargar.onerror = () => resolve(false);
                    }
                };

                tx.onerror = () => resolve(false);
            } catch (error) {
                console.warn('[IndexedDB] Error en inicialización de persistencia:', error);
                resolve(false);
            }
        });
    }

    // --- GESTIÓN DE REGLAS DE CÁLCULO ---
    function obtenerReglasNegocio() {
        const guardadas = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, REGLAS_NEGOCIO_POR_DEFECTO);
        return Dominio.sanitizarReglasNegocio(guardadas);
    }

    function guardarReglasNegocio(nuevasReglas) {
        const sanitizadas = Dominio.sanitizarReglasNegocio(nuevasReglas);
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, sanitizadas);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.CONFIGURACION], 'readwrite');
                tx.objectStore(STORES.CONFIGURACION).put(sanitizadas, 'reglas_activas');
            } catch (e) {
                console.warn('[IndexedDB] Error guardando reglas:', e);
            }
        });

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
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                const store = tx.objectStore(STORES.DICCIONARIO);
                store.clear();
                Object.values(diccionario || {}).forEach(item => {
                    if (item && item.codigoBarras) {
                        store.put(item);
                    }
                });
            } catch (e) {
                console.warn('[IndexedDB] Error guardando diccionario:', e);
            }
        });

        return resultado;
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
        const esNombreGenerico = !nombreCandidato || /^Producto #\d+$/i.test(nombreCandidato) || nombreCandidato === 'Producto IA' || nombreCandidato === 'Producto';
        if (!codigo) return false;

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo];

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

        const fichaActualizada = {
            ...(existente || {}),
            codigoBarras: codigo,
            nombre: nombreFinal,
            nombreComercial: lineaProducto.nombreComercial || nombreFinal,
            principioActivo: lineaProducto.principioActivo || (existente && existente.principioActivo) || '',
            laboratorio: lineaProducto.laboratorio || (existente && existente.laboratorio) || '',
            concentracion: lineaProducto.concentracion || (existente && existente.concentracion) || '',
            categoria: lineaProducto.categoria || (existente && existente.categoria) || '',
            presentacion: lineaProducto.presentacion || (existente && existente.presentacion) || '',
            formaFarmaceutica: lineaProducto.formaFarmaceutica || (existente && existente.formaFarmaceutica) || '',
            registroSanitario: lineaProducto.registroSanitario || (existente && existente.registroSanitario) || '',
            condicionVenta: lineaProducto.condicionVenta || (existente && existente.condicionVenta) || 'OTC',
            ubicacion: lineaProducto.ubicacion || (existente && existente.ubicacion) || '',
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

        diccionario[codigo] = fichaActualizada;
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(fichaActualizada);
            } catch (e) {
                console.warn('[IndexedDB] Error persistiendo producto aprendido:', e);
            }
        });

        return true;
    }

    function eliminarCodigoDeDiccionario(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        const diccionario = obtenerDiccionarioCodigos();
        if (!diccionario[codigo]) return false;
        delete diccionario[codigo];
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).delete(codigo);
            } catch (e) {
                console.warn('[IndexedDB] Error eliminando código:', e);
            }
        });

        return true;
    }

    // --- HISTORIAL (7 DÍAS O MÁS) Y BORRADOR ACTIVO ---
    function obtenerHistorialFacturas() {
        const lista = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        return Array.isArray(lista) ? lista : [];
    }

    function guardarHistorialFacturas(listaFacturas) {
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, listaFacturas);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.HISTORIAL], 'readwrite');
                const store = tx.objectStore(STORES.HISTORIAL);
                store.clear();
                (listaFacturas || []).forEach(fac => {
                    if (fac && fac.id) {
                        store.put(fac);
                    }
                });
            } catch (e) {
                console.warn('[IndexedDB] Error guardando historial:', e);
            }
        });

        return resultado;
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
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, sesionActual);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.BORRADOR], 'readwrite');
                tx.objectStore(STORES.BORRADOR).put(sesionActual, 'activo');
            } catch (e) {
                console.warn('[IndexedDB] Error guardando borrador:', e);
            }
        });

        return resultado;
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

    async function leerArchivoJsonSubido(archivo) {
        if (!archivo) {
            throw new Error('No se seleccionó ningún archivo.');
        }
        if (Dominio && typeof Dominio.validarArchivoSeguro === 'function') {
            const validacion = await Dominio.validarArchivoSeguro(archivo, { tipoPermitido: 'json' });
            if (!validacion.valido) {
                throw new Error(validacion.error);
            }
        }
        return new Promise((resolve, reject) => {
            if (!archivo) {
                reject(new Error('No se seleccionó ningún archivo.'));
                return;
            }
            if (archivo.size > CONSTANTES.LIMITE_ARCHIVO_JSON_BYTES) {
                const mbPermitido = (CONSTANTES.LIMITE_ARCHIVO_JSON_BYTES / (1024 * 1024)).toFixed(0);
                reject(new Error(`El archivo supera el límite de seguridad de ${mbPermitido} MB.`));
                return;
            }
            const lector = new FileReader();
            lector.onload = () => {
                try {
                    const raw = JSON.parse(lector.result);
                    const sanitizado = (Dominio && typeof Dominio.sanitizarJsonSeguro === 'function')
                        ? Dominio.sanitizarJsonSeguro(raw)
                        : raw;
                    resolve(sanitizado);
                } catch (e) {
                    reject(new Error('El archivo seleccionado no tiene un formato JSON válido.'));
                }
            };
            lector.onerror = () => reject(new Error('No se pudo leer el archivo del disco.'));
            lector.readAsText(archivo);
        });
    }
// --- RESIDENCIA COMPLETA DE INDEXEDDB: RESPALDO Y RESTAURACIÓN MAESTRA ---
    function exportarBaseCompleta() {
        const diccionario = obtenerDiccionarioCodigos();
        const historial = obtenerHistorialFacturas();
        const borrador = cargarBorradorActivo();
        const reglas = obtenerReglasNegocio();

        const fechaIso = Dominio.obtenerFechaLocalISO();
        const objetoRespaldo = {
            tipo: CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fechaExportacion: new Date().toISOString(),
            descripcion: 'Copia de Seguridad Completa del Sistema (IndexedDB)',
            resumen: {
                totalProductosDiccionario: Object.keys(diccionario).length,
                totalFacturasHistorial: historial.length
            },
            datos: {
                diccionario,
                historial,
                borrador,
                reglas
            }
        };

        descargarObjetoComoJson(objetoRespaldo, `respaldo-completo-farmacia-${fechaIso}.json`);
    }

    function restaurarBaseCompleta(objetoRespaldo) {
        if (!objetoRespaldo || typeof objetoRespaldo !== 'object') {
            return { exito: false, error: 'El archivo de respaldo no es válido.' };
        }
        if (objetoRespaldo.tipo !== CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO) {
            if (objetoRespaldo.tipo === CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS) {
                return { exito: false, error: 'Has seleccionado un archivo de Diccionario de Códigos. Para restaurarlo, usa la opción "Cargar Diccionario (.json)" de arriba.' };
            }
            if (objetoRespaldo.tipo === CONSTANTES.TIPO_ARCHIVO_RESPALDO_FACTURAS) {
                return { exito: false, error: 'Has seleccionado un archivo de Historial de Facturas. Para restaurarlo, ve a la Bóveda de la Farmacia.' };
            }
            return { exito: false, error: 'El archivo no corresponde a una Copia de Seguridad Completa del Sistema.' };
        }
        const datos = objetoRespaldo.datos;
        if (!datos || typeof datos !== 'object') {
            return { exito: false, error: 'El archivo no contiene los datos del sistema.' };
        }

        if (datos.diccionario && typeof datos.diccionario === 'object') {
            guardarDiccionarioCodigos(datos.diccionario);
        }
        if (Array.isArray(datos.historial)) {
            guardarHistorialFacturas(datos.historial);
        }
        if (datos.borrador && typeof datos.borrador === 'object') {
            guardarBorradorActivo(datos.borrador);
        }
        if (datos.reglas && typeof datos.reglas === 'object') {
            guardarReglasNegocio(datos.reglas);
        }

        return {
            exito: true,
            totalProductos: Object.keys(datos.diccionario || {}).length,
            totalFacturas: (datos.historial || []).length
        };
    }


    // --- DIRECTORIO DE PROVEEDORES Y LABORATORIOS (RD) ---
    const PROVEEDORES_SEMILLA = Object.freeze([
        { rnc: '101023456', nombre: 'Droguería Betances', razonSocial: 'Droguería Betances, S.A.S.' },
        { rnc: '101012345', nombre: 'Droguería Farach', razonSocial: 'Droguería Farach, S.A.' },
        { rnc: '101098765', nombre: 'Laboratorios Rowe', razonSocial: 'Laboratorios Rowe, S.R.L.' },
        { rnc: '101054321', nombre: 'Ethical Farmacéutica', razonSocial: 'Ethical Farmacéutica, S.A.' },
        { rnc: '130123456', nombre: 'Suiphar Dominicana', razonSocial: 'Suiphar de la República Dominicana, S.R.L.' },
        { rnc: '101045678', nombre: 'Alfa Farmacéutica', razonSocial: 'Laboratorios Alfa, S.R.L.' }
    ]);

    function obtenerDirectorioProveedores() {
        const guardados = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, null);
        if (Array.isArray(guardados) && guardados.length > 0) {
            return guardados;
        }
        return [...PROVEEDORES_SEMILLA];
    }

    function guardarProveedorEnDirectorio(proveedor) {
        if (!proveedor || (!proveedor.rnc && !proveedor.nombre)) return false;
        const directorio = obtenerDirectorioProveedores();
        const rncLimpio = String(proveedor.rnc || '').replace(/\D/g, '');
        const nombreLimpio = String(proveedor.nombre || proveedor.razonSocial || '').trim();

        const idx = directorio.findIndex(p => {
            const rncP = String(p.rnc || '').replace(/\D/g, '');
            const nomP = String(p.nombre || p.razonSocial || '').toLowerCase().trim();
            return (rncLimpio && rncP === rncLimpio) || (nombreLimpio && nomP === nombreLimpio.toLowerCase());
        });

        const registro = {
            rnc: rncLimpio || (idx >= 0 ? directorio[idx].rnc : ''),
            nombre: nombreLimpio || (idx >= 0 ? directorio[idx].nombre : ''),
            razonSocial: String(proveedor.razonSocial || proveedor.nombre || (idx >= 0 ? directorio[idx].razonSocial : '')).trim(),
            actualizadoEn: new Date().toISOString()
        };

        if (idx >= 0) {
            directorio[idx] = { ...directorio[idx], ...registro };
        } else {
            directorio.push(registro);
        }

        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);
        return true;
    }

    function buscarProveedorPorRnc(rncCrudo) {
        const rnc = String(rncCrudo || '').replace(/\D/g, '');
        if (!rnc) return null;
        const directorio = obtenerDirectorioProveedores();
        return directorio.find(p => String(p.rnc || '').replace(/\D/g, '') === rnc) || null;
    }

    function buscarProveedorPorNombre(nombreCrudo) {
        const termino = String(nombreCrudo || '').toLowerCase().trim();
        if (!termino) return null;
        const directorio = obtenerDirectorioProveedores();
        return directorio.find(p =>
            String(p.nombre || '').toLowerCase().trim() === termino ||
            String(p.razonSocial || '').toLowerCase().trim() === termino
        ) || null;
    }

    AppFarmacia.Almacenamiento = Object.freeze({
        obtenerDirectorioProveedores,
        guardarProveedorEnDirectorio,
        buscarProveedorPorRnc,
        buscarProveedorPorNombre,
        leerJsonSeguro,
        escribirJsonSeguro,
        invalidarCacheStorage,
        inicializarPersistencia,
        sembrarCatalogoInicial,
        solicitarPersistenciaAlmacenamiento,
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
        leerArchivoJsonSubido,
        exportarBaseCompleta,
        restaurarBaseCompleta
    });
})(window);
