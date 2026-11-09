(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});

    const ESTRATEGIAS_CALCULO = Object.freeze({
        CASCADA_DESCUENTO: 'CASCADA_DESCUENTO',
        MARGEN_DIRECTO_COSTO: 'MARGEN_DIRECTO_COSTO',
        MARGEN_BRUTO_FINANCIERO: 'MARGEN_BRUTO_FINANCIERO'
    });

    const PERFILES_POR_DEFECTO = Object.freeze({
        CASCADA_DESCUENTO: Object.freeze({ p1: 30, p2: 5, p3: 5 }),
        MARGEN_DIRECTO_COSTO: Object.freeze({ p1: 30, p2: 25, p3: 20 }),
        MARGEN_BRUTO_FINANCIERO: Object.freeze({ p1: 30, p2: 5, p3: 5 })
    });

    const REGLAS_NEGOCIO_POR_DEFECTO = Object.freeze({
        estrategia: ESTRATEGIAS_CALCULO.CASCADA_DESCUENTO,
        porcentajeItbis: 18,
        porcentajeAlertaInflacion: 5,
        porcentajePrecio1: 30,
        porcentajePrecio2: 5,
        porcentajePrecio3: 5,
        perfiles: PERFILES_POR_DEFECTO
    });

    const CONSTANTES = Object.freeze({
        VERSION_ESQUEMA_RESPALDO: 2,
        TIPO_ARCHIVO_RESPALDO_FACTURAS: 'respaldo-farmacia-facturas',
        TIPO_ARCHIVO_DICCIONARIO_CODIGOS: 'respaldo-farmacia-diccionario',
        TIPO_ARCHIVO_RESPALDO_COMPLETO: 'respaldo-farmacia-completo',
        TIPO_ARCHIVO_PARCHE_CATALOGO: 'parche-farmacia-catalogo',
        DECIMALES_COSTO_UNITARIO: 8,
        DECIMALES_MONEDA: 2,
        DECIMALES_AUDITORIA: 4,
        TOLERANCIA_CUADRE_FACTURA: 0.05,
        UMBRAL_FEFO_DIAS_CRITICO: 90,
        UMBRAL_FEFO_DIAS_ALERTA: 180,
        DIAS_RETENCION_HISTORIAL_MS: 7 * 24 * 60 * 60 * 1000,
        AVISO_EXPIRACION_HISTORIAL_MS: 2 * 24 * 60 * 60 * 1000, // Alerta si queda <= 2 días para expirar
        LIMITE_ARCHIVO_JSON_BYTES: 5 * 1024 * 1024, // 5 MB máximo para importaciones JSON
        TIEMPO_REVOCAR_URL_MS: 1000,
        DURACION_NOTIFICACION_MS: 3500,
        DEBOUNCE_CALCULO_MS: 80,
        MODELO_IA_POR_DEFECTO: 'gemini-2.5-flash',
        URL_GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',
        SEGURIDAD_ARCHIVOS: Object.freeze({
            MAX_BYTES_FACTURA: 15 * 1024 * 1024,
            MAX_BYTES_JSON: 5 * 1024 * 1024,
            MAX_PIXELES_IMAGEN: 64000000,
            EXTENSIONES_PERMITIDAS_FACTURAS: Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'webp']),
            EXTENSIONES_PERMITIDAS_IMAGENES: Object.freeze(['jpg', 'jpeg', 'png', 'webp']),
            EXTENSIONES_PELIGROSAS_DOBLES: Object.freeze([
                'exe', 'bat', 'cmd', 'sh', 'php', 'phtml', 'php3', 'php4', 'php5',
                'js', 'vbs', 'ps1', 'jar', 'jsp', 'asp', 'aspx', 'cgi', 'pl', 'py', 'dll', 'so'
            ]),
            PATRONES_PDF_MALICIOSOS: Object.freeze([
                { regex: /\/JavaScript\b/i, motivo: 'Código JavaScript embebido no permitido en PDF (/JavaScript).' },
                { regex: /\/JS\s*(?:<<|\/|\()/i, motivo: 'Objeto ejecutable JS embebido (/JS).' },
                { regex: /\/Launch\b/i, motivo: 'Acción de ejecución de comandos externos (/Launch).' },
                { regex: /\/EmbeddedFiles\b/i, motivo: 'Archivos ejecutables o adjuntos embebidos (/EmbeddedFiles).' },
                { regex: /\/RichMedia\b/i, motivo: 'Contenido multimedia ejecutable (/RichMedia).' },
                { regex: /\/SubmitForm\b/i, motivo: 'Envío no controlado de formularios externos (/SubmitForm).' },
                { regex: /\/ImportData\b/i, motivo: 'Importación externa de datos (/ImportData).' },
                { regex: /\/URI\s*\([^)]*javascript\s*:/i, motivo: 'Enlace URI a pseudo-protocolo javascript:.' }
            ])
        }),
        SEGURIDAD_CRIPTO: Object.freeze({
            ALGORITMO_FIRMA: 'HMAC-SHA256',
            CLAVE_SISTEMA_SEMILLA: 'Chroniris-OS::reiNameless::FiscalPharmacy::v1',
            VERSION_SELLO: 1
        }),
        DOMINIOS_AUTORIZADOS: Object.freeze([
            'localhost',
            '127.0.0.1',
            'reinameless.github.io'
        ]),
        LIMITES_CAMPOS: Object.freeze({
            MAX_PRECIO_COMPRA: 50000000,
            MAX_CAJAS: 100000,
            MAX_UNIDADES_CAJA: 50000,
            MAX_TOTAL_FISICO: 500000000,
            MAX_LONGITUD_TEXTO_CORTO: 120,
            MAX_LONGITUD_TEXTO_MEDIO: 255
        }),
        CATEGORIAS: Object.freeze({
            DIVISIBLE: 'divisible',
            ENTERO: 'entero'
        }),
        CLAVES_STORAGE: Object.freeze({
            BORRADOR_ACTIVO: 'farmacia_borrador_activo',
            HISTORIAL_7DIAS: 'farmacia_historial_7dias',
            DICCIONARIO_CODIGOS: 'farmacia_diccionario_codigos_v1',
            PROVEEDORES: 'farmacia_proveedores_v1',
            REGLAS_NEGOCIO: 'farmacia_reglas_calculo_v2',
            IA_API_KEY: 'farmacia_gemini_api_key', // Se almacena en sessionStorage por seguridad
            IA_MODELO: 'farmacia_gemini_modelo'
        })
    });

    AppFarmacia.Configuracion = Object.freeze({
        ESTRATEGIAS_CALCULO,
        PERFILES_POR_DEFECTO,
        REGLAS_NEGOCIO_POR_DEFECTO,
        CONSTANTES
    });
})(window);
