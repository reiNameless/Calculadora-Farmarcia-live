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
    const DB_VERSION = 4;
    const STORES = Object.freeze({
        BORRADOR: 'borrador',
        HISTORIAL: 'historial_facturas',
        DICCIONARIO: 'diccionario_productos',
        CONFIGURACION: 'configuracion_reglas',
        PROVEEDORES: 'directorio_proveedores',
        LABORATORIOS: 'directorio_laboratorios',
        SEGURIDAD: 'seguridad_boveda'
    });

    let dbInstancia = null;
    let dbPromesa = null;

    // Caché en memoria de acceso ultra-rápido (0ms) únicamente en el cierre del módulo (nunca en window/localStorage)
    const cacheStorage = new Map();
    // Conserva sobres cifrados por código mientras la bóveda está bloqueada para nunca sobreescribir secretos al editar campos públicos
    const encDiccionarioBlobs = new Map();
    let vademecumCache = [];
    let colaEscriturasIdb = Promise.resolve();

    function obtenerSeguridad() {
        return AppFarmacia.Seguridad || null;
    }

    function encolarOperacionIdb(fnAsync) {
        const tarea = colaEscriturasIdb.then(async () => {
            try {
                return await fnAsync();
            } catch (e) {
                console.warn('[Almacenamiento/Cripto] Error en operación asíncrona:', e);
                return { exito: false, error: e.message };
            }
        });
        colaEscriturasIdb = tarea.catch(() => {});
        return tarea;
    }

    function limpiarLocalStorageSensible() {
        if (typeof localStorage !== 'undefined') {
            [
                CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO,
                CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS,
                CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS,
                CONSTANTES.CLAVES_STORAGE.PROVEEDORES,
                CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO,
                CONSTANTES.CLAVES_STORAGE.IA_API_KEY,
                CONSTANTES.CLAVES_STORAGE.IA_MODELO
            ].forEach(clave => {
                try { localStorage.removeItem(clave); } catch (_) {}
            });
        }
        if (typeof sessionStorage !== 'undefined') {
            try { sessionStorage.removeItem(CONSTANTES.CLAVES_STORAGE.IA_API_KEY); } catch (_) {}
        }
    }

    function extraerSubconjuntoCampos(item, listaCampos) {
        if (!item || typeof item !== 'object') return null;
        const salida = {};
        let tieneDatos = false;
        for (const c of listaCampos) {
            const val = item[c];
            if (val === undefined || val === null || val === '') continue;
            if (Array.isArray(val) && val.length === 0) continue;
            if (typeof val === 'number' && val === 0 &&
                (c === 'ultimoPrecioCaja' || c === 'costoAnteriorCaja' || c === 'variacionCosto' || c === 'descuentoValor') &&
                !item.esBonificacionCruzada) {
                continue;
            }
            salida[c] = Dominio.clonarObjetoSeguro(val);
            tieneDatos = true;
        }
        return tieneDatos ? salida : null;
    }

    function extraerCamposCajaProducto(item) {
        const camposCaja = (CONSTANTES && Array.isArray(CONSTANTES.CAMPOS_OPERATIVOS_CAJA))
            ? CONSTANTES.CAMPOS_OPERATIVOS_CAJA
            : ['ultimoPrecioCaja', 'costoAnteriorCaja', 'variacionCosto', 'costoUnitarioFiscal', 'costoReferencia', 'preciosVenta'];
        return extraerSubconjuntoCampos(item, camposCaja);
    }

    function extraerCamposAdminProducto(item) {
        const camposAdmin = ['historialCostos', 'proveedorHabitual', 'rncProveedor', 'ubicacion', 'descuentoValor', 'tipoDescuento', 'descuentoTotalLinea'];
        return extraerSubconjuntoCampos(item, camposAdmin);
    }

    function extraerCamposSensiblesProducto(item) {
        if (!item || typeof item !== 'object') return null;
        const campos = (CONSTANTES && Array.isArray(CONSTANTES.CAMPOS_SENSIBLES_CATALOGO))
            ? CONSTANTES.CAMPOS_SENSIBLES_CATALOGO
            : [
                'ultimoPrecioCaja', 'costoAnteriorCaja', 'variacionCosto',
                'costoUnitarioFiscal', 'costoUnitario', 'costoUnitarioVenta',
                'costoReferencia', 'preciosVenta', 'historialCostos',
                'descuentoValor', 'tipoDescuento', 'descuentoTotalLinea',
                'proveedorHabitual', 'rncProveedor', 'ubicacion'
            ];
        return extraerSubconjuntoCampos(item, campos);
    }

    async function empaquetarProductoParaIdb(item) {
        const publico = Dominio.sanitizarFichaPublicaCatalogo(item);
        if (!publico || !publico.codigoBarras) return null;

        const cod = publico.codigoBarras;
        const Seg = obtenerSeguridad();

        if (Seg && Seg.estaConfigurado()) {
            const previo = encDiccionarioBlobs.get(cod) || {};
            const adminAbierto = typeof Seg.estaAdminDesbloqueado === 'function' ? Seg.estaAdminDesbloqueado() : !Seg.estaBloqueado();
            const cajaAbierta = typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : adminAbierto;

            const reg = { ...publico };

            if (adminAbierto) {
                const datosCaja = extraerCamposCajaProducto(item);
                const datosAdmin = extraerCamposAdminProducto(item);

                if (datosCaja) {
                    reg._segCaja = await Seg.cifrarParaCaja(datosCaja, cod);
                } else if (previo._segCaja && !item._forzarLimpiarCaja) {
                    reg._segCaja = previo._segCaja;
                }

                if (datosAdmin) {
                    reg._segAdmin = await Seg.cifrarJson(datosAdmin, { scope: 'admin', codigoBarras: cod });
                } else if (previo._segAdmin && !item._forzarLimpiarAdmin) {
                    reg._segAdmin = previo._segAdmin;
                }
                if (previo._segPendienteAdmin && !item._limpiarPendienteAdmin) {
                    reg._segPendienteAdmin = previo._segPendienteAdmin;
                }
            } else if (cajaAbierta) {
                const datosCaja = extraerCamposCajaProducto(item);
                if (datosCaja) {
                    reg._segCaja = await Seg.cifrarParaCaja(datosCaja, cod);
                } else if (previo._segCaja) {
                    reg._segCaja = previo._segCaja;
                }
                if (previo._segAdmin) reg._segAdmin = previo._segAdmin;
                if (previo._segCifrado) reg._segCifrado = previo._segCifrado;
                if (Array.isArray(item._segPendienteAdmin)) {
                    reg._segPendienteAdmin = item._segPendienteAdmin;
                } else if (previo._segPendienteAdmin) {
                    reg._segPendienteAdmin = previo._segPendienteAdmin;
                }
            } else {
                // Bloqueado total: preservar intactos todos los sobres previos en disco
                if (previo._segCaja) reg._segCaja = previo._segCaja;
                if (previo._segAdmin) reg._segAdmin = previo._segAdmin;
                if (previo._segCifrado) reg._segCifrado = previo._segCifrado;
                if (previo._segPendienteAdmin) reg._segPendienteAdmin = previo._segPendienteAdmin;
            }

            encDiccionarioBlobs.set(cod, {
                _segCaja: reg._segCaja || null,
                _segAdmin: reg._segAdmin || null,
                _segCifrado: reg._segCifrado || null,
                _segPendienteAdmin: Array.isArray(reg._segPendienteAdmin) ? reg._segPendienteAdmin : null
            });
            return reg;
        }

        // Sin cifrado configurado todavía: mantener registro completo en IDB hasta activar contraseña
        return { ...Dominio.clonarObjetoSeguro(item), ...publico };
    }

    async function desempaquetarProductoDesdeIdb(registro) {
        if (!registro || typeof registro !== 'object' || !registro.codigoBarras) return null;
        const publico = Dominio.sanitizarFichaPublicaCatalogo(registro);
        if (!publico || !publico.codigoBarras) return null;
        const cod = publico.codigoBarras;
        const Seg = obtenerSeguridad();

        if (Seg && Seg.estaConfigurado()) {
            // Almacenar únicamente sobres cifrados en memoria interna privada (cero descifrado masivo en RAM)
            const tieneCifrado = Boolean(registro._segCaja || registro._segAdmin || registro._segCifrado || registro._segPendienteAdmin);
            if (tieneCifrado) {
                encDiccionarioBlobs.set(cod, {
                    _segCaja: registro._segCaja || null,
                    _segAdmin: registro._segAdmin || null,
                    _segCifrado: registro._segCifrado || null,
                    _segPendienteAdmin: Array.isArray(registro._segPendienteAdmin) ? registro._segPendienteAdmin : null
                });
            }
            return publico;
        }

        // Sin cifrado configurado aún
        const copia = Dominio.clonarObjetoSeguro(registro);
        delete copia._segCifrado;
        delete copia._segCaja;
        delete copia._segAdmin;
        delete copia._segPendienteAdmin;
        return copia;
    }

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

                    // 7. Metadatos de Bóveda Cifrada y Contraseña Maestra (Versión 4)
                    if (!db.objectStoreNames.contains(STORES.SEGURIDAD)) {
                        db.createObjectStore(STORES.SEGURIDAD);
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

    // --- LECTURA Y ESCRITURA EN CACHÉ DE RAM (SIN EXPOSICIÓN EN LOCALSTORAGE PARA SECRETOS) ---
    function esClaveDatosSensibles(claveStorage) {
        return [
            CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO,
            CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS,
            CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS,
            CONSTANTES.CLAVES_STORAGE.PROVEEDORES,
            CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO
        ].includes(claveStorage);
    }

    function leerJsonSeguro(claveStorage, valorPorDefecto) {
        if (cacheStorage.has(claveStorage)) {
            return Dominio.clonarObjetoSeguro(cacheStorage.get(claveStorage));
        }
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && esClaveDatosSensibles(claveStorage)) {
            return Dominio.clonarObjetoSeguro(valorPorDefecto);
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
        const Seg = obtenerSeguridad();
        // Prohibición AppSec: datos sensibles jamás se duplican en texto plano en localStorage cuando hay IndexedDB o cifrado activo
        if (esClaveDatosSensibles(claveStorage) && (indexedDBRef !== null || (Seg && Seg.estaConfigurado()))) {
            return { exito: true };
        }
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(claveStorage, JSON.stringify(datos));
            }
            return { exito: true };
        } catch (error) {
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
            let respuesta = await fetch("./catalogo_farmacia_extenso.json").catch(() => null);
            if (!respuesta || !respuesta.ok) {
                respuesta = await fetch("./catalogo_rd_inicial.json").catch(() => null);
            }
            if (!respuesta || !respuesta.ok) {
                return { sembrado: false, motivo: "No se encontró archivo de catálogo inicial en el servidor.", totalProductos: 0 };
            }
            const contenido = await respuesta.json();
            if (!contenido || !contenido.diccionario || typeof contenido.diccionario !== "object") {
                return { sembrado: false, motivo: "Estructura inválida en archivo de catálogo.", totalProductos: 0 };
            }
            const dicSemilla = Dominio.sanitizarDiccionarioPublico(Dominio.sanitizarJsonSeguro(contenido.diccionario));
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

    // --- INICIALIZACIÓN ASÍNCRONA, SEGURIDAD Y MIGRACIÓN AUTOMÁTICA ---
    async function inicializarPersistencia() {
        const db = await abrirBaseDatos();
        solicitarPersistenciaAlmacenamiento();
        if (!db) {
            console.info('[Almacenamiento] IndexedDB no soportada; operando con almacenamiento estándar.');
            return false;
        }

        const claveMeta = (CONSTANTES.SEGURIDAD_BOVEDA && CONSTANTES.SEGURIDAD_BOVEDA.CLAVE_META_BOVEDA) || 'vault_meta';
        const storesRequeridos = [
            STORES.BORRADOR, STORES.HISTORIAL, STORES.DICCIONARIO,
            STORES.CONFIGURACION, STORES.PROVEEDORES, STORES.LABORATORIOS, STORES.SEGURIDAD
        ];

        const snapshot = await new Promise((resolve) => {
            try {
                const tx = db.transaction(storesRequeridos, 'readonly');
                const reqMeta = tx.objectStore(STORES.SEGURIDAD).get(claveMeta);
                const reqGetAllDic = tx.objectStore(STORES.DICCIONARIO).getAll();
                const reqGetAllHist = tx.objectStore(STORES.HISTORIAL).getAll();
                const reqGetAllProv = tx.objectStore(STORES.PROVEEDORES).getAll();
                const reqGetAllLab = tx.objectStore(STORES.LABORATORIOS).getAll();
                const reqGetBorrador = tx.objectStore(STORES.BORRADOR).get('activo');
                const reqGetReglas = tx.objectStore(STORES.CONFIGURACION).get('reglas_activas');
                const reqGetVademecum = tx.objectStore(STORES.CONFIGURACION).get('vademecum_maestro');

                tx.oncomplete = () => resolve({
                    ok: true,
                    vaultMeta: reqMeta.result || null,
                    dic: reqGetAllDic.result || [],
                    hist: reqGetAllHist.result || [],
                    prov: reqGetAllProv.result || [],
                    lab: reqGetAllLab.result || [],
                    borrador: reqGetBorrador.result || null,
                    reglas: reqGetReglas.result || null,
                    vademecum: reqGetVademecum.result || null
                });
                tx.onerror = () => resolve({ ok: false });
            } catch (error) {
                console.warn('[IndexedDB] Error leyendo stores iniciales:', error);
                resolve({ ok: false });
            }
        });

        if (!snapshot.ok) return false;

        const Seg = obtenerSeguridad();
        if (Seg) {
            Seg.establecerMetadatosPersistidos(snapshot.vaultMeta);
        }

        // Siempre erradicar copias planas heredadas de localStorage cuando IndexedDB está activa
        limpiarLocalStorageSensible();

        // Poblar Vademécum y Laboratorios (datos sanitarios públicos)
        if (Array.isArray(snapshot.vademecum) && snapshot.vademecum.length > 0) {
            vademecumCache = snapshot.vademecum;
        }
        const listaLab = fusionarSemillasConGuardados(snapshot.lab, LABORATORIOS_SEMILLA);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, listaLab);
        if (snapshot.lab.length === 0) {
            try {
                const txSeedLab = db.transaction([STORES.LABORATORIOS], 'readwrite');
                listaLab.forEach(l => txSeedLab.objectStore(STORES.LABORATORIOS).put(l));
            } catch (_) {}
        }

        // Si IndexedDB está vacía por primera vez y no hay contraseña configurada aún
        if (snapshot.dic.length === 0 && snapshot.hist.length === 0 && !(Seg && Seg.estaConfigurado())) {
            const listaProvInit = fusionarSemillasConGuardados(snapshot.prov, PROVEEDORES_SEMILLA);
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, listaProvInit);
            if (snapshot.prov.length === 0) {
                try {
                    const txSeedProv = db.transaction([STORES.PROVEEDORES], 'readwrite');
                    listaProvInit.forEach(p => txSeedProv.objectStore(STORES.PROVEEDORES).put(p));
                } catch (_) {}
            }
            const resSeed = await sembrarCatalogoInicial(false);
            return Boolean(resSeed && resSeed.sembrado);
        }

        // Depuración segura de facturas caducadas (> 7 días) por timestampGuardado sin perder vigentes
        const ahora = Date.now();
        const idsExpirados = snapshot.hist
            .filter(fac => fac && fac.id && (ahora - (Number(fac.timestampGuardado) || ahora)) > CONSTANTES.DIAS_RETENCION_HISTORIAL_MS)
            .map(fac => fac.id);
        if (idsExpirados.length > 0) {
            try {
                const txPurge = db.transaction([STORES.HISTORIAL], 'readwrite');
                const storeHist = txPurge.objectStore(STORES.HISTORIAL);
                idsExpirados.forEach(idExp => storeHist.delete(idExp));
            } catch (_) {}
        }
        const histVigente = snapshot.hist.filter(fac => !idsExpirados.includes(fac?.id));

        // Desempaquetar catálogo: si está bloqueado, SOLO carga fichas sanitarias públicas y guarda sobres cifrados
        const dicMap = {};
        for (const item of snapshot.dic) {
            const proc = await desempaquetarProductoDesdeIdb(item);
            if (proc && proc.codigoBarras) {
                dicMap[proc.codigoBarras] = proc;
            }
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicMap);

        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            // Modo Cifrado Bloqueado: secretos comerciales inaccesibles hasta contraseña maestra
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, []);
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, crearSesionVacia());
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, Dominio.clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO));
            console.info(`[IndexedDB/Cripto] Modo Protegido Bloqueado: ${Object.keys(dicMap).length} fichas públicas cargadas. Secretos cifrados en reposo.`);
            return true;
        }

        // Modo sin cifrado aún (o desbloqueado)
        const listaProv = fusionarSemillasConGuardados(snapshot.prov, PROVEEDORES_SEMILLA);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, listaProv);
        if (snapshot.prov.length === 0) {
            try {
                const txSeedProv = db.transaction([STORES.PROVEEDORES], 'readwrite');
                listaProv.forEach(p => txSeedProv.objectStore(STORES.PROVEEDORES).put(p));
            } catch (_) {}
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, histVigente);
        if (snapshot.borrador && !snapshot.borrador._segCifrado) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, snapshot.borrador);
        }
        if (snapshot.reglas && !snapshot.reglas._segCifrado) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, snapshot.reglas);
        }

        console.info(`[IndexedDB] Activo: ${Object.keys(dicMap).length} productos, ${vademecumCache.length} en vademécum y ${histVigente.length} facturas.`);
        return true;
    }

    // --- GESTIÓN DE REGLAS DE CÁLCULO ---
    function obtenerReglasNegocio() {
        const Seg = obtenerSeguridad();
        const puedeVerReglas = !Seg || !Seg.estaConfigurado() || (typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : !Seg.estaBloqueado());
        if (!puedeVerReglas) {
            return Dominio.sanitizarReglasNegocio(REGLAS_NEGOCIO_POR_DEFECTO);
        }
        const guardadas = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, REGLAS_NEGOCIO_POR_DEFECTO);
        return Dominio.sanitizarReglasNegocio(guardadas);
    }

    function guardarReglasNegocio(nuevasReglas) {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return { exito: false, bloqueado: true, error: 'Bóveda bloqueada. Desbloquea con contraseña de administrador para guardar reglas.' };
        }
        const sanitizadas = Dominio.sanitizarReglasNegocio(nuevasReglas);
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, sanitizadas);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const adminActivo = Seg && Seg.estaConfigurado() && !Seg.estaBloqueado();
            const payload = adminActivo ? await Seg.cifrarJson(sanitizadas) : sanitizadas;
            const payloadCaja = (adminActivo && typeof Seg.estaCajaConfigurada === 'function' && Seg.estaCajaConfigurada())
                ? await Seg.cifrarParaCaja(sanitizadas, 'reglas_caja')
                : null;
            const tx = db.transaction([STORES.CONFIGURACION], 'readwrite');
            const st = tx.objectStore(STORES.CONFIGURACION);
            st.put(payload, 'reglas_activas');
            if (payloadCaja) {
                st.put(payloadCaja, 'reglas_caja');
            } else if (adminActivo) {
                st.delete('reglas_caja');
            }
        });

        return {
            ...resultado,
            reglas: sanitizadas
        };
    }

    // --- DICCIONARIO PERMANENTE DE CÓDIGOS DE BARRA (FICHAS PÚBLICAS EN RAM + DESCIFRADO JIT) ---
    function obtenerDiccionarioCodigos() {
        const dic = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
        if (!dic || typeof dic !== 'object' || Array.isArray(dic)) return {};
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado()) {
            return Dominio.sanitizarDiccionarioPublico(dic);
        }
        return dic;
    }

    function guardarDiccionarioCodigos(diccionario) {
        if (diccionario && typeof diccionario === 'object' && Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function') {
            for (const k in diccionario) {
                if (diccionario[k] && diccionario[k].nombre && diccionario[k].nombre !== 'Producto sin nombre' && !/^Producto #\d+$/i.test(diccionario[k].nombre)) {
                    diccionario[k].nombre = Dominio.estandarizarNombreFarmaceutico(diccionario[k].nombre);
                }
            }
        }
        const Seg = obtenerSeguridad();
        const configurado = Boolean(Seg && Seg.estaConfigurado());
        const dicParaRam = configurado
            ? Dominio.sanitizarDiccionarioPublico(diccionario)
            : diccionario;

        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicParaRam);
        const fuenteItems = Object.values((configurado && (!Seg.estaBloqueado() || (typeof Seg.estaCajaActiva === 'function' && Seg.estaCajaActiva()))) ? (diccionario || {}) : (dicParaRam || {}))
            .map(x => Dominio.clonarObjetoSeguro(x));

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const empaquetados = (await Promise.all(fuenteItems.map(empaquetarProductoParaIdb))).filter(Boolean);
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            const store = tx.objectStore(STORES.DICCIONARIO);
            empaquetados.forEach(item => store.put(item));
        });

        return resultado;
    }

    function buscarProductoPorCodigo(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        if (!codigo) return null;
        const diccionario = obtenerDiccionarioCodigos();
        return diccionario[codigo] || null;
    }

    async function leerRegistroCrudoDiccionarioIdb(codigo) {
        const db = await abrirBaseDatos();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const tx = db.transaction([STORES.DICCIONARIO], 'readonly');
                const req = tx.objectStore(STORES.DICCIONARIO).get(codigo);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    }

    async function obtenerSobresCodigoJit(codigo) {
        let blob = encDiccionarioBlobs.get(codigo);
        if (!blob) {
            const regIdb = await leerRegistroCrudoDiccionarioIdb(codigo);
            if (regIdb) {
                blob = {
                    _segCaja: regIdb._segCaja || null,
                    _segAdmin: regIdb._segAdmin || null,
                    _segCifrado: regIdb._segCifrado || null,
                    _segPendienteAdmin: Array.isArray(regIdb._segPendienteAdmin) ? regIdb._segPendienteAdmin : null
                };
                if (blob._segCaja || blob._segAdmin || blob._segCifrado || blob._segPendienteAdmin) {
                    encDiccionarioBlobs.set(codigo, blob);
                }
            }
        }
        return blob || null;
    }

    async function obtenerCostoOperativoProducto(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        if (!codigo) return null;
        const Seg = obtenerSeguridad();

        if (!Seg || !Seg.estaConfigurado()) {
            const dic = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
            const item = dic[codigo];
            if (!item) return null;
            return extraerCamposCajaProducto(item);
        }

        const cajaActiva = typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : !Seg.estaBloqueado();
        if (!cajaActiva) return null;

        const blob = await obtenerSobresCodigoJit(codigo);
        if (!blob) return null;

        if (blob._segCaja) {
            try {
                return await Seg.descifrarDeCaja(blob._segCaja, codigo);
            } catch (e) {
                console.warn(`[Cripto] No se pudo descifrar _segCaja de ${codigo}:`, e);
            }
        }

        if (blob._segCifrado && !Seg.estaBloqueado()) {
            try {
                const legacy = await Seg.descifrarJson(blob._segCifrado);
                return extraerCamposCajaProducto(legacy);
            } catch (_) {}
        }

        return null;
    }

    async function obtenerDetalleProductoAdmin(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        if (!codigo) return null;
        const dic = obtenerDiccionarioCodigos();
        const basePublica = dic[codigo] ? Dominio.clonarObjetoSeguro(dic[codigo]) : null;
        if (!basePublica) return null;

        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado()) {
            const completo = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
            return completo[codigo] ? Dominio.clonarObjetoSeguro(completo[codigo]) : basePublica;
        }
        if (Seg.estaBloqueado()) {
            return basePublica;
        }

        const blob = await obtenerSobresCodigoJit(codigo);
        if (!blob) return basePublica;

        let extraCaja = {};
        let extraAdmin = {};
        let extraLegacy = {};
        if (blob._segCifrado) {
            try { extraLegacy = await Seg.descifrarJson(blob._segCifrado); } catch (_) {}
        }
        if (blob._segCaja) {
            try { extraCaja = await Seg.descifrarDeCaja(blob._segCaja, codigo); } catch (_) {}
        }
        if (blob._segAdmin) {
            try { extraAdmin = await Seg.descifrarJson(blob._segAdmin, { scope: 'admin', codigoBarras: codigo }); } catch (_) {}
        }

        return { ...basePublica, ...extraLegacy, ...extraAdmin, ...extraCaja };
    }

    async function obtenerResumenCostosTablaSiAdmin() {
        const mapa = new Map();
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado()) {
            const dic = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
            for (const [cod, item] of Object.entries(dic || {})) {
                if (!item) continue;
                mapa.set(cod, {
                    ultimoPrecioCaja: item.ultimoPrecioCaja,
                    variacionCosto: item.variacionCosto
                });
            }
            return mapa;
        }
        if (Seg.estaBloqueado()) return mapa;

        for (const [cod, blob] of encDiccionarioBlobs.entries()) {
            try {
                let datos = null;
                if (blob._segCaja) {
                    datos = await Seg.descifrarDeCaja(blob._segCaja, cod);
                } else if (blob._segCifrado) {
                    datos = await Seg.descifrarJson(blob._segCifrado);
                }
                if (datos) {
                    mapa.set(cod, {
                        ultimoPrecioCaja: datos.ultimoPrecioCaja,
                        variacionCosto: datos.variacionCosto
                    });
                }
            } catch (_) {}
        }
        return mapa;
    }

    function aprenderProductoEnDiccionario(lineaProducto, contextoFactura = {}) {
        const codigo = Dominio.normalizarCodigoBarras(lineaProducto.codigoBarras);
        const nombreCandidato = String(lineaProducto.nombre || '').trim();
        const esNombreGenerico = !nombreCandidato || /^Producto #\d+$/i.test(nombreCandidato) || nombreCandidato === 'Producto IA' || nombreCandidato === 'Producto';
        if (!codigo) return false;

        const dicActual = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
        const existente = dicActual[codigo];
        const Seg = obtenerSeguridad();
        const configurado = Boolean(Seg && Seg.estaConfigurado());
        const adminAbierto = !configurado || (typeof Seg.estaAdminDesbloqueado === 'function' ? Seg.estaAdminDesbloqueado() : !Seg.estaBloqueado());
        const cajaAbierta = !configurado || (typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : adminAbierto);

        let nombreFinal = nombreCandidato;
        let tipo = lineaProducto.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        let tasaItbis = (lineaProducto.tasaItbis !== undefined && Number.isFinite(Number(lineaProducto.tasaItbis)))
            ? Number(lineaProducto.tasaItbis)
            : (lineaProducto.aplicaItbis ? 18 : 0);
        let unidadesPorCaja = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Number(lineaProducto.unidadesPorCaja) || 1;
        let esLeche = Boolean(lineaProducto.esLeche);

        if (existente && existente.nombre && !lineaProducto._esEdicionCatalogo) {
            nombreFinal = existente.nombre;
            if (existente.tipo) tipo = existente.tipo;
            if (existente.unidadesPorCaja && existente.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE) {
                unidadesPorCaja = Number(existente.unidadesPorCaja) || 1;
            }
            if (existente.tasaItbis !== undefined) tasaItbis = Number(existente.tasaItbis);
            if (existente.esLeche !== undefined) esLeche = Boolean(existente.esLeche);
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

        const fichaPublica = Dominio.sanitizarFichaPublicaCatalogo({
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
            tipo,
            unidadesPorCaja: tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : unidadesPorCaja,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche,
            actualizadoEn: new Date().toISOString()
        });

        const precioCajaActual = Number(lineaProducto.precioCajaBase) || 0;
        const proveedor = (contextoFactura && contextoFactura.proveedor) || lineaProducto.proveedor || '';
        const rncProveedor = (contextoFactura && contextoFactura.rnc) || lineaProducto.rncProveedor || '';
        const fechaCompra = (contextoFactura && contextoFactura.fechaEmision) || (Dominio ? Dominio.obtenerFechaLocalISO() : new Date().toISOString().slice(0, 10));
        const unidadesReales = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : unidadesPorCaja;
        const costoUnitCalculado = lineaProducto.costoUnitario || (Dominio && Dominio.formatearCostoFiscalOchoDecimales
            ? Dominio.formatearCostoFiscalOchoDecimales(precioCajaActual / unidadesReales)
            : (precioCajaActual / unidadesReales).toFixed(8));
        const preciosVentaActual = lineaProducto.precios ? {
            p1Exacto: lineaProducto.precios.p1Exacto,
            p1Redondeado: lineaProducto.precios.p1Redondeado,
            p2Exacto: lineaProducto.precios.p2Exacto,
            p2Redondeado: lineaProducto.precios.p2Redondeado,
            p3Exacto: lineaProducto.precios.p3Exacto,
            p3Redondeado: lineaProducto.precios.p3Redondeado
        } : null;

        if (!configurado) {
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
            const historialCostos = Array.isArray(existente && existente.historialCostos) ? [...existente.historialCostos] : [];
            if (precioCajaActual > 0) {
                historialCostos.unshift({
                    fecha: fechaCompra,
                    precioCaja: precioCajaActual,
                    costoUnitarioFiscal: costoUnitCalculado,
                    proveedor: proveedor || (existente && existente.proveedorHabitual) || '',
                    rnc: rncProveedor || (existente && existente.rncProveedor) || '',
                    descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                    tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                    aplicaItbis: tasaItbis > 0
                });
                if (historialCostos.length > 20) historialCostos.length = 20;
            }
            const fichaPlano = {
                ...(existente || {}),
                ...fichaPublica,
                ubicacion: lineaProducto.ubicacion || (existente && existente.ubicacion) || '',
                proveedorHabitual: proveedor || (existente && existente.proveedorHabitual) || '',
                rncProveedor: rncProveedor || (existente && existente.rncProveedor) || '',
                ultimoPrecioCaja: precioCajaActual > 0 ? precioCajaActual : ((existente && existente.ultimoPrecioCaja) || undefined),
                costoAnteriorCaja,
                variacionCosto,
                costoUnitarioFiscal: costoUnitCalculado,
                preciosVenta: preciosVentaActual || (existente && existente.preciosVenta ? existente.preciosVenta : null),
                historialCostos,
                descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto'
            };
            dicActual[codigo] = fichaPlano;
            escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicActual);
            const clonSnapshot = Dominio.clonarObjetoSeguro(fichaPlano);
            encolarOperacionIdb(async () => {
                const db = await abrirBaseDatos();
                if (!db) return;
                const regIdb = await empaquetarProductoParaIdb(clonSnapshot);
                if (!regIdb) return;
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(regIdb);
            });
            return true;
        }

        // Con bóveda configurada: cacheStorage mantiene exclusivamente fichas sanitarias públicas
        dicActual[codigo] = fichaPublica;
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicActual);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const blobPrevio = (await obtenerSobresCodigoJit(codigo)) || {};
            let cajaPrevia = null;
            let adminPrevio = null;

            if (cajaAbierta && blobPrevio._segCaja) {
                try { cajaPrevia = await Seg.descifrarDeCaja(blobPrevio._segCaja, codigo); } catch (_) {}
            }
            if (adminAbierto) {
                if (blobPrevio._segCifrado) {
                    try {
                        const leg = await Seg.descifrarJson(blobPrevio._segCifrado);
                        cajaPrevia = cajaPrevia || extraerCamposCajaProducto(leg);
                        adminPrevio = extraerCamposAdminProducto(leg);
                    } catch (_) {}
                }
                if (blobPrevio._segAdmin) {
                    try {
                        const adm = await Seg.descifrarJson(blobPrevio._segAdmin, { scope: 'admin', codigoBarras: codigo });
                        adminPrevio = { ...(adminPrevio || {}), ...adm };
                    } catch (_) {}
                }
            }

            if (adminAbierto) {
                const costoAnt = (cajaPrevia && cajaPrevia.ultimoPrecioCaja > 0) ? Number(cajaPrevia.ultimoPrecioCaja) : 0;
                let varPct = (cajaPrevia && cajaPrevia.variacionCosto !== undefined) ? cajaPrevia.variacionCosto : 0;
                if (costoAnt > 0 && precioCajaActual > 0) {
                    varPct = (Dominio && typeof Dominio.calcularVariacionCostoPorcentaje === 'function')
                        ? Dominio.calcularVariacionCostoPorcentaje(precioCajaActual, costoAnt)
                        : Math.round(((precioCajaActual - costoAnt) / costoAnt) * 10000) / 100;
                }
                const historial = Array.isArray(adminPrevio && adminPrevio.historialCostos) ? [...adminPrevio.historialCostos] : [];
                if (precioCajaActual > 0) {
                    historial.unshift({
                        fecha: fechaCompra,
                        precioCaja: precioCajaActual,
                        costoUnitarioFiscal: costoUnitCalculado,
                        proveedor: proveedor || (adminPrevio && adminPrevio.proveedorHabitual) || '',
                        rnc: rncProveedor || (adminPrevio && adminPrevio.rncProveedor) || '',
                        descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                        tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                        aplicaItbis: tasaItbis > 0
                    });
                    if (historial.length > 20) historial.length = 20;
                }

                const fichaCompleta = {
                    ...fichaPublica,
                    ultimoPrecioCaja: precioCajaActual > 0 ? precioCajaActual : ((cajaPrevia && cajaPrevia.ultimoPrecioCaja) || undefined),
                    costoAnteriorCaja: costoAnt,
                    variacionCosto: varPct,
                    costoUnitarioFiscal: costoUnitCalculado,
                    preciosVenta: preciosVentaActual || (cajaPrevia && cajaPrevia.preciosVenta) || null,
                    ubicacion: lineaProducto.ubicacion || (adminPrevio && adminPrevio.ubicacion) || '',
                    proveedorHabitual: proveedor || (adminPrevio && adminPrevio.proveedorHabitual) || '',
                    rncProveedor: rncProveedor || (adminPrevio && adminPrevio.rncProveedor) || '',
                    historialCostos: historial,
                    descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                    tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto'
                };
                const reg = await empaquetarProductoParaIdb(fichaCompleta);
                if (!reg) return;
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(reg);
                return;
            }

            if (cajaAbierta) {
                const costoAnt = (cajaPrevia && cajaPrevia.ultimoPrecioCaja > 0) ? Number(cajaPrevia.ultimoPrecioCaja) : 0;
                let varPct = (cajaPrevia && cajaPrevia.variacionCosto !== undefined) ? cajaPrevia.variacionCosto : 0;
                if (costoAnt > 0 && precioCajaActual > 0) {
                    varPct = (Dominio && typeof Dominio.calcularVariacionCostoPorcentaje === 'function')
                        ? Dominio.calcularVariacionCostoPorcentaje(precioCajaActual, costoAnt)
                        : Math.round(((precioCajaActual - costoAnt) / costoAnt) * 10000) / 100;
                }
                const fichaCaja = {
                    ...fichaPublica,
                    ultimoPrecioCaja: precioCajaActual > 0 ? precioCajaActual : ((cajaPrevia && cajaPrevia.ultimoPrecioCaja) || undefined),
                    costoAnteriorCaja: costoAnt,
                    variacionCosto: varPct,
                    costoUnitarioFiscal: costoUnitCalculado,
                    preciosVenta: preciosVentaActual || (cajaPrevia && cajaPrevia.preciosVenta) || null
                };
                if (Seg.tieneBuzonPublico() && (precioCajaActual > 0 || proveedor)) {
                    const deltaAdmin = {
                        fecha: fechaCompra,
                        precioCaja: precioCajaActual,
                        costoUnitarioFiscal: costoUnitCalculado,
                        proveedor,
                        rnc: rncProveedor,
                        descuentoValor: Number(lineaProducto.descuentoValor) || 0,
                        tipoDescuento: lineaProducto.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                        aplicaItbis: tasaItbis > 0
                    };
                    const sobreDelta = await Seg.sellarParaBuzonAdmin(deltaAdmin, { scope: 'delta_producto', codigoBarras: codigo });
                    const listaPend = Array.isArray(blobPrevio._segPendienteAdmin) ? [...blobPrevio._segPendienteAdmin, sobreDelta] : [sobreDelta];
                    fichaCaja._segPendienteAdmin = listaPend.slice(-20);
                }
                const reg = await empaquetarProductoParaIdb(fichaCaja);
                if (!reg) return;
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(reg);
                return;
            }

            // Bloqueado total: actualiza únicamente ficha sanitaria pública conservando secretos cifrados intactos
            const reg = await empaquetarProductoParaIdb(fichaPublica);
            if (!reg) return;
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            tx.objectStore(STORES.DICCIONARIO).put(reg);
        });

        return true;
    }

    function eliminarCodigoDeDiccionario(codigoCrudo) {
        const codigo = Dominio.normalizarCodigoBarras(codigoCrudo);
        const diccionario = obtenerDiccionarioCodigos();
        if (!diccionario[codigo]) return false;
        delete diccionario[codigo];
        encDiccionarioBlobs.delete(codigo);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            tx.objectStore(STORES.DICCIONARIO).delete(codigo);
        });

        return true;
    }

    // --- HISTORIAL (7 DÍAS), BUZÓN SELLADO Y BORRADOR ACTIVO ---
    function obtenerHistorialFacturas() {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return [];
        }
        const lista = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        return Array.isArray(lista) ? lista : [];
    }

    function guardarHistorialFacturas(listaFacturas) {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return { exito: false, bloqueado: true, error: 'Bóveda bloqueada. Desbloquea con contraseña de administrador para modificar facturas.' };
        }
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, listaFacturas);
        const listaClonada = (listaFacturas || []).map(f => Dominio.clonarObjetoSeguro(f)).filter(f => f && f.id);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            let payloads = listaClonada;
            if (Seg && Seg.estaConfigurado() && !Seg.estaBloqueado()) {
                payloads = await Promise.all(listaClonada.map(async fac => {
                    const env = await Seg.cifrarJson(fac, { id: fac.id, store: STORES.HISTORIAL });
                    return {
                        id: fac.id,
                        timestampGuardado: fac.timestampGuardado || Date.now(),
                        ...env
                    };
                }));
            }
            const tx = db.transaction([STORES.HISTORIAL], 'readwrite');
            const store = tx.objectStore(STORES.HISTORIAL);
            store.clear();
            payloads.forEach(reg => store.put(reg));
        });

        return resultado;
    }

    async function archivarFacturaEnBuzon(facturaCerrada) {
        if (!facturaCerrada || !facturaCerrada.id) {
            return { exito: false, error: 'Factura inválida para archivar.' };
        }
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado()) {
            const actual = obtenerHistorialFacturas();
            actual.unshift(Dominio.clonarObjetoSeguro(facturaCerrada));
            return guardarHistorialFacturas(actual);
        }

        const cajaActiva = typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : !Seg.estaBloqueado();
        if (!cajaActiva) {
            return { exito: false, bloqueado: true, error: 'Ingresa tu PIN de Mostrador o Contraseña Admin para archivar la factura.' };
        }

        const clon = Dominio.clonarObjetoSeguro(facturaCerrada);
        if (!Seg.estaBloqueado()) {
            const historial = obtenerHistorialFacturas();
            const idx = historial.findIndex(f => f.id === clon.id);
            if (idx >= 0) historial[idx] = clon;
            else historial.unshift(clon);
            return guardarHistorialFacturas(historial);
        }

        if (!Seg.tieneBuzonPublico || !Seg.tieneBuzonPublico()) {
            return { exito: false, bloqueado: true, error: 'Buzón sellado no disponible aún. Desbloquea Admin una vez para inicializar llaves.' };
        }

        const sobreBuzon = await Seg.sellarParaBuzonAdmin(clon, {
            id: clon.id,
            store: STORES.HISTORIAL,
            buzon: true
        });
        const regIdb = {
            id: clon.id,
            timestampGuardado: clon.timestampGuardado || Date.now(),
            ...sobreBuzon
        };

        await encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.HISTORIAL], 'readwrite');
            tx.objectStore(STORES.HISTORIAL).put(regIdb);
        });

        return { exito: true, selladaEnBuzon: true };
    }

    function limpiarHistorialExpirado7Dias() {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) return;
        const ahora = Date.now();
        const actual = obtenerHistorialFacturas();
        if (!actual.length) return;
        const vigentes = actual.filter(
            fac => (ahora - (Number(fac.timestampGuardado) || ahora)) <= CONSTANTES.DIAS_RETENCION_HISTORIAL_MS
        );
        if (vigentes.length !== actual.length) {
            guardarHistorialFacturas(vigentes);
        }
    }

    function crearSesionVacia() {
        const fechaEmision = Dominio.obtenerFechaLocalISO();
        return {
            id: null,
            folioInterno: '',
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
        const Seg = obtenerSeguridad();
        const puedeVerCaja = !Seg || !Seg.estaConfigurado() || (typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : !Seg.estaBloqueado());
        if (!puedeVerCaja) {
            return crearSesionVacia();
        }
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
        const Seg = obtenerSeguridad();
        const puedeGuardarCaja = !Seg || !Seg.estaConfigurado() || (typeof Seg.estaCajaActiva === 'function' ? Seg.estaCajaActiva() : !Seg.estaBloqueado());
        if (!puedeGuardarCaja) {
            return { exito: false, bloqueado: true };
        }
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, sesionActual);
        const clon = Dominio.clonarObjetoSeguro(sesionActual);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            let payload = clon;
            if (Seg && Seg.estaConfigurado()) {
                if (typeof Seg.estaCajaConfigurada === 'function' && Seg.estaCajaConfigurada()) {
                    payload = await Seg.cifrarParaCaja(clon, 'borrador');
                } else if (!Seg.estaBloqueado()) {
                    payload = await Seg.cifrarJson(clon, { scope: 'borrador' });
                } else {
                    return;
                }
            }
            const tx = db.transaction([STORES.BORRADOR], 'readwrite');
            tx.objectStore(STORES.BORRADOR).put(payload, 'activo');
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

    // --- BLOQUEO LEGAL DE EXPORTACIÓN TOTAL DE BASE DE DATOS ---
    function exportarBaseCompleta() {
        return {
            exito: false,
            bloqueadoPorLegalidad: true,
            error: 'La exportación completa del sistema fue eliminada por cumplimiento legal y protección de secretos comerciales.'
        };
    }

    function restaurarBaseCompleta() {
        return {
            exito: false,
            bloqueadoPorLegalidad: true,
            error: 'La restauración de respaldos totales fue deshabilitada. Utiliza los importadores de Catálogo Sanitario Público.'
        };
    }


    // --- DIRECTORIO DE PROVEEDORES / DISTRIBUIDORES OFICIALES (RD) ---
    const PROVEEDORES_SEMILLA = Object.freeze([
        { id: 'prov_betances', rnc: '101023456', nombre: 'Droguería Betances', razonSocial: 'Droguería Betances, S.A.S.', telefono: '(809) 565-1234', contacto: 'Ventas Institucionales / Farmacias', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_farach', rnc: '101012345', nombre: 'Droguería Farach', razonSocial: 'Droguería Farach, S.A.', telefono: '(809) 567-5678', contacto: 'Despacho Farmacias', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_suiphar', rnc: '130123456', nombre: 'Suiphar Dominicana', razonSocial: 'Suiphar de la República Dominicana, S.R.L.', telefono: '(809) 540-3344', contacto: 'División Farmacéutica', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_union', rnc: '101889922', nombre: 'Droguería Unión', razonSocial: 'Droguería Unión, S.A.S.', telefono: '(809) 562-7788', contacto: 'Pedidos Mayoristas', diasCredito: 45, descuentoHabitual: 5, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_san_luis', rnc: '102334455', nombre: 'Distribuidora San Luis', razonSocial: 'Distribuidora San Luis, S.R.L.', telefono: '(809) 598-1122', contacto: 'Atención a Farmacias', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_masso', rnc: '130998877', nombre: 'Farmacéutica Massó', razonSocial: 'Farmacéutica Massó Dominicana, S.A.', telefono: '(809) 537-8899', contacto: 'Distribución Nacional', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_ethical', rnc: '101054321', nombre: 'Ethical Farmacéutica', razonSocial: 'Ethical Farmacéutica, S.A.', telefono: '(809) 530-1122', contacto: 'Servicio al Cliente', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_corripio', rnc: '101002233', nombre: 'Distribuidora Corripio', razonSocial: 'Distribuidora Corripio, S.A.S.', telefono: '(809) 227-2000', contacto: 'Consumo Masivo / Conveniencia', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_mallas', rnc: '101004455', nombre: 'Mallas y Enlaces', razonSocial: 'Mallas y Enlaces Farmacéuticos, S.R.L.', telefono: '(809) 688-9900', contacto: 'Logística y Hospitales', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_macrofarma', rnc: '130887766', nombre: 'Macrofarma Dominicana', razonSocial: 'Macrofarma Dominicana, S.R.L.', telefono: '(809) 563-3322', contacto: 'Ventas Institucionales', diasCredito: 45, descuentoHabitual: 3, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_cedipharma', rnc: '131445566', nombre: 'CediPharma', razonSocial: 'Centro de Distribución Farmacéutica CediPharma, S.R.L.', telefono: '(809) 548-7711', contacto: 'Despacho Express', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_bassa', rnc: '101223344', nombre: 'Bassa Distribuidora', razonSocial: 'Bassa Distribución Farmacéutica, S.A.', telefono: '(809) 535-6677', contacto: 'Línea Dermatológica y Ética', diasCredito: 30, descuentoHabitual: 2, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_quimocaribe', rnc: '101665544', nombre: 'Quimocaribe', razonSocial: 'Químicos del Caribe, S.A.S.', telefono: '(809) 566-4455', contacto: 'Insumos y Material Médico', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_difarna', rnc: '101778899', nombre: 'DIFARNA', razonSocial: 'Distribuidores Farmacéuticos Nacionales, S.R.L.', telefono: '(809) 595-3344', contacto: 'Despacho Cibao y Norte', diasCredito: 45, descuentoHabitual: 4, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_repmed', rnc: '131998811', nombre: 'REPMED', razonSocial: 'Representaciones Médicas del Caribe, S.R.L.', telefono: '(809) 560-8800', contacto: 'Especialidades Médicas', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_gador', rnc: '131002233', nombre: 'Gador Dominicana', razonSocial: 'Gador Dominicana, S.R.L.', telefono: '(809) 472-1100', contacto: 'Fármacos de Alta Especialidad', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_profamilia', rnc: '101044556', nombre: 'Profamilia Distribución', razonSocial: 'Asociación Pro-Familia (Profamilia)', telefono: '(809) 689-0141', contacto: 'Salud Femenina y Reproductiva', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_farmacoop', rnc: '130556677', nombre: 'Farmacoop', razonSocial: 'Cooperativa de Farmacias Dominicanas', telefono: '(809) 561-2244', contacto: 'Alianza de Farmacias', diasCredito: 60, descuentoHabitual: 5, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_interfarma', rnc: '130778811', nombre: 'Interfarma Dominicana', razonSocial: 'Interfarma Dominicana, S.R.L.', telefono: '(809) 532-9900', contacto: 'Genéricos Bioequivalentes', diasCredito: 30, descuentoHabitual: 3, actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'prov_propharma', rnc: '131554433', nombre: 'Pro-Pharma Dominicana', razonSocial: 'Pro-Pharma Dominicana, S.A.', telefono: '(809) 541-6677', contacto: 'Insumos Hospitalarios', diasCredito: 30, descuentoHabitual: 0, actualizadoEn: '2026-11-09T00:00:00.000Z' }
    ]);

    // --- DIRECTORIO DE LABORATORIOS FABRICANTES (RD E INTERNACIONALES) ---
    const LABORATORIOS_SEMILLA = Object.freeze([
        { id: 'lab_rowe', nombre: 'Laboratorios Rowe', razonSocial: 'Laboratorios Rowe, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Laboratorios Rowe', telefono: '(809) 560-6000', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_lam', nombre: 'Laboratorios LAM', razonSocial: 'Laboratorios de Aplicaciones Médicas (LAM), S.R.L.', origen: 'Nacional RD', titularRegistro: 'LAM Dominicana', telefono: '(809) 565-5555', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_magnachem', nombre: 'Magnachem International', razonSocial: 'Magnachem International Pharmaceuticals, S.A.', origen: 'Nacional RD', titularRegistro: 'Magnachem Corp', telefono: '(809) 560-1200', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_acromax', nombre: 'Acromax Dominicana', razonSocial: 'Acromax Dominicana, C. por A.', origen: 'Nacional RD', titularRegistro: 'Acromax Dominicana', telefono: '(809) 565-4422', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_alfa', nombre: 'Laboratorios Alfa', razonSocial: 'Laboratorios Alfa, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Alfa Farmacéutica', telefono: '(809) 534-7121', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_sued', nombre: 'Sued Farmacéutica', razonSocial: 'Sued Farmacéutica, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Sued & Fargesa', telefono: '(809) 582-4141', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_ethical', nombre: 'Ethical Pharmaceutical', razonSocial: 'Ethical Pharmaceutical, S.A.', origen: 'Nacional RD', titularRegistro: 'Ethical Farmacéutica', telefono: '(809) 530-1122', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_infaca', nombre: 'Infaca', razonSocial: 'Industria Farmacéutica del Caribe (Infaca), S.A.', origen: 'Nacional RD', titularRegistro: 'Infaca RD', telefono: '(809) 566-2181', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_pharmatech', nombre: 'Pharmatech', razonSocial: 'Pharmatech Dominicana, S.A.', origen: 'Nacional RD', titularRegistro: 'Pharmatech', telefono: '(809) 535-7799', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_iberoventas', nombre: 'Iberoventas', razonSocial: 'Iberoventas / Iberofármacos, S.A.', origen: 'Nacional RD', titularRegistro: 'Iberofármacos', telefono: '(809) 563-8822', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_rowe_esp', nombre: 'Rowe Especialidades', razonSocial: 'Rowe Especialidades Médicas, S.R.L.', origen: 'Nacional RD', titularRegistro: 'Rowe RD', telefono: '(809) 560-6000', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_bayer', nombre: 'Bayer', razonSocial: 'Bayer S.A. / Consumer Health', origen: 'Importado', titularRegistro: 'Bayer AG Alemania', telefono: '(809) 544-2400', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_pfizer', nombre: 'Pfizer', razonSocial: 'Pfizer Free Zone Panamá / RD', origen: 'Importado', titularRegistro: 'Pfizer Inc. EE. UU.', telefono: '(809) 562-4111', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_novartis', nombre: 'Novartis', razonSocial: 'Novartis Pharma AG', origen: 'Importado', titularRegistro: 'Novartis Pharma Suiza', telefono: '(809) 563-7111', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_abbott', nombre: 'Abbott Laboratories', razonSocial: 'Abbott Laboratories Dominicana', origen: 'Importado', titularRegistro: 'Abbott USA', telefono: '(809) 567-2200', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_sanofi', nombre: 'Sanofi', razonSocial: 'Sanofi-Aventis de la República Dominicana', origen: 'Importado', titularRegistro: 'Sanofi Francia', telefono: '(809) 540-0202', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_gsk', nombre: 'GlaxoSmithKline (GSK)', razonSocial: 'GlaxoSmithKline Caribe, S.A.', origen: 'Importado', titularRegistro: 'GSK Reino Unido', telefono: '(809) 566-3399', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_astrazeneca', nombre: 'AstraZeneca', razonSocial: 'AstraZeneca Centroamérica y Caribe', origen: 'Importado', titularRegistro: 'AstraZeneca Reino Unido', telefono: '(809) 541-0022', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_roche', nombre: 'Roche', razonSocial: 'Roche Servicios Dominicana, S.A.', origen: 'Importado', titularRegistro: 'F. Hoffmann-La Roche Suiza', telefono: '(809) 563-5500', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_roemmers', nombre: 'Laboratorios Roemmers', razonSocial: 'Roemmers Centroamérica y Caribe', origen: 'Importado', titularRegistro: 'Roemmers Argentina', telefono: '(809) 562-8811', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_menarini', nombre: 'Menarini', razonSocial: 'Grupo Menarini Centroamérica y Caribe', origen: 'Importado', titularRegistro: 'Laboratorios Menarini España/Italia', telefono: '(809) 567-8899', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_chinoin', nombre: 'Laboratorios Chinoin', razonSocial: 'Productos Farmacéuticos Chinoin', origen: 'Importado', titularRegistro: 'Chinoin México', telefono: '(809) 540-5544', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_calox', nombre: 'Calox International', razonSocial: 'Calox Dominicana, S.A.', origen: 'Importado', titularRegistro: 'Calox International', telefono: '(809) 532-4411', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_mk', nombre: 'MK (Tecnoquímicas)', razonSocial: 'Tecnoquímicas Dominicana, S.A.', origen: 'Importado', titularRegistro: 'MK Colombia', telefono: '(809) 549-3388', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_medifarma', nombre: 'Medifarma', razonSocial: 'Medifarma Centroamérica y Caribe', origen: 'Importado', titularRegistro: 'Medifarma Perú', telefono: '(809) 567-9911', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_stein', nombre: 'Stein Corp', razonSocial: 'Laboratorios Stein Dominicana', origen: 'Importado', titularRegistro: 'Stein Costa Rica', telefono: '(809) 544-3322', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_philips_avent', nombre: 'Philips Avent', razonSocial: 'Philips Consumer Lifestyle B.V.', origen: 'Importado', titularRegistro: 'Philips Puericultura', telefono: '(809) 565-1122', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_jnj', nombre: 'Johnson & Johnson', razonSocial: 'Johnson & Johnson del Caribe', origen: 'Importado', titularRegistro: 'Kenvue / J&J EE. UU.', telefono: '(809) 563-4400', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_pg', nombre: 'Procter & Gamble (Salud)', razonSocial: 'P&G Dominicana', origen: 'Importado', titularRegistro: 'P&G Health', telefono: '(809) 540-7700', actualizadoEn: '2026-11-09T00:00:00.000Z' },
        { id: 'lab_colgate', nombre: 'Colgate-Palmolive (Oral)', razonSocial: 'Colgate-Palmolive Dominicana', origen: 'Importado', titularRegistro: 'Colgate Oral Care', telefono: '(809) 567-7711', actualizadoEn: '2026-11-09T00:00:00.000Z' }
    ]);

    // Función universal de fusión no destructiva para mantener sincronizados los directorios
    function fusionarSemillasConGuardados(guardados, semillas, claveId = 'id', claveNombre = 'nombre') {
        const resultado = (Array.isArray(guardados) ? guardados : []).map(x => {
            if (typeof x === 'string') {
                return {
                    id: 'item_' + Dominio.generarIdUnico(),
                    nombre: x,
                    razonSocial: x,
                    actualizadoEn: new Date().toISOString()
                };
            }
            return { ...x };
        });

        const idsExistentes = new Set(resultado.map(x => String(x[claveId] || '').toLowerCase().trim()));
        const nombresExistentes = new Set(resultado.map(x => String(x[claveNombre] || '').toLowerCase().trim()));

        semillas.forEach(sem => {
            const idSem = String(sem[claveId] || '').toLowerCase().trim();
            const nomSem = String(sem[claveNombre] || '').toLowerCase().trim();
            if (!idsExistentes.has(idSem) && !nombresExistentes.has(nomSem)) {
                resultado.push({ ...sem });
                idsExistentes.add(idSem);
                nombresExistentes.add(nomSem);
            }
        });
        return resultado;
    }

    function obtenerDirectorioProveedores() {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return [];
        }
        if (cacheStorage.has(CONSTANTES.CLAVES_STORAGE.PROVEEDORES)) {
            return cacheStorage.get(CONSTANTES.CLAVES_STORAGE.PROVEEDORES);
        }
        const guardados = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, null);
        const fusionados = fusionarSemillasConGuardados(guardados, PROVEEDORES_SEMILLA);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, fusionados);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, fusionados);
        return fusionados;
    }

    function guardarProveedorEnDirectorio(proveedor) {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return false;
        }
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

        const regClon = Dominio.clonarObjetoSeguro(registro);
        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const regIdb = (Seg && Seg.estaConfigurado() && !Seg.estaBloqueado())
                ? { id: regClon.id, ...(await Seg.cifrarJson(regClon)) }
                : regClon;
            const tx = db.transaction([STORES.PROVEEDORES], 'readwrite');
            tx.objectStore(STORES.PROVEEDORES).put(regIdb);
        });
        return true;
    }

    function eliminarProveedorDeDirectorio(idProveedor) {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return false;
        }
        if (!idProveedor) return false;
        const directorio = obtenerDirectorioProveedores().filter(p => p.id !== idProveedor);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, directorio);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.PROVEEDORES], 'readwrite');
            tx.objectStore(STORES.PROVEEDORES).delete(idProveedor);
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
        const fusionados = fusionarSemillasConGuardados(guardados, LABORATORIOS_SEMILLA);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, fusionados);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, fusionados);
        return fusionados;
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
        // Purga en caliente obligatoria dentro de Dominio.generarCsvCatalogoMaestro
        const diccionario = obtenerDiccionarioCodigos();
        const csvContenido = Dominio.generarCsvCatalogoMaestro(diccionario);
        const fechaIso = Dominio.obtenerFechaLocalISO();
        descargarTextoComoArchivo(csvContenido, `catalogo-sanitario-farmacia-${fechaIso}.csv`, 'text/csv;charset=utf-8;');
        return {
            exito: true,
            totalProductos: Object.keys(diccionario || {}).length
        };
    }

    function exportarLaboratoriosJson() {
        const labs = obtenerDirectorioLaboratorios();
        const sobre = Dominio.generarSobreLaboratorios(labs);
        const fechaIso = Dominio.obtenerFechaLocalISO();
        descargarObjetoComoJson(sobre, `laboratorios-sanitarios-${fechaIso}.json`, CONSTANTES.TIPO_ARCHIVO_DIRECTORIO_LABORATORIOS);
        return {
            exito: true,
            totalLaboratorios: overTotalLabs(sobre)
        };
    }

    function overTotalLabs(sobre) {
        return (sobre && sobre.resumen && sobre.resumen.totalLaboratorios) || 0;
    }

    function importarLaboratoriosJson(objetoCandidato) {
        if (!objetoCandidato || typeof objetoCandidato !== 'object') {
            return { exito: false, error: 'El archivo seleccionado no es un JSON válido.' };
        }
        let datos = objetoCandidato;
        if (Dominio && typeof Dominio.verificarSobreDatos === 'function') {
            const verif = Dominio.verificarSobreDatos(objetoCandidato, CONSTANTES.TIPO_ARCHIVO_DIRECTORIO_LABORATORIOS);
            if (verif.esValido) {
                datos = verif.datos;
            } else if (!verif.esLegacy) {
                return { exito: false, error: verif.error };
            }
        }
        const listaRaw = Array.isArray(datos)
            ? datos
            : (datos.datos && Array.isArray(datos.datos.laboratorios))
                ? datos.datos.laboratorios
                : (Array.isArray(datos.laboratorios) ? datos.laboratorios : null);

        if (!listaRaw) {
            return { exito: false, error: 'El archivo no contiene una lista de laboratorios válida.' };
        }
        const limpios = Dominio.sanitizarDirectorioLaboratoriosPublico(listaRaw);
        if (limpios.length === 0) {
            return { exito: false, error: 'No se encontraron laboratorios válidos para importar.' };
        }

        const actuales = obtenerDirectorioLaboratorios();
        const porNombre = new Map(actuales.map(l => [String(l.nombre || '').toLowerCase().trim(), { ...l }]));
        let agregados = 0;
        let actualizados = 0;
        for (const lab of limpios) {
            const k = lab.nombre.toLowerCase().trim();
            if (porNombre.has(k)) {
                porNombre.set(k, { ...porNombre.get(k), ...lab, id: porNombre.get(k).id });
                actualizados++;
            } else {
                porNombre.set(k, lab);
                agregados++;
            }
        }
        const finalLista = Array.from(porNombre.values());
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, finalLista);
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.LABORATORIOS, finalLista);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.LABORATORIOS], 'readwrite');
            const st = tx.objectStore(STORES.LABORATORIOS);
            finalLista.forEach(l => st.put(l));
        });

        return { exito: true, agregados, actualizados, total: finalLista.length };
    }

    // --- EDICIÓN DELIBERADA DE FICHA MAESTRA EN CATÁLOGO / AJUSTES ---
    function guardarFichaProductoCatalogo(ficha) {
        if (!ficha || !ficha.codigoBarras) return { exito: false, error: 'Código de barras no proporcionado.' };
        const codigo = Dominio.normalizarCodigoBarras(ficha.codigoBarras);
        if (!codigo) return { exito: false, error: 'Código de barras no válido.' };

        const diccionario = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
        const existente = diccionario[codigo] || {};
        const Seg = obtenerSeguridad();
        const configurado = Boolean(Seg && Seg.estaConfigurado());
        const estaBloqueado = Boolean(configurado && Seg.estaBloqueado());

        const tipo = ficha.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        const unidadesPorCaja = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Math.max(1, parseInt(ficha.unidadesPorCaja, 10) || 1);
        const tasaItbis = Number(ficha.tasaItbis) || (ficha.aplicaItbis ? 18 : 0);

        const nombreCrudo = String(ficha.nombre || ficha.nombreComercial || existente.nombre || existente.nombreComercial || 'Producto sin nombre').trim();
        const nombreFinal = (Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function' && nombreCrudo !== 'Producto sin nombre')
            ? Dominio.estandarizarNombreFarmaceutico(nombreCrudo)
            : nombreCrudo;

        const basePublica = Dominio.sanitizarFichaPublicaCatalogo({
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
            tipo,
            unidadesPorCaja,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche: Boolean(ficha.esLeche),
            actualizadoEn: new Date().toISOString()
        });

        let fichaParaIdb = { ...basePublica };
        let costoEditado = undefined;
        if (!estaBloqueado) {
            if (ficha.ultimoPrecioCaja !== undefined && ficha.ultimoPrecioCaja !== null && ficha.ultimoPrecioCaja !== '') {
                const n = Number(ficha.ultimoPrecioCaja);
                if (Number.isFinite(n) && n > 0) costoEditado = n;
            }
            fichaParaIdb = {
                ...basePublica,
                ubicacion: String(ficha.ubicacion !== undefined ? ficha.ubicacion : (existente.ubicacion || '')).trim(),
                proveedorHabitual: String(ficha.proveedorHabitual || '').trim(),
                rncProveedor: String(ficha.rncProveedor || '').trim()
            };
            if (costoEditado !== undefined) {
                fichaParaIdb.ultimoPrecioCaja = costoEditado;
            } else if (ficha.ultimoPrecioCaja === '' || ficha.ultimoPrecioCaja === null) {
                fichaParaIdb._forzarLimpiarCaja = true;
            }
        }

        // Auto-alimentación inteligente: Registrar laboratorio si es nuevo (público)
        if (basePublica.laboratorio && basePublica.laboratorio.length >= 2) {
            const labExistente = buscarLaboratorioPorNombre(basePublica.laboratorio);
            if (!labExistente) {
                guardarLaboratorioEnDirectorio({
                    nombre: basePublica.laboratorio,
                    origen: 'Nacional RD'
                });
            }
        }
        // Auto-alimentación inteligente de proveedor solo si Admin está disponible
        if (!estaBloqueado && fichaParaIdb.proveedorHabitual && fichaParaIdb.proveedorHabitual.length >= 2) {
            const provExistente = buscarProveedorPorNombre(fichaParaIdb.proveedorHabitual);
            if (!provExistente) {
                guardarProveedorEnDirectorio({
                    nombre: fichaParaIdb.proveedorHabitual,
                    rnc: fichaParaIdb.rncProveedor || ''
                });
            }
        }

        const fichaParaRam = configurado ? basePublica : fichaParaIdb;
        diccionario[codigo] = fichaParaRam;
        escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

        const clonSnapshot = Dominio.clonarObjetoSeguro(fichaParaIdb);
        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            // Si Admin está desbloqueado y había historial previo en _segAdmin, preservarlo si no venía en ficha
            if (configurado && !estaBloqueado) {
                const blobPrev = await obtenerSobresCodigoJit(codigo);
                if (blobPrev) {
                    let adminPrev = {};
                    if (blobPrev._segAdmin) {
                        try { adminPrev = await Seg.descifrarJson(blobPrev._segAdmin, { scope: 'admin', codigoBarras: codigo }); } catch (_) {}
                    } else if (blobPrev._segCifrado) {
                        try { adminPrev = extraerCamposAdminProducto(await Seg.descifrarJson(blobPrev._segCifrado)) || {}; } catch (_) {}
                    }
                    if (!clonSnapshot.historialCostos && Array.isArray(adminPrev.historialCostos)) {
                        clonSnapshot.historialCostos = adminPrev.historialCostos;
                    }
                    if (!clonSnapshot.rncProveedor && adminPrev.rncProveedor) {
                        clonSnapshot.rncProveedor = adminPrev.rncProveedor;
                    }
                }
            }
            const regIdb = await empaquetarProductoParaIdb(clonSnapshot);
            if (!regIdb) return;
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            tx.objectStore(STORES.DICCIONARIO).put(regIdb);
        });

        return { exito: true, producto: basePublica };
    }

    // --- VADEMÉCUM MAESTRO OFICIAL DIGEMAPS (CATÁLOGO DE REFERENCIA RD) ---
    function guardarVademecumMaestro(listaMedicamentos) {
        if (!Array.isArray(listaMedicamentos)) return { exito: false, error: 'Formato de Vademécum inválido' };
        vademecumCache = listaMedicamentos.filter(m => m && (m.nombreComercial || m.nombre));

        abrirBaseDatos().then(db => {
            if (!db) return;
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
        const norm = str => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const q = norm(termino.trim());
        if (q.length < 2) return [];

        const resultados = [];
        for (const med of vademecumCache) {
            const nom = norm(med.nombreComercial || med.nombre);
            const act = norm(med.principioActivo);
            const lab = norm(med.laboratorio);
            const reg = norm(med.registroSanitario);

            if (nom.includes(q) || act.includes(q) || lab.includes(q) || reg.includes(q)) {
                resultados.push(med);
                if (resultados.length >= limite) break;
            }
        }
        return resultados;
    }

    // --- SINCRONIZACIÓN Y FUSIÓN DE CATÁLOGO ENTRE COMPUTADORAS (SOLO SANITARIO PÚBLICO) ---
    function exportarParcheParaOtraCaja() {
        const diccionario = obtenerDiccionarioCodigos();
        // Purga en caliente obligatoria dentro de generarSobreParcheCatalogo
        const sobre = Dominio.generarSobreParcheCatalogo(diccionario);
        const fechaIso = Dominio.obtenerFechaLocalISO();
        descargarObjetoComoJson(sobre, `parche-sanitario-farmacia-${fechaIso}.json`, CONSTANTES.TIPO_ARCHIVO_PARCHE_CATALOGO);
    }

    function fusionarCatalogoDesdeArchivo(objetoCandidato, opciones = { modo: 'fusion' }) {
        if (!objetoCandidato || typeof objetoCandidato !== 'object') {
            return { exito: false, error: 'El archivo recibido no es un objeto JSON válido.' };
        }

        let datos = objetoCandidato;
        if (Dominio && typeof Dominio.verificarSobreDatos === 'function') {
            const verif = Dominio.verificarSobreDatos(objetoCandidato, [
                CONSTANTES.TIPO_ARCHIVO_PARCHE_CATALOGO,
                CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS
            ]);
            if (verif.esValido) {
                datos = verif.datos;
            } else if (!verif.esLegacy) {
                return { exito: false, error: verif.error, codigo: verif.codigo };
            }
        }

        // 1. Detección polimórfica de Vademécum Oficial DIGEMAPS
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

        const esConveniencia = datos.tipo === 'catalogo-conveniencia' || datos.tipo === 'catalogo-conveniencia-rd';

        // Extracción flexible y sanitización pública obligatoria de productos entrantes
        let itemsRaw = null;
        if (datos.datos && datos.datos.diccionario && typeof datos.datos.diccionario === 'object') {
            itemsRaw = datos.datos.diccionario;
        } else if (datos.diccionario && typeof datos.diccionario === 'object' && !Array.isArray(datos.diccionario)) {
            itemsRaw = datos.diccionario;
        } else if (datos.datos && typeof datos.datos === 'object' && !Array.isArray(datos.datos)) {
            itemsRaw = datos.datos;
        } else if (Array.isArray(datos)) {
            itemsRaw = {};
            datos.forEach(p => { if (p && p.codigoBarras) itemsRaw[p.codigoBarras] = p; });
        } else if (Array.isArray(datos.productos)) {
            itemsRaw = {};
            datos.productos.forEach(p => {
                if (p && p.codigoBarras) {
                    itemsRaw[p.codigoBarras] = {
                        ...p,
                        nombre: p.nombre || p.nombreComercial || '',
                        laboratorio: p.laboratorio || p.marca || p.fabricante || ''
                    };
                }
            });
        } else if (typeof datos === 'object' && !Array.isArray(datos)) {
            itemsRaw = datos;
        }

        const items = Dominio.sanitizarDiccionarioPublico(itemsRaw || {});
        if (!items || Object.keys(items).length === 0) {
            return { exito: false, error: 'El archivo no contiene productos sanitarios reconocibles para fusionar.' };
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

    // --- CICLO DE VIDA CRIPTOGRÁFICO DE LA BÓVEDA (BÓVEDA BIFURCADA, BUZÓN SELLADO Y SYNC P2P) ---
    function limpiarRamPorBloqueo(opciones = {}) {
        const mantenerCaja = Boolean(opciones && opciones.mantenerCaja);
        const dicActual = cacheStorage.get(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS);
        if (dicActual && typeof dicActual === 'object') {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, Dominio.sanitizarDiccionarioPublico(dicActual));
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, []);

        if (!mantenerCaja) {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, crearSesionVacia());
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, Dominio.clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO));
        }
        limpiarLocalStorageSensible();
    }

    async function persistirMetadatosSeguridad(metadatos) {
        const claveMeta = (CONSTANTES.SEGURIDAD_BOVEDA && CONSTANTES.SEGURIDAD_BOVEDA.CLAVE_META_BOVEDA) || 'vault_meta';
        return encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.SEGURIDAD], 'readwrite');
            if (metadatos) {
                tx.objectStore(STORES.SEGURIDAD).put(metadatos, claveMeta);
            } else {
                tx.objectStore(STORES.SEGURIDAD).delete(claveMeta);
            }
        });
    }

    async function migrarTodoACifradoIdb(snapshot) {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado() || Seg.estaBloqueado()) {
            throw new Error('Se requiere bóveda de administrador desbloqueada para cifrar datos.');
        }
        return encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;

            const empaquetadosDic = (await Promise.all(
                Object.values(snapshot.diccionario || {}).map(empaquetarProductoParaIdb)
            )).filter(Boolean);

            const encHist = await Promise.all((snapshot.historial || []).filter(f => f && f.id).map(async fac => ({
                id: fac.id,
                timestampGuardado: fac.timestampGuardado || Date.now(),
                ...(await Seg.cifrarJson(fac, { id: fac.id, store: STORES.HISTORIAL }))
            })));

            const borradorObj = snapshot.borrador || crearSesionVacia();
            const encBorrador = (typeof Seg.estaCajaConfigurada === 'function' && Seg.estaCajaConfigurada())
                ? await Seg.cifrarParaCaja(borradorObj, 'borrador')
                : await Seg.cifrarJson(borradorObj, { scope: 'borrador' });

            const reglasObj = snapshot.reglas || REGLAS_NEGOCIO_POR_DEFECTO;
            const encReglas = await Seg.cifrarJson(reglasObj);
            const encReglasCaja = (typeof Seg.estaCajaConfigurada === 'function' && Seg.estaCajaConfigurada())
                ? await Seg.cifrarParaCaja(reglasObj, 'reglas_caja')
                : null;

            const encProvs = await Promise.all((snapshot.proveedores || []).filter(p => p && p.id).map(async prov => ({
                id: prov.id,
                ...(await Seg.cifrarJson(prov, { id: prov.id, store: STORES.PROVEEDORES }))
            })));

            const storesTx = [STORES.DICCIONARIO, STORES.HISTORIAL, STORES.BORRADOR, STORES.CONFIGURACION, STORES.PROVEEDORES];
            const tx = db.transaction(storesTx, 'readwrite');
            const sDic = tx.objectStore(STORES.DICCIONARIO);
            const sHist = tx.objectStore(STORES.HISTORIAL);
            const sProv = tx.objectStore(STORES.PROVEEDORES);
            const sCfg = tx.objectStore(STORES.CONFIGURACION);

            sDic.clear();
            empaquetadosDic.forEach(p => sDic.put(p));

            sHist.clear();
            encHist.forEach(h => sHist.put(h));

            sProv.clear();
            encProvs.forEach(p => sProv.put(p));

            tx.objectStore(STORES.BORRADOR).put(encBorrador, 'activo');
            sCfg.put(encReglas, 'reglas_activas');
            if (encReglasCaja) {
                sCfg.put(encReglasCaja, 'reglas_caja');
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Error cifrando stores en IndexedDB'));
            });
        });
    }

    async function descifrarParaCajaEnRam() {
        const Seg = obtenerSeguridad();
        if (!Seg || (typeof Seg.estaCajaActiva === 'function' && !Seg.estaCajaActiva())) {
            throw new Error('Sesión de mostrador bloqueada.');
        }
        const db = await abrirBaseDatos();
        if (!db) return false;

        const crudo = await new Promise(resolve => {
            try {
                const tx = db.transaction([STORES.BORRADOR, STORES.CONFIGURACION], 'readonly');
                const rBor = tx.objectStore(STORES.BORRADOR).get('activo');
                const rRegCaja = tx.objectStore(STORES.CONFIGURACION).get('reglas_caja');
                tx.oncomplete = () => resolve({ ok: true, borrador: rBor.result || null, reglasCaja: rRegCaja.result || null });
                tx.onerror = () => resolve({ ok: false });
            } catch (_) {
                resolve({ ok: false });
            }
        });
        if (!crudo.ok) return false;

        if (crudo.borrador) {
            let borDec = null;
            if (crudo.borrador._segCaja) {
                try { borDec = await Seg.descifrarDeCaja(crudo.borrador, 'borrador'); } catch (_) {}
            } else if (!crudo.borrador._segCifrado) {
                borDec = crudo.borrador;
            }
            if (borDec) cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, borDec);
        }

        if (crudo.reglasCaja && crudo.reglasCaja._segCaja) {
            try {
                const regDec = await Seg.descifrarDeCaja(crudo.reglasCaja, 'reglas_caja');
                cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, regDec);
            } catch (_) {}
        }
        return true;
    }

    async function descifrarTodoDesdeIdbEnRam() {
        const Seg = obtenerSeguridad();
        if (!Seg || Seg.estaBloqueado()) {
            throw new Error('La bóveda está bloqueada.');
        }
        const db = await abrirBaseDatos();
        if (!db) return false;

        const storesLeer = [STORES.DICCIONARIO, STORES.HISTORIAL, STORES.BORRADOR, STORES.CONFIGURACION, STORES.PROVEEDORES];
        const crudo = await new Promise((resolve) => {
            try {
                const tx = db.transaction(storesLeer, 'readonly');
                const rDic = tx.objectStore(STORES.DICCIONARIO).getAll();
                const rHist = tx.objectStore(STORES.HISTORIAL).getAll();
                const rProv = tx.objectStore(STORES.PROVEEDORES).getAll();
                const rBor = tx.objectStore(STORES.BORRADOR).get('activo');
                const rReg = tx.objectStore(STORES.CONFIGURACION).get('reglas_activas');
                tx.oncomplete = () => resolve({
                    ok: true,
                    dic: rDic.result || [],
                    hist: rHist.result || [],
                    prov: rProv.result || [],
                    borrador: rBor.result || null,
                    reglas: rReg.result || null
                });
                tx.onerror = () => resolve({ ok: false });
            } catch (_) {
                resolve({ ok: false });
            }
        });

        if (!crudo.ok) return false;

        // 1. Proveedores
        const provDec = [];
        for (const pv of crudo.prov) {
            if (pv && pv._segCifrado) {
                try {
                    provDec.push(await Seg.descifrarJson(pv, pv.aad ? { id: pv.id, store: STORES.PROVEEDORES } : null));
                } catch (e) {
                    console.warn('[Cripto] Error descifrando proveedor:', e);
                }
            } else if (pv && pv.id) {
                provDec.push(pv);
            }
        }
        let listaProvsFinal = fusionarSemillasConGuardados(provDec, PROVEEDORES_SEMILLA);
        const provNombresSet = new Set(listaProvsFinal.map(p => String(p.nombre || '').toLowerCase().trim()));
        const provNuevosParaIdb = [];
        const registrarProveedorConsolidado = (nombreProv, rncProv) => {
            const nom = String(nombreProv || '').trim();
            if (nom.length < 2 || provNombresSet.has(nom.toLowerCase())) return;
            const nuevoProv = {
                id: rncProv ? ('prov_' + String(rncProv).replace(/\D/g, '')) : ('prov_' + Dominio.generarIdUnico()),
                rnc: String(rncProv || '').replace(/\D/g, ''),
                nombre: nom,
                razonSocial: nom,
                telefono: '',
                contacto: '',
                diasCredito: 30,
                descuentoHabitual: 0,
                actualizadoEn: new Date().toISOString()
            };
            listaProvsFinal.push(nuevoProv);
            provNuevosParaIdb.push(nuevoProv);
            provNombresSet.add(nom.toLowerCase());
        };

        // 2. Historial + Consolidación de facturas selladas en Buzón Ciego (_buzonSellado)
        const histDec = [];
        const buzonConsolidadoParaIdb = [];
        for (const fac of crudo.hist) {
            if (fac && fac._buzonSellado) {
                try {
                    const dec = await Seg.abrirDeBuzonAdmin(fac, fac.aadMeta || { id: fac.id, store: STORES.HISTORIAL, buzon: true });
                    histDec.push(dec);
                    if (dec.proveedor) registrarProveedorConsolidado(dec.proveedor, dec.rnc);
                    const envAdmin = await Seg.cifrarJson(dec, { id: dec.id, store: STORES.HISTORIAL });
                    buzonConsolidadoParaIdb.push({
                        id: dec.id,
                        timestampGuardado: dec.timestampGuardado || fac.timestampGuardado || Date.now(),
                        ...envAdmin
                    });
                } catch (e) {
                    console.warn('[Cripto] Error abriendo factura de buzón:', e);
                }
            } else if (fac && fac._segCifrado) {
                try {
                    const dec = await Seg.descifrarJson(fac, fac.aad ? { id: fac.id, store: STORES.HISTORIAL } : null);
                    histDec.push(dec);
                } catch (e) {
                    console.warn('[Cripto] Error descifrando factura:', e);
                }
            } else if (fac && fac.id) {
                histDec.push(fac);
            }
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, histDec);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, listaProvsFinal);

        // 3. Catálogo Público en cacheStorage + Consolidación de _segPendienteAdmin / migración _segCifrado legacy
        const dicMap = {};
        const productosReempaquetar = [];
        for (const item of crudo.dic) {
            const pPub = await desempaquetarProductoDesdeIdb(item);
            if (!pPub || !pPub.codigoBarras) continue;
            dicMap[pPub.codigoBarras] = pPub;

            const tienePendiente = Array.isArray(item._segPendienteAdmin) && item._segPendienteAdmin.length > 0;
            const esLegacySinBifurcar = Boolean(item._segCifrado && !item._segCaja && !item._segAdmin);
            if (tienePendiente || esLegacySinBifurcar) {
                try {
                    let combinado = { ...pPub };
                    if (item._segCifrado) {
                        const leg = await Seg.descifrarJson(item._segCifrado);
                        combinado = { ...combinado, ...leg };
                    }
                    if (item._segAdmin) {
                        const adm = await Seg.descifrarJson(item._segAdmin, { scope: 'admin', codigoBarras: pPub.codigoBarras });
                        combinado = { ...combinado, ...adm };
                    }
                    if (item._segCaja) {
                        const caj = await Seg.descifrarDeCaja(item._segCaja, pPub.codigoBarras);
                        combinado = { ...combinado, ...caj };
                    }
                    if (tienePendiente) {
                        const historial = Array.isArray(combinado.historialCostos) ? [...combinado.historialCostos] : [];
                        for (const sobreDelta of item._segPendienteAdmin) {
                            try {
                                const delta = await Seg.abrirDeBuzonAdmin(sobreDelta, { scope: 'delta_producto', codigoBarras: pPub.codigoBarras });
                                if (delta && delta.precioCaja > 0) {
                                    historial.unshift(delta);
                                }
                                if (delta && delta.proveedor) {
                                    combinado.proveedorHabitual = delta.proveedor;
                                    if (delta.rnc) combinado.rncProveedor = delta.rnc;
                                    registrarProveedorConsolidado(delta.proveedor, delta.rnc);
                                }
                            } catch (_) {}
                        }
                        combinado.historialCostos = historial.slice(0, 20);
                    }
                    combinado._limpiarPendienteAdmin = true;
                    const regNuevo = await empaquetarProductoParaIdb(combinado);
                    if (regNuevo) productosReempaquetar.push(regNuevo);
                } catch (e) {
                    console.warn('[Cripto] Error consolidando deltas del producto:', pPub.codigoBarras, e);
                }
            }
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicMap);

        // Persistir consolidaciones en IndexedDB
        if (buzonConsolidadoParaIdb.length > 0 || productosReempaquetar.length > 0 || provNuevosParaIdb.length > 0) {
            await encolarOperacionIdb(async () => {
                const encProvsNuevos = await Promise.all(provNuevosParaIdb.map(async pv => ({
                    id: pv.id,
                    ...(await Seg.cifrarJson(pv, { id: pv.id, store: STORES.PROVEEDORES }))
                })));
                const txCons = db.transaction([STORES.HISTORIAL, STORES.DICCIONARIO, STORES.PROVEEDORES], 'readwrite');
                const stH = txCons.objectStore(STORES.HISTORIAL);
                buzonConsolidadoParaIdb.forEach(h => stH.put(h));
                const stD = txCons.objectStore(STORES.DICCIONARIO);
                productosReempaquetar.forEach(pr => stD.put(pr));
                const stP = txCons.objectStore(STORES.PROVEEDORES);
                encProvsNuevos.forEach(pv => stP.put(pv));
                await new Promise(res => { txCons.oncomplete = res; txCons.onerror = res; });
            });
        }

        // 4. Borrador activo
        if (crudo.borrador) {
            let borDec = null;
            if (crudo.borrador._segCaja) {
                try { borDec = await Seg.descifrarDeCaja(crudo.borrador, 'borrador'); } catch (_) {}
            } else if (crudo.borrador._segCifrado) {
                try { borDec = await Seg.descifrarJson(crudo.borrador, crudo.borrador.aad ? { scope: 'borrador' } : null); } catch (_) {}
            } else {
                borDec = crudo.borrador;
            }
            if (borDec) cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, borDec);
        }

        // 5. Reglas de cálculo
        if (crudo.reglas) {
            let regDec = REGLAS_NEGOCIO_POR_DEFECTO;
            if (crudo.reglas._segCifrado) {
                try { regDec = await Seg.descifrarJson(crudo.reglas); } catch (_) {}
            } else {
                regDec = crudo.reglas;
            }
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, regDec);
        }

        limpiarHistorialExpirado7Dias();
        return true;
    }

    async function activarCifradoConContrasena(contrasena, opciones = {}) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');

        const provActuales = obtenerDirectorioProveedores();
        const dicActualPlano = leerJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, {});
        const snapshot = {
            diccionario: Dominio.clonarObjetoSeguro(dicActualPlano),
            historial: Dominio.clonarObjetoSeguro(obtenerHistorialFacturas()),
            borrador: Dominio.clonarObjetoSeguro(cargarBorradorActivo()),
            reglas: Dominio.clonarObjetoSeguro(obtenerReglasNegocio()),
            proveedores: Dominio.clonarObjetoSeguro(provActuales)
        };

        const res = await Seg.configurarContrasenaMaestra(contrasena, opciones);
        await persistirMetadatosSeguridad(res.metadatos);
        await migrarTodoACifradoIdb(snapshot);
        // En memoria pública RAM del catálogo solo permanecen fichas sanitarias públicas
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, Dominio.sanitizarDiccionarioPublico(snapshot.diccionario));
        limpiarLocalStorageSensible();

        return {
            exito: true,
            codigoRecuperacion: res.codigoRecuperacion
        };
    }

    async function desbloquearBoveda(contrasena) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = await Seg.desbloquear(contrasena);
        if (res && res.metadatosActualizados) {
            await persistirMetadatosSeguridad(res.metadatosActualizados);
        }
        await descifrarTodoDesdeIdbEnRam();
        return { exito: true };
    }

    async function desbloquearCajaBoveda(pinCaja) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        await Seg.desbloquearCaja(pinCaja);
        await descifrarParaCajaEnRam();
        return { exito: true };
    }

    async function configurarPinCajaBoveda(pinCaja) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = await Seg.configurarPinCaja(pinCaja);
        await persistirMetadatosSeguridad(res.metadatos);

        // Re-empaquetar sobres _segCaja + borrador + reglas_caja bajo la nueva clave de Caja
        const reglas = obtenerReglasNegocio();
        const borrador = cargarBorradorActivo();
        const db = await abrirBaseDatos();
        if (db) {
            await encolarOperacionIdb(async () => {
                const encReglasCaja = await Seg.cifrarParaCaja(reglas, 'reglas_caja');
                const encBor = await Seg.cifrarParaCaja(borrador, 'borrador');
                const items = Array.from(encDiccionarioBlobs.keys());
                const dicPub = obtenerDiccionarioCodigos();
                const nuevosRegs = [];
                for (const cod of items) {
                    const full = await obtenerDetalleProductoAdmin(cod);
                    if (full) {
                        const r = await empaquetarProductoParaIdb(full);
                        if (r) nuevosRegs.push(r);
                    } else if (dicPub[cod]) {
                        const r = await empaquetarProductoParaIdb(dicPub[cod]);
                        if (r) nuevosRegs.push(r);
                    }
                }
                const tx = db.transaction([STORES.CONFIGURACION, STORES.BORRADOR, STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.CONFIGURACION).put(encReglasCaja, 'reglas_caja');
                tx.objectStore(STORES.BORRADOR).put(encBor, 'activo');
                const stDic = tx.objectStore(STORES.DICCIONARIO);
                nuevosRegs.forEach(r => stDic.put(r));
                await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
            });
        }
        return { exito: true };
    }

    async function desactivarPinCajaBoveda() {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = Seg.desactivarPinCaja();
        await persistirMetadatosSeguridad(res.metadatos);
        await encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.CONFIGURACION], 'readwrite');
            tx.objectStore(STORES.CONFIGURACION).delete('reglas_caja');
        });
        return { exito: true };
    }

    function bloquearAdminBoveda() {
        const Seg = obtenerSeguridad();
        if (Seg && typeof Seg.bloquearAdminManteniendoCaja === 'function') {
            Seg.bloquearAdminManteniendoCaja();
        } else if (Seg) {
            Seg.bloquear();
        }
        limpiarRamPorBloqueo({ mantenerCaja: Boolean(Seg && Seg.estaCajaActiva && Seg.estaCajaActiva()) });
    }

    function bloquearBoveda() {
        const Seg = obtenerSeguridad();
        if (Seg) Seg.bloquear();
        limpiarRamPorBloqueo({ mantenerCaja: false });
    }

    async function cambiarContrasenaBoveda(actual, nueva) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = await Seg.cambiarContrasena(actual, nueva);
        await persistirMetadatosSeguridad(res.metadatos);
        return { exito: true };
    }

    async function regenerarCodigoRecuperacionBoveda(actual) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = await Seg.regenerarCodigoRecuperacion(actual);
        await persistirMetadatosSeguridad(res.metadatos);
        return { exito: true, codigoRecuperacion: res.codigoRecuperacion };
    }

    async function recuperarBovedaConCodigo(codigo, nuevaContrasena) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        const res = await Seg.recuperarConCodigo(codigo, nuevaContrasena);
        await persistirMetadatosSeguridad(res.metadatos);
        await descifrarTodoDesdeIdbEnRam();
        return { exito: true, nuevoCodigoRecuperacion: res.nuevoCodigoRecuperacion };
    }

    async function actualizarAutoBloqueoBoveda(minutos) {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado()) return false;
        const meta = Seg.configurarAutoBloqueo(minutos);
        if (meta) await persistirMetadatosSeguridad(meta);
        return true;
    }

    async function purgarDatosPrivadosLocales() {
        const Seg = obtenerSeguridad();
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            throw new Error('Debes desbloquear la sesión de Administrador antes de purgar datos privados.');
        }
        const dicPublico = Dominio.sanitizarDiccionarioPublico(obtenerDiccionarioCodigos());
        encDiccionarioBlobs.clear();
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicPublico);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, crearSesionVacia());
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, [...PROVEEDORES_SEMILLA]);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, Dominio.clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO));
        limpiarLocalStorageSensible();

        await migrarTodoACifradoIdb({
            diccionario: dicPublico,
            historial: [],
            borrador: crearSesionVacia(),
            reglas: REGLAS_NEGOCIO_POR_DEFECTO,
            proveedores: [...PROVEEDORES_SEMILLA]
        }).catch(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const tx = db.transaction([STORES.DICCIONARIO, STORES.HISTORIAL, STORES.BORRADOR, STORES.CONFIGURACION, STORES.PROVEEDORES], 'readwrite');
            const sDic = tx.objectStore(STORES.DICCIONARIO);
            sDic.clear();
            Object.values(dicPublico).forEach(p => sDic.put(p));
            tx.objectStore(STORES.HISTORIAL).clear();
            tx.objectStore(STORES.BORRADOR).delete('activo');
            tx.objectStore(STORES.CONFIGURACION).put(Dominio.clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO), 'reglas_activas');
            const sProv = tx.objectStore(STORES.PROVEEDORES);
            sProv.clear();
            PROVEEDORES_SEMILLA.forEach(p => sProv.put(p));
        });
        return { exito: true, totalProductosConservados: Object.keys(dicPublico).length };
    }

    // --- EMPAREJAMIENTO Y SINCRONIZACIÓN P2P CIFRADA ENTRE CAJAS DE LA FARMACIA ---
    async function emparejarDispositivoP2P(tarjetaPeerJson, alias = 'Caja Hermana') {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado() || Seg.estaBloqueado()) {
            throw new Error('Desbloquea como Administrador para vincular otra PC de tu farmacia.');
        }
        const tarjeta = (typeof tarjetaPeerJson === 'string') ? JSON.parse(tarjetaPeerJson) : tarjetaPeerJson;
        const res = await Seg.agregarPeerConfiable(tarjeta, alias);
        await persistirMetadatosSeguridad(res.metadatos);
        return res;
    }

    async function revocarDispositivoP2P(deviceId) {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado() || Seg.estaBloqueado()) {
            throw new Error('Desbloquea como Administrador para revocar un dispositivo.');
        }
        const res = await Seg.revocarPeerConfiable(deviceId);
        await persistirMetadatosSeguridad(res.metadatos);
        return res;
    }

    async function exportarSyncCifradaParaPeer(peerId, opciones = {}) {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado() || Seg.estaBloqueado()) {
            throw new Error('Desbloquea como Administrador para generar sincronización cifrada.');
        }

        const dicPublico = obtenerDiccionarioCodigos();
        const productosSync = {};
        for (const cod of Object.keys(dicPublico)) {
            const detalle = await obtenerDetalleProductoAdmin(cod);
            if (detalle) productosSync[cod] = detalle;
        }

        const payload = {
            diccionario: productosSync,
            laboratorios: Dominio.sanitizarDirectorioLaboratoriosPublico(obtenerDirectorioLaboratorios()),
            reglas: obtenerReglasNegocio()
        };
        if (opciones.incluirProveedores !== false) {
            payload.proveedores = Dominio.clonarObjetoSeguro(obtenerDirectorioProveedores());
        }

        const res = await Seg.empaquetarSyncParaPeer(peerId, payload, opciones);
        await persistirMetadatosSeguridad(res.metadatos);
        return {
            exito: true,
            paquete: res.paquete,
            codigoEntrega: res.codigoEntrega,
            seq: res.seq,
            totalProductos: Object.keys(productosSync).length
        };
    }

    async function importarSyncCifradaDePeer(paqueteJson, codigoEntrega = '') {
        const Seg = obtenerSeguridad();
        if (!Seg || !Seg.estaConfigurado() || Seg.estaBloqueado()) {
            throw new Error('Desbloquea como Administrador para recibir sincronización cifrada.');
        }
        const paquete = (typeof paqueteJson === 'string') ? JSON.parse(paqueteJson) : paqueteJson;
        const res = await Seg.abrirSyncDePeer(paquete, codigoEntrega);
        await persistirMetadatosSeguridad(res.metadatos);

        const datos = res.datos || {};
        const dicEntranteCrudo = (datos.diccionario && typeof datos.diccionario === 'object') ? datos.diccionario : {};

        // Validación defensiva post-descifrado de cada ficha entrante (sin reemplazar ni admitir fechas futuras)
        const maxFechaMs = Date.now() + 24 * 60 * 60 * 1000;
        const dicEntranteValidado = {};
        for (const [cod, item] of Object.entries(dicEntranteCrudo)) {
            const pub = Dominio.sanitizarFichaPublicaCatalogo(item);
            if (!pub || !pub.codigoBarras) continue;
            const extra = {};
            if (item.ultimoPrecioCaja !== undefined) {
                const vp = Dominio.validarPrecioCompra(item.ultimoPrecioCaja, { permitirCero: false });
                if (vp.esValido) extra.ultimoPrecioCaja = vp.valor;
            }
            if (item.costoAnteriorCaja !== undefined && Number(item.costoAnteriorCaja) > 0) {
                extra.costoAnteriorCaja = Number(item.costoAnteriorCaja);
            }
            if (item.variacionCosto !== undefined && Number.isFinite(Number(item.variacionCosto))) {
                extra.variacionCosto = Number(item.variacionCosto);
            }
            if (item.costoUnitarioFiscal) extra.costoUnitarioFiscal = String(item.costoUnitarioFiscal).slice(0, 32);
            if (item.preciosVenta && typeof item.preciosVenta === 'object') {
                extra.preciosVenta = Dominio.clonarObjetoSeguro(item.preciosVenta);
            }
            if (item.proveedorHabitual) extra.proveedorHabitual = Dominio.sanitizarEntradaTexto(item.proveedorHabitual, 120);
            if (item.rncProveedor) extra.rncProveedor = String(item.rncProveedor).replace(/\D/g, '').slice(0, 11);
            if (item.ubicacion) extra.ubicacion = Dominio.sanitizarEntradaTexto(item.ubicacion, 120);
            if (Array.isArray(item.historialCostos)) {
                extra.historialCostos = item.historialCostos.slice(0, 20).map(h => ({
                    fecha: String(h.fecha || '').slice(0, 20),
                    precioCaja: Number(h.precioCaja) || 0,
                    costoUnitarioFiscal: String(h.costoUnitarioFiscal || '').slice(0, 32),
                    proveedor: Dominio.sanitizarEntradaTexto(h.proveedor || '', 120),
                    rnc: String(h.rnc || '').replace(/\D/g, '').slice(0, 11),
                    descuentoValor: Number(h.descuentoValor) || 0,
                    tipoDescuento: h.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto',
                    aplicaItbis: Boolean(h.aplicaItbis)
                }));
            }
            const fechaMs = new Date(pub.actualizadoEn || 0).getTime();
            pub.actualizadoEn = new Date(Number.isFinite(fechaMs) && fechaMs > 0 ? Math.min(fechaMs, maxFechaMs) : Date.now()).toISOString();
            dicEntranteValidado[pub.codigoBarras] = { ...pub, ...extra };
        }

        // Reconstruir diccionario completo local puntualmente solo para fusionar con seguridad
        const dicLocalCompleto = {};
        const dicPubLocal = obtenerDiccionarioCodigos();
        for (const cod of Object.keys(dicPubLocal)) {
            const det = await obtenerDetalleProductoAdmin(cod);
            dicLocalCompleto[cod] = det || dicPubLocal[cod];
        }

        const fusion = Dominio.fusionarDiccionarios(dicLocalCompleto, dicEntranteValidado, { modo: 'fusion' });
        const db = await abrirBaseDatos();
        if (db) {
            await encolarOperacionIdb(async () => {
                const empaquetados = (await Promise.all(
                    Object.values(fusion.diccionarioFusionado).map(empaquetarProductoParaIdb)
                )).filter(Boolean);
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                const st = tx.objectStore(STORES.DICCIONARIO);
                empaquetados.forEach(item => st.put(item));
                await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
            });
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, Dominio.sanitizarDiccionarioPublico(fusion.diccionarioFusionado));

        if (Array.isArray(datos.laboratorios) && datos.laboratorios.length > 0) {
            importarLaboratoriosJson({ laboratorios: datos.laboratorios });
        }
        if (Array.isArray(datos.proveedores) && datos.proveedores.length > 0) {
            datos.proveedores.forEach(pv => {
                if (pv && pv.nombre) guardarProveedorEnDirectorio(pv);
            });
        }
        if (datos.reglas && typeof datos.reglas === 'object') {
            guardarReglasNegocio(datos.reglas);
        }

        return {
            exito: true,
            origenPeer: res.origenPeer,
            seq: res.seq,
            estadisticas: fusion.estadisticas
        };
    }

    // Suscribirse al bloqueo automático / degradación para limpiar secretos administrativos de RAM
    if (AppFarmacia.Seguridad && typeof AppFarmacia.Seguridad.suscribirCambioEstado === 'function') {
        AppFarmacia.Seguridad.suscribirCambioEstado(estado => {
            if (estado && estado.configurado && estado.bloqueado) {
                limpiarRamPorBloqueo({ mantenerCaja: Boolean(estado.cajaDesbloqueada) });
            }
        });
    }

    AppFarmacia.Almacenamiento = Object.freeze({
        activarCifradoConContrasena,
        desbloquearBoveda,
        desbloquearCajaBoveda,
        configurarPinCajaBoveda,
        desactivarPinCajaBoveda,
        bloquearAdminBoveda,
        bloquearBoveda,
        cambiarContrasenaBoveda,
        regenerarCodigoRecuperacionBoveda,
        recuperarBovedaConCodigo,
        actualizarAutoBloqueoBoveda,
        purgarDatosPrivadosLocales,

        emparejarDispositivoP2P,
        revocarDispositivoP2P,
        exportarSyncCifradaParaPeer,
        importarSyncCifradaDePeer,

        obtenerCostoOperativoProducto,
        obtenerDetalleProductoAdmin,
        obtenerResumenCostosTablaSiAdmin,
        archivarFacturaEnBuzon,
        exportarLaboratoriosJson,
        importarLaboratoriosJson,

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
