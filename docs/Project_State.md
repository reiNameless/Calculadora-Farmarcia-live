# ESTADO DEL PROYECTO: Calculadora de Farmacia (Cockpit de Operaciones e Inventario)
> **Fuente de Verdad Técnica e Historial de Sesiones**  
> *Última auditoría y consolidación: 2026-11-06 (Implementación de Opciones 1, 2 y 3)*

---

## 1. RESUMEN EJECUTIVO Y ARQUITECTURA GENERAL
- **Naturaleza del Sistema:** Aplicación Web Progresiva (PWA) de alto rendimiento, cero dependencias de servidor (Local-First), diseñada para farmacias y droguerías en mostrador y dispositivos móviles.
- **Dominio Fiscal:** República Dominicana (DGII Art. 343: medicamentos exentos 0% ITBIS; bienes gravados al 18% / 16%; comprobantes e-CF/NCF B01, B02, E31, etc.; costo fiscal unitario exacto a 8 decimales; tolerancia de cuadre ±0.05).
- **Motor de Datos Local:** Híbrido `IndexedDB` (`CalculadoraFarmaciaDB` v1) estructurado en 4 Object Stores con réplica reactiva síncrona en memoria (`Map` a 0ms) y fallback de resiliencia en `localStorage`. Sembrado automático de catálogo dominicano (`catalogo_rd_inicial.json`). Credenciales de API de Google Gemini resguardadas exclusivamente en `sessionStorage` (memoria volátil).
- **Estándar de Códigos:** GS1 Checksum (Módulo 10) para EAN-13 (prefijo RD 746), UPC-A (12 dígitos importados), EAN-8 (ampollas/gotas) e ITF-14 (cajas maestras). Decodificación con cámara vía `BarcodeDetector` nativo con fallback universal a `ZXing` embebido.

---

## 2. MAPA FÍSICO DE CARPETAS Y ARCHIVOS

```
Calculadora-Farmacia/
├── .agent/
│   └── rules/
│       └── web_db_architect.md                # Directivas maestras del Arquitecto Senior
├── .agents/
│   ├── rules/
│   │   └── AGENTS.md                          # Reglas de negocio farmacéutico y restricciones de CI
│   └── skills/
│       ├── barcode-gs1-resolver/SKILL.md      # Skill GS1 y validación de código de barras
│       ├── pwa-indexeddb-toolkit/SKILL.md     # Skill de persistencia Local-First e IndexedDB
│       └── rd-pharmacy-audit/SKILL.md         # Skill de auditoría fiscal RD y matemáticas farmacéuticas
├── .github/
│   └── workflows/
│       └── ci.yml                             # CI: node -c, auditoría de 178 IDs y pruebas unitarias
├── css/
│   └── estilos.css                            # Sistema de diseño Ultra-Dark, variables CSS, accesibilidad y print
├── docs/
│   └── Project_State.md                       # [ESTE ARCHIVO] Tracker vivo de estado del proyecto
├── icons/
│   ├── icon-192.png                           # Ícono PWA estándar
│   ├── icon-512.png                           # Ícono PWA alta resolución
│   └── icon.svg                               # Vectorial SVG
├── js/
│   ├── almacenamiento.js                      # IndexedDB + localStorage + caché Map en memoria + sembrado de catálogo
│   ├── configuracion.js                       # Constantes inmutables, estrategias y perfiles de margen
│   ├── dominio.js                             # Cálculos fiscales puros (Strategy Pattern), GS1, RNC, e-CF y redondeo exponencial
│   ├── interfaz.js                            # Orquestador del estado central, PWA service worker y navegación protegida
│   ├── pruebas.js                             # Suite de pruebas unitarias automatizadas (16 suites de prueba)
│   ├── servicio-catalogo.js                   # Consulta online en Open Food Facts (con timeout y offline-safe)
│   ├── servicio-ia.js                         # Procesador multimodal de facturas con Google Gemini (Vision)
│   ├── ui-calculadora.js                      # Cockpit de cálculo en vivo, debounce, atajos y escáner de cámara
│   ├── ui-diccionario.js                      # CRUD y vista del diccionario de códigos con botón de sembrado RD
│   ├── ui-factura.js                          # Cabecera, tabla reactiva, edición inline y cuadre unificado DRY
│   ├── ui-historial.js                        # Historial 7 días con alertas de expiración e impresión de reportes
│   ├── ui-notificaciones.js                   # Diálogos modales accesibles (<dialog>), toasts y filtro numérico
│   └── zxing.min.js                           # Librería cliente ZXing (336 KB) para escaneo universal
├── catalogo_farmacia_extenso.json             # Respaldo JSON con 77 medicamentos y productos de RD
├── catalogo_rd_inicial.json                   # Respaldo JSON de diccionario de productos RD precacheado en PWA
├── index.html                                 # Estructura semántica HTML5 (178 IDs verificados en CI)
├── manifest.json                              # Web App Manifest para instalación PWA
├── optimizacion_universal.py                  # Script de orquestación de auditoría multi-agente
├── README.md                                  # Documentación técnica general (actualizada a Caché v19)
├── robots.txt                                 # Políticas de indexación
├── SECURITY.md                                # Política de privacidad y seguridad Zero-Trust
└── sw.js                                      # Service Worker offline (Caché v19 con precarga de catálogo RD)
```

