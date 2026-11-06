# ESTADO DEL PROYECTO: Calculadora de Farmacia (Cockpit de Operaciones e Inventario)
> **Fuente de Verdad Técnica e Historial de Sesiones**  
> *Última auditoría y consolidación: 2026-11-06 (Rediseño Cockpit Dual, Ergonomía Split-Screen con Cero Scroll, Cabecera Colapsable y Números Tabulares tnum)*

---

## 1. RESUMEN EJECUTIVO Y ARQUITECTURA GENERAL
- **Naturaleza del Sistema:** Aplicación Web Progresiva (PWA) de alto rendimiento, cero dependencias de servidor (Local-First), diseñada para farmacias y droguerías en mostrador y dispositivos móviles.
- **Marca y Titularidad:** Plataforma desarrollada bajo la marca **Chroniris**, creada y desarrollada por **reiNameless**. Todos los derechos reservados.
- **Dominio Fiscal:** República Dominicana (DGII Art. 343: medicamentos exentos 0% ITBIS; bienes gravados al 18% / 16%; comprobantes e-CF/NCF B01, B02, E31, etc.; costo fiscal unitario exacto a 8 decimales; tolerancia de cuadre ±0.05).
- **Motor de Datos Local:** Híbrido `IndexedDB` (`CalculadoraFarmaciaDB` v2) estructurado en 4 Object Stores con réplica reactiva síncrona en memoria (`Map` a 0ms), solicitud de almacenamiento persistente (`navigator.storage.persist()`), sembrado de catálogo dominicano (`catalogo_rd_inicial.json`) y fallback en `localStorage`. Credenciales de Google Gemini en `sessionStorage` (Zero-Trust).
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

