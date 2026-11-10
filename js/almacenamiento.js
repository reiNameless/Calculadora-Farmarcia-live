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

    function extraerCamposSensiblesProducto(item) {
        if (!item || typeof item !== 'object') return null;
        const campos = (CONSTANTES && Array.isArray(CONSTANTES.CAMPOS_SENSIBLES_CATALOGO))
            ? CONSTANTES.CAMPOS_SENSIBLES_CATALOGO
            : [
                'ultimoPrecioCaja', 'costoAnteriorCaja', 'variacionCosto',
                'costoUnitarioFiscal', 'costoUnitario', 'costoUnitarioVenta',
                'costoReferencia', 'preciosVenta', 'historialCostos',
                'descuentoValor', 'tipoDescuento', 'descuentoTotalLinea',
                'proveedorHabitual', 'rncProveedor', 'numeroFactura'
            ];
        const sensible = {};
        let tieneDatos = false;
        for (const c of campos) {
            const val = item[c];
            if (val === undefined || val === null || val === '') continue;
            if (Array.isArray(val) && val.length === 0) continue;
            if (typeof val === 'number' && val === 0 && (c === 'ultimoPrecioCaja' || c === 'costoAnteriorCaja' || c === 'variacionCosto' || c === 'descuentoValor')) {
                continue;
            }
            sensible[c] = Dominio.clonarObjetoSeguro(val);
            tieneDatos = true;
        }
        return tieneDatos ? sensible : null;
    }

    async function empaquetarProductoParaIdb(item) {
        const publico = Dominio.sanitizarFichaPublicaCatalogo(item);
        if (!publico || !publico.codigoBarras) return null;

        const Seg = obtenerSeguridad();
        const sensible = extraerCamposSensiblesProducto(item);

        if (Seg && Seg.estaConfigurado()) {
            if (!Seg.estaBloqueado()) {
                if (sensible) {
                    const env = await Seg.cifrarJson(sensible);
                    encDiccionarioBlobs.set(publico.codigoBarras, env);
                    return { ...publico, _segCifrado: env };
                }
                encDiccionarioBlobs.delete(publico.codigoBarras);
                return publico;
            }
            // Bóveda bloqueada: preservar intacto el sobre cifrado previo en disco
            const previo = encDiccionarioBlobs.get(publico.codigoBarras);
            return previo ? { ...publico, _segCifrado: previo } : publico;
        }

        // Sin cifrado configurado todavía: mantener formato plano completo en IDB hasta que el dueño configure contraseña
        return { ...Dominio.clonarObjetoSeguro(item), ...publico };
    }

    async function desempaquetarProductoDesdeIdb(registro) {
        if (!registro || typeof registro !== 'object' || !registro.codigoBarras) return null;
        const publico = Dominio.sanitizarFichaPublicaCatalogo(registro);
        const Seg = obtenerSeguridad();

        if (registro._segCifrado) {
            encDiccionarioBlobs.set(publico.codigoBarras, registro._segCifrado);
            if (Seg && !Seg.estaBloqueado()) {
                try {
                    const descifrado = await Seg.descifrarJson(registro._segCifrado);
                    return { ...publico, ...descifrado };
                } catch (e) {
                    console.warn(`[Cripto] No se pudieron descifrar costos de ${publico.codigoBarras}:`, e);
                    return publico;
                }
            }
            // Bloqueado: solo retornar campos sanitarios públicos
            return publico;
        }

        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return publico;
        }

        const copia = Dominio.clonarObjetoSeguro(registro);
        delete copia._segCifrado;
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
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
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
            const payload = (Seg && Seg.estaConfigurado() && !Seg.estaBloqueado())
                ? await Seg.cifrarJson(sanitizadas)
                : sanitizadas;
            const tx = db.transaction([STORES.CONFIGURACION], 'readwrite');
            tx.objectStore(STORES.CONFIGURACION).put(payload, 'reglas_activas');
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
        const Seg = obtenerSeguridad();
        const dicParaRam = (Seg && Seg.estaConfigurado() && Seg.estaBloqueado())
            ? Dominio.sanitizarDiccionarioPublico(diccionario)
            : diccionario;

        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicParaRam);
        const snapshotItems = Object.values(dicParaRam || {}).map(x => Dominio.clonarObjetoSeguro(x));

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const empaquetados = (await Promise.all(snapshotItems.map(empaquetarProductoParaIdb))).filter(Boolean);
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            const store = tx.objectStore(STORES.DICCIONARIO);
            store.clear();
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

    function aprenderProductoEnDiccionario(lineaProducto, contextoFactura = {}) {
        const codigo = Dominio.normalizarCodigoBarras(lineaProducto.codigoBarras);
        const nombreCandidato = String(lineaProducto.nombre || '').trim();
        const esNombreGenerico = !nombreCandidato || /^Producto #\d+$/i.test(nombreCandidato) || nombreCandidato === 'Producto IA' || nombreCandidato === 'Producto';
        if (!codigo) return false;

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo];
        const Seg = obtenerSeguridad();
        const estaBloqueado = Boolean(Seg && Seg.estaConfigurado() && Seg.estaBloqueado());

        // PROTECCIÓN DE INTEGRIDAD DE CATÁLOGO MAESTRO:
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

        // Si la bóveda está bloqueada, SOLO aprender/preservar ficha sanitaria pública (preservando _segCifrado intacto)
        if (estaBloqueado) {
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
                ubicacion: lineaProducto.ubicacion || (existente && existente.ubicacion) || '',
                tipo,
                unidadesPorCaja: tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : unidadesPorCaja,
                aplicaItbis: tasaItbis > 0,
                tasaItbis,
                esLeche,
                actualizadoEn: new Date().toISOString()
            });
            diccionario[codigo] = fichaPublica;
            escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, diccionario);

            encolarOperacionIdb(async () => {
                const db = await abrirBaseDatos();
                if (!db) return;
                const reg = await empaquetarProductoParaIdb(fichaPublica);
                if (!reg) return;
                const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
                tx.objectStore(STORES.DICCIONARIO).put(reg);
            });
            return true;
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

        const clonSnapshot = Dominio.clonarObjetoSeguro(fichaActualizada);
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

    // --- HISTORIAL (7 DÍAS) Y BORRADOR ACTIVO ---
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
            return { exito: false, bloqueado: true, error: 'Bóveda bloqueada. Desbloquea con contraseña de administrador para guardar facturas.' };
        }
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, listaFacturas);
        const listaClonada = (listaFacturas || []).map(f => Dominio.clonarObjetoSeguro(f)).filter(f => f && f.id);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            let payloads = listaClonada;
            if (Seg && Seg.estaConfigurado() && !Seg.estaBloqueado()) {
                payloads = await Promise.all(listaClonada.map(async fac => {
                    const env = await Seg.cifrarJson(fac);
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
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
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
        if (Seg && Seg.estaConfigurado() && Seg.estaBloqueado()) {
            return { exito: false, bloqueado: true };
        }
        const resultado = escribirJsonSeguro(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, sesionActual);
        const clon = Dominio.clonarObjetoSeguro(sesionActual);

        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const payload = (Seg && Seg.estaConfigurado() && !Seg.estaBloqueado())
                ? await Seg.cifrarJson(clon)
                : clon;
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

        // --- EDICIÓN DELIBERADA DE FICHA MAESTRA EN CATÁLOGO / AJUSTES ---
    function guardarFichaProductoCatalogo(ficha) {
        if (!ficha || !ficha.codigoBarras) return { exito: false, error: 'Código de barras no proporcionado.' };
        const codigo = Dominio.normalizarCodigoBarras(ficha.codigoBarras);
        if (!codigo) return { exito: false, error: 'Código de barras no válido.' };

        const diccionario = obtenerDiccionarioCodigos();
        const existente = diccionario[codigo] || {};
        const Seg = obtenerSeguridad();
        const estaBloqueado = Boolean(Seg && Seg.estaConfigurado() && Seg.estaBloqueado());

        const tipo = ficha.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE;
        const unidadesPorCaja = tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : Math.max(1, parseInt(ficha.unidadesPorCaja, 10) || 1);
        const tasaItbis = Number(ficha.tasaItbis) || (ficha.aplicaItbis ? 18 : 0);

        const nombreCrudo = String(ficha.nombre || ficha.nombreComercial || existente.nombre || existente.nombreComercial || 'Producto sin nombre').trim();
        const nombreFinal = (Dominio && typeof Dominio.estandarizarNombreFarmaceutico === 'function' && nombreCrudo !== 'Producto sin nombre')
            ? Dominio.estandarizarNombreFarmaceutico(nombreCrudo)
            : nombreCrudo;

        const basePublica = {
            ...(estaBloqueado ? Dominio.sanitizarFichaPublicaCatalogo(existente) : existente),
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
            tipo,
            unidadesPorCaja,
            aplicaItbis: tasaItbis > 0,
            tasaItbis,
            esLeche: Boolean(ficha.esLeche),
            actualizadoEn: new Date().toISOString()
        };

        const fichaActualizada = estaBloqueado
            ? Dominio.sanitizarFichaPublicaCatalogo(basePublica)
            : {
                ...basePublica,
                proveedorHabitual: String(ficha.proveedorHabitual || existente.proveedorHabitual || '').trim(),
                rncProveedor: String(ficha.rncProveedor || existente.rncProveedor || '').trim(),
                ultimoPrecioCaja: Number(ficha.ultimoPrecioCaja !== undefined ? ficha.ultimoPrecioCaja : (existente.ultimoPrecioCaja || 0))
            };

        // Auto-alimentación inteligente: Registrar laboratorio si es nuevo (público)
        if (fichaActualizada.laboratorio && fichaActualizada.laboratorio.length >= 2) {
            const labExistente = buscarLaboratorioPorNombre(fichaActualizada.laboratorio);
            if (!labExistente) {
                guardarLaboratorioEnDirectorio({
                    nombre: fichaActualizada.laboratorio,
                    origen: 'Nacional RD'
                });
            }
        }
        // Auto-alimentación inteligente de proveedor solo si bóveda está desbloqueada/disponible
        if (!estaBloqueado && fichaActualizada.proveedorHabitual && fichaActualizada.proveedorHabitual.length >= 2) {
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

        const clonSnapshot = Dominio.clonarObjetoSeguro(fichaActualizada);
        encolarOperacionIdb(async () => {
            const db = await abrirBaseDatos();
            if (!db) return;
            const regIdb = await empaquetarProductoParaIdb(clonSnapshot);
            if (!regIdb) return;
            const tx = db.transaction([STORES.DICCIONARIO], 'readwrite');
            tx.objectStore(STORES.DICCIONARIO).put(regIdb);
        });

        return { exito: true, producto: fichaActualizada };
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

    // --- CICLO DE VIDA CRIPTOGRÁFICO DE LA BÓVEDA (PANEL DE ADMINISTRADOR) ---
    function limpiarRamPorBloqueo() {
        const dicActual = cacheStorage.get(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS);
        if (dicActual && typeof dicActual === 'object') {
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, Dominio.sanitizarDiccionarioPublico(dicActual));
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, []);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, []);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, crearSesionVacia());
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, Dominio.clonarObjetoSeguro(REGLAS_NEGOCIO_POR_DEFECTO));
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
            throw new Error('Se requiere bóveda desbloqueada para cifrar datos.');
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
                ...(await Seg.cifrarJson(fac))
            })));

            const encBorrador = await Seg.cifrarJson(snapshot.borrador || crearSesionVacia());
            const encReglas = await Seg.cifrarJson(snapshot.reglas || REGLAS_NEGOCIO_POR_DEFECTO);
            const encProvs = await Promise.all((snapshot.proveedores || []).filter(p => p && p.id).map(async prov => ({
                id: prov.id,
                ...(await Seg.cifrarJson(prov))
            })));

            const storesTx = [STORES.DICCIONARIO, STORES.HISTORIAL, STORES.BORRADOR, STORES.CONFIGURACION, STORES.PROVEEDORES];
            const tx = db.transaction(storesTx, 'readwrite');
            const sDic = tx.objectStore(STORES.DICCIONARIO);
            const sHist = tx.objectStore(STORES.HISTORIAL);
            const sProv = tx.objectStore(STORES.PROVEEDORES);

            sDic.clear();
            empaquetadosDic.forEach(p => sDic.put(p));

            sHist.clear();
            encHist.forEach(h => sHist.put(h));

            sProv.clear();
            encProvs.forEach(p => sProv.put(p));

            tx.objectStore(STORES.BORRADOR).put(encBorrador, 'activo');
            tx.objectStore(STORES.CONFIGURACION).put(encReglas, 'reglas_activas');

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Error cifrando stores en IndexedDB'));
            });
        });
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

        const dicMap = {};
        for (const item of crudo.dic) {
            const p = await desempaquetarProductoDesdeIdb(item);
            if (p && p.codigoBarras) dicMap[p.codigoBarras] = p;
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.DICCIONARIO_CODIGOS, dicMap);

        const histDec = [];
        for (const fac of crudo.hist) {
            if (fac && fac._segCifrado) {
                try {
                    const dec = await Seg.descifrarJson(fac);
                    histDec.push(dec);
                } catch (e) {
                    console.warn('[Cripto] Error descifrando factura:', e);
                }
            } else if (fac && fac.id) {
                histDec.push(fac);
            }
        }
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.HISTORIAL_7DIAS, histDec);

        const provDec = [];
        for (const pv of crudo.prov) {
            if (pv && pv._segCifrado) {
                try {
                    provDec.push(await Seg.descifrarJson(pv));
                } catch (e) {
                    console.warn('[Cripto] Error descifrando proveedor:', e);
                }
            } else if (pv && pv.id) {
                provDec.push(pv);
            }
        }
        const listaProvsFinal = fusionarSemillasConGuardados(provDec, PROVEEDORES_SEMILLA);
        cacheStorage.set(CONSTANTES.CLAVES_STORAGE.PROVEEDORES, listaProvsFinal);

        if (crudo.borrador) {
            const borDec = crudo.borrador._segCifrado
                ? await Seg.descifrarJson(crudo.borrador).catch(() => crearSesionVacia())
                : crudo.borrador;
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.BORRADOR_ACTIVO, borDec);
        }

        if (crudo.reglas) {
            const regDec = crudo.reglas._segCifrado
                ? await Seg.descifrarJson(crudo.reglas).catch(() => REGLAS_NEGOCIO_POR_DEFECTO)
                : crudo.reglas;
            cacheStorage.set(CONSTANTES.CLAVES_STORAGE.REGLAS_NEGOCIO, regDec);
        }

        limpiarHistorialExpirado7Dias();
        return true;
    }

    async function activarCifradoConContrasena(contrasena, opciones = {}) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');

        const provActuales = obtenerDirectorioProveedores();
        const snapshot = {
            diccionario: Dominio.clonarObjetoSeguro(obtenerDiccionarioCodigos()),
            historial: Dominio.clonarObjetoSeguro(obtenerHistorialFacturas()),
            borrador: Dominio.clonarObjetoSeguro(cargarBorradorActivo()),
            reglas: Dominio.clonarObjetoSeguro(obtenerReglasNegocio()),
            proveedores: Dominio.clonarObjetoSeguro(provActuales)
        };

        const res = await Seg.configurarContrasenaMaestra(contrasena, opciones);
        await persistirMetadatosSeguridad(res.metadatos);
        await migrarTodoACifradoIdb(snapshot);
        limpiarLocalStorageSensible();

        return {
            exito: true,
            codigoRecuperacion: res.codigoRecuperacion
        };
    }

    async function desbloquearBoveda(contrasena) {
        const Seg = obtenerSeguridad();
        if (!Seg) throw new Error('Módulo de seguridad no inicializado.');
        await Seg.desbloquear(contrasena);
        await descifrarTodoDesdeIdbEnRam();
        return { exito: true };
    }

    function bloquearBoveda() {
        const Seg = obtenerSeguridad();
        if (Seg) Seg.bloquear();
        limpiarRamPorBloqueo();
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
            throw new Error('Debes desbloquear la bóveda antes de purgar datos privados.');
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
            // Si no hay cifrado configurado todavía, limpiar IDB directamente
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

    // Suscribirse al bloqueo automático por inactividad para limpiar RAM de inmediato
    if (AppFarmacia.Seguridad && typeof AppFarmacia.Seguridad.suscribirCambioEstado === 'function') {
        AppFarmacia.Seguridad.suscribirCambioEstado(estado => {
            if (estado && estado.configurado && estado.bloqueado) {
                limpiarRamPorBloqueo();
            }
        });
    }

    AppFarmacia.Almacenamiento = Object.freeze({
        activarCifradoConContrasena,
        desbloquearBoveda,
        bloquearBoveda,
        cambiarContrasenaBoveda,
        regenerarCodigoRecuperacionBoveda,
        recuperarBovedaConCodigo,
        actualizarAutoBloqueoBoveda,
        purgarDatosPrivadosLocales,

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
