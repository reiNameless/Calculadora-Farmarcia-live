# Sistema de Cálculo e Inventario para Farmacia

Aplicación web local y ligera (cero dependencias externas) para recepción de mercancía, cálculo fiscal de costos unitarios a 8 decimales, determinación automática de precios de venta (P1, P2 y P3), memorización de códigos de barra y cuadre de facturas físicas.

---

## 🚀 Características Principales

- **Exactitud Fiscal y Redondeo Monetario:**
  - Costo Unitario calculado a **8 decimales** para mantener la precisión matemática del inventario contable.
  - Precios de venta expresados en **formato exacto (2 decimales)** y **redondeado al entero más cercano** para mostrador.
- **3 Fórmulas / Estrategias de Cálculo Independientes:**
  1. **Cascada de Descuento (Estándar de Farmacia):** Sube el margen a partir del costo para P1 (+30%), y aplica descuentos escalonados a partir del precio anterior para P2 (-5%) y P3 (-5%).
  2. **Margen Directo sobre el Costo:** Cada precio calcula su porcentaje de ganancia directamente sobre el costo base.
  3. **Margen Bruto Financiero:** Divide el costo entre `(1 - Margen)` para fijar el porcentaje sobre el precio cobrado al cliente.
- **Diccionario Permanente de Códigos de Barra:**
  - Reconoce y memoriza automáticamente los productos escaneados con pistola lectora o ingresados manualmente.
  - No sobrescribe nombres personalizados con valores genéricos.
- **Borrador Automático e Historial de 7 Días:**
  - Persistencia continua en `localStorage` con caché en memoria optimizado.
  - Alerta de proximidad de expiración antes del purgado automático de los 7 días.
  - Exportación e importación de respaldos en formato JSON seguro.
- **Escáner Inteligente con IA (Opcional):**
  - Lectura de fotos de facturas físicas mediante la API de Google Gemini (los datos se procesan con clave de sesión protegida en `sessionStorage`).

---

## 📂 Arquitectura de Archivos

```
Calculadora-Farmacia/
│
├── index.html              # Estructura semántica, accesibilidad y modales HTML5
├── README.md               # Documentación general y técnica
│
├── css/
│   └── estilos.css         # Diseño responsivo, accesibilidad, animaciones e impresión
│
└── js/
    ├── configuracion.js    # Constantes globales, claves de almacenamiento y perfiles
    ├── dominio.js          # Lógica pura de cálculo (Strategy Pattern), validaciones y redondeos
    ├── almacenamiento.js   # Manejo de persistencia, caché en memoria y respaldos JSON
    ├── servicio-ia.js      # Integración con Google Gemini API
    ├── interfaz.js         # Controlador de eventos, renderizado selectivo y modales
    └── pruebas.js          # Suite de pruebas unitarias automatizadas
```

---

## 🧪 Ejecución de Pruebas Automatizadas

Para correr la suite de pruebas unitarias en el navegador, simplemente abre `index.html` con el parámetro `?test=true`:

```
file:///.../index.html?test=true
```

O desde la consola de desarrollador del navegador (F12):
```javascript
AppFarmacia.ejecutarSuitePruebas();
```

Las pruebas cubren:
- Validaciones numéricas de cajas, precios y unidades.
- Cálculos exactos de las 3 estrategias de precios con y sin ITBIS.
- Expresiones regulares de detección de nombres genéricos.
- Cuadre contable y tolerancias de factura física.
