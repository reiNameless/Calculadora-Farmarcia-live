(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia;
    const UI = AppFarmacia.UI || (AppFarmacia.UI = {});
    const { CONSTANTES } = AppFarmacia.Configuracion;
    const Dominio = AppFarmacia.Dominio;
    const Almacenamiento = AppFarmacia.Almacenamiento;

    const el = id => document.getElementById(id);
    const escaparHtml = texto => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const iconoSvg = nombre => `<svg class="ico" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

    function renderizarDiccionarioUI() {
        const contenedor = el('contenedorDiccionario');
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        const codigos = Object.keys(diccionario);

        if (!codigos.length) {
            contenedor.innerHTML = `<div class="text-center p-18 text-muted">Aún no hay códigos de barra memorizados. Escanea un producto en la calculadora y agrégalo para aprenderlo.</div>`;
            return;
        }

        contenedor.innerHTML = `
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Código de Barras</th>
                            <th>Producto Memorizado</th>
                            <th>Categoría</th>
                            <th>Unidades/Caja</th>
                            <th>Último Costo Caja</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${codigos.map(cod => {
                            const item = diccionario[cod];
                            const codEscapado = escaparHtml(cod);
                            return `<tr>
                                <td class="mono">${escaparHtml(item.codigoBarras)}</td>
                                <td><strong>${escaparHtml(item.nombre)}</strong></td>
                                <td>${item.tipo === CONSTANTES.CATEGORIAS.DIVISIBLE ? 'Se divide' : 'Se vende entero'}</td>
                                <td class="mono">${item.unidadesPorCaja}</td>
                                <td class="mono">$${Number(item.ultimoPrecioCaja || 0).toFixed(2)}</td>
                                <td>
                                    <button type="button" class="action-icon-btn" data-usar-codigo="${codEscapado}" aria-label="Cargar ${escaparHtml(item.nombre)} en calculadora">Cargar en Calculadora</button>
                                    <button type="button" class="action-icon-btn text-danger" data-borrar-codigo="${codEscapado}" aria-label="Eliminar código ${codEscapado}">${iconoSvg('trash')}</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function descargarDiccionarioJson() {
        const diccionario = Almacenamiento.obtenerDiccionarioCodigos();
        if (Object.keys(diccionario).length === 0) {
            return UI.Notificaciones.mostrarMensaje('El diccionario de códigos está vacío. No hay datos para descargar.', 'error');
        }
        Almacenamiento.descargarObjetoComoJson({
            tipo: CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS,
            version: CONSTANTES.VERSION_ESQUEMA_RESPALDO,
            fecha: new Date().toISOString(),
            diccionario
        }, `diccionario-codigos-farmacia-${Dominio.obtenerFechaLocalISO()}.json`);
    }

    async function restaurarDiccionarioJson(inputArchivo) {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
        if (!archivo) return;

        try {
            const datos = await Almacenamiento.leerArchivoJsonSubido(archivo);
            if (datos.tipo !== CONSTANTES.TIPO_ARCHIVO_DICCIONARIO_CODIGOS || !datos.diccionario || typeof datos.diccionario !== 'object') {
                throw new Error('Ese archivo no es un respaldo válido del diccionario de códigos.');
            }
            const actual = Almacenamiento.obtenerDiccionarioCodigos();
            let agregados = 0;
            Object.entries(datos.diccionario).forEach(([cod, info]) => {
                const codigoLimpio = Dominio.normalizarCodigoBarras(cod);
                if (codigoLimpio && info && info.nombre) {
                    actual[codigoLimpio] = {
                        codigoBarras: codigoLimpio,
                        nombre: String(info.nombre).trim(),
                        tipo: info.tipo === CONSTANTES.CATEGORIAS.ENTERO ? CONSTANTES.CATEGORIAS.ENTERO : CONSTANTES.CATEGORIAS.DIVISIBLE,
                        unidadesPorCaja: info.tipo === CONSTANTES.CATEGORIAS.ENTERO ? 1 : (Number(info.unidadesPorCaja) || 1),
                        ultimoPrecioCaja: Number(info.ultimoPrecioCaja) || 0,
                        aplicaItbis: Boolean(info.aplicaItbis),
                        actualizadoEn: info.actualizadoEn || new Date().toISOString()
                    };
                    agregados++;
                }
            });
            Almacenamiento.guardarDiccionarioCodigos(actual);
            renderizarDiccionarioUI();
            UI.Factura.actualizarBarraSuperior();
            UI.Notificaciones.mostrarMensaje(`Diccionario actualizado: ${agregados} códigos importados correctamente.`, 'success');
        } catch (error) {
            UI.Notificaciones.mostrarMensaje(error.message, 'error');
        }
    }

    function inicializarEventosDiccionario() {
        el('btnDescargarDiccionario').addEventListener('click', descargarDiccionarioJson);
        el('inputRestaurarDiccionario').addEventListener('change', e => restaurarDiccionarioJson(e.target));
        el('contenedorDiccionario').addEventListener('click', async e => {
            const btnUsar = e.target.closest('[data-usar-codigo]');
            if (btnUsar) {
                el('calcCodigoBarras').value = btnUsar.dataset.usarCodigo;
                UI.Calculadora.procesarEscaneoCodigoBarras();
                el('seccionCalculadora').scrollIntoView({ behavior: 'smooth' });
                return;
            }
            const btnBorrar = e.target.closest('[data-borrar-codigo]');
            if (btnBorrar) {
                const confirmarBorrado = await UI.Notificaciones.mostrarConfirmacion('¿Eliminar este código y su nombre memorizado del diccionario?', 'Eliminar Código');
                if (confirmarBorrado) {
                    Almacenamiento.eliminarCodigoDeDiccionario(btnBorrar.dataset.borrarCodigo);
                    renderizarDiccionarioUI();
                    UI.Factura.actualizarBarraSuperior();
                }
            }
        });
    }

    UI.Diccionario = Object.freeze({
        renderizarDiccionarioUI,
        descargarDiccionarioJson,
        restaurarDiccionarioJson,
        inicializarEventosDiccionario
    });
})(window);
