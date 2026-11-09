# Política de Seguridad (Security Policy)

## 🛡️ Compromiso con la Seguridad y la Privacidad

La **Calculadora de Farmacia** fue diseñada bajo el principio de **Privacidad y Aislamiento por Defecto (Zero-Trust Local)**.

---

### 1. Manejo de Credenciales y Claves de API
* **Sin almacenamiento persistente de credenciales:** La clave de la API de Google Gemini **NUNCA** se guarda en `localStorage` ni se transmite a ningún servidor intermediario.
* **Almacenamiento en memoria volátil de sesión (`sessionStorage`):** La API key solo vive en la pestaña activa del navegador del usuario y se destruye automáticamente al cerrar la ventana.
* **Cero dependencias externas:** El código no utiliza librerías de terceros (`npm`, `cdn` externos, etc.) para evitar riesgos de ataques de cadena de suministro (*supply-chain attacks*).

---

### 2. Privacidad de los Datos de la Farmacia
* **Arquitectura 100% Offline (Local-First):** Toda la información de facturas, precios, costos, nombres de medicamentos y el diccionario de códigos de barras reside exclusivamente en el dispositivo del usuario (`localStorage` del navegador).
* **Sin telemetría ni analíticas:** No existen scripts de seguimiento (*trackers*), cookies comerciales ni recopilación de datos de ventas.

---

### 3. Validación de Archivos y Sanitización
* **Respaldo JSON Protegido:** El proceso de importación y exportación de respaldos JSON valida la estructura interna y restringe el tamaño máximo del archivo para evitar desbordamientos de memoria o ataques de denegación de servicio local.
* **Filtros numéricos físicos:** Los campos numéricos y de códigos de barra bloquean físicamente entradas maliciosas, caracteres no autorizados y scripts inyectados.

---

### 4. Reporte de Vulnerabilidades
Si detectas alguna vulnerabilidad de seguridad o comportamiento inesperado, por favor repórtala de manera responsable a través de los canales de contacto del desarrollador o mediante la pestaña de **Issues** en el repositorio privado.
