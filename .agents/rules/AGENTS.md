# Reglas de Desarrollo: Calculadora de Farmacia (Cockpit de Operaciones)

Este documento define las reglas de negocio, directrices fiscales y restricciones arquitectónicas que deben regir cualquier cambio en este repositorio.

---

## 1. Regla de Oro: Precisión Matemática y Fiscal
* **Costo Unitario Fiscal**: Debe conservarse siempre a **8 decimales** utilizando `Dominio.formatearCostoFiscalOchoDecimales(num)`. Prohibido redondear o truncar costos unitarios antes de la división final.
* **Precios de Venta (P1, P2, P3)**: Deben presentarse en valor exacto a **2 decimales** (`formatearMonedaDosDecimales`) y valor redondeado al entero más cercano (`Math.round`) para facilitar el cobro en efectivo.
* **Auditoría Interna**: Subtotales de línea y cálculos de margen usan 4 decimales intermedios para evitar arrastre de error por redondeo prematuro.
* **Tolerancia de Cuadre**: El semáforo de cuadre de factura física vs. calculada acepta una discrepancia máxima de `±0.05` (`CONSTANTES.TOLERANCIA_CUADRE_FACTURA`) debido al redondeo de centavos de los sistemas ERP de los proveedores.

---

## 2. Normativa Tributaria y Comercial (República Dominicana)
* **ITBIS en Medicamentos**: Por mandato de la DGII (Art. 343 del Código Tributario), los **medicamentos para uso humano están 100% EXENTOS de ITBIS (Tasa 0% / `aplicaItbis: false`)**.
* **Artículos Gravados (18% / 16%)**: Solo los productos de conveniencia, higiene, cosméticos, golosinas y bebidas llevan ITBIS general del 18% (o 16% en derivados lácteos específicos).
* **Comprobantes Fiscales (NCF / e-CF)**: El sistema debe admitir formatos dominicanos de comprobantes: `B01` (Crédito Fiscal), `B02` (Consumo), `B14` (Régimen Especial), `B15` (Gubernamental) y comprobantes electrónicos `E31`, `E32`, etc.
* **Regla Comercial de Leches y Fórmulas Infantiles**:
  * Es una **política comercial y de mercado de la farmacia**, NO una ley obligatoria.
  * Por defecto aplica un margen directo del 10% (`costo × 1.10`) para mantenerse competitivo frente a supermercados en canasta básica.
  * Debe permanecer como parámetro configurable en los perfiles de la farmacia.

---

## 3. Política de Arquitectura: Local-First & Dependencias Cuidadosas
* **Local-First es innegociable**: La aplicación debe ser 100% funcional sin conexión a internet. Todos los datos esenciales (catálogo, borradores, historial) deben almacenarse en el dispositivo (`IndexedDB` / `localStorage`).
* **Criterio de Dependencias**:
  * **Permitidas**: Librerías especializadas que corran 100% en el cliente (Browser / Client-Side) y puedan ser cacheadas por el Service Worker (`sw.js`). Ejemplos válidos: `Dexie.js` para simplificar IndexedDB, librerías cliente para decodificar códigos con cámara (`ZXing` o `@zxing/library`), o generadores cliente de reportes (`jsPDF`, `SheetJS`).
  * **Restringidas**: Frameworks que fuercen reescrituras innecesarias del núcleo o requieran un backend/servidor Node.js activo en la farmacia para poder operar.

---

## 4. Códigos de Barra GS1
* Toda validación de código de barras debe procesarse mediante el algoritmo oficial GS1 Checksum (Módulo 10) implementado en `Dominio.validarCodigoBarrasEstandar`.
* Se deben soportar sin excepción:
  * **EAN-13**: Estándar nacional de RD (prefijo **746**) e internacional.
  * **UPC-A**: Medicamentos y suplementos importados de EE. UU. (12 dígitos).
  * **EAN-8**: Ampollas, gotas oftálmicas y empaques reducidos.
  * **ITF-14**: Cajas maestras de distribución.

---

## 5. Integridad del Pipeline de Integración Continua (CI)
* Antes de dar por finalizado un cambio, debe verificarse:
  1. Sintaxis limpia con `node -c` en todos los archivos de `js/` y `sw.js`.
  2. Paridad total de IDs en `index.html` auditada por `.github/workflows/ci.yml`.
  3. Ejecución exitosa de la suite completa en `js/pruebas.js`.
