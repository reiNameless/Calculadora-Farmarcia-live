(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;

    const CFG_BOVEDA = (CONSTANTES && CONSTANTES.SEGURIDAD_BOVEDA) || {
        ALGORITMO_CIFRADO: 'AES-GCM',
        LONGITUD_CLAVE_BITS: 256,
        ITERACIONES_PBKDF2: 600000,
        ITERACIONES_PIN_CAJA: 300000,
        LONGITUD_SALT_BYTES: 16,
        LONGITUD_IV_BYTES: 12,
        MIN_LONGITUD_CONTRASENA: 10,
        MIN_LONGITUD_PIN_CAJA: 4,
        MAX_LONGITUD_PIN_CAJA: 16,
        MAX_INTENTOS_FALLIDOS_BASE: 3,
        AUTO_BLOQUEO_DEFECTO_MIN: 15
    };

    const ITERACIONES_CODIGO_RECUPERACION = 100000;
    const ALFABETO_CODIGO_ENTREGA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    // Estado criptográfico estrictamente en RAM (nunca persiste en claro en disco ni en window)
    let dekRam = null;
    let dekCajaRam = null;
    let skBuzonRam = null;
    let idEncPrivRam = null;
    let idSignPrivRam = null;
    let trustedPeersRam = [];

    let metadatosBoveda = null;
    let intentosFallidos = 0;
    let bloqueadoHastaMs = 0;
    let intentosFallidosCaja = 0;
    let bloqueadoCajaHastaMs = 0;
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

    function concatenarBytes(...arrays) {
        const total = arrays.reduce((acc, a) => acc + (a ? a.length : 0), 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const a of arrays) {
            if (!a || !a.length) continue;
            out.set(a, offset);
            offset += a.length;
        }
        return out;
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

    function serializarAadCanonica(obj) {
        if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
        }
        if (Array.isArray(obj)) {
            return '[' + obj.map(serializarAadCanonica).join(',') + ']';
        }
        const claves = Object.keys(obj).sort();
        return '{' + claves.map(k => JSON.stringify(k) + ':' + serializarAadCanonica(obj[k])).join(',') + '}';
    }

    function codificarAadBytes(aad) {
        if (aad === null || aad === undefined) return null;
        if (aad instanceof Uint8Array) return aad;
        const txt = (typeof aad === 'string') ? aad : serializarAadCanonica(aad);
        return new TextEncoder().encode(txt);
    }

    function validarPoliticaContrasena(contrasena) {
        if (typeof contrasena !== 'string') {
            return { esValido: false, error: 'La contraseña debe ser texto válido.' };
        }
        const minLen = Number(CFG_BOVEDA.MIN_LONGITUD_CONTRASENA) || 10;
        if (contrasena.length < minLen) {
            return {
                esValido: false,
                error: `La contraseña debe tener al menos ${minLen} caracteres.`
            };
        }
        if (contrasena.length > 128) {
            return { esValido: false, error: 'La contraseña no puede exceder los 128 caracteres.' };
        }
        return { esValido: true };
    }

    function validarPoliticaPinCaja(pin) {
        if (typeof pin !== 'string') {
            return { esValido: false, error: 'El PIN operativo de caja debe ser texto válido.' };
        }
        const minLen = Number(CFG_BOVEDA.MIN_LONGITUD_PIN_CAJA) || 4;
        const maxLen = Number(CFG_BOVEDA.MAX_LONGITUD_PIN_CAJA) || 16;
        const limpio = pin.trim();
        if (limpio.length < minLen) {
            return { esValido: false, error: `El PIN de mostrador debe tener al menos ${minLen} caracteres o dígitos.` };
        }
        if (limpio.length > maxLen) {
            return { esValido: false, error: `El PIN de mostrador no puede exceder ${maxLen} caracteres.` };
        }
        return { esValido: true, pin: limpio };
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

    function generarCodigoEntregaSync(cryptoObj) {
        const bytes = new Uint8Array(8);
        cryptoObj.getRandomValues(bytes);
        let chars = '';
        for (let i = 0; i < bytes.length; i++) {
            chars += ALFABETO_CODIGO_ENTREGA[bytes[i] % ALFABETO_CODIGO_ENTREGA.length];
        }
        limpiarBytes(bytes);
        return chars.slice(0, 4) + '-' + chars.slice(4, 8);
    }

    function normalizarCodigoEntrega(codigo) {
        return String(codigo || '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
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

    async function cifrarConClave(keyAes, datos, aad = null) {
        const cryptoObj = obtenerCrypto();
        const iv = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
        const textoJson = JSON.stringify(datos);
        const bytes = new TextEncoder().encode(textoJson);
        const aadBytes = codificarAadBytes(aad);
        const params = { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv };
        if (aadBytes) params.additionalData = aadBytes;
        const ciphertext = await cryptoObj.subtle.encrypt(params, keyAes, bytes);
        limpiarBytes(bytes);

        const sobre = {
            _segCifrado: true,
            v: aadBytes ? 2 : 1,
            alg: 'AES-256-GCM',
            iv: bytesABase64(iv),
            ct: bytesABase64(ciphertext)
        };
        if (aadBytes) sobre.aad = true;
        return sobre;
    }

    async function descifrarConClave(keyAes, sobre, aad = null) {
        if (!sobre || typeof sobre !== 'object' || sobre._segCifrado !== true || !sobre.iv || !sobre.ct) {
            throw new Error('Sobre cifrado inválido o corrupto.');
        }
        const cryptoObj = obtenerCrypto();
        const iv = base64ABytes(sobre.iv);
        const ct = base64ABytes(sobre.ct);
        const params = { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv };
        if (sobre.aad) {
            const aadBytes = codificarAadBytes(aad);
            if (!aadBytes) throw new Error('Falta contexto de integridad (AAD) para descifrar el registro.');
            params.additionalData = aadBytes;
        }
        const claroBuf = await cryptoObj.subtle.decrypt(params, keyAes, ct);
        const texto = new TextDecoder().decode(claroBuf);
        const crudo = JSON.parse(texto);
        return (Dominio && typeof Dominio.sanitizarJsonSeguro === 'function')
            ? Dominio.sanitizarJsonSeguro(crudo)
            : crudo;
    }

    async function generarMaterialAsimetricoBoveda(dekAdminKey) {
        const cryptoObj = obtenerCrypto();
        const deviceIdBytes = cryptoObj.getRandomValues(new Uint8Array(12));
        let deviceId = 'PC-';
        for (let i = 0; i < deviceIdBytes.length; i++) {
            deviceId += deviceIdBytes[i].toString(16).padStart(2, '0').toUpperCase();
        }
        limpiarBytes(deviceIdBytes);

        const [parBuzon, parIdEnc, parIdSign] = await Promise.all([
            cryptoObj.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
            cryptoObj.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
            cryptoObj.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        ]);

        const [
            pkBuzonJwk, skBuzonJwk,
            idEncPubJwk, idEncPrivJwk,
            idSignPubJwk, idSignPrivJwk
        ] = await Promise.all([
            cryptoObj.subtle.exportKey('jwk', parBuzon.publicKey),
            cryptoObj.subtle.exportKey('jwk', parBuzon.privateKey),
            cryptoObj.subtle.exportKey('jwk', parIdEnc.publicKey),
            cryptoObj.subtle.exportKey('jwk', parIdEnc.privateKey),
            cryptoObj.subtle.exportKey('jwk', parIdSign.publicKey),
            cryptoObj.subtle.exportKey('jwk', parIdSign.privateKey)
        ]);

        const [
            wrappedSkBuzon,
            wrappedIdEncPriv,
            wrappedIdSignPriv,
            trustedPeersEnc
        ] = await Promise.all([
            cifrarConClave(dekAdminKey, skBuzonJwk, { scope: 'skBuzon', deviceId }),
            cifrarConClave(dekAdminKey, idEncPrivJwk, { scope: 'idEncPriv', deviceId }),
            cifrarConClave(dekAdminKey, idSignPrivJwk, { scope: 'idSignPriv', deviceId }),
            cifrarConClave(dekAdminKey, [], { scope: 'trusted_peers', deviceId })
        ]);

        skBuzonRam = await cryptoObj.subtle.importKey('jwk', skBuzonJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        idEncPrivRam = await cryptoObj.subtle.importKey('jwk', idEncPrivJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        idSignPrivRam = await cryptoObj.subtle.importKey('jwk', idSignPrivJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        trustedPeersRam = [];

        return {
            deviceId,
            pkBuzonJwk,
            idEncPubJwk,
            idSignPubJwk,
            wrappedSkBuzon,
            wrappedIdEncPriv,
            wrappedIdSignPriv,
            trustedPeersEnc
        };
    }

    async function cargarMaterialAsimetricoEnRam() {
        const cryptoObj = obtenerCrypto();
        if (!dekRam || !metadatosBoveda) return false;

        // Migración automática transparente desde metadatos v1 -> v2 (sin perder DEK ni claves)
        if (!metadatosBoveda.deviceId || !metadatosBoveda.pkBuzonJwk || !metadatosBoveda.wrappedSkBuzon || !metadatosBoveda.wrappedIdEncPriv || !metadatosBoveda.wrappedIdSignPriv) {
            const mat = await generarMaterialAsimetricoBoveda(dekRam);
            metadatosBoveda = {
                ...metadatosBoveda,
                version: 2,
                ...mat,
                actualizadoEn: new Date().toISOString()
            };
            return true;
        }

        const deviceId = metadatosBoveda.deviceId;
        const [skBuzonJwk, idEncPrivJwk, idSignPrivJwk] = await Promise.all([
            descifrarConClave(dekRam, metadatosBoveda.wrappedSkBuzon, { scope: 'skBuzon', deviceId }),
            descifrarConClave(dekRam, metadatosBoveda.wrappedIdEncPriv, { scope: 'idEncPriv', deviceId }),
            descifrarConClave(dekRam, metadatosBoveda.wrappedIdSignPriv, { scope: 'idSignPriv', deviceId })
        ]);

        skBuzonRam = await cryptoObj.subtle.importKey('jwk', skBuzonJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        idEncPrivRam = await cryptoObj.subtle.importKey('jwk', idEncPrivJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        idSignPrivRam = await cryptoObj.subtle.importKey('jwk', idSignPrivJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

        if (metadatosBoveda.trustedPeersEnc) {
            const peers = await descifrarConClave(dekRam, metadatosBoveda.trustedPeersEnc, { scope: 'trusted_peers', deviceId }).catch(() => []);
            trustedPeersRam = Array.isArray(peers) ? peers : [];
        } else {
            trustedPeersRam = [];
        }

        // Si existe DEK de caja envuelta por Admin, habilitarla también en RAM para el dueño
        if (metadatosBoveda.cajaConfigurada && metadatosBoveda.wrappedCajaPorAdmin) {
            try {
                const rawCajaObj = await descifrarConClave(dekRam, metadatosBoveda.wrappedCajaPorAdmin, { scope: 'dekCajaAdmin', deviceId });
                if (rawCajaObj && rawCajaObj.b64) {
                    const rawCajaBytes = base64ABytes(rawCajaObj.b64);
                    dekCajaRam = await importarDekNoExtraible(rawCajaBytes);
                    limpiarBytes(rawCajaBytes);
                }
            } catch (_) {}
        }
        return false;
    }

    async function envolverCajaConPinYAdmin(pinLimpio, rawDekCajaBytes) {
        const cryptoObj = obtenerCrypto();
        const saltCaja = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
        const ivCajaWrap = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));
        const iteracionesCaja = Number(CFG_BOVEDA.ITERACIONES_PIN_CAJA) || 300000;

        const { kek: kekCaja, verifHash: verifCaja } = await derivarKekYVerificador(pinLimpio, saltCaja, iteracionesCaja);
        const wrappedCajaBuf = await cryptoObj.subtle.encrypt(
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivCajaWrap },
            kekCaja,
            rawDekCajaBytes
        );

        let wrappedCajaPorAdmin = null;
        if (dekRam && metadatosBoveda && metadatosBoveda.deviceId) {
            wrappedCajaPorAdmin = await cifrarConClave(
                dekRam,
                { b64: bytesABase64(rawDekCajaBytes) },
                { scope: 'dekCajaAdmin', deviceId: metadatosBoveda.deviceId }
            );
        }

        return {
            cajaConfigurada: true,
            cajaIteraciones: iteracionesCaja,
            cajaSalt: bytesABase64(saltCaja),
            cajaVerifHash: bytesABase64(verifCaja),
            cajaIvWrap: bytesABase64(ivCajaWrap),
            wrappedCajaDek: bytesABase64(wrappedCajaBuf),
            wrappedCajaPorAdmin
        };
    }

    async function derivarClaveAesDesdeEcdhBits(sharedBitsList, saltBytes, infoStr, mezclaExtraBytes = null) {
        const cryptoObj = obtenerCrypto();
        const ikm = concatenarBytes(...sharedBitsList, mezclaExtraBytes || new Uint8Array(0));
        const hkdfKey = await cryptoObj.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
        limpiarBytes(ikm);

        return cryptoObj.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: saltBytes,
                info: new TextEncoder().encode(infoStr)
            },
            hkdfKey,
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, length: CFG_BOVEDA.LONGITUD_CLAVE_BITS },
            false,
            ['encrypt', 'decrypt']
        );
    }

    function validarJwkP256(jwk) {
        return Boolean(
            jwk &&
            typeof jwk === 'object' &&
            jwk.kty === 'EC' &&
            jwk.crv === 'P-256' &&
            typeof jwk.x === 'string' &&
            typeof jwk.y === 'string' &&
            !jwk.d
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
            // Si el mostrador tiene PIN Caja configurado y activo, al expirar Admin degrada solo Admin y conserva Caja
            if (metadatosBoveda && metadatosBoveda.cajaConfigurada && dekCajaRam !== null) {
                bloquearAdminManteniendoCaja();
            } else {
                bloquear();
            }
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
            dekCajaRam = null;
            skBuzonRam = null;
            idEncPrivRam = null;
            idSignPrivRam = null;
            trustedPeersRam = [];
            detenerTemporizadorAutoBloqueo();
            notificarCambioEstado();
            return;
        }
        metadatosBoveda = Dominio ? Dominio.clonarObjetoSeguro(meta) : { ...meta };
        // Cargar metadatos nunca desbloquea automáticamente la sesión
        notificarCambioEstado();
    }

    function estaConfigurado() {
        return Boolean(metadatosBoveda && metadatosBoveda.wrappedDek && metadatosBoveda.verificadorHash);
    }

    function estaAdminDesbloqueado() {
        return !estaConfigurado() || dekRam !== null;
    }

    function estaCajaConfigurada() {
        return Boolean(metadatosBoveda && metadatosBoveda.cajaConfigurada && metadatosBoveda.wrappedCajaDek);
    }

    function estaCajaActiva() {
        if (!estaConfigurado()) return true;
        return dekRam !== null || dekCajaRam !== null;
    }

    function estaBloqueado() {
        // Conserva semántica Admin para todas las vistas administrativas (Historial, Proveedores, Reglas, Edición de Costos)
        return estaConfigurado() && dekRam === null;
    }

    function estaBloqueadoTotal() {
        return estaConfigurado() && dekRam === null && dekCajaRam === null;
    }

    function tieneBuzonPublico() {
        return Boolean(metadatosBoveda && validarJwkP256(metadatosBoveda.pkBuzonJwk));
    }

    function obtenerEstado() {
        const config = estaConfigurado();
        const adminAbierto = config && dekRam !== null;
        const cajaConf = estaCajaConfigurada();
        const cajaAbierta = config && (dekCajaRam !== null || dekRam !== null);
        let nivelAcceso = 'SIN_CLAVE';
        if (config) {
            if (adminAbierto) nivelAcceso = 'ADMIN';
            else if (cajaAbierta) nivelAcceso = 'SOLO_CAJA';
            else nivelAcceso = 'BLOQUEADO_TOTAL';
        }
        return {
            soportado: soportaWebCrypto(),
            configurado: config,
            bloqueado: config ? !adminAbierto : false,
            desbloqueado: adminAbierto,
            adminDesbloqueado: adminAbierto,
            cajaConfigurada: cajaConf,
            cajaDesbloqueada: cajaAbierta,
            bloqueadoTotal: config ? (!adminAbierto && !cajaAbierta) : false,
            tieneBuzon: tieneBuzonPublico(),
            deviceId: metadatosBoveda ? (metadatosBoveda.deviceId || null) : null,
            nivelAcceso,
            minutosAutoBloqueo: metadatosBoveda ? Number(metadatosBoveda.minutosAutoBloqueo || 0) : CFG_BOVEDA.AUTO_BLOQUEO_DEFECTO_MIN,
            intentosFallidos,
            bloqueadoHastaMs,
            intentosFallidosCaja,
            bloqueadoCajaHastaMs
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

        let pinCajaLimpio = '';
        if (opciones.pinCaja !== undefined && String(opciones.pinCaja || '').trim() !== '') {
            const valPin = validarPoliticaPinCaja(String(opciones.pinCaja));
            if (!valPin.esValido) throw new Error(valPin.error);
            pinCajaLimpio = valPin.pin;
        }

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
        let rawDekCaja = null;

        try {
            const [{ kek, verifHash }, { kek: recKek, verifHash: recVerifHash }] = await Promise.all([
                derivarKekYVerificador(contrasena, salt, iteraciones),
                derivarKekYVerificador(recNorm, saltRec, ITERACIONES_CODIGO_RECUPERACION)
            ]);

            const [wrappedDekBuf, wrappedDekRecBuf] = await Promise.all([
                cryptoObj.subtle.encrypt({ name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivWrap }, kek, rawDek),
                cryptoObj.subtle.encrypt({ name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: ivRec }, recKek, rawDek)
            ]);

            dekRam = await importarDekNoExtraible(rawDek);
            const matAsimetrico = await generarMaterialAsimetricoBoveda(dekRam);

            const ahoraIso = new Date().toISOString();
            metadatosBoveda = {
                version: 2,
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
                cajaConfigurada: false,
                minutosAutoBloqueo,
                creadoEn: ahoraIso,
                actualizadoEn: ahoraIso,
                ...matAsimetrico
            };

            if (pinCajaLimpio) {
                rawDekCaja = cryptoObj.getRandomValues(new Uint8Array(32));
                const metaCaja = await envolverCajaConPinYAdmin(pinCajaLimpio, rawDekCaja);
                metadatosBoveda = { ...metadatosBoveda, ...metaCaja };
                dekCajaRam = await importarDekNoExtraible(rawDekCaja);
            } else {
                dekCajaRam = null;
            }

            intentosFallidos = 0;
            bloqueadoHastaMs = 0;
            intentosFallidosCaja = 0;
            bloqueadoCajaHastaMs = 0;

            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();

            return {
                exito: true,
                metadatos: obtenerMetadatos(),
                codigoRecuperacion
            };
        } finally {
            limpiarBytes(rawDek);
            limpiarBytes(rawDekCaja);
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
            const huboMigracion = await cargarMaterialAsimetricoEnRam();
            intentosFallidos = 0;
            bloqueadoHastaMs = 0;
            reiniciarTemporizadorAutoBloqueo();
            notificarCambioEstado();
            return { exito: true, metadatosActualizados: huboMigracion ? obtenerMetadatos() : null };
        } finally {
            limpiarBytes(rawDek);
        }
    }

    async function configurarPinCaja(pinCaja) {
        if (!estaConfigurado() || dekRam === null) {
            throw new Error('Desbloquea la sesión de Administrador para configurar el PIN de Mostrador.');
        }
        const valPin = validarPoliticaPinCaja(pinCaja);
        if (!valPin.esValido) throw new Error(valPin.error);
        const cryptoObj = obtenerCrypto();

        let rawDekCaja = null;
        try {
            // Reutilizar DEK_Caja existente si se cambia de PIN para conservar legibilidad de _segCaja ya cifrados
            if (metadatosBoveda.cajaConfigurada && metadatosBoveda.wrappedCajaPorAdmin && metadatosBoveda.deviceId) {
                try {
                    const env = await descifrarConClave(dekRam, metadatosBoveda.wrappedCajaPorAdmin, {
                        scope: 'dekCajaAdmin',
                        deviceId: metadatosBoveda.deviceId
                    });
                    if (env && env.b64) rawDekCaja = base64ABytes(env.b64);
                } catch (_) {}
            }
            if (!rawDekCaja) {
                rawDekCaja = cryptoObj.getRandomValues(new Uint8Array(32));
            }
            const metaCaja = await envolverCajaConPinYAdmin(valPin.pin, rawDekCaja);
            dekCajaRam = await importarDekNoExtraible(rawDekCaja);
            metadatosBoveda = {
                ...metadatosBoveda,
                ...metaCaja,
                actualizadoEn: new Date().toISOString()
            };
            intentosFallidosCaja = 0;
            bloqueadoCajaHastaMs = 0;
            notificarCambioEstado();
            return { exito: true, metadatos: obtenerMetadatos() };
        } finally {
            limpiarBytes(rawDekCaja);
        }
    }

    function desactivarPinCaja() {
        if (!estaConfigurado() || dekRam === null) {
            throw new Error('Desbloquea la sesión de Administrador para desactivar el PIN de Mostrador.');
        }
        dekCajaRam = null;
        const limpio = { ...metadatosBoveda, cajaConfigurada: false, actualizadoEn: new Date().toISOString() };
        delete limpio.cajaIteraciones;
        delete limpio.cajaSalt;
        delete limpio.cajaVerifHash;
        delete limpio.cajaIvWrap;
        delete limpio.wrappedCajaDek;
        delete limpio.wrappedCajaPorAdmin;
        metadatosBoveda = limpio;
        intentosFallidosCaja = 0;
        bloqueadoCajaHastaMs = 0;
        notificarCambioEstado();
        return { exito: true, metadatos: obtenerMetadatos() };
    }

    async function desbloquearCaja(pinCaja) {
        if (!estaConfigurado() || !estaCajaConfigurada()) {
            throw new Error('El PIN rápido de mostrador aún no ha sido configurado por el Administrador.');
        }
        const ahora = Date.now();
        if (bloqueadoCajaHastaMs > ahora) {
            const segs = Math.ceil((bloqueadoCajaHastaMs - ahora) / 1000);
            throw new Error(`Demasiados intentos en PIN de caja. Espera ${segs} segundo(s).`);
        }
        const pinLimpio = String(pinCaja || '').trim();
        if (!pinLimpio) throw new Error('Ingresa el PIN de mostrador.');

        const cryptoObj = obtenerCrypto();
        const saltCaja = base64ABytes(metadatosBoveda.cajaSalt);
        const iteracionesCaja = Number(metadatosBoveda.cajaIteraciones) || 300000;
        const { kek: kekCaja, verifHash } = await derivarKekYVerificador(pinLimpio, saltCaja, iteracionesCaja);
        const esperado = base64ABytes(metadatosBoveda.cajaVerifHash);

        if (!comparacionTiempoConstante(verifHash, esperado)) {
            intentosFallidosCaja++;
            if (intentosFallidosCaja >= 5) {
                bloqueadoCajaHastaMs = Date.now() + 30000;
            } else if (intentosFallidosCaja >= CFG_BOVEDA.MAX_INTENTOS_FALLIDOS_BASE) {
                bloqueadoCajaHastaMs = Date.now() + 5000;
            }
            notificarCambioEstado();
            throw new Error('PIN de mostrador incorrecto.');
        }

        let rawDekCaja = null;
        try {
            const rawBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv: base64ABytes(metadatosBoveda.cajaIvWrap) },
                kekCaja,
                base64ABytes(metadatosBoveda.wrappedCajaDek)
            );
            rawDekCaja = new Uint8Array(rawBuf);
            dekCajaRam = await importarDekNoExtraible(rawDekCaja);
            intentosFallidosCaja = 0;
            bloqueadoCajaHastaMs = 0;
            notificarCambioEstado();
            return { exito: true };
        } finally {
            limpiarBytes(rawDekCaja);
        }
    }

    function bloquearAdminManteniendoCaja() {
        dekRam = null;
        skBuzonRam = null;
        idEncPrivRam = null;
        idSignPrivRam = null;
        trustedPeersRam = [];
        detenerTemporizadorAutoBloqueo();
        notificarCambioEstado();
    }

    function bloquear() {
        dekRam = null;
        dekCajaRam = null;
        skBuzonRam = null;
        idEncPrivRam = null;
        idSignPrivRam = null;
        trustedPeersRam = [];
        detenerTemporizadorAutoBloqueo();
        notificarCambioEstado();
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
            await cargarMaterialAsimetricoEnRam();
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
            await cargarMaterialAsimetricoEnRam();
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

    function registrarActividad() {
        if (estaConfigurado() && dekRam !== null) {
            reiniciarTemporizadorAutoBloqueo();
        }
    }

    async function cifrarJson(datos, aad = null) {
        if (estaBloqueado()) {
            throw new Error('Bóveda cifrada bloqueada: no es posible cifrar sin clave de administrador.');
        }
        return cifrarConClave(dekRam, datos, aad);
    }

    async function descifrarJson(sobre, aad = null) {
        if (estaBloqueado()) {
            throw new Error('Bóveda cifrada bloqueada: requiere desbloqueo de administrador.');
        }
        return descifrarConClave(dekRam, sobre, aad);
    }

    async function cifrarParaCaja(datos, codigoBarras) {
        const keyCaja = dekCajaRam || (!estaCajaConfigurada() ? dekRam : null);
        if (!keyCaja) {
            throw new Error('Sesión de caja bloqueada: ingresa PIN de Mostrador o Contraseña Admin.');
        }
        const cod = String(codigoBarras || '').trim();
        const sobre = await cifrarConClave(keyCaja, datos, { scope: 'caja', codigoBarras: cod });
        sobre._segCaja = true;
        return sobre;
    }

    async function descifrarDeCaja(sobreCaja, codigoBarras) {
        const keyCaja = dekCajaRam || (!estaCajaConfigurada() ? dekRam : null);
        if (!keyCaja) {
            throw new Error('Sesión de caja bloqueada: ingresa PIN de Mostrador o Contraseña Admin.');
        }
        if (!sobreCaja || typeof sobreCaja !== 'object' || !sobreCaja.iv || !sobreCaja.ct) {
            throw new Error('Sobre operativo de caja inválido.');
        }
        const cod = String(codigoBarras || '').trim();
        const copia = { ...sobreCaja, _segCifrado: true };
        return descifrarConClave(keyCaja, copia, { scope: 'caja', codigoBarras: cod });
    }

    async function sellarParaBuzonAdmin(datos, aadMeta = {}) {
        if (!tieneBuzonPublico()) {
            throw new Error('Esta bóveda no dispone de llave pública de buzón administrativo.');
        }
        const cryptoObj = obtenerCrypto();
        const pkBuzon = await cryptoObj.subtle.importKey(
            'jwk',
            metadatosBoveda.pkBuzonJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );
        const ephPar = await cryptoObj.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const ephPkJwk = await cryptoObj.subtle.exportKey('jwk', ephPar.publicKey);
        const salt = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
        const iv = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));

        const sharedBits = new Uint8Array(await cryptoObj.subtle.deriveBits(
            { name: 'ECDH', public: pkBuzon },
            ephPar.privateKey,
            256
        ));
        const aesKey = await derivarClaveAesDesdeEcdhBits([sharedBits], salt, 'Chroniris-Buzon-v1');
        limpiarBytes(sharedBits);

        const aadObj = { buzon: true, ...aadMeta, x: ephPkJwk.x, y: ephPkJwk.y };
        const aadBytes = codificarAadBytes(aadObj);
        const bytes = new TextEncoder().encode(JSON.stringify(datos));
        const ciphertext = await cryptoObj.subtle.encrypt(
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv, additionalData: aadBytes },
            aesKey,
            bytes
        );
        limpiarBytes(bytes);

        return {
            _buzonSellado: true,
            v: 1,
            alg: 'ECDH-P256+AES-256-GCM',
            ephPk: ephPkJwk,
            salt: bytesABase64(salt),
            iv: bytesABase64(iv),
            ct: bytesABase64(ciphertext),
            aadMeta: Dominio ? Dominio.clonarObjetoSeguro(aadMeta) : { ...aadMeta }
        };
    }

    async function abrirDeBuzonAdmin(sobreBuzon, aadMetaEsperada = null) {
        if (estaBloqueado() || !skBuzonRam) {
            throw new Error('Requiere sesión de Administrador desbloqueada para abrir el buzón sellado.');
        }
        if (!sobreBuzon || sobreBuzon._buzonSellado !== true || !validarJwkP256(sobreBuzon.ephPk)) {
            throw new Error('Sobre de buzón inválido o corrupto.');
        }
        const cryptoObj = obtenerCrypto();
        const ephPk = await cryptoObj.subtle.importKey(
            'jwk',
            sobreBuzon.ephPk,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );
        const sharedBits = new Uint8Array(await cryptoObj.subtle.deriveBits(
            { name: 'ECDH', public: ephPk },
            skBuzonRam,
            256
        ));
        const aesKey = await derivarClaveAesDesdeEcdhBits(
            [sharedBits],
            base64ABytes(sobreBuzon.salt),
            'Chroniris-Buzon-v1'
        );
        limpiarBytes(sharedBits);

        const metaUsada = aadMetaEsperada || sobreBuzon.aadMeta || {};
        const aadBytes = codificarAadBytes({ buzon: true, ...metaUsada, x: sobreBuzon.ephPk.x, y: sobreBuzon.ephPk.y });
        const claroBuf = await cryptoObj.subtle.decrypt(
            {
                name: CFG_BOVEDA.ALGORITMO_CIFRADO,
                iv: base64ABytes(sobreBuzon.iv),
                additionalData: aadBytes
            },
            aesKey,
            base64ABytes(sobreBuzon.ct)
        );
        const crudo = JSON.parse(new TextDecoder().decode(claroBuf));
        return (Dominio && typeof Dominio.sanitizarJsonSeguro === 'function')
            ? Dominio.sanitizarJsonSeguro(crudo)
            : crudo;
    }

    // --- EMPAREJAMIENTO MUTUO Y SINCRONIZACIÓN P2P CIFRADA POR DISPOSITIVO ---
    function obtenerTarjetaEmparejamiento() {
        if (!estaConfigurado() || !metadatosBoveda.deviceId || !validarJwkP256(metadatosBoveda.idEncPubJwk) || !validarJwkP256(metadatosBoveda.idSignPubJwk)) {
            return null;
        }
        return {
            tipo: 'chroniris-peer-card-v1',
            deviceId: metadatosBoveda.deviceId,
            idEncPub: Dominio ? Dominio.clonarObjetoSeguro(metadatosBoveda.idEncPubJwk) : { ...metadatosBoveda.idEncPubJwk },
            idSignPub: Dominio ? Dominio.clonarObjetoSeguro(metadatosBoveda.idSignPubJwk) : { ...metadatosBoveda.idSignPubJwk }
        };
    }

    async function calcularCodigoSas(tarjetaA, tarjetaB) {
        const cryptoObj = obtenerCrypto();
        if (!cryptoObj || !tarjetaA || !tarjetaB || !tarjetaA.deviceId || !tarjetaB.deviceId) {
            throw new Error('Tarjetas de emparejamiento inválidas.');
        }
        const parOrdenado = [tarjetaA, tarjetaB].sort((a, b) => String(a.deviceId).localeCompare(String(b.deviceId)));
        const bytes = codificarAadBytes(parOrdenado.map(t => ({
            deviceId: t.deviceId,
            idEncX: t.idEncPub?.x || '',
            idEncY: t.idEncPub?.y || '',
            idSignX: t.idSignPub?.x || '',
            idSignY: t.idSignPub?.y || ''
        })));
        const digest = new Uint8Array(await cryptoObj.subtle.digest('SHA-256', bytes));
        const num = ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1000000;
        const txt = String(num).padStart(6, '0');
        return txt.slice(0, 3) + '-' + txt.slice(3, 6);
    }

    async function persistirPeersEnMeta() {
        if (!dekRam || !metadatosBoveda || !metadatosBoveda.deviceId) return;
        const enc = await cifrarConClave(dekRam, trustedPeersRam, {
            scope: 'trusted_peers',
            deviceId: metadatosBoveda.deviceId
        });
        metadatosBoveda = {
            ...metadatosBoveda,
            trustedPeersEnc: enc,
            actualizadoEn: new Date().toISOString()
        };
    }

    function obtenerPeersConfiables() {
        if (estaBloqueado()) return [];
        return trustedPeersRam.map(p => ({
            deviceId: p.deviceId,
            alias: p.alias,
            agregadoEn: p.agregadoEn,
            ultimoSeqEnviado: Number(p.ultimoSeqEnviado) || 0,
            ultimoSeqRecibido: Number(p.ultimoSeqRecibido) || 0
        }));
    }

    async function agregarPeerConfiable(tarjetaPeer, alias = 'Caja Hermana') {
        if (estaBloqueado() || !dekRam) {
            throw new Error('Desbloquea como Administrador para autorizar una computadora hermana.');
        }
        if (!tarjetaPeer || typeof tarjetaPeer !== 'object' || !tarjetaPeer.deviceId ||
            !validarJwkP256(tarjetaPeer.idEncPub) || !validarJwkP256(tarjetaPeer.idSignPub)) {
            throw new Error('La tarjeta de vinculación del equipo destino no es válida.');
        }
        if (tarjetaPeer.deviceId === metadatosBoveda.deviceId) {
            throw new Error('No puedes vincular esta computadora consigo misma.');
        }

        const aliasLimpio = (Dominio && typeof Dominio.sanitizarEntradaTexto === 'function')
            ? Dominio.sanitizarEntradaTexto(alias || 'Caja Hermana', 50).trim() || 'Caja Hermana'
            : String(alias || 'Caja Hermana').slice(0, 50);

        const idx = trustedPeersRam.findIndex(p => p.deviceId === tarjetaPeer.deviceId);
        const registro = {
            deviceId: String(tarjetaPeer.deviceId),
            alias: aliasLimpio,
            idEncPub: Dominio ? Dominio.clonarObjetoSeguro(tarjetaPeer.idEncPub) : { ...tarjetaPeer.idEncPub },
            idSignPub: Dominio ? Dominio.clonarObjetoSeguro(tarjetaPeer.idSignPub) : { ...tarjetaPeer.idSignPub },
            agregadoEn: (idx >= 0 && trustedPeersRam[idx].agregadoEn) ? trustedPeersRam[idx].agregadoEn : new Date().toISOString(),
            ultimoSeqEnviado: (idx >= 0) ? (Number(trustedPeersRam[idx].ultimoSeqEnviado) || 0) : 0,
            ultimoSeqRecibido: (idx >= 0) ? (Number(trustedPeersRam[idx].ultimoSeqRecibido) || 0) : 0
        };

        if (idx >= 0) trustedPeersRam[idx] = registro;
        else trustedPeersRam.push(registro);

        await persistirPeersEnMeta();
        return { exito: true, peer: { deviceId: registro.deviceId, alias: registro.alias }, metadatos: obtenerMetadatos() };
    }

    async function revocarPeerConfiable(deviceId) {
        if (estaBloqueado() || !dekRam) {
            throw new Error('Desbloquea como Administrador para revocar dispositivos.');
        }
        const antes = trustedPeersRam.length;
        trustedPeersRam = trustedPeersRam.filter(p => p.deviceId !== deviceId);
        if (trustedPeersRam.length === antes) return { exito: false, metadatos: obtenerMetadatos() };
        await persistirPeersEnMeta();
        return { exito: true, metadatos: obtenerMetadatos() };
    }

    async function empaquetarSyncParaPeer(peerId, payloadDatos, opciones = {}) {
        if (estaBloqueado() || !idEncPrivRam || !idSignPrivRam || !metadatosBoveda.deviceId) {
            throw new Error('Requiere sesión de Administrador desbloqueada para sincronizar.');
        }
        const idx = trustedPeersRam.findIndex(p => p.deviceId === peerId);
        if (idx < 0) {
            throw new Error('El equipo destino no está emparejado ni autorizado en esta farmacia.');
        }
        const peer = trustedPeersRam[idx];
        const cryptoObj = obtenerCrypto();

        const peerEncPub = await cryptoObj.subtle.importKey('jwk', peer.idEncPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const ephPar = await cryptoObj.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const ephPkJwk = await cryptoObj.subtle.exportKey('jwk', ephPar.publicKey);
        const salt = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_SALT_BYTES));
        const iv = cryptoObj.getRandomValues(new Uint8Array(CFG_BOVEDA.LONGITUD_IV_BYTES));

        const codigoEntrega = opciones.codigoEntrega
            ? String(opciones.codigoEntrega).trim().toUpperCase()
            : generarCodigoEntregaSync(cryptoObj);
        const codNormBytes = new TextEncoder().encode(normalizarCodigoEntrega(codigoEntrega));

        const [bitsEph, bitsMutuo] = await Promise.all([
            cryptoObj.subtle.deriveBits({ name: 'ECDH', public: peerEncPub }, ephPar.privateKey, 256),
            cryptoObj.subtle.deriveBits({ name: 'ECDH', public: peerEncPub }, idEncPrivRam, 256)
        ]);
        const arrEph = new Uint8Array(bitsEph);
        const arrMutuo = new Uint8Array(bitsMutuo);
        const aesKey = await derivarClaveAesDesdeEcdhBits([arrEph, arrMutuo], salt, 'Chroniris-Sync-P2P-v1', codNormBytes);
        limpiarBytes(arrEph);
        limpiarBytes(arrMutuo);
        limpiarBytes(codNormBytes);

        const seq = (Number(peer.ultimoSeqEnviado) || 0) + 1;
        const tipoSync = (CONSTANTES && CONSTANTES.TIPO_ARCHIVO_SYNC_CIFRADA) || 'chroniris-sync-cifrado-v1';
        const cabecera = {
            tipo: tipoSync,
            v: 1,
            alg: 'ECDH-P256+ECDSA+AES-256-GCM',
            origenId: metadatosBoveda.deviceId,
            destinoId: peer.deviceId,
            seq,
            ts: new Date().toISOString(),
            ephPk: ephPkJwk,
            salt: bytesABase64(salt)
        };

        const aadBytes = codificarAadBytes(cabecera);
        const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadDatos));
        const ctBuf = await cryptoObj.subtle.encrypt(
            { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv, additionalData: aadBytes },
            aesKey,
            payloadBytes
        );
        limpiarBytes(payloadBytes);
        const ctBytes = new Uint8Array(ctBuf);

        const msgFirma = concatenarBytes(aadBytes, iv, ctBytes);
        const sigBuf = await cryptoObj.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            idSignPrivRam,
            msgFirma
        );

        trustedPeersRam[idx].ultimoSeqEnviado = seq;
        await persistirPeersEnMeta();

        return {
            exito: true,
            codigoEntrega,
            seq,
            metadatos: obtenerMetadatos(),
            paquete: {
                ...cabecera,
                iv: bytesABase64(iv),
                ct: bytesABase64(ctBytes),
                sig: bytesABase64(new Uint8Array(sigBuf))
            }
        };
    }

    async function abrirSyncDePeer(paquete, codigoEntrega = '') {
        if (estaBloqueado() || !idEncPrivRam || !metadatosBoveda.deviceId) {
            throw new Error('Desbloquea como Administrador en este equipo para recibir la sincronización.');
        }
        const tipoSync = (CONSTANTES && CONSTANTES.TIPO_ARCHIVO_SYNC_CIFRADA) || 'chroniris-sync-cifrado-v1';
        if (!paquete || typeof paquete !== 'object' || paquete.tipo !== tipoSync ||
            !validarJwkP256(paquete.ephPk) || !paquete.salt || !paquete.iv || !paquete.ct || !paquete.sig) {
            throw new Error('Archivo o paquete de sincronización cifrada inválido.');
        }
        if (paquete.destinoId !== metadatosBoveda.deviceId) {
            throw new Error('Acceso denegado: este paquete cifrado fue emitido exclusivamente para otra computadora.');
        }

        const idx = trustedPeersRam.findIndex(p => p.deviceId === paquete.origenId);
        if (idx < 0) {
            throw new Error('Origen no autorizado: la computadora emisora no está emparejada en esta PC.');
        }
        const peer = trustedPeersRam[idx];
        const seqNum = Number(paquete.seq);
        if (!Number.isInteger(seqNum) || seqNum <= (Number(peer.ultimoSeqRecibido) || 0)) {
            throw new Error('Paquete rechazado por protección anti-replay (secuencia ya importada o obsoleta).');
        }

        const cryptoObj = obtenerCrypto();
        const cabecera = {
            tipo: paquete.tipo,
            v: paquete.v,
            alg: paquete.alg,
            origenId: paquete.origenId,
            destinoId: paquete.destinoId,
            seq: paquete.seq,
            ts: paquete.ts,
            ephPk: paquete.ephPk,
            salt: paquete.salt
        };
        const aadBytes = codificarAadBytes(cabecera);
        const iv = base64ABytes(paquete.iv);
        const ctBytes = base64ABytes(paquete.ct);
        const sigBytes = base64ABytes(paquete.sig);

        const peerSignPub = await cryptoObj.subtle.importKey('jwk', peer.idSignPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const firmaValida = await cryptoObj.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            peerSignPub,
            sigBytes,
            concatenarBytes(aadBytes, iv, ctBytes)
        );
        if (!firmaValida) {
            throw new Error('Firma digital ECDSA inválida: el paquete fue adulterado o suplantado.');
        }

        const [peerEncPub, ephPub] = await Promise.all([
            cryptoObj.subtle.importKey('jwk', peer.idEncPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []),
            cryptoObj.subtle.importKey('jwk', paquete.ephPk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
        ]);

        const codNormBytes = new TextEncoder().encode(normalizarCodigoEntrega(codigoEntrega));
        const [bitsEph, bitsMutuo] = await Promise.all([
            cryptoObj.subtle.deriveBits({ name: 'ECDH', public: ephPub }, idEncPrivRam, 256),
            cryptoObj.subtle.deriveBits({ name: 'ECDH', public: peerEncPub }, idEncPrivRam, 256)
        ]);
        const arrEph = new Uint8Array(bitsEph);
        const arrMutuo = new Uint8Array(bitsMutuo);
        const aesKey = await derivarClaveAesDesdeEcdhBits(
            [arrEph, arrMutuo],
            base64ABytes(paquete.salt),
            'Chroniris-Sync-P2P-v1',
            codNormBytes
        );
        limpiarBytes(arrEph);
        limpiarBytes(arrMutuo);
        limpiarBytes(codNormBytes);

        let claroBuf;
        try {
            claroBuf = await cryptoObj.subtle.decrypt(
                { name: CFG_BOVEDA.ALGORITMO_CIFRADO, iv, additionalData: aadBytes },
                aesKey,
                ctBytes
            );
        } catch (_) {
            throw new Error('No se pudo descifrar el paquete. Verifica el Código de Entrega efímero del equipo origen.');
        }

        const crudo = JSON.parse(new TextDecoder().decode(claroBuf));
        const datos = (Dominio && typeof Dominio.sanitizarJsonSeguro === 'function')
            ? Dominio.sanitizarJsonSeguro(crudo)
            : crudo;

        trustedPeersRam[idx].ultimoSeqRecibido = seqNum;
        await persistirPeersEnMeta();

        return {
            exito: true,
            origenPeer: { deviceId: peer.deviceId, alias: peer.alias },
            seq: seqNum,
            datos,
            metadatos: obtenerMetadatos()
        };
    }

    AppFarmacia.Seguridad = Object.freeze({
        soportaWebCrypto,
        establecerMetadatosPersistidos,
        obtenerEstado,
        obtenerMetadatos,
        estaConfigurado,
        estaBloqueado,
        estaAdminDesbloqueado,
        estaCajaConfigurada,
        estaCajaActiva,
        estaBloqueadoTotal,
        tieneBuzonPublico,
        configurarContrasenaMaestra,
        desbloquear,
        configurarPinCaja,
        desactivarPinCaja,
        desbloquearCaja,
        bloquearAdminManteniendoCaja,
        cambiarContrasena,
        recuperarConCodigo,
        regenerarCodigoRecuperacion,
        configurarAutoBloqueo,
        bloquear,
        registrarActividad,
        suscribirCambioEstado,
        cifrarJson,
        descifrarJson,
        cifrarParaCaja,
        descifrarDeCaja,
        sellarParaBuzonAdmin,
        abrirDeBuzonAdmin,
        obtenerTarjetaEmparejamiento,
        calcularCodigoSas,
        obtenerPeersConfiables,
        agregarPeerConfiable,
        revocarPeerConfiable,
        empaquetarSyncParaPeer,
        abrirSyncDePeer
    });
})(window);
