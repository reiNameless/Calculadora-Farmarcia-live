(function (global) {
    'use strict';

    const AppFarmacia = global.AppFarmacia || (global.AppFarmacia = {});

    async function analizarImagenFactura() {
        throw new Error('El lector en la nube con IA fue deshabilitado por política de confidencialidad y protección de secretos comerciales.');
    }

    AppFarmacia.ServicioIA = Object.freeze({
        analizarImagenFactura
    });
})(window);
