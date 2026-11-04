---
name: pwa-indexeddb-toolkit
description: >-
  Manages, tests, and migrates Local-First PWA storage including IndexedDB architecture, Service Worker cache
  invalidation, and JSON backup/restore. Use when refactoring storage beyond the 5MB localStorage limit, updating
  the Service Worker offline cache, designing database stores, or auditing data persistence resilience.
---

# Herramientas de Persistencia Local-First e IndexedDB

Esta habilidad guía el diseño, migración y mantenimiento del almacenamiento local offline y el Service Worker de la aplicación.

---

## 1. Arquitectura de Almacenamiento Local

### El Problema de `localStorage`:
* Límite rígido de **~5 MB**.
* Operaciones síncronas que pueden congelar la interfaz al serializar catálogos grandes.

### Diseño Recomendado en `IndexedDB`:
Nombre de la Base de Datos: `CalculadoraFarmaciaDB` (Versión 1)

Almacenes de Objetos (Object Stores):
1. **`borrador`**:
   * Clave única: `'activo'`.
   * Contiene la factura en proceso actualmente.
2. **`historial_facturas`**:
   * Clave primaria (`keyPath`): `'id'`.
   * Índices: `'fechaEmision'`, `'proveedor'`, `'numeroFactura'`, `'timestampGuardado'`.
3. **`diccionario_productos`**:
   * Clave primaria: `'codigoBarras'`.
   * Índices: `'nombre'`, `'ultimoCosto'`, `'timestampActualizado'`.
4. **`configuracion_reglas`**:
   * Clave única: `'reglas_activas'`.

---

## 2. Estrategia de Migración Transparente (Fallback Híbrido)

Para no perder datos de usuarios existentes:
1. Al arrancar, el servicio verifica si `localStorage` contiene claves previas (`farmacia_diccionario_codigos_v1`, `farmacia_historial_7dias`).
2. Si existen y la base de `IndexedDB` está vacía, se ejecuta una migración atómica en segundo plano.
3. Se mantiene una interfaz unificada basada en promesas:
   * `obtenerDiccionario()` $\to$ `Promise<Object>`
   * `guardarProductoEnDiccionario(producto)` $\to$ `Promise<Boolean>`
   * `obtenerHistorialFacturas()` $\to$ `Promise<Array>`

---

## 3. Ciclo de Vida del Service Worker (`sw.js`)

Al modificar archivos de interfaz, estilos o scripts:
1. **Incrementar la versión de caché** en `sw.js`:
   ```javascript
   const CACHE_NAME = 'farmacia-cache-v11'; // Incrementar v10 -> v11
   ```
2. **Verificar la lista de precaché**:
   Asegurarse de que todos los archivos estáticos requeridos estén listados en `ARCHIVOS_A_CACHEAR`.
3. **Evento Activate**:
   Garantiza que las versiones viejas de caché se purguen inmediatamente con `caches.delete(key)`.

---

## 4. Auditoría de Respaldo JSON

Los respaldos manuales descargables deben cumplir con la versión de esquema:
* Versión de esquema actual: `CONSTANTES.VERSION_ESQUEMA_RESPALDO = 2`.
* Se debe validar siempre la cabecera del archivo JSON antes de sobreescribir la memoria local:
  ```json
  {
    "tipo": "respaldo-farmacia-facturas" | "respaldo-farmacia-diccionario",
    "version": 2,
    "fechaExportacion": "ISO-STRING",
    "datos": { ... }
  }
  ```
