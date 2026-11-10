(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;

    const CFG_BOVEDA = (CONSTANTES && CONSTANTES.SEGURIDAD_BOVEDA) || {
        ALGORITMO_CIFRADO: 'AES-GCM',
        LONGITUD_CLAVE_BITS: 256,
        ITERACIONES_PBKDF2: 600000,
        LONGITUD_SALT_BYTES: 16,
        LONGITUD_IV_BYTES: 12,
        MIN_LONGITUD_CONTRASENA: 6,
        MAX_INTENTOS_FALLIDOS_BASE: 3,
        AUTO_BLOQUEO_DEFECTO_MIN: 15
    };

    const ITERACIONES_CODIGO_RECUPERACION = 100000;

    // Estado criptográfico estrictamente en RAM (nunca persiste en disco ni en window)
    let dekRam = null;
    let metadatosBoveda = null;
    let intentosFallidos = 0;
    let bloqueadoHastaMs = 0;
    let temporizadorAutoBloqueo = null;
    const suscriptoresEstado = new Set();

    function obtenerCrypto() {
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
            return globalThis.crypto;
        }
        if (global && global.crypto && global.crypto.subtle) {
            return global.crypto;
        }
        return null;
    }

    function soportaWebCrypto() {
        const c = obtenerCrypto();
        return Boolean(c && c.subtle && typeof c.getRandomValues === 'function');
    }

    function bytesABase64(bytes) {
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let binario = '';
        const chunk = 8192;
        for (let i = 0; i < arr.length; i += chunk) {
            const sub = arr.subarray(i, Math.min(i + chunk, arr.length));
            binario += String.fromCharCode.apply(null, sub);
        }
        return btoa(binario);
    }

    function base64ABytes(b64) {
        const binario = atob(String(b64 || ''));
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) {
            bytes[i] = binario.charCodeAt(i);
        }
        return bytes;
    }

    function comparacionTiempoConstante(a, b) {
        if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
            diff |= (a[i] ^ b[i]);
        }
        return diff === 0;
    }

    function limpiarBytes(arr) {
        if (arr && typeof arr.fill === 'function') {
            try { arr.fill(0); } catch (_) {}
        }
    }

    function validarPoliticaContrasena(contrasena) {
        if (typeof contrasena !== 'string') {
            return { esValido: false, error: 'La contraseña debe ser texto válido.' };
        }
        if (contrasena.length < CFG_BOVEDA.MIN_LONGITUD_CONTRASENA) {
            return {
                esValido: false,
                error: `La contraseña debe tener al menos ${CFG_BOVEDA.MIN_LONGITUD_CONTRASENA} caracteres.`
            };
        }
        if (contrasena.length > 128) {
            return { esValido: false, error: 'La contraseña no puede exceder los 128 caracteres.' };
        }
        return { esValido: true };
    }

    function generarCodigoRecuperacionLegible(cryptoObj) {
        const bytes = new Uint8Array(16);
        cryptoObj.getRandomValues(bytes);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, '0').toUpperCase();
        }
        limpiarBytes(bytes);
        return hex.match(/.{1,4}/g).join('-');
    }

    function normalizarCodigoRecuperacion(codigo) {
        return String(codigo || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    }

    async function derivarKekYVerificador(secretoTexto, saltBytes, iteraciones) {
        const cryptoObj = obtenerCrypto();
        if (!cryptoObj) {
            throw new Error('Este navegador o contexto no soporta Web Crypto API (requiere HTTPS o localhost).');
        }
        const enc = new TextEncoder();
        const bytesSecreto = enc.encode(secretoTexto);
        const claveBase = await cryptoObj.subtle.importKey(
            'raw',
            bytesSecreto,
            'PBKDF2',
            false,
            ['deriveBits']
        );
        limpiarBytes(bytesSecreto);

        const bitsDerivados = new Uint8Array(await cryptoObj.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: iteraciones,
                hash: 'SHA-256'
            },
            claveBase,
            512
        ));

        const kekBytes = bitsDerivados.slice(0, 32);
        const verifSlice = bitsDerivados.slice(32, 64);

        const kek = await cryptoObj.subtle.importKey(
            'raw',
            kekBytes,
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, length: CFG_BOVEDA.LONGITUD_CLAVE_BITS },
            false,
            ['encrypt', 'decrypt']
        );
        const verifHash = new Uint8Array(await cryptoObj.subtle.digest('SHA-256', verifSlice));

        limpiarBytes(bitsDerivados);
        limpiarBytes(kekBytes);
        limpiarBytes(verifSlice);

        return { kek, verifHash };
    }

    async function importarDekNoExtraible(rawDekBytes) {
        const cryptoObj = obtenerCrypto();
        return cryptoObj.subtle.importKey(
            'raw',
            rawDekBytes,
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, length: CFG_BOVEDA.LONGITUD_CLAVE_BITS },
            false,
            ['encrypt', 'decrypt']
        );
    }

    function notificarCambioEstado() {
        const estado = obtenerEstado();
        suscriptoresEstado.forEach(fn => {
            try { fn(estado); } catch (e) { console.warn('[Seguridad] Error en suscriptor:', e); }
        });
    }

    function detenerTemporizadorAutoBloqueo() {
        if (temporizadorAutoBloqueo) {
            clearTimeout(temporizadorAutoBloqueo);
            temporizadorAutoBloqueo = null;
        }
    }

    function reiniciarTemporizadorAutoBloqueo() {
        detenerTemporizadorAutoBloqueo();
        if (!metadatosBoveda || dekRam === null) return;
        const mins = Number(metadatosBoveda.minutosAutoBloqueo);
        if (!Number.isFinite(mins) || mins <= 0) return;
        temporizadorAutoBloqueo = setTimeout(() => {
            bloquear();
        }, mins * 60 * 1000);
    }

    function suscribirCambioEstado(fn) {
        if (typeof fn === 'function') {
            suscriptoresEstado.add(fn);
        }
        return () => suscriptoresEstado.delete(fn);
    }

    function establecerMetadatosPersistidos(meta) {
        if (!meta || typeof meta !== 'object' || !meta.salt || !meta.wrappedDek) {
            metadatosBoveda = null;
            dekRam = null;
            detenerTemporizadorAutoBloqueo();
            notificarCambioEstado();
            return;
        }
        metadatosBoveda = Dominio ? Dominio.clonarObjetoSeguro(meta) : { ...meta };
        // Por seguridad, cargar metadatos desde disco no desbloquea automáticamente la sesión
        notificarCambioEstado();
    }

    function estaConfigurado() {
        return Boolean(metadatosBoveda && metadatosBoveda.wrappedDek && metadatosBoveda.verificadorHash);
    }

    function estaBloqueado() {
        return !estaConfigurado() || dekRam === null;
    }

    function obtenerEstado() {
        const config = estaConfigurado();
        const abierto = config && dekRam !== null;
        return {
            soportado: soportaWebCrypto(),
            configurado: config,
            bloqueado: config ? !abierto : false,
            desbloqueado: abierto,
            minutosAutoBloqueo: metadatosBoveda ? Number(metadatosBoveda.minutosAutoBloqueo || 0) : CFG_BOVEDA.AUTO_BLOQUEO_DEFECTO_MIN,
            intentosFallidos,
            bloqueadoHastaMs
        };
    }

    function obtenerMetadatos() {
        return metadatosBoveda ? (Dominio ? Dominio.clonarObjetoSeguro(metadatosBoveda) : { ...metadatosBoveda }) : null;
    }

    async function configurarContrasenaMaestra(contrasena, opciones = {}) {
        const cryptoObj = obtenerCrypto();
        if (!cryptoObj) {
            throw new Error('Tu navegador no permite Web Crypto API en este origen. Abre la app por HTTPS o localhost.');
        }
        const val = validarPoliticaContrasena(contrasena);
        if (!val.esValido) throw new Error(val.error);

        const iteraciones = Math.max(
            100000,
            parseInt(opciones.iteraciones, 10) || CFG_BOVEDA.ITERACIONES_PBKDF2
        );
        const minutosAutoBloqueo = opciones.minutosAutoBloqueo !== undefined
            ? Math.max(0, parseInt(opciones.minutosAutoBloqueo, 10) || 0)
            : CFG_BOVEDA.AUTO_BLOQUEO_DEFECTO_MIN;

        const salt = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
        const saltRec = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
        const ivWrap = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
        const ivRec = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));

        const codigoRecuperacion = generarCodigoRecuperacionLegible(cryptoObj);
        const recNorm = normalizarCodigoRecuperacion(codigoRecuperacion);

        const rawDek = cryptoObj.getRandomValues(new Uint8Array(32));

        try {
            const [{ kek, verifHash }, { kek: recKek, verifHash: recVerifHash }] = await Promise.all([
                derivarKekYVerificador(contrasena, salt, iteraciones),
                derivarKekYVerificador(recNorm, saltRec, ITERACIONES_CODIGO_RECUPERACION)
            ]);

            const wrappedDekBuf = await cryptoObj.subtle.encrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivWrap },
                kek,
                rawDek
            );
            const wrappedDekRecBuf = await cryptoObj.subtle.encrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivRec },
                recKek,
                rawDek
            );

            dekRam = await importarDekNoExtraible(rawDek);
            intentosFallidos = 0;
            bloqueadoHastaMs = 0;

            const ahoraIso = new Date().toISOString();
            metadatosBoveda = {
                version: 1,
                algoritmo: 'AES-256-GCM',
                kdf: 'PBKDF2-SHA256',
                iteraciones,
                salt: bytesABase64(salt),
                verificadorHash: bytesABase64(verifHash),
                ivWrap: bytesABase64(ivWrap),
                wrappedDek: bytesABase64(wrappedDekBuf),
                saltRec: bytesABase64(saltRec),
                recVerificadorHash: bytesABase64(recVerifHash),
                ivRec: bytesABase64(ivRec),
                wrappedDekRec: bytesABase64(wrappedDekRecBuf),
                minutosAutoBloqueo,
                creadoEn: ahoraIso,
                actualizadoEn: ahoraIso
            };

            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();

            return {
                exito: true,
                metadatos: obtenerMetadatos(),
                codigoRecuperacion
            };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    async function desbloquear(contrasena) {
        if (!estaConfigurado()) {
            throw new Error('La bóveda aún no tiene contraseña maestra configurada.');
        }
        const ahora = Date.now();
        if (bloqueadoHastaMs > ahora) {
            const segs = Math.ceil((bloqueadoHastaMs - ahora) / 1000);
            throw new Error(`Demasiados intentos fallidos. Espera ${segs} segundo(s) antes de reintentar.`);
        }
        if (typeof contrasena !== 'string' || contrasena.length === 0) {
            throw new Error('Ingresa la contraseña de administrador.');
        }

        const cryptoObj = obtenerCrypto();
        if (!cryptoObj) {
            throw new Error('Web Crypto API no disponible en este contexto.');
        }

        const salt = base64ABytes(metadatosBoveda.salt);
        const iteraciones = Number(metadatosBoveda.iteraciones) || CFG_BOVEDA.ITERACIONES_PBKDF2;
        const { kek, verifHash } = await derivarKekYVerificador(contrasena, salt, iteraciones);
        const esperado = base64ABytes(metadatosBoveda.verificadorHash);

        if (!comparacionTiempoConstante(verifHash, esperado)) {
            intentosFallidos++;
            if (intentosFallidos >= 8) {
                bloqueadoHastaMs = Date.now() + 120000;
            } else if (intentosFallidos >= 5) {
                bloqueadoHastaMs = Date.now() + 30000;
            } else if (intentosFallidos >= CFG_BOVEDA.MAX_INTENTOS_FALLIDOS_BASE) {
                bloqueadoHastaMs = Date.now() + 5000;
            }
            notificarCambioEstado();
            throw new Error('Contraseña de administrador incorrecta.');
        }

        let rawDek = null;
        try {
            const ivWrap = base64ABytes(metadatosBoveda.ivWrap);
            const wrappedDek = base64ABytes(metadatosBoveda.wrappedDek);
            const rawDekBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivWrap },
                kek,
                wrappedDek
            );
            rawDek = new Uint8Array(rawDekBuf);
            dekRam = await importarDekNoExtraible(rawDek);
            intentosFallidos = 0;
            bloqueadoHastaMs = 0;
            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();
            return { exito: true };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    async function cambiarContrasena(contrasenaActual, contrasenaNueva) {
        if (!estaConfigurado()) {
            throw new Error('No hay contraseña maestra configurada todavía.');
        }
        const valNueva = validarPoliticaContrasena(contrasenaNueva);
        if (!valNueva.esValido) throw new Error(valNueva.error);

        const cryptoObj = obtenerCrypto();
        const saltActual = base64ABytes(metadatosBoveda.salt);
        const iteraciones = Number(metadatosBoveda.iteraciones) || CFG_BOVEDA.ITERACIONES_PBKDF2;
        const { kek: kekActual, verifHash: verifActual } = await derivarKekYVerificador(contrasenaActual, saltActual, iteraciones);
        const esperado = base64ABytes(metadatosBoveda.verificadorHash);

        if (!comparacionTiempoConstante(verifActual, esperado)) {
            throw new Error('La contraseña actual es incorrecta.');
        }

        let rawDek = null;
        try {
            const rawDekBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: base64ABytes(metadatosBoveda.ivWrap) },
                kekActual,
                base64ABytes(metadatosBoveda.wrappedDek)
            );
            rawDek = new Uint8Array(rawDekBuf);

            const saltNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
            const ivWrapNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
            const { kek: kekNuevo, verifHash: verifNuevo } = await derivarKekYVerificador(contrasenaNueva, saltNuevo, iteraciones);
            const wrappedNuevo = await cryptoObj.subtle.encrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivWrapNuevo },
                kekNuevo,
                rawDek
            );

            metadatosBoveda = {
                ...metadatosBoveda,
                salt: bytesABase64(saltNuevo),
                verificadorHash: bytesABase64(verifNuevo),
                ivWrap: bytesABase64(ivWrapNuevo),
                wrappedDek: bytesABase64(wrappedNuevo),
                actualizadoEn: new Date().toISOString()
            };

            dekRam = await importarDekNoExtraible(rawDek);
            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();
            return { exito: true, metadatos: obtenerMetadatos() };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    async function recuperarConCodigo(codigoIngresado, nuevaContrasena) {
        if (!estaConfigurado() || !metadatosBoveda.wrappedDekRec || !metadatosBoveda.saltRec) {
            throw new Error('La bóveda no cuenta con metadatos de recuperación.');
        }
        const valNueva = validarPoliticaContrasena(nuevaContrasena);
        if (!valNueva.esValido) throw new Error(valNueva.error);

        const recNorm = normalizarCodigoRecuperacion(codigoIngresado);
        if (recNorm.length !== 32) {
            throw new Error('El código de recuperación no tiene el formato completo de 32 caracteres.');
        }

        const cryptoObj = obtenerCrypto();
        const saltRecActual = base64ABytes(metadatosBoveda.saltRec);
        const { kek: recKekActual, verifHash: recVerifActual } = await derivarKekYVerificador(
            recNorm,
            saltRecActual,
            ITERACIONES_CODIGO_RECUPERACION
        );
        const esperadoRec = base64ABytes(metadatosBoveda.recVerificadorHash);

        if (!comparacionTiempoConstante(recVerifActual, esperadoRec)) {
            throw new Error('Código de recuperación incorrecto.');
        }

        let rawDek = null;
        try {
            const rawDekBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: base64ABytes(metadatosBoveda.ivRec) },
                recKekActual,
                base64ABytes(metadatosBoveda.wrappedDekRec)
            );
            rawDek = new Uint8Array(rawDekBuf);

            const iteraciones = Number(metadatosBoveda.iteraciones) || CFG_BOVEDA.ITERACIONES_PBKDF2;
            const saltNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
            const ivWrapNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
            const saltRecNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
            const ivRecNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));

            const nuevoCodigoRecuperacion = generarCodigoRecuperacionLegible(cryptoObj);
            const recNormNuevo = normalizarCodigoRecuperacion(nuevoCodigoRecuperacion);

            const [{ kek: kekNuevo, verifHash: verifNuevo }, { kek: recKekNuevo, verifHash: recVerifNuevo }] = await Promise.all([
                derivarKekYVerificador(nuevaContrasena, saltNuevo, iteraciones),
                derivarKekYVerificador(recNormNuevo, saltRecNuevo, ITERACIONES_CODIGO_RECUPERACION)
            ]);

            const [wrappedNuevo, wrappedRecNuevo] = await Promise.all([
                cryptoObj.subtle.encrypt({ name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivWrapNuevo }, kekNuevo, rawDek),
                cryptoObj.subtle.encrypt({ name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivRecNuevo }, recKekNuevo, rawDek)
            ]);

            metadatosBoveda = {
                ...metadatosBoveda,
                salt: bytesABase64(saltNuevo),
                verificadorHash: bytesABase64(verifNuevo),
                ivWrap: bytesABase64(ivWrapNuevo),
                wrappedDek: bytesABase64(wrappedNuevo),
                saltRec: bytesABase64(saltRecNuevo),
                recVerificadorHash: bytesABase64(recVerifNuevo),
                ivRec: bytesABase64(ivRecNuevo),
                wrappedDekRec: bytesABase64(wrappedRecNuevo),
                actualizadoEn: new Date().toISOString()
            };

            dekRam = await importarDekNoExtraible(rawDek);
            intentosFallidos = 0;
            bloqueadoHastaMs = 0;
            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();

            return {
                exito: true,
                metadatos: obtenerMetadatos(),
                nuevoCodigoRecuperacion
            };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    async function regenerarCodigoRecuperacion(contrasenaActual) {
        if (!estaConfigurado()) throw new Error('Bóveda no configurada.');
        const cryptoObj = obtenerCrypto();
        const saltActual = base64ABytes(metadatosBoveda.salt);
        const iteraciones = Number(metadatosBoveda.iteraciones) || CFG_BOVEDA.ITERACIONES_PBKDF2;
        const { kek, verifHash } = await derivarKekYVerificador(contrasenaActual, saltActual, iteraciones);
        if (!comparacionTiempoConstante(verifHash, base64ABytes(metadatosBoveda.verificadorHash))) {
            throw new Error('La contraseña actual es incorrecta.');
        }

        let rawDek = null;
        try {
            const rawDekBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: base64ABytes(metadatosBoveda.ivWrap) },
                kek,
                base64ABytes(metadatosBoveda.wrappedDek)
            );
            rawDek = new Uint8Array(rawDekBuf);

            const saltRecNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
            const ivRecNuevo = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
            const nuevoCodigoRecuperacion = generarCodigoRecuperacionLegible(cryptoObj);
            const { kek: recKek, verifHash: recVerif } = await derivarKekYVerificador(
                normalizarCodigoRecuperacion(nuevoCodigoRecuperacion),
                saltRecNuevo,
                ITERACIONES_CODIGO_RECUPERACION
            );
            const wrappedRec = await cryptoObj.subtle.encrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivRecNuevo },
                recKek,
                rawDek
            );

            metadatosBoveda = {
                ...metadatosBoveda,
                saltRec: bytesABase64(saltRecNuevo),
                recVerificadorHash: bytesABase64(recVerif),
                ivRec: bytesABase64(ivRecNuevo),
                wrappedDekRec: bytesABase64(wrappedRec),
                actualizadoEn: new Date().toISOString()
            };

            return {
                exito: true,
                metadatos: obtenerMetadatos(),
                codigoRecuperacion: nuevoCodigoRecuperacion
            };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    function configurarAutoBloqueo(minutos) {
        if (!metadatosBoveda) return null;
        const mins = Math.max(0, parseInt(minutos, 10) || 0);
        metadatosBoveda = {
            ...metadatosBoveda,
            minutosAutoBloqueo: mins,
            actualizadoEn: new Date().toISOString()
        };
        reiniciarTemporizadorAutoBloqueo();
        notificarCambioEstado();
        return obtenerMetadatos();
    }

    function bloquear() {
        dekRam = null;
        detenerTemporizadorAutoBloqueo();
        notificarCambioEstado();
    }

    function registrarActividad() {
        if (estaConfigurado() && dekRam !== null) {
            reiniciarTemporizadorAutoBloqueo();
        }
    }

    async function cifrarJson(datos) {
        if (estaBloqueado()) {
            throw new Error('Bóveda cifrada bloqueada: no es posible cifrar sin clave desbloqueada.');
        }
        const cryptoObj = obtenerCrypto();
        const iv = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
        const textoJson = JSON.stringify(datos);
        const bytes = new TextEncoder().encode(textoJson);
        const ciphertext = await cryptoObj.subtle.encrypt(
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv },
            dekRam,
            bytes
        );
        limpiarBytes(bytes);

        return {
            _segCifrado: true,
            v: 1,
            alg: 'AES-256-GCM',
            iv: bytesABase64(iv),
            ct: bytesABase64(ciphertext)
        };
    }

    async function descifrarJson(sobre) {
        if (estaBloqueado()) {
            throw new Error('Bóveda cifrada bloqueada: requiere desbloqueo de administrador.');
        }
        if (!sobre || typeof sobre !== 'object' || sobre._segCifrado !== true || !sobre.iv || !sobre.ct) {
            throw new Error('Sobre cifrado inválido o corrupto.');
        }
        const cryptoObj = obtenerCrypto();
        const iv = base64ABytes(sobre.iv);
        const ct = base64ABytes(sobre.ct);
        const claroBuf = await cryptoObj.subtle.decrypt(
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv },
            dekRam,
            ct
        );
        const texto = new TextDecoder().decode(claroBuf);
        const crudo = JSON.parse(texto);
        return (Dominio && typeof Dominio.sanitizarJsonSeguro === 'function')
            ? Dominio.sanitizarJsonSeguro(crudo)
            : crudo;
    }

    AppFarmacia.Seguridad = Object.freeze({
        soportaWebCrypto,
        establecerMetadatosPersistidos,
        obtenerEstado,
        obtenerMetadatos,
        estaConfigurado,
        estaBloqueado,
        configurarContrasenaMaestra,
        desbloquear,
        cambiarContrasena,
        recuperarConCodigo,
        regenerarCodigoRecuperacion,
        configurarAutoBloqueo,
        bloquear,
        registrarActividad,
        suscribirCambioEstado,
        cifrarJson,
        descifrarJson
    });
})(window);