### IndexedDB: `CalculadoraFarmaciaDB` (Versión 2)
| Object Store | KeyPath / Clave | Índices Configurados | Propósito |
| :--- | :--- | :--- | :--- |
| `borrador` | Clave out-of-line (`'activo'`) | Ninguno | Almacena la factura en curso de edición para evitar pérdidas ante recargas o cierres. |
| `historial_facturas` | `id` | `fechaEmision`, `proveedor`, `numeroFactura`, `timestampGuardado` | Facturas cerradas durante la ventana de 7 días de retención. |
| `diccionario_productos` | `codigoBarras` | `nombre`, `ultimoPrecioCaja`, `actualizadoEn`, `principioActivo`, `laboratorio`, `proveedorHabitual`, `categoria` | Catálogo maestro de productos para futuro ERP con trazabilidad histórica de costos, taxonomía farmacéutica y precios de venta calculados. |
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
5. **Auditoría y Validación de Seguridad de Archivos (Defensa en Profundidad):**
   - **Firma Binaria Real (Magic Numbers):** Validación obligatoria de los primeros bytes del archivo (`ArrayBuffer` / `Uint8Array`) para impedir la suplantación de formato (CWE-434). Valida firmas binarias canónicas de PDF (`%PDF-`), JPEG (`0xFF, 0xD8, 0xFF`), PNG (`\x89PNG\r\n\x1a\n`), WebP (`RIFF...WEBP`) y JSON.
   - **Inspección Profunda de Amenazas en PDFs:** Análisis de cabecera ISO 32000-1 (`%PDF-1.x`), presencia de marcador de cierre (`%%EOF`) y escaneo exhaustivo de objetos ejecutables activos (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFiles`, `/RichMedia`, `/SubmitForm`, `/ImportData`, `/URI javascript:`).
   - **Protección contra Bombas de Descompresión (Pixel Flood / Zip Bomb):** Decodificación preventiva en binario de bloques IHDR (PNG) y SOF (JPEG) para rechazar imágenes con dimensiones excesivas (> 64 Megapíxeles) antes de asignar memoria en lienzos Canvas.
   - **Sanitización de Nombres de Archivo:** Neutralización de Path Traversal (CWE-22) eliminando secuencias `../`, eliminación de bytes nulos (`\0`) y bloqueo estricto de dobles extensiones ejecutables (`.php.pdf`, `.exe.jpg`).
   - **Invalidación de Caché PWA:** Actualización de Service Worker a `farmacia-pwa-v24`.
6. **Sellos Criptográficos Digitales y Protección Anti-Tampering (Chroniris Seal):**
   - **Firma Digital HMAC-SHA256 en Archivos:** Toda exportación de datos (Respaldo Completo, Diccionario de Códigos o Historial) se encapsula en un sobre criptográfico inmutable (`_chroniris_sello`) con huella canónica SHA-256 y firma HMAC calculada con semilla de la aplicación.
   - **Rechazo Inmediato de Adulteraciones:** Si un atacante o usuario externo altera un solo centavo, letra o balance en un archivo JSON descargado, el sistema detecta la rotura de huella y aborta la restauración (`INTEGRIDAD_COMPROMETIDA`).
   - **Bloqueo de Archivos Foráneos:** Archivos generados externamente sin firma digital de Chroniris OS son rechazados por seguridad.
7. **Protección contra Clickjacking y Falsificación de Dominio en GitHub Pages:**
   - **Framebusting en `<head>`:** Inmunización activa contra Clickjacking (`window.top !== window.self`), bloqueando la incrustación de la aplicación en `<iframe>` maliciosos.
   - **Detección de Dominio No Autorizado:** El sistema verifica el origen (`window.location.hostname`). Si se ejecuta en un clon no autorizado fuera de `localhost` o `reinameless.github.io`, despliega una advertencia de seguridad para proteger a los usuarios de sitios piratas.
8. **Blindaje Riguroso Campo por Campo:**
   - Límites superiores físicos en precios (máximo RD$ 50,000,000.00) y cantidades (máximo 100,000 cajas) evitando desbordamientos de punto flotante IEEE 754.
   - Sanitización de entradas de texto contra caracteres de control, bytes nulos e inyecciones XSS en nombres de fármacos, números de factura y proveedores.
   - Actualización de Service Worker a `farmacia-pwa-v24`.


---

9. **Rediseño Arquitectónico: Cockpit Dual (Opción 1) y Ergonomía Split-Screen (ROL 02):**
   - **Prioridad Operativa a Cálculos Inmediatos:** La calculadora rápida y los precios de venta (P1, P2, P3 y Costo Unitario Fiscal a 8 decimales) tienen prioridad visual absoluta para el mostrador.
   - **Cabecera de Factura Colapsable y Bloqueable (`#seccionDatosFactura`):** La cabecera física puede colapsarse u ocultarse mediante `#btnToggleDatosFactura` (atajo `Alt + F`), liberando ~180px verticales y mostrando un chip resumen compacto `#resumenFacturaCompacta` (`[Proveedor: Rowe | Factura #: B0100012345 | Papel: $1,450.00] [Editar Datos]`). En caso de error de validación al guardar, la cabecera se auto-expande automáticamente.
   - **Ergonomía de Pantalla Dividida (Split-Screen / POS) con Cero Scroll:** Al trabajar con la ventana minimizada o compartida con el ERP de la farmacia (< 1024px o modo forzado), se activa la barra de pestañas `#cockpitTabs` (`[Calculadora Rápida]` vs `[Factura & Cuadre]`), garantizando que la entrada de mercancía y los precios en vivo encajen en menos de 480px sin ningún scroll vertical.
   - **Fila de 3 Campos Compacta (`.fila-tres-campos`):** Compactación de variables en 2 filas limpias: (Cant. Cajas | Costo Base | Trae x Caja) y (ITBIS | Descuento | Leche 10%).
   - **Mini Strip de Cuadre en Vivo (`#miniCuadreStrip`):** Barra informativa en la vista de calculadora que muestra el acumulado y semáforo de cuadre en tiempo real sin salir de la pestaña.
   - **Erradicación del Jitter Numérico (`font-feature-settings: "tnum"`):** Aplicación estricta de figuras tabulares (`tnum`) a todas las cifras monetarias y unitarias para que los números no bailen al recalcular.
   - **Botón de Modo Compacto / Dual (`#btnModoCompacto`):** Permite forzar el modo de 1 columna o 2 columnas lado a lado en cualquier monitor con persistencia en `localStorage`.
   - **Caché PWA Actualizado:** Incremento a `farmacia-pwa-v25`.

---

## 5. ESTADO DE PRUEBAS Y CI
- **Sintaxis JS:** Verificada con `node -c` en 14 archivos (`sw.js` + 13 en `js/`). Estado: **100% PASS**.
- **Paridad de IDs:** 234 IDs en `index.html` auditados contra los IDs críticos obligatorios. Estado: **100% PASS**.
- **Suite de Pruebas Unitarias (`js/pruebas.js`):** 24 suites automatizadas ejecutadas sin errores. Estado: **100% PASS**.
- **Suite de Pruebas de Integración Cockpit Dual (`test_cockpit_dual_integration.js`):** Verificación al 100% de alternancia de pestañas, colapsado de cabecera, actualización de chips y semáforo mini. Estado: **100% PASS**.
