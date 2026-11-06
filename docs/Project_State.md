# ESTADO DEL PROYECTO: Calculadora de Farmacia (Cockpit de Operaciones e Inventario)
> **Fuente de Verdad Técnica e Historial de Sesiones**  
> *Última auditoría y consolidación: 2026-11-06 (Arquitectura Semántica HTML5, Atajos F1-F4, Web Audio API y Marca Chroniris)*

---

## 1. RESUMEN EJECUTIVO Y ARQUITECTURA GENERAL
- **Naturaleza del Sistema:** Aplicación Web Progresiva (PWA) de alto rendimiento, cero dependencias de servidor (Local-First), diseñada para farmacias y droguerías en mostrador y dispositivos móviles.
- **Marca y Titularidad:** Plataforma desarrollada bajo la marca **Chroniris**, creada y desarrollada por **reiNameless**. Todos los derechos reservados.
- **Dominio Fiscal:** República Dominicana (DGII Art. 343: medicamentos exentos 0% ITBIS; bienes gravados al 18% / 16%; comprobantes e-CF/NCF B01, B02, E31, etc.; costo fiscal unitario exacto a 8 decimales; tolerancia de cuadre ±0.05).
- **Motor de Datos Local:** Híbrido `IndexedDB` (`CalculadoraFarmaciaDB` v1) estructurado en 4 Object Stores con réplica reactiva síncrona en memoria (`Map` a 0ms), solicitud de almacenamiento persistente (`navigator.storage.persist()`), sembrado de catálogo dominicano (`catalogo_rd_inicial.json`) y fallback en `localStorage`. Credenciales de Google Gemini en `sessionStorage` (Zero-Trust).
- **Estándar de Códigos:** GS1 Checksum (Módulo 10) para EAN-13 (prefijo RD 746), UPC-A (12 dígitos importados), EAN-8 (ampollas/gotas) e ITF-14 (cajas maestras). Decodificación con cámara vía `BarcodeDetector` nativo con fallback a `ZXing` embebido y sintetizador sonoro Web Audio API (bips de confirmación acústica en hardware).

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
│       └── ci.yml                             # CI: node -c, auditoría de 187 IDs y pruebas unitarias
├── css/
│   └── estilos.css                            # Sistema de diseño Ultra-Dark, variables CSS, accesibilidad, print y footer Chroniris
├── docs/
│   └── Project_State.md                       # [ESTE ARCHIVO] Tracker vivo de estado del proyecto
├── icons/
│   ├── icon-192.png                           # Ícono PWA estándar
│   ├── icon-512.png                           # Ícono PWA alta resolución
│   └── icon.svg                               # Vectorial SVG
├── js/
│   ├── almacenamiento.js                      # IndexedDB + localStorage + caché Map + persistencia navigator.storage.persist
│   ├── configuracion.js                       # Constantes inmutables, estrategias y perfiles de margen
│   ├── dominio.js                             # Cálculos fiscales (Strategy Pattern), GS1, RNC, e-CF, redondeo exponencial y Web Audio bips
│   ├── interfaz.js                            # Orquestador del estado central, PWA service worker, modal de atajos y navegación
│   ├── pruebas.js                             # Suite de pruebas unitarias automatizadas (16 suites de prueba)
│   ├── servicio-catalogo.js                   # Consulta online en Open Food Facts (con timeout y offline-safe)
│   ├── servicio-ia.js                         # Procesador multimodal de facturas con Google Gemini (Vision)
│   ├── ui-calculadora.js                      # Cockpit de cálculo en vivo, atajos F1-F4, enter secuencial y audio feedback
│   ├── ui-diccionario.js                      # CRUD y vista del diccionario de códigos con botón de sembrado RD
│   ├── ui-factura.js                          # Cabecera, tabla reactiva, edición inline y cuadre unificado DRY
│   ├── ui-historial.js                        # Historial 7 días con alertas de expiración e impresión de reportes
│   ├── ui-notificaciones.js                   # Diálogos modales accesibles (<dialog>), toasts y filtro numérico
│   └── zxing.min.js                           # Librería cliente ZXing (336 KB) para escaneo universal
├── catalogo_farmacia_extenso.json             # Respaldo JSON con 77 medicamentos y productos de RD
├── catalogo_rd_inicial.json                   # Respaldo JSON de diccionario de productos RD precacheado en PWA
├── index.html                                 # Estructura semántica HTML5 (<header>, <main>, <footer>, 187 IDs verificados en CI)
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

## 4. HISTORIAL DE MEJORAS Y ARQUITECTURA SEMÁNTICA

### Mejoras de Arquitectura Web y Ergonomía de Mostrador (Sesión Actual)
1. **Estructura Semántica HTML5 Canónica:**
   - Adición del landmark `<main id="contenidoPrincipal">` envolviendo todas las secciones operativas del cockpit.
   - Creación del landmark `<footer class="pie-pagina-farmacia" role="contentinfo">` con información de versión, copyright legal de **Chroniris**, desarrollo por **reiNameless** y botones de acción rápida.
   - Metadatos optimizados en `<head>`: `<meta name="description">` y `<meta name="author" content="Chroniris / reiNameless">`.
2. **Modal Accesible de Atajos de Teclado e Información (`#modalAtajosAyuda`):**
   - Diálogo modal HTML5 accesible con teclado (`F1` o `?`), listando las teclas rápidas de operación (`F1`, `F2`, `F4`, `Enter`, `Espacio`, `Esc`), resumen de la normativa tributaria DGII (Art. 343) y especificaciones GS1.
3. **Feedback Acústico con Web Audio API (Cero Dependencias):**
   - `Dominio.emitirBipExito()` (880 Hz) y `Dominio.emitirBipError()` (240 Hz con vibración háptica), permitiendo al farmacéutico recibir mercancía con pistolas lectoras con confirmación auditiva inmediata.
4. **Blindaje contra Purga de Almacenamiento:**
   - Invocación de `navigator.storage.persist()` en `Almacenamiento.solicitarPersistenciaAlmacenamiento()`.

---

## 5. ESTADO DE PRUEBAS Y CI
- **Sintaxis JS:** Verificada con `node -c` en 14 archivos (`sw.js` + 13 en `js/`). Estado: **100% PASS**.
- **Paridad de IDs:** 187 IDs en `index.html` auditados contra los 23 IDs críticos obligatorios. Estado: **100% PASS**.
- **Suite de Pruebas Unitarias (`js/pruebas.js`):** 16 suites automatizadas. Estado: **100% PASS**.
