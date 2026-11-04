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
        DECIMALES_COSTO_UNITARIO: 8,
        DECIMALES_MONEDA: 2,
        DECIMALES_AUDITORIA: 4,
        TOLERANCIA_CUADRE_FACTURA: 0.05,
        DIAS_RETENCION_HISTORIAL_MS: 7 * 24 * 60 * 60 * 1000,
        AVISO_EXPIRACION_HISTORIAL_MS: 2 * 24 * 60 * 60 * 1000, // Alerta si queda <= 2 días para expirar
        LIMITE_ARCHIVO_JSON_BYTES: 5 * 1024 * 1024, // 5 MB máximo para importaciones JSON
        TIEMPO_REVOCAR_URL_MS: 1000,
        DURACION_NOTIFICACION_MS: 3500,
        DEBOUNCE_CALCULO_MS: 80,
        MODELO_IA_POR_DEFECTO: 'gemini-2.5-flash',
        URL_GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',
        CATEGORIAS: Object.freeze({
            DIVISIBLE: 'divisible',
            ENTERO: 'entero'
        }),
        CLAVES_STORAGE: Object.freeze({
            BORRADOR_ACTIVO: 'farmacia_borrador_activo',
            HISTORIAL_7DIAS: 'farmacia_historial_7dias',
            DICCIONARIO_CODIGOS: 'farmacia_diccionario_codigos_v1',
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