---

## 3. ESQUEMA DE PERSISTENCIA Y BASE DE DATOS LOCAL

### IndexedDB: `CalculadoraFarmaciaDB` (Versión 1)
| Object Store | KeyPath / Clave | Índices Configurados | Propósito |
| :--- | :--- | :--- | :--- |
| `borrador` | Clave out-of-line (`'activo'`) | Ninguno | Almacena la factura en curso de edición para evitar pérdidas ante recargas o cierres. |
| `historial_facturas` | `id` | `fechaEmision`, `proveedor`, `numeroFactura`, `timestampGuardado` | Facturas cerradas durante la ventana de 7 días de retención. |
| `diccionario_productos` | `codigoBarras` | `nombre`, `ultimoPrecioCaja`, `actualizadoEn` | Catálogo de productos aprendidos con costos y configuraciones de ITBIS/Leche. |
| `configuracion_reglas` | Clave out-of-line (`'reglas_activas'`) | Ninguno | Parámetros de margen fiscal, estrategia activa y perfiles. |

### Fallback en LocalStorage / SessionStorage
- `farmacia_borrador_activo`: Respaldo JSON del borrador.
- `farmacia_historial_7dias`: Array serializado de facturas recientes.
- `farmacia_diccionario_codigos_v1`: Objeto asociativo de códigos memorizados.
- `farmacia_proveedores_v1`: Directorio de droguerías y RNCs frecuentes.
- `farmacia_reglas_calculo_v2`: Objeto de reglas y márgenes activos.
- `farmacia_gemini_api_key`: **`sessionStorage`** exclusivamente (Zero-Trust, borrado al cerrar pestaña).
- `farmacia_gemini_modelo`: Modelo activo (por defecto `gemini-2.5-flash`).

---

## 4. HISTORIAL DE MEJORAS IMPLEMENTADAS EN ESTA SESIÓN

### Opción 1 — Blindaje de Persistencia y Sembrado de Catálogo
1. **Redondeo Exponencial Simétrico:** `Dominio.redondearDecimalExacto` refactorizado usando notación exponencial de base 10 (`split('e')`), eliminando el sesgo de punto flotante IEEE 754 de `Number.EPSILON` en números mayores a 1,000.
2. **Sembrado Automático y Manual del Catálogo Dominicano:** `Almacenamiento.sembrarCatalogoInicial` precarga los 77 fármacos de `catalogo_rd_inicial.json` en `IndexedDB` en instalaciones limpias. Se añadió el botón `#btnSembrarCatalogoRd` en la interfaz para siembra manual en cualquier momento.
3. **Mitigación de Condición de Carrera en Hidratación:** En `interfaz.js`, se implementó una guarda de interacción temprana (`interaccionUsuarioIniciada`). Si el cajero comienza a interactuar antes de que `IndexedDB` resuelva su promesa, la sesión activa en memoria no se sobreescribe, protegiendo los datos ingresados.
4. **PWA Caché v19:** Se añadió `catalogo_rd_inicial.json` a `ARCHIVOS_ESTATICOS` en `sw.js` y se incrementó la versión a `v19`.

### Opción 2 — Unificación DRY y Desglose Fiscal Canónico
1. **Desglose Fiscal Consolidado:** `Dominio.calcularResumenCuadreFactura` calcula y expone de forma canónica:
   - `totalBrutoAcumulado`
   - `totalDescuentoAcumulado`
   - `totalExentoAcumulado`
   - `totalGravadoAcumulado`
   - `totalItbisAcumulado`
   - `subtotalBaseAcumulado`
   - `sumaAcumulada` (total calculado)
   - `totalFisico`, `diferencia` y `cuadreExacto`.
2. **Consumo DRY en UI:** `ui-factura.js` (`actualizarDesgloseFiscalGlobal`) consume directamente el resultado de `Dominio.calcularResumenCuadreFactura`, eliminando más de 30 líneas de ciclos y lógica duplicada.
3. **Ampliación de Pruebas Unitarias:** Se añadieron 3 nuevas suites en `js/pruebas.js` que validan el desglose DRY y el redondeo exacto en montos altos sin pérdida de precisión.

### Opción 3 — Consolidación y Verificación Integral
- Verificación de CI superada al 100%: sintaxis en todos los archivos, paridad de 178 IDs y todas las pruebas de dominio y GS1.
- Cambios desplegados al repositorio de producción (`origin/main`), preservando el repositorio público (`public/main`) intacto.

---

## 5. ESTADO DE PRUEBAS Y CI
- **Sintaxis JS:** Verificada con `node -c` en 14 archivos (`sw.js` + 13 en `js/`). Estado: **100% PASS**.
- **Paridad de IDs:** 178 IDs en `index.html` auditados contra los IDs críticos obligatorios. Estado: **100% PASS**.
- **Suite de Pruebas Unitarias (`js/pruebas.js`):** 16 suites automatizadas. Estado: **100% PASS**.
