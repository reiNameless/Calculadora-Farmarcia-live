---
name: rd-pharmacy-audit
description: >-
  Audits and verifies pharmacy invoice reconciliations, fiscal cost calculations (8 decimal places),
  pricing strategies (cascade, direct cost margin, gross financial margin), line discounts, and Dominican
  Republic ITBIS and NCF rules. Use when modifying financial math, adding pricing formulas, debugging invoice
  imbalances, or validating invoice calculation suites.
---

# Auditoría Fiscal y Cuadre de Facturas de Droguería (República Dominicana)

Esta habilidad contiene los procedimientos, fórmulas y casos de prueba para auditar el motor de cálculo fiscal de la calculadora de farmacia.

---

## 1. Estrategias de Precios de Venta

La aplicación implementa el patrón **Strategy** en `Dominio.calcularDesglosePrecios`:

### A. Cascada con Descuento (`CASCADA_DESCUENTO` - Por Defecto)
* **P1 (Precio Mostrador)**: `Costo Unitario × (1 + f1)`. (Por defecto: +30%).
* **P2 (Precio Clientes / Mayoristas)**: `P1 × (1 - f2)`. (Por defecto: -5% sobre P1).
* **P3 (Precio Mínimo / Especial)**: `P2 × (1 - f3)`. (Por defecto: -5% sobre P2).
* *Excepción Leches*: Si `esLeche === true`, `f1` se fuerza a `0.10` (+10% ganancia directa), ignorando el margen normal.

### B. Margen Directo sobre Costo (`MARGEN_DIRECTO_COSTO`)
* **P1**: `Costo Unitario × (1 + f1)` (+30%).
* **P2**: `Costo Unitario × (1 + f2)` (+25%).
* **P3**: `Costo Unitario × (1 + f3)` (+20%).

### C. Margen Bruto Financiero (`MARGEN_BRUTO_FINANCIERO`)
* **P1**: `Costo Unitario / (1 - f1)`. (Margen sobre venta real, divisor con guarda mínima de 0.01).
* **P2**: `P1 × (1 - f2)`.
* **P3**: `P2 × (1 - f3)`.

---

## 2. Reglas de Descuento de Droguerías

Los proveedores aplican descuentos de dos formas:
1. **Por Monto Global de la Línea ($)**: El descuento se divide entre las cajas compradas (`descuentoPorCaja = descuentoValor / cajas`).
2. **Por Porcentaje Unitario (%)**: El descuento se calcula por caja: `descuentoPorCaja = precioCajaBase × (descuentoValor / 100)`.

* **Regla Crítica de Farmacia**: El descuento de droguería reduce el **costo fiscal de compra**, pero los precios de mostrador (P1, P2, P3) se calculan sobre la base real de compra sin descuento para retener el beneficio comercial.

---

## 3. Tolerancia de Cuadre de Factura

* **Suma de Líneas**: `sumaAcumulada = ∑ subtotalFactura`.
* **Diferencia con Factura Papel**: `diferencia = round(sumaAcumulada - totalFisico, 2)`.
* **Semáforo Visual**:
  * **Verde (Cuadrada)**: `Math.abs(diferencia) <= 0.05`.
  * **Amarillo (Discrepancia Leve de Centavos)**: `0.05 < Math.abs(diferencia) <= 2.00`.
  * **Rojo (Descuadre Crítico)**: `Math.abs(diferencia) > 2.00`.

---

## 4. Ejecución Rápida de Pruebas de Auditoría

Para verificar la integridad matemática tras cualquier cambio en `dominio.js`:

```powershell
node -e "
const fs = require('fs');
const vm = require('vm');
const sandbox = { window: {}, console, Intl, setTimeout, clearTimeout };
sandbox.window = sandbox;
['js/configuracion.js', 'js/dominio.js', 'js/pruebas.js'].forEach(f => vm.runInNewContext(fs.readFileSync(f, 'utf8'), sandbox));
sandbox.AppFarmacia.ejecutarSuitePruebas();
"
```
