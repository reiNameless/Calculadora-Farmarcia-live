# Calculadora de Farmacia — Cockpit de Operaciones e Inventario

[![CI & Pruebas Automatizadas](https://github.com/reiNameless/Calculadora-Farmarcia/actions/workflows/ci.yml/badge.svg)](https://github.com/reiNameless/Calculadora-Farmarcia/actions/workflows/ci.yml)
[![PWA Ready](https://img.shields.io/badge/PWA-100%25_Offline-146c2e?style=flat&logo=pwa)](https://github.com/reiNameless/Calculadora-Farmarcia)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](./LICENSE)

Aplicación web progresiva (PWA) de alto rendimiento y cero dependencias para recepción ágil de mercancía en farmacias, cálculo fiscal exacto de costos a 8 decimales, determinación automática de precios de venta (P1, P2 y P3), cuadre de facturas y memorización local de códigos de barras.

Diseñada con enfoque **Local-First (100% funcional sin conexión a internet)** y optimizada para operar tanto en computadoras de mostrador con pistolas lectoras de códigos de barras como en dispositivos móviles (tablets y smartphones).

---

## 🚀 Características Principales

### 1. Cálculo Fiscal y Precios de Venta
* **Costo Fiscal a 8 Decimales:** División de alta precisión para coincidir con los requerimientos de los sistemas contables y ERP farmacéuticos.
* **Precios de Mostrador (P1, P2 y P3):** Presentación dual de precios en valor exacto (con 2 decimales) y valor redondeado al entero más cercano.
* **Regla Especial de Leche (Ganancia 10%):** Opción de cálculo para leches y fórmulas infantiles fijando el margen P1 en un 10% directo (`costo × 1.10`).
* **Descuentos Flexibles en Factura:** Permite aplicar descuentos de proveedores por monto global de la línea ($) o por porcentaje unitario (%). Los precios de venta se calculan sobre la base real de compra mientras que el costo fiscal absorbe el descuento.

### 2. Reconocimiento y Validación de Códigos de Barras
* **Algoritmo Oficial GS1 Checksum (Modulo 10):** Valida la integridad matemática de códigos estándar:
  * **EAN-13** (13 dígitos: estándar para la gran mayoría de medicamentos).
  * **UPC-A** (12 dígitos: medicamentos y suplementos importados de EE.UU./Canadá).
  * **EAN-8** (8 dígitos: envases pequeños, colirios, ampollas).
  * **ITF-14** (14 dígitos: cajas maestras).
* **Autocompletado Selectivo e Inteligente:** Al escanear o tipear un código memorizado, autocompleta inmediatamente el **Nombre**, el **Último Costo**, la tasa de **ITBIS** y la marca de **Leche**, dejando intactas la categoría y unidades para agilizar el ingreso de cajas.
* **Filtro Numérico Estricto:** Bloqueo físico de caracteres alfabéticos y teclado numérico automático en dispositivos móviles.

### 3. Facturación y Cuadre de Mercancía
* **Cuadre Exacto con Semáforo Visual:** Monitoreo en tiempo real de la diferencia entre el total calculado y el total físico de la factura en papel.
* **Vencimiento Automático (+30 días):** Al establecer la fecha de emisión de la factura, la fecha de vencimiento se calcula automáticamente a 30 días calendario por defecto.
* **Edición Inline en Tabla:** Modificación rápida de cantidades, precios o ITBIS directamente en la tabla de productos registrados.

### 4. Bóveda Protegida y Respaldo
* **Bóveda de Fórmulas:** Candado de protección contra modificaciones accidentales en los porcentajes de margen y fórmulas matemáticas (Cascada, Margen Directo y Margen Financiero).
* **Historial de 7 Días:** Almacenamiento local temporal con advertencia de retención y opción de reapertura de facturas.
* **Exportación / Importación JSON:** Respaldos portátiles para editar nombres o catálogos en cualquier editor de texto u hoja de cálculo y restaurarlos sin perder información.

### 5. Escáner Inteligente con IA (Opcional)
* Integración con la API de Google Gemini para transcripción automática de facturas a partir de fotografías. La clave de API se resguarda en `sessionStorage` (memoria volátil) para máxima seguridad.

### 6. Interfaz Moderna Ultra-Dark
* Modo Oscuro Clínico de alto contraste diseñado para reducir la fatiga visual durante jornadas prolongadas de digitación.

---

## 📂 Arquitectura Modular

```
Calculadora-Farmacia/
│
├── index.html              # Estructura semántica, accesibilidad y modales HTML5
├── manifest.json           # Manifiesto PWA para instalación en Android/iOS/PC
├── sw.js                   # Service Worker para funcionamiento 100% offline (Caché v19)
├── robots.txt              # Configuración para motores de búsqueda
├── LICENSE                 # Licencia propietaria (All Rights Reserved)
├── SECURITY.md             # Política de seguridad y privacidad
├── README.md               # Documentación general y técnica
│
├── .github/
│   └── workflows/
│       └── ci.yml          # Integración Continua (validación de sintaxis, pruebas y paridad de IDs)
│
├── icons/
│   ├── icon.svg            # Ícono vectorial escalable
│   ├── icon-192.png        # Ícono PWA estándar (192x192)
│   └── icon-512.png        # Ícono PWA alta resolución (512x512)
│
├── css/
│   └── estilos.css         # Paleta Ultra-Dark, diseño responsivo y estilos de impresión
├── docs/
│   └── Project_State.md    # Fuente de verdad técnica y estado del proyecto
├── catalogo_rd_inicial.json# Catálogo semilla dominicano (77 medicamentos y productos)
│
└── js/
    ├── configuracion.js    # Constantes globales, claves de almacenamiento y perfiles
    ├── dominio.js          # Lógica pura de cálculo (Strategy Pattern), algoritmo GS1 y fechas
    ├── almacenamiento.js   # Persistencia en localStorage, IndexedDB y respaldos JSON
    ├── servicio-ia.js      # Conexión con Google Gemini API
    ├── servicio-catalogo.js# Consulta inteligente a bases de datos de productos
    ├── zxing.min.js        # Decodificador universal cliente de códigos de barra y QR
    │
    ├── ui-notificaciones.js# Alertas toast accesibles y diálogos modales
    ├── ui-calculadora.js   # Cockpit de cálculo en vivo, atajos de teclado y escáner GS1
    ├── ui-factura.js       # Cabecera de factura, tabla reactiva y cuadre en tiempo real
    ├── ui-diccionario.js   # Gestión de diccionario de códigos, exportación e importación
    ├── ui-historial.js     # Historial de 7 días, alertas de retención e impresión
    ├── interfaz.js         # Orquestador del estado central y registro PWA
    └── pruebas.js          # Suite de pruebas unitarias automatizadas
```

---

## 🧪 Pruebas Automatizadas

La aplicación cuenta con una suite completa de pruebas unitarias para validación de precios, estrategias de cascada, algoritmo GS1 Modulo 10, leche, descuentos y sumas de fechas.

Para ejecutar las pruebas en el navegador:
```
https://reinameless.github.io/Calculadora-Farmarcia-live/?test=true
```

O abriendo la consola de desarrollador (F12):
```javascript
AppFarmacia.ejecutarSuitePruebas();
```

---

## 📄 Licencia

Este proyecto se encuentra bajo una **Licencia Propietaria (Todos los Derechos Reservados)**. Consulta el archivo [LICENSE](./LICENSE) para conocer los términos de uso y autoría.
