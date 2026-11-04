---
name: barcode-gs1-resolver
description: >-
  Validates, resolves, and tests GS1 barcode integrity (EAN-13 prefix 746 for Dominican Republic, UPC-A for US
  imports, EAN-8, ITF-14) using the Modulo 10 checksum algorithm. Manages camera barcode detection workflows,
  drug catalog lookup (OpenFDA, local registers), and selective product autocompletion.
---

# Resolución y Validación de Códigos de Barra Farmacéuticos (GS1)

Esta habilidad cubre el algoritmo GS1 Módulo 10, estándares de empaque farmacéutico y la integración de escaneo por cámara y pistola en la aplicación.

---

## 1. Estándares GS1 Soportados

| Estándar | Longitud | Uso en Farmacia | Ejemplo |
| :--- | :---: | :--- | :--- |
| **EAN-13** | 13 dígitos | Mayoría de medicamentos en RD (prefijo nacional **746**xxxxxxxxx) y Europa. | `7460012345678` |
| **UPC-A** | 12 dígitos | Medicamentos, vitaminas y suplementos importados de EE. UU. y Canadá. | `012345678905` |
| **EAN-8** | 8 dígitos | Empaques pequeños: colirios, ampollas, cremas dermatológicas compactas. | `12345670` |
| **ITF-14** | 14 dígitos | Cajas maestras o bultos de distribución que contienen múltiples empaques. | `17460012345675` |

---

## 2. Algoritmo Oficial GS1 Check Digit (Módulo 10)

El cálculo del dígito verificador se implementa en `Dominio.validarCodigoBarrasEstandar`:

1. Excluir el último dígito (dígito de control a verificar).
2. De derecha a izquierda, multiplicar los dígitos alternando pesos: `3, 1, 3, 1, ...`
3. Sumar todas las multiplicaciones ponderadas.
4. Calcular el residuo base 10: `residuo = suma % 10`.
5. El dígito esperado es: `(10 - residuo) % 10`.
6. Si el dígito esperado coincide con el último dígito ingresado, el código es matemáticamente íntegro.

---

## 3. Autocompletado Selectivo en Mostrador

Al escanear un código que ya existe en el diccionario:
* **Campos que SÍ autocompleta**:
  * Nombre del producto.
  * Último costo unitario registrado (`precioCajaBase`).
  * Tasa de ITBIS (`aplicaItbis`).
  * Indicador de Leche (`esLeche`).
* **Campos que DEJA INTACTOS**:
  * Cantidad de cajas (`calcCajasCompradas`).
  * Unidades por caja (`calcUnidadesCaja`).
  * Esto permite que el operador ingrese rápidamente cajas recibidas sin que el autocompletado sobreescriba las unidades de la factura actual.

---

## 4. Integración de Cámara Web/Móvil (`BarcodeDetector`)

Para dispositivos móviles y tablets sin pistola física:
1. **Detección Nativa**:
   ```javascript
   if ('BarcodeDetector' in window) {
       const detector = new BarcodeDetector({ formats: ['ean_13', 'upc_a', 'ean_8', 'itf'] });
       const codigos = await detector.detect(elementoVideo);
   }
   ```
2. **Fallback por Software**:
   Si el navegador no soporta `BarcodeDetector` nativo, se puede incluir una librería cliente ligera como `@zxing/library` para procesar el flujo de video en un canvas.
3. **Confirmación Inmediata**:
   Al detectar un código válido, emitir un sonido corto (`AudioContext` nativo) o vibración (`navigator.vibrate([100])`) y asignar el valor al campo `calcCodigoBarras`.
