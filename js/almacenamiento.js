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
            const parseado = JSON.parse(texto);
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

    // --- INICIALIZACIÓN ASÍNCRONA Y MIGRACIÓN AUTOMÁTICA ---
    async function inicializarPersistencia() {
        const db = await abrirBaseDatos();
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
                            resolve(false);
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

    function leerArchivoJsonSubido(archivo) {
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
                    resolve(JSON.parse(lector.result));
                } catch (e) {
                    reject(new Error('El archivo seleccionado no tiene un formato JSON válido.'));
                }
            };
            lector.onerror = () => reject(new Error('No se pudo leer el archivo del disco.'));
            lector.readAsText(archivo);
        });
    }

    // --- CATÁLOGO MAESTRO INICIAL DE REPÚBLICA DOMINICANA ---
    const CATALOGO_RD_PRECARGADO = Object.freeze({
    "7460100100100": {
        "codigoBarras": "7460100100100",
        "nombre": "Winasorb 500mg - Caja 100 Tabletas",
        "nombreComercial": "Winasorb",
        "principioActivo": "Acetaminofén (Paracetamol)",
        "concentracion": "500 mg",
        "categoria": "Analgésicos y Antipiréticos",
        "laboratorio": "Laboratorios Suiphar / Sanofi",
        "presentacion": "Caja con 10 blisters de 10 tabletas (100 tabletas)",
        "formaFarmaceutica": "Tabletas",
        "tipo": "divisible",
        "unidadesPorCaja": 100,
        "ultimoPrecioCaja": 380,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.832Z",
        "registroSanitario": "Reg. Sanit. 2018-0123",
        "condicionVenta": "OTC",
        "ubicacion": "Estante A-1"
    },
    "7460100100209": {
        "codigoBarras": "7460100100209",
        "nombre": "Cataflam 50mg - Caja 20 Grageas",
        "nombreComercial": "Cataflam",
        "principioActivo": "Diclofenac Potásico",
        "concentracion": "50 mg",
        "categoria": "Antiinflamatorios y Analgésicos",
        "laboratorio": "Novartis / Sandoz",
        "presentacion": "Caja con 2 blisters de 10 grageas",
        "formaFarmaceutica": "Grageas",
        "tipo": "divisible",
        "unidadesPorCaja": 20,
        "ultimoPrecioCaja": 420,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0452",
        "condicionVenta": "Rx",
        "ubicacion": "Estante A-2"
    },
    "004588801233": {
        "codigoBarras": "004588801233",
        "nombre": "Motrin IB 200mg - Frasco 100 Cápsulas Líquidas",
        "nombreComercial": "Motrin IB",
        "principioActivo": "Ibuprofeno",
        "concentracion": "200 mg",
        "categoria": "Antiinflamatorios y Analgésicos",
        "laboratorio": "Johnson & Johnson / Kenvue",
        "presentacion": "Frasco plástico con 100 cápsulas líquidas",
        "formaFarmaceutica": "Cápsulas blandas",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 680,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2017-0889",
        "condicionVenta": "OTC",
        "ubicacion": "Estante A-3"
    },
    "7460100100308": {
        "codigoBarras": "7460100100308",
        "nombre": "Tempra Infantil Gotas 100mg/ml - Frasco 30ml",
        "nombreComercial": "Tempra Pediátrico",
        "principioActivo": "Paracetamol (Acetaminofén)",
        "concentracion": "100 mg / ml",
        "categoria": "Analgésicos y Antipiréticos Pediátricos",
        "laboratorio": "Reckitt Benckiser",
        "presentacion": "Frasco gotero de 30 ml con pipeta dosificadora",
        "formaFarmaceutica": "Solución gotas orales",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 295,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2020-0331",
        "condicionVenta": "OTC",
        "ubicacion": "Estante B-1"
    },
    "7460100100407": {
        "codigoBarras": "7460100100407",
        "nombre": "Amoxil 500mg - Caja 20 Cápsulas",
        "nombreComercial": "Amoxil",
        "principioActivo": "Amoxicilina Trihidrato",
        "concentracion": "500 mg",
        "categoria": "Antibióticos y Antimicrobianos",
        "laboratorio": "GlaxoSmithKline (GSK)",
        "presentacion": "Caja con 2 blisters de 10 cápsulas",
        "formaFarmaceutica": "Cápsulas",
        "tipo": "divisible",
        "unidadesPorCaja": 20,
        "ultimoPrecioCaja": 390,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2016-0211",
        "condicionVenta": "Rx",
        "ubicacion": "Estante B-2"
    },
    "7460100100506": {
        "codigoBarras": "7460100100506",
        "nombre": "Clavumox 500mg/125mg - Caja 14 Tabletas",
        "nombreComercial": "Clavumox",
        "principioActivo": "Amoxicilina + Ácido Clavulánico",
        "concentracion": "500 mg / 125 mg",
        "categoria": "Antibióticos de Amplio Espectro",
        "laboratorio": "Laboratorios Rowe",
        "presentacion": "Caja con 2 blisters de 7 tabletas recubiertas",
        "formaFarmaceutica": "Tabletas recubiertas",
        "tipo": "divisible",
        "unidadesPorCaja": 14,
        "ultimoPrecioCaja": 510,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0744",
        "condicionVenta": "Rx",
        "ubicacion": "Estante B-3"
    },
    "7460100100605": {
        "codigoBarras": "7460100100605",
        "nombre": "Azitrom 500mg - Caja 3 Tabletas",
        "nombreComercial": "Azitrom",
        "principioActivo": "Azitromicina Dihidrato",
        "concentracion": "500 mg",
        "categoria": "Antibióticos Macrólidos",
        "laboratorio": "Laboratorios Alfa",
        "presentacion": "Caja con 1 blister de 3 tabletas",
        "formaFarmaceutica": "Tabletas recubiertas",
        "tipo": "divisible",
        "unidadesPorCaja": 3,
        "ultimoPrecioCaja": 285,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2021-0988",
        "condicionVenta": "Rx",
        "ubicacion": "Estante B-4"
    },
    "7613035100107": {
        "codigoBarras": "7613035100107",
        "nombre": "Nan Optipro 1 - Lata 800g (0-6 meses)",
        "nombreComercial": "Nan Optipro 1",
        "principioActivo": "Fórmula infantil de inicio con hierro y probióticos",
        "concentracion": "800 g",
        "categoria": "Fórmulas y Nutrición Infantil",
        "laboratorio": "Nestlé Nutrition",
        "presentacion": "Lata metálica de 800 g con precinto de seguridad",
        "formaFarmaceutica": "Polvo para reconstituir",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 1140,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": true,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2018-0341",
        "condicionVenta": "OTC",
        "ubicacion": "Estante C-1"
    },
    "7613035100206": {
        "codigoBarras": "7613035100206",
        "nombre": "Nan Optipro 2 - Lata 800g (6-12 meses)",
        "nombreComercial": "Nan Optipro 2",
        "principioActivo": "Fórmula infantil de continuación con hierro y DHA",
        "concentracion": "800 g",
        "categoria": "Fórmulas y Nutrición Infantil",
        "laboratorio": "Nestlé Nutrition",
        "presentacion": "Lata metálica de 800 g",
        "formaFarmaceutica": "Polvo para reconstituir",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 1140,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": true,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2018-0342",
        "condicionVenta": "OTC",
        "ubicacion": "Estante C-2"
    },
    "008751410017": {
        "codigoBarras": "008751410017",
        "nombre": "Enfamil Premium Promental 1 - Lata 800g",
        "nombreComercial": "Enfamil Premium 1",
        "principioActivo": "Fórmula láctea infantil con MFGM, DHA y ARA",
        "concentracion": "800 g",
        "categoria": "Fórmulas y Nutrición Infantil",
        "laboratorio": "Mead Johnson Nutrition",
        "presentacion": "Lata metálica de 800 g",
        "formaFarmaceutica": "Polvo para reconstituir",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 1260,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": true,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0112",
        "condicionVenta": "OTC",
        "ubicacion": "Estante C-3"
    },
    "007007410016": {
        "codigoBarras": "007007410016",
        "nombre": "Similac 1 2'-FL con HMO - Lata 850g",
        "nombreComercial": "Similac 1 HMO",
        "principioActivo": "Fórmula infantil con oligosacárido 2-FL HMO",
        "concentracion": "850 g",
        "categoria": "Fórmulas y Nutrición Infantil",
        "laboratorio": "Abbott Laboratories",
        "presentacion": "Lata metálica de 850 g",
        "formaFarmaceutica": "Polvo para reconstituir",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 1290,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": true,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0551",
        "condicionVenta": "OTC",
        "ubicacion": "Estante C-4"
    },
    "7460100100704": {
        "codigoBarras": "7460100100704",
        "nombre": "Omeprazol Rowe 20mg - Caja 28 Cápsulas",
        "nombreComercial": "Omeprazol Rowe",
        "principioActivo": "Omeprazol",
        "concentracion": "20 mg",
        "categoria": "Gastrointestinal y Antiulcerosos",
        "laboratorio": "Laboratorios Rowe",
        "presentacion": "Caja con 4 tiras de 7 cápsulas con microgránulos",
        "formaFarmaceutica": "Cápsulas con microgránulos gastrorresistentes",
        "tipo": "divisible",
        "unidadesPorCaja": 28,
        "ultimoPrecioCaja": 340,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2018-0567",
        "condicionVenta": "OTC",
        "ubicacion": "Estante D-1"
    },
    "7460100100803": {
        "codigoBarras": "7460100100803",
        "nombre": "Mylanta Suspensión Antiacida - Frasco 360ml",
        "nombreComercial": "Mylanta Regular",
        "principioActivo": "Hidróxido de Aluminio + Magnesio + Simeticona",
        "concentracion": "400mg / 400mg / 40mg por cada 10ml",
        "categoria": "Antiácidos y Antiflatulentos",
        "laboratorio": "Johnson & Johnson",
        "presentacion": "Frasco plástico de 360 ml sabor a menta",
        "formaFarmaceutica": "Suspensión oral",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 310,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2015-0199",
        "condicionVenta": "OTC",
        "ubicacion": "Estante D-2"
    },
    "7460100100902": {
        "codigoBarras": "7460100100902",
        "nombre": "Claritine 10mg - Caja 10 Tabletas",
        "nombreComercial": "Claritine",
        "principioActivo": "Loratadina",
        "concentracion": "10 mg",
        "categoria": "Antihistamínicos y Antialérgicos",
        "laboratorio": "Bayer Healthcare",
        "presentacion": "Caja con 1 blister de 10 tabletas",
        "formaFarmaceutica": "Tabletas",
        "tipo": "divisible",
        "unidadesPorCaja": 10,
        "ultimoPrecioCaja": 275,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2017-0432",
        "condicionVenta": "OTC",
        "ubicacion": "Estante D-3"
    },
    "7460100101008": {
        "codigoBarras": "7460100101008",
        "nombre": "Ventolin Inhalador 100mcg - Frasco 200 Dosis",
        "nombreComercial": "Ventolin Aerosol",
        "principioActivo": "Salbutamol Sulfato",
        "concentracion": "100 mcg / dosis",
        "categoria": "Broncodilatadores y Respiratorios",
        "laboratorio": "GlaxoSmithKline (GSK)",
        "presentacion": "Inhalador presurizado de 200 dosis con aplicador bucal",
        "formaFarmaceutica": "Aerosol para inhalación",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 495,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2016-0812",
        "condicionVenta": "Rx",
        "ubicacion": "Estante E-1"
    },
    "7460100101107": {
        "codigoBarras": "7460100101107",
        "nombre": "Zyrtec 10mg - Caja 10 Tabletas",
        "nombreComercial": "Zyrtec",
        "principioActivo": "Cetirizina Diclorhidrato",
        "concentracion": "10 mg",
        "categoria": "Antihistamínicos y Antialérgicos",
        "laboratorio": "GSK / UCB",
        "presentacion": "Caja con 1 blister de 10 tabletas recubiertas",
        "formaFarmaceutica": "Tabletas recubiertas",
        "tipo": "divisible",
        "unidadesPorCaja": 10,
        "ultimoPrecioCaja": 320,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0144",
        "condicionVenta": "OTC",
        "ubicacion": "Estante E-2"
    },
    "7460100101206": {
        "codigoBarras": "7460100101206",
        "nombre": "Cozaar 50mg - Caja 30 Tabletas",
        "nombreComercial": "Cozaar",
        "principioActivo": "Losartán Potásico",
        "concentracion": "50 mg",
        "categoria": "Cardiovascular y Antihipertensivos",
        "laboratorio": "Organon / Merck Sharp & Dohme",
        "presentacion": "Caja con 3 blisters de 10 tabletas",
        "formaFarmaceutica": "Tabletas recubiertas",
        "tipo": "divisible",
        "unidadesPorCaja": 30,
        "ultimoPrecioCaja": 620,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2018-0677",
        "condicionVenta": "Rx",
        "ubicacion": "Estante E-3"
    },
    "7460100101305": {
        "codigoBarras": "7460100101305",
        "nombre": "Glucophage 850mg - Caja 30 Tabletas",
        "nombreComercial": "Glucophage",
        "principioActivo": "Metformina Clorhidrato",
        "concentracion": "850 mg",
        "categoria": "Antidiabéticos Orales",
        "laboratorio": "Merck Healthcare",
        "presentacion": "Caja con 3 blisters de 10 tabletas",
        "formaFarmaceutica": "Tabletas",
        "tipo": "divisible",
        "unidadesPorCaja": 30,
        "ultimoPrecioCaja": 385,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2017-0355",
        "condicionVenta": "Rx",
        "ubicacion": "Estante F-1"
    },
    "7460100101404": {
        "codigoBarras": "7460100101404",
        "nombre": "Norvasc 5mg - Caja 30 Tabletas",
        "nombreComercial": "Norvasc",
        "principioActivo": "Amlodipina Besilato",
        "concentracion": "5 mg",
        "categoria": "Cardiovascular y Antihipertensivos",
        "laboratorio": "Pfizer / Viatris",
        "presentacion": "Caja con 3 blisters de 10 tabletas",
        "formaFarmaceutica": "Tabletas",
        "tipo": "divisible",
        "unidadesPorCaja": 30,
        "ultimoPrecioCaja": 590,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2018-0921",
        "condicionVenta": "Rx",
        "ubicacion": "Estante F-2"
    },
    "7460100101503": {
        "codigoBarras": "7460100101503",
        "nombre": "Bactroban Ungüento 2% - Tubo 15g",
        "nombreComercial": "Bactroban",
        "principioActivo": "Mupirocina",
        "concentracion": "2% (20 mg / g)",
        "categoria": "Antibióticos Tópicos y Dermatología",
        "laboratorio": "GlaxoSmithKline (GSK)",
        "presentacion": "Tubo de aluminio colapsible de 15 g",
        "formaFarmaceutica": "Ungüento dermatológico",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 410,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2019-0288",
        "condicionVenta": "Rx",
        "ubicacion": "Estante G-1"
    },
    "7460100101602": {
        "codigoBarras": "7460100101602",
        "nombre": "Betnovate Crema 0.1% - Tubo 30g",
        "nombreComercial": "Betnovate",
        "principioActivo": "Betametasona Valerato",
        "concentracion": "0.1%",
        "categoria": "Corticosteroides Tópicos",
        "laboratorio": "GlaxoSmithKline (GSK)",
        "presentacion": "Tubo de 30 g",
        "formaFarmaceutica": "Crema tópica",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 360,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2016-0499",
        "condicionVenta": "Rx",
        "ubicacion": "Estante G-2"
    },
    "7460100101701": {
        "codigoBarras": "7460100101701",
        "nombre": "Electrolit Suero Oral Fresa 625ml",
        "nombreComercial": "Electrolit Fresa",
        "principioActivo": "Electrolitos Orales (Glucosa, Sodio, Potasio, Magnesio)",
        "concentracion": "Fórmula OMS / Suero rehidratante",
        "categoria": "Soluciones Electrolíticas y Rehidratación",
        "laboratorio": "Laboratorios Pisa",
        "presentacion": "Frasco plástico ergonómico de 625 ml",
        "formaFarmaceutica": "Solución líquida oral",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 140,
        "aplicaItbis": false,
        "tasaItbis": 0,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2020-0761",
        "condicionVenta": "OTC",
        "ubicacion": "Estante H-1"
    },
    "7460100101800": {
        "codigoBarras": "7460100101800",
        "nombre": "Alcohol Isopropílico 70% Antiséptico 500ml",
        "nombreComercial": "Alcohol Rangel 70%",
        "principioActivo": "Alcohol Isopropílico",
        "concentracion": "70% v/v",
        "categoria": "Higiene, Antisépticos y Primeros Auxilios",
        "laboratorio": "Laboratorios Rangel",
        "presentacion": "Frasco plástico de 500 ml",
        "formaFarmaceutica": "Solución tópica antiséptica",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 95,
        "aplicaItbis": true,
        "tasaItbis": 18,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2015-0811",
        "condicionVenta": "OTC",
        "ubicacion": "Pasillo 1"
    },
    "7460100101909": {
        "codigoBarras": "7460100101909",
        "nombre": "Agua Oxigenada 10 Volúmenes 120ml",
        "nombreComercial": "Agua Oxigenada Alfa",
        "principioActivo": "Peróxido de Hidrógeno al 3%",
        "concentracion": "10 Volúmenes (3%)",
        "categoria": "Higiene, Antisépticos y Primeros Auxilios",
        "laboratorio": "Laboratorios Alfa",
        "presentacion": "Frasco ámbar de 120 ml",
        "formaFarmaceutica": "Solución líquida tópica",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 55,
        "aplicaItbis": true,
        "tasaItbis": 18,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2015-0812",
        "condicionVenta": "OTC",
        "ubicacion": "Pasillo 1"
    },
    "7460100102005": {
        "codigoBarras": "7460100102005",
        "nombre": "Gasa Estéril 3x3 Pulgadas - Sobre con 5 unidades",
        "nombreComercial": "Gasa Estéril Rangel",
        "principioActivo": "Algodón hidrófilo quirúrgico estéril",
        "concentracion": "3\" x 3\" (7.5 cm x 7.5 cm)",
        "categoria": "Material Quirúrgico y Primeros Auxilios",
        "laboratorio": "Laboratorios Rangel",
        "presentacion": "Sobre termosellado con 5 apósitos estériles",
        "formaFarmaceutica": "Material de curación",
        "tipo": "entero",
        "unidadesPorCaja": 1,
        "ultimoPrecioCaja": 45,
        "aplicaItbis": true,
        "tasaItbis": 18,
        "esLeche": false,
        "descuentoValor": 0,
        "tipoDescuento": "monto",
        "origenDatos": "catalogo_oficial_rd",
        "actualizadoEn": "2026-11-04T17:52:26.846Z",
        "registroSanitario": "Reg. Sanit. 2014-0310",
        "condicionVenta": "OTC",
        "ubicacion": "Pasillo 2"
    }
});

    function precargarCatalogoDominicano() {
        const actual = obtenerDiccionarioCodigos();
        let agregados = 0;
        Object.entries(CATALOGO_RD_PRECARGADO).forEach(([cod, info]) => {
            const limpio = Dominio.normalizarCodigoBarras(cod);
            if (limpio && info) {
                actual[limpio] = {
                    ...info,
                    codigoBarras: limpio,
                    actualizadoEn: new Date().toISOString()
                };
                agregados++;
            }
        });
        guardarDiccionarioCodigos(actual);
        return agregados;
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

    AppFarmacia.Almacenamiento = Object.freeze({
        leerJsonSeguro,
        escribirJsonSeguro,
        invalidarCacheStorage,
        inicializarPersistencia,
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
        restaurarBaseCompleta,
        precargarCatalogoDominicano
    });
})(window);
