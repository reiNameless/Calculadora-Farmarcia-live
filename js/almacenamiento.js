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
    const DB_VERSION = 3;
    const STORES = Object.freeze({
        BORRADOR: 'borrador',
        HISTORIAL: 'historial_facturas',
        DICCIONARIO: 'diccionario_productos',
        CONFIGURACION: 'configuracion_reglas',
        PROVEEDORES: 'directorio_proveedores',
        LABORATORIOS: 'directorio_laboratorios'
    });

    let dbInstancia = null;
    let dbPromesa = null;

    // Caché en memoria de acceso ultra-rápido (0ms) para operaciones síncronas de UI
    const cacheStorage = new Map();
    let vademecumCache = [];

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
                    let storeDic;
                    if (!db.objectStoreNames.contains(STORES.DICCIONARIO)) {
                        storeDic = db.createObjectStore(STORES.DICCIONARIO, { keyPath: 'codigoBarras' });
                        storeDic.createIndex('nombre', 'nombre', { unique: false });
                        storeDic.createIndex('ultimoPrecioCaja', 'ultimoPrecioCaja', { unique: false });
                        storeDic.createIndex('actualizadoEn', 'actualizadoEn', { unique: false });
                    } else if (event.target.transaction) {
                        storeDic = event.target.transaction.objectStore(STORES.DICCIONARIO);
                    }

                    // Versión 2: Índices para catálogo maestro y futuro ERP
                    if (storeDic) {
                        if (!storeDic.indexNames.contains('principioActivo')) {
                            storeDic.createIndex('principioActivo', 'principioActivo', { unique: false });
                        }
                        if (!storeDic.indexNames.contains('laboratorio')) {
                            storeDic.createIndex('laboratorio', 'laboratorio', { unique: false });
                        }
                        if (!storeDic.indexNames.contains('proveedorHabitual')) {
                            storeDic.createIndex('proveedorHabitual', 'proveedorHabitual', { unique: false });
                        }
                        if (!storeDic.indexNames.contains('categoria')) {
                            storeDic.createIndex('categoria', 'categoria', { unique: false });
                        }
                    }

                    // 4. Configuración y reglas fiscales
                    if (!db.objectStoreNames.contains(STORES.CONFIGURACION)) {
                        db.createObjectStore(STORES.CONFIGURACION);
                    }

                    // 5. Directorio de Proveedores / Droguerías (Versión 3)
                    if (!db.objectStoreNames.contains(STORES.PROVEEDORES)) {
                        const storeProv = db.createObjectStore(STORES.PROVEEDORES, { keyPath: 'id' });
                        storeProv.createIndex('rnc', 'rnc', { unique: false });
                        storeProv.createIndex('nombre', 'nombre', { unique: false });
                        storeProv.createIndex('actualizadoEn', 'actualizadoEn', { unique: false });
                    }

                    // 6. Directorio de Laboratorios Fabricantes (Versión 3)
                    if (!db.objectStoreNames.contains(STORES.LABORATORIOS)) {
                        const storeLab = db.createObjectStore(STORES.LABORATORIOS, { keyPath: 'id' });
                        storeLab.createIndex('nombre', 'nombre', { unique: false });
                        storeLab.createIndex('origen', 'origen', { unique: false });
                        storeLab.createIndex('actualizadoEn', 'actualizadoEn', { unique: false });
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
                const storesRequeridos = [STORES.BORRADOR, STORES.HISTORIAL, STORES.DICCIONARIO, STORES.CONFIGURACION, STORES.PROVEEDORES, STORES.LABORATORIOS];
                const tx = db.transaction(storesRequeridos, 'readonly');
                const reqCountDic = tx.objectStore(STORES.DICCIONARIO).count();
                const reqCountHist = tx.objectStore(STORES.HISTORIAL).count();
                const reqCountProv = tx.objectStore(STORES.PROVEEDORES).count();
                const reqCountLab = tx.objectStore(STORES.LABORATORIOS).count();

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
                        const txCargar = db.transaction(storesRequeridos, 'readonly');
                        const reqGetAllDic = txCargar.objectStore(STORES.DICCIONARIO).getAll();
                        const reqGetAllHist = txCargar.objectStore(STORES.HISTORIAL).getAll();
                        const reqGetAllProv = txCargar.objectStore(STORES.PROVEEDORES).getAll();
                        const reqGetAllLab = txCargar.objectStore(STORES.LABORATORIOS).getAll();
                        const reqGetBorrador = txCargar.objectStore(STORES.BORRADOR).get('activo');
                        const reqGetReglas = txCargar.objectStore(STORES.CONFIGURACION).get('reglas_activas');
                        const reqGetVademecum = txCargar.objectStore(STORES.CONFIGURACION).get('vademecum_maestro');

                        txCargar.oncomplete = () => {
                            const listaProv = (reqGetAllProv.result && reqGetAllProv.result.length > 0)
                                ? reqGetAllProv.result
                                : obtenerDirectorioProveedores();
                            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, listaProv);

                            const listaLab = (reqGetAllLab.result && reqGetAllLab.result.length > 0)
                                ? reqGetAllLab.result
                                : obtenerDirectorioLaboratorios();
                            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, listaLab);

                            // Si las tablas de proveedores o laboratorios están vacías en IDB, sembrarlas
                            if (!reqGetAllProv.result || reqGetAllProv.result.length === 0) {
                                abrirBaseDatos().then(dbRef => {
                                    if (!dbRef) return;
                                    try {
                                        const txSeed = dbRef.transaction([STORES.PROVEEDORES], 'readwrite');
                                        listaProv.forEach(p => txSeed.objectStore(STORES.PROVEEDORES).put(p));
                                    } catch (_) {}
                                });
                            }
                            if (!reqGetAllLab.result || reqGetAllLab.result.length === 0) {
                                abrirBaseDatos().then(dbRef => {
                                    if (!dbRef) return;
                                    try {
                                        const txSeed = dbRef.transaction([STORES.LABORATORIOS], 'readwrite');
                                        listaLab.forEach(l => txSeed.objectStore(STORES.LABORATORIOS).put(l));
                                    } catch (_) {}
                                });
                            }
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
                            if (Array.isArray(reqGetVademecum.result) && reqGetVademecum.result.length > 0) {
                                vademecumCache = reqGetVademecum.result;
                            } else {
                                try {
                                    if (typeof window !== 'undefined' && window.localStorage) {
                                        const raw = localStorage.getItem('farmacia_vademecum_maestro');
                                        if (raw) vademecumCache = JSON.parse(raw);
                                    }
                                } catch (_) {}
                            }

                            console.info(`[IndexedDB] Activo: ${Object.keys(dicMap).length} productos en inventario, ${vademecumCache.length} en vademécum y ${(reqGetAllHist.result || []).length} facturas.`);
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
        if (diccionario && typeof diccionario === 'object' && Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function') {
            for (const k in diccionario) {
                if (diccionario[k] && diccionario[k].nombre && diccionario[k].nombre !== 'Producto sin nombre' && !/^Producto #\d+$/i.test(diccionario[k].nombre)) {
                    diccionario[k].nombre = Dominio.estandarizarNombreFarmaceutico(diccionario[k].nombre);
                }
            }
        }
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

    function aprenderProductoEnDiccionario(lineaProducto, contextoFactura = {}) {
        const codigo = Dominio.normalizarCodigoBarras(lineaProducto.codigoBarras);
        const nombreCandidato = String(lineaProducto.nombre || '').trim();
        const esNombreGenerico = !nombreCandidato || /^Producto #\d+$/i.test(nombreCandidato) || nombreCandidato === 'Producto IA' || nombreCandidato === 'Producto';
        if (!codigo) return false;

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo];

        // PROTECCIÓN DE INTEGRIDAD DE CATÁLOGO MAESTRO:
        // Si el producto ya está registrado en el catálogo, su nombre y configuración taxonómica
        // quedan blindados para impedir sobreescritura accidental desde el cockpit de cálculo.
        let nombreFinal = nombreCandidato;
        let tipo = lineaProducto.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        let tasaItbis = (lineaProducto.tasaItbis !== undefined && Number.isFinite(Number(lineaProducto.tasaItbis)))
            ? Number(lineaProducto.tasaItbis)
            : (lineaProducto.aplicaItbis ? 18 : 0);
        let unidadesPorCaja = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Number(lineaProducto.unidadesPorCaja) || 1;
        let esLeche = Boolean(lineaProducto.esLeche);

        if (existente && existente.nombre && !lineaProducto._esEdicionCatalogo) {
            // Producto preexistente en catálogo: preservar nombre oficial y atributos de empaque
            nombreFinal = existente.nombre;
            if (existente.tipo) tipo = existente.tipo;
            if (existente.unidadesPorCaja && existente.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
                unidadesPorCaja = Number(existente.unidadesPorCaja) || 1;
            }
            if (existente.tasaItbis !== undefined) {
                tasaItbis = Number(existente.tasaItbis);
            }
            if (existente.esLeche !== undefined) {
                esLeche = Boolean(existente.esLeche);
            }
        } else if (esNombreGenerico && existente && existente.nombre && !/^Producto #\d+$/i.test(existente.nombre)) {
            nombreFinal = existente.nombre;
        } else if (!nombreFinal) {
            nombreFinal = 'Producto sin nombre';
        }

        if (nombreFinal && nombreFinal !== 'Producto sin nombre' && !/^Producto #\d+$/i.test(nombreFinal)) {
            if (Dominio && typeof Dominio.normalizarNombreProductoMayusculas === 'function') {
                nombreFinal = Dominio.normalizarNombreProductoMayusculas(nombreFinal);
            } else if (Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function') {
                nombreFinal = Dominio.estandarizarNombreFarmaceutico(nombreFinal);
            }
        }

        const precioCajaActual = Number(lineaProducto.precioCajaBase) || 0;
        const costoAnteriorCaja = (existente && existente.ultimoPrecioCaja && Number(existente.ultimoPrecioCaja) > 0)
            ? Number(existente.ultimoPrecioCaja)
            : 0;

        let variacionCosto = 0;
        if (costoAnteriorCaja > 0 && precioCajaActual > 0) {
            variacionCosto = (Dominio && typeof Dominio.calcularVariacionCostoPorcentaje === 'function')
                ? Dominio.calcularVariacionCostoPorcentaje(precioCajaActual, costoAnteriorCaja)
                : Math.round(((precioCajaActual - costoAnteriorCaja) / costoAnteriorCaja) * 10000) / 100;
        } else if (existente && existente.variacionCosto !== undefined) {
            variacionCosto = existente.variacionCosto;
        }

        const proveedor = (contextoFactura && contextoFactura.proveedor) || lineaProducto.proveedor || (existente && existente.proveedorHabitual) || '';
        const rncProveedor = (contextoFactura && contextoFactura.rnc) || lineaProducto.rncProveedor || (existente && existente.rncProveedor) || '';
        const numeroFactura = (contextoFactura && contextoFactura.numeroFactura) || lineaProducto.numeroFactura || '';

        // Trazabilidad de costos históricos (hasta 20 registros)
        const historialCostos = Array.isArray(existente && existente.historialCostos)
            ? [...existente.historialCostos]
            : [];

        if (precioCajaActual > 0) {
            historialCostos.unshift({
                fecha: (contextoFactura && contextoFactura.fechaEmision) || (Dominio ? Dominio.obtenerFechaLocalISO() : new Date().toISOString().slice(0, 10)),
                precioCaja: precioCajaActual,
                costoUnitarioFiscal: lineaProducto.costoUnitario || (Dominio && Dominio.formatearCostoFiscalOchoDecimales
                    ? Dominio.formatearCostoFiscalOchoDecimales(precioCajaActual / (tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(lineaProducto.unidadesPorCaja) || 1)))
                    : (precioCajaActual / (tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(lineaProducto.unidadesPorCaja) || 1))).toFixed(8)),
                proveedor,
                rnc: rncProveedor,
                numeroFactura,
                descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                aplicaItbis: tasaItbis > 0
            });
            if (historialCostos.length > 20) {
                historialCostos.length = 20;
            }
        }

        const fichaActualizada = {
            ...(existente || {}),
            codigoBarras: codigo,
            nombre: nombreFinal,
            nombreComercial: lineaProducto.nombreComercial || (existente && existente.nombreComercial) || nombreFinal,
            principioActivo: lineaProducto.principioActivo || (existente && existente.principioActivo) || '',
            laboratorio: lineaProducto.laboratorio || (existente && existente.laboratorio) || '',
            concentracion: lineaProducto.concentracion || (existente && existente.concentracion) || '',
            categoria: lineaProducto.categoria || (existente && existente.categoria) || '',
            presentacion: lineaProducto.presentacion || (existente && existente.presentacion) || '',
            formaFarmaceutica: lineaProducto.formaFarmaceutica || (existente && existente.formaFarmaceutica) || '',
            registroSanitario: lineaProducto.registroSanitario || (existente && existente.registroSanitario) || '',
            condicionVenta: lineaProducto.condicionVenta || (existente && existente.condicionVenta) || 'OTC',
            ubicacion: lineaProducto.ubicacion || (existente && existente.ubicacion) || '',
            proveedorHabitual: proveedor,
            rncProveedor: rncProveedor,
            tipo,
            unidadesPorCaja: tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : unidadesPorCaja,
            ultimoPrecioCaja: precioCajaActual > 0 ? precioCajaActual : ((existente && existente.ultimoPrecioCaja) || 0),
            costoAnteriorCaja: costoAnteriorCaja,
            variacionCosto: variacionCosto,
            costoUnitarioFiscal: lineaProducto.costoUnitario || (existente && existente.costoUnitarioFiscal) || (Dominio && Dominio.formatearCostoFiscalOchoDecimales
                ? Dominio.formatearCostoFiscalOchoDecimales(precioCajaActual / (tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(lineaProducto.unidadesPorCaja) || 1)))
                : (precioCajaActual / (tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(lineaProducto.unidadesPorCaja) || 1))).toFixed(8)),
            preciosVenta: lineaProducto.precios ? {
                p1Exacto: lineaProducto.precios.p1Exacto,
                p1Redondeado: lineaProducto.precios.p1Redondeado,
                p2Exacto: lineaProducto.precios.p2Exacto,
                p2Redondeado: lineaProducto.precios.p2Redondeado,
                p3Exacto: lineaProducto.precios.p3Exacto,
                p3Redondeado: lineaProducto.precios.p3Redondeado
            } : (existente && existente.preciosVenta ? existente.preciosVenta : null),
            historialCostos,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche,
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
            descuentoGlobalValor: 0,
            descuentoGlobalTipo: 'monto',
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
            descuentoGlobalValor: Number(borrador.descuentoGlobalValor) || 0,
            descuentoGlobalTipo: borrador.descuentoGlobalTipo === 'porcentaje' ? 'porcentaje' : 'monto',
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
    function descargarObjetoComoJson(objetoDatos, nombreArchivo, tipoArchivo = null) {
        let objetoFinal = objetoDatos;
        if (tipoArchivo && Dominio && typeof Dominio.firmarSobreDatos === 'function') {
            objetoFinal = Dominio.firmarSobreDatos(objetoDatos, tipoArchivo);
        }
        const contenido = JSON.stringify(objetoFinal, null, 2);
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
                reglas,
                proveedores: obtenerDirectorioProveedores(),
                laboratorios: obtenerDirectorioLaboratorios()
            }
        };

        descargarObjetoComoJson(objetoRespaldo, `respaldo-completo-farmacia-${fechaIso}.json`, CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO);
    }

    function restaurarBaseCompleta(objetoCandidato) {
        if (!objetoCandidato || typeof objetoCandidato !== 'object') {
            return { exito: false, error: 'El archivo de respaldo no es válido.' };
        }
        let objetoRespaldo = objetoCandidato;
        if (Dominio && typeof Dominio.verificarSobreDatos === 'function') {
            const verif = Dominio.verificarSobreDatos(objetoCandidato, CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO);
            if (!verif.esValido) {
                if (verif.esLegacy && objetoCandidato.tipo === CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO) {
                    objetoRespaldo = objetoCandidato;
                } else {
                    return { exito: false, error: verif.error, codigo: verif.codigo };
                }
            } else {
                objetoRespaldo = verif.datos;
            }
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
        if (Array.isArray(datos.proveedores)) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, datos.proveedores);
            escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, datos.proveedores);
            abrirBaseDatos().then(db => {
                if (!db) return;
                try {
                    const tx = db.transaction([STORES.PROVEEDORES], 'readwrite');
                    datos.proveedores.forEach(p => tx.objectStore(STORES.PROVEEDORES).put(p));
                } catch (_) {}
            });
        }
        if (Array.isArray(datos.laboratorios)) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, datos.laboratorios);
            escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, datos.laboratorios);
            abrirBaseDatos().then(db => {
                if (!db) return;
                try {
                    const tx = db.transaction([STORES.LABORATORIOS], 'readwrite');
                    datos.laboratorios.forEach(l => tx.objectStore(STORES.LABORATORIOS).put(l));
                } catch (_) {}
            });
        }

        return {
            exito: true,
            totalProductos: Object.keys(datos.diccionario || {}).length,
            totalFacturas: (datos.historial || []).length
        };
    }


    // --- DIRECTORIO DE PROVEEDORES / DROGUERÍAS (RD) ---
    const PROVEEDORES_SEMILLA = Object.freeze([
        { id: 'prov_betances', rnc: '101023456', nombre: 'Droguería Betances', razonSocial: 'Droguería Betances, S.A.S.', telefono: '(809) 565-1234', contacto: 'Ventas Institucionales', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_farach', rnc: '101012345', nombre: 'Droguería Farach', razonSocial: 'Droguería Farach, S.A.', telefono: '(809) 567-5678', contacto: 'Despacho Farmacias', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_ethical', rnc: '101054321', nombre: 'Ethical Farmacéutica', razonSocial: 'Ethical Farmacéutica, S.A.', telefono: '(809) 530-1122', contacto: 'Servicio al Cliente', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_suiphar', rnc: '130123456', nombre: 'Suiphar Dominicana', razonSocial: 'Suiphar de la República Dominicana, S.R.L.', telefono: '(809) 540-3344', contacto: 'Representante Médico', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_corripio', rnc: '101002233', nombre: 'Distribuidora Corripio', razonSocial: 'Distribuidora Corripio, S.A.S.', telefono: '(809) 227-2000', contacto: 'Consumo Masivo / Conveniencia', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_mallas', rnc: '101004455', nombre: 'Mallas y Enlaces', razonSocial: 'Mallas y Enlaces Farmacéuticos, S.R.L.', telefono: '(809) 688-9900', contacto: 'Distribución Nacional', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' }
    ]);

    // --- DIRECTORIO DE LABORATORIOS FABRICANTES (RD E INTERNACIONALES) ---
    const LABORATORIOS_SEMILLA = Object.freeze([
        { id: 'lab_rowe', nombre: 'Laboratorios Rowe', razonSocial: 'Laboratorios Rowe, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Laboratorios Rowe', telefono: '(809) 560-6000', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_lam', nombre: 'Laboratorios LAM', razonSocial: 'Laboratorios de Aplicaciones Médicas (LAM), S.R.L.', origen: 'Nacional RD', titularRegistro: 'LAM Dominicana', telefono: '(809) 565-5555', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_magnachem', nombre: 'Magnachem International', razonSocial: 'Magnachem International Pharmaceuticals, S.A.', origen: 'Nacional RD', titularRegistro: 'Magnachem Corp', telefono: '(809) 560-1200', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_alfa', nombre: 'Laboratorios Alfa', razonSocial: 'Laboratorios Alfa, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Alfa Farmacéutica', telefono: '(809) 534-7121', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_sued', nombre: 'Sued Farmacéutica', razonSocial: 'Sued Farmacéutica, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Sued Fargesa', telefono: '(809) 582-4141', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_bayer', nombre: 'Bayer', razonSocial: 'Bayer S.A. / Consumer Health', origen: 'Importado', titularRegistro: 'Bayer AG Alemania', telefono: '(809) 544-2400', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_pfizer', nombre: 'Pfizer', razonSocial: 'Pfizer Free Zone Panamá / RD', origen: 'Importado', titularRegistro: 'Pfizer Inc.', telefono: '(809) 562-4111', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_novartis', nombre: 'Novartis', razonSocial: 'Novartis Pharma AG', origen: 'Importado', titularRegistro: 'Novartis Pharma', telefono: '(809) 563-7111', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_abbott', nombre: 'Abbott Laboratories', razonSocial: 'Abbott Laboratories Dominicana', origen: 'Importado', titularRegistro: 'Abbott USA', telefono: '(809) 567-2200', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_sanofi', nombre: 'Sanofi', razonSocial: 'Sanofi-Aventis de la República Dominicana', origen: 'Importado', titularRegistro: 'Sanofi Francia', telefono: '(809) 540-0202', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_philips_avent', nombre: 'Philips Avent', razonSocial: 'Philips Consumer Lifestyle B.V.', origen: 'Importado', titularRegistro: 'Philips Puericultura', telefono: '(809) 565-1122', actualizadoEn: '2026-11-09T00:00:00.000Z' }
    ]);

    function obtenerDirectorioProveedores() {
        if (cacheStorage.has(CONSTANTES.CLAVES_STORAGE.PROVEEDORES)) {
            return cacheStorage.get(CONSTANTES.CLAVES_STORAGE.PROVEEDORES);
        }
        const guardados = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, null);
        if (Array.isArray(guardados) && guardados.length > 0) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, guardados);
            return guardados;
        }
        const iniciales = PROVEEDORES_SEMILLA.map(p => ({ ...p }));
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, iniciales);
        return iniciales;
    }

    function guardarProveedorEnDirectorio(proveedor) {
        if (!proveedor || (!proveedor.rnc && !proveedor.nombre)) return false;
        const directorio = obtenerDirectorioProveedores().map(p => ({ ...p }));
        const rncLimpio = String(proveedor.rnc || '').replace(/\D/g, '');
        const nombreLimpio = String(proveedor.nombre || proveedor.razonSocial || '').trim();

        const idTarget = proveedor.id || (rncLimpio ? ('prov_' + rncLimpio) : ('prov_' + Dominio.generarIdUnico()));
        const idx = directorio.findIndex(p => {
            if (proveedor.id && p.id === proveedor.id) return true;
            const rncP = String(p.rnc || '').replace(/\D/g, '');
            const nomP = String(p.nombre || p.razonSocial || '').toLowerCase().trim();
            return (rncLimpio && rncP === rncLimpio) || (nombreLimpio && nomP === nombreLimpio.toLowerCase());
        });

        const registro = {
            id: (idx >= 0 ? directorio[idx].id : idTarget),
            rnc: rncLimpio || (idx >= 0 ? directorio[idx].rnc : ''),
            nombre: nombreLimpio || (idx >= 0 ? directorio[idx].nombre : ''),
            razonSocial: String(proveedor.razonSocial || proveedor.nombre || (idx >= 0 ? directorio[idx].razonSocial : '')).trim(),
            telefono: String(proveedor.telefono || (idx >= 0 ? (directorio[idx].telefono || '') : '')).trim(),
            contacto: String(proveedor.contacto || (idx >= 0 ? (directorio[idx].contacto || '') : '')).trim(),
            diasCredito: parseInt(proveedor.diasCredito !== undefined ? proveedor.diasCredito : (idx >= 0 ? directorio[idx].diasCredito : 30), 10) || 30,
            descuentoHabitual: parseFloat(proveedor.descuentoHabitual !== undefined ? proveedor.descuentoHabitual : (idx >= 0 ? directorio[idx].descuentoHabitual : 0)) || 0,
            actualizadoEn: new Date().toISOString()
        };

        if (idx >= 0) {
            directorio[idx] = { ...directorio[idx], ...registro };
        } else {
            directorio.push(registro);
        }

        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.PROVEEDORES], 'readwrite');
                tx.objectStore(STORES.PROVEEDORES).put(registro);
            } catch (e) {
                console.warn('[IndexedDB] Error guardando proveedor:', e);
            }
        });
        return true;
    }

    function eliminarProveedorDeDirectorio(idProveedor) {
        if (!idProveedor) return false;
        const directorio = obtenerDirectorioProveedores().filter(p => p.id !== idProveedor);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.PROVEEDORES], 'readwrite');
                tx.objectStore(STORES.PROVEEDORES).delete(idProveedor);
            } catch (e) {
                console.warn('[IndexedDB] Error eliminando proveedor:', e);
            }
        });
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

    // --- CRUD DE LABORATORIOS FABRICANTES ---
    function obtenerDirectorioLaboratorios() {
        if (cacheStorage.has(CONSTANTES.CLAVES_STORAGE.LABORATORIOS)) {
            return cacheStorage.get(CONSTANTES.CLAVES_STORAGE.LABORATORIOS);
        }
        const guardados = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, null);
        if (Array.isArray(guardados) && guardados.length > 0) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, guardados);
            return guardados;
        }
        const iniciales = LABORATORIOS_SEMILLA.map(l => ({ ...l }));
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, iniciales);
        return iniciales;
    }

    function guardarLaboratorioEnDirectorio(lab) {
        if (!lab || !lab.nombre) return false;
        const directorio = obtenerDirectorioLaboratorios().map(l => ({ ...l }));
        const nombreLimpio = String(lab.nombre || '').trim();
        const idTarget = lab.id || ('lab_' + Dominio.generarIdUnico());

        const idx = directorio.findIndex(l => {
            if (lab.id && l.id === lab.id) return true;
            return l.nombre.toLowerCase().trim() === nombreLimpio.toLowerCase();
        });

        const registro = {
            id: (idx >= 0 ? directorio[idx].id : idTarget),
            nombre: nombreLimpio,
            razonSocial: String(lab.razonSocial || (idx >= 0 ? directorio[idx].razonSocial : nombreLimpio)).trim(),
            origen: String(lab.origen || (idx >= 0 ? directorio[idx].origen : 'Nacional RD')).trim(),
            titularRegistro: String(lab.titularRegistro || (idx >= 0 ? (directorio[idx].titularRegistro || '') : '')).trim(),
            telefono: String(lab.telefono || (idx >= 0 ? (directorio[idx].telefono || '') : '')).trim(),
            actualizadoEn: new Date().toISOString()
        };

        if (idx >= 0) {
            directorio[idx] = { ...directorio[idx], ...registro };
        } else {
            directorio.push(registro);
        }

        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, directorio);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, directorio);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.LABORATORIOS], 'readwrite');
                tx.objectStore(STORES.LABORATORIOS).put(registro);
            } catch (e) {
                console.warn('[IndexedDB] Error guardando laboratorio:', e);
            }
        });
        return true;
    }

    function eliminarLaboratorioDeDirectorio(idLab) {
        if (!idLab) return false;
        const directorio = obtenerDirectorioLaboratorios().filter(l => l.id !== idLab);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, directorio);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, directorio);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.LABORATORIOS], 'readwrite');
                tx.objectStore(STORES.LABORATORIOS).delete(idLab);
            } catch (e) {
                console.warn('[IndexedDB] Error eliminando laboratorio:', e);
            }
        });
        return true;
    }

    function buscarLaboratorioPorNombre(nombreCrudo) {
        const termino = String(nombreCrudo || '').toLowerCase().trim();
        if (!termino) return null;
        const directorio = obtenerDirectorioLaboratorios();
        return directorio.find(l =>
            l.nombre.toLowerCase().trim() === termino ||
            String(l.razonSocial || '').toLowerCase().trim() === termino
        ) || null;
    }

    
    function descargarTextoComoArchivo(contenidoTexto, nombreArchivo, mimeType = 'text/csv;charset=utf-8;') {
        if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
        const blob = new Blob([contenidoTexto], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombreArchivo;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        setTimeout(() => URL.revokeObjectURL(url), CONSTANTES.TIEMPO_REVOCAR_URL_MS);
    }

    function exportarCatalogoMaestroCsv() {
        const diccionario = obtenerDiccionarioCodigos();
        const csvContenido = Dominio.generarCsvCatalogoMaestro(diccionario);
        const fechaIso = Dominio.obtenerFechaLocalISO();
        descargarTextoComoArchivo(csvContenido, `catalogo-maestro-farmacia-${fechaIso}.csv`, 'text/csv;charset=utf-8;');
        return {
            exito: true,
            totalProductos: Object.keys(diccionario || {}).length
        };
    }

        // --- EDICIÓN DELIBERADA DE FICHA MAESTRA EN CATÁLOGO / AJUSTES ---
    function guardarFichaProductoCatalogo(ficha) {
        if (!ficha || !ficha.codigoBarras) return { exito: false, error: 'Código de barras no proporcionado.' };
        const codigo = Dominio.normalizarCodigoBarras(ficha.codigoBarras);
        if (!codigo) return { exito: false, error: 'Código de barras no válido.' };

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo] || {};

        const tipo = ficha.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        const unidadesPorCaja = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Math.max(1, parseInt(ficha.unidadesPorCaja, 10) || 1);
        const tasaItbis = Number(ficha.tasaItbis) || (ficha.aplicaItbis ? 18 : 0);

        const nombreCrudo = String(ficha.nombre || existente.nombre || 'Producto sin nombre').trim();
        const nombreFinal = (Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function' && nombreCrudo !== 'Producto sin nombre')
            ? Dominio.estandarizarNombreFarmaceutico(nombreCrudo)
            : nombreCrudo;

        const fichaActualizada = {
            ...existente,
            codigoBarras: codigo,
            nombre: nombreFinal,
            nombreComercial: String(ficha.nombreComercial || ficha.nombre || existente.nombreComercial || nombreFinal).trim(),
            principioActivo: String(ficha.principioActivo || '').trim(),
            laboratorio: String(ficha.laboratorio || '').trim(),
            concentracion: String(ficha.concentracion || '').trim(),
            categoria: String(ficha.categoria || 'General / Otros').trim(),
            presentacion: String(ficha.presentacion || '').trim(),
            formaFarmaceutica: String(ficha.formaFarmaceutica || '').trim(),
            registroSanitario: String(ficha.registroSanitario || '').trim(),
            condicionVenta: String(ficha.condicionVenta || 'OTC').trim(),
            ubicacion: String(ficha.ubicacion || '').trim(),
            proveedorHabitual: String(ficha.proveedorHabitual || existente.proveedorHabitual || '').trim(),
            rncProveedor: String(ficha.rncProveedor || existente.rncProveedor || '').trim(),
            tipo,
            unidadesPorCaja,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche: Boolean(ficha.esLeche),
            ultimoPrecioCaja: Number(ficha.ultimoPrecioCaja !== undefined ? ficha.ultimoPrecioCaja : (existente.ultimoPrecioCaja || 0)),
            actualizadoEn: new Date().toISOString()
        };

        // Auto-alimentación inteligente: Registrar laboratorio si es nuevo
        if (fichaActualizada.laboratorio && fichaActualizada.laboratorio.length >= 2) {
            const labExistente = buscarLaboratorioPorNombre(fichaActualizada.laboratorio);
            if (!labExistente) {
                guardarLaboratorioEnDirectorio({
                    nombre: fichaActualizada.laboratorio,
                    origen: 'Nacional RD'
                });
            }
        }
        // Auto-alimentación inteligente: Registrar proveedor si es nuevo
        if (fichaActualizada.proveedorHabitual && fichaActualizada.proveedorHabitual.length >= 2) {
            const provExistente = buscarProveedorPorNombre(fichaActualizada.proveedorHabitual);
            if (!provExistente) {
                guardarProveedorEnDirectorio({
                    nombre: fichaActualizada.proveedorHabitual,
                    rnc: fichaActualizada.rncProveedor || ''
                });
            }
        }

        diccionario[codigo] = fichaActualizada;
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        abrirBaseDatos().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(fichaActualizada);
            } catch (e) {
                console.warn('[IndexedDB] Error guardando ficha en catálogo:', e);
            }
        });

        return { exito: true, producto: fichaActualizada };
    }

    // --- VADEMÉCUM MAESTRO OFICIAL DIGEMAPS (CATÁLOGO DE REFERENCIA RD) ---
    function guardarVademecumMaestro(listaMedicamentos) {
        if (!Array.isArray(listaMedicamentos)) return { exito: false, error: 'Formato de Vademécum inválido' };
        vademecumCache = listaMedicamentos.filter(m => m && (m.nombreComercial || m.nombre));

        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem('farmacia_vademecum_maestro', JSON.stringify(vademecumCache));
            }
        } catch (e) {
            console.warn('[Almacenamiento] No se pudo guardar Vademécum en localStorage:', e);
        }

        ejecutarConDb(db => {
            try {
                const tx = db.transaction([STORES.CONFIGURACION], 'readwrite');
                tx.objectStore(STORES.CONFIGURACION).put(vademecumCache, 'vademecum_maestro');
            } catch (err) {
                console.warn('[IndexedDB] Error persistiendo vademecum_maestro:', err);
            }
        });

        return { exito: true, total: vademecumCache.length };
    }

    function obtenerVademecumMaestro() {
        return [...vademecumCache];
    }

    function buscarEnVademecum(termino, limite = 10) {
        if (!termino || typeof termino !== 'string') return [];
        const q = termino.trim().toLowerCase();
        if (q.length < 2) return [];

        const resultados = [];
        for (const med of vademecumCache) {
            const nom = (med.nombreComercial || med.nombre || '').toLowerCase();
            const act = (med.principioActivo || '').toLowerCase();
            const lab = (med.laboratorio || '').toLowerCase();
            const reg = (med.registroSanitario || '').toLowerCase();

            if (nom.includes(q) || act.includes(q) || lab.includes(q) || reg.includes(q)) {
                resultados.push(med);
                if (resultados.length >= limite) break;
            }
        }
        return resultados;
    }

    // --- SINCRONIZACIÓN Y FUSIÓN DE CATÁLOGO ENTRE COMPUTADORAS (SMART DELTA) ---
    function exportarParcheParaOtraCaja() {
        const diccionario = obtenerDiccionarioCodigos();
        const sobre = Dominio.generarSobreParcheCatalogo(diccionario);
        const fechaIso = Dominio.obtenerFechaLocalISO();
        descargarObjetoComoJson(sobre, `parche-catalogo-farmacia-${fechaIso}.json`, CONSTANTES.TIPO_ARCHIVO_PARCHE_CATALOGO);
    }

    function fusionarCatalogoDesdeArchivo(objetoCandidato, opciones = { modo: 'fusion' }) {
        if (!objetoCandidato || typeof objetoCandidato !== 'object') {
            return { exito: false, error: 'El archivo recibido no es un objeto JSON válido.' };
        }

        let datos = objetoCandidato;
        if (Dominio && typeof Dominio.verificarSobreDatos === 'function') {
            const verif = Dominio.verificarSobreDatos(objetoCandidato, [
                CONSTANTES.TIPO_ARCHIVO_PARCHE_CATALOGO,
                CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS,
                CONSTANTES.TIPO_ARCHIVO_RESPALDO_COMPLETO
            ]);
            if (verif.esValido) {
                datos = verif.datos;
            } else if (!verif.esLegacy) {
                return { exito: false, error: verif.error, codigo: verif.codigo };
            }
        }

        // 1. Detección polimórfica de Vademécum Oficial DIGEMAPS (sin códigos de barras obligatorios iniciales)
        if (datos.tipo === 'vademecum-digemaps' || (Array.isArray(datos.medicamentos) && datos.medicamentos.length > 0)) {
            const medicamentos = datos.medicamentos || [];
            const resVad = guardarVademecumMaestro(medicamentos);
            return {
                exito: true,
                tipo: 'vademecum-digemaps',
                total: resVad.total,
                mensaje: `Vademécum Oficial DIGEMAPS cargado con éxito (${resVad.total} medicamentos). Listo para enlazado en mostrador.`
            };
        }

        const esConveniencia = datos.tipo === 'catalogo-conveniencia';

        // Extracción flexible de productos según esquema
        let items = null;
        if (datos.datos && datos.datos.diccionario && typeof datos.datos.diccionario === 'object') {
            items = datos.datos.diccionario;
        } else if (datos.diccionario && typeof datos.diccionario === 'object' && !Array.isArray(datos.diccionario)) {
            items = datos.diccionario;
        } else if (datos.datos && typeof datos.datos === 'object' && !Array.isArray(datos.datos)) {
            items = datos.datos;
        } else if (Array.isArray(datos)) {
            items = {};
            datos.forEach(p => { if (p && p.codigoBarras) items[p.codigoBarras] = p; });
        } else if (Array.isArray(datos.productos)) {
            items = {};
            datos.productos.forEach(p => { if (p && p.codigoBarras) items[p.codigoBarras] = p; });
        } else if (typeof datos === 'object' && !Array.isArray(datos)) {
            items = datos;
        }

        if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
            return { exito: false, error: 'El archivo no contiene productos reconocibles para fusionar.' };
        }

        const actual = obtenerDiccionarioCodigos();
        const resultadoFusion = Dominio.fusionarDiccionarios(actual, items, opciones);

        guardarDiccionarioCodigos(resultadoFusion.diccionarioFusionado);

        return {
            exito: true,
            tipo: esConveniencia ? 'catalogo-conveniencia' : 'diccionario',
            total: Object.keys(items).length,
            estadisticas: resultadoFusion.estadisticas
        };
    }

    AppFarmacia.Almacenamiento = Object.freeze({
        guardarVademecumMaestro,
        obtenerVademecumMaestro,
        buscarEnVademecum,
        guardarFichaProductoCatalogo,
        descargarTextoComoArchivo,
        exportarCatalogoMaestroCsv,
        exportarParcheParaOtraCaja,
        fusionarCatalogoDesdeArchivo,

        obtenerDirectorioProveedores,
        guardarProveedorEnDirectorio,
        eliminarProveedorDeDirectorio,
        buscarProveedorPorRnc,
        buscarProveedorPorNombre,
        obtenerDirectorioLaboratorios,
        guardarLaboratorioEnDirectorio,
        eliminarLaboratorioDeDirectorio,
        buscarLaboratorioPorNombre,
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
