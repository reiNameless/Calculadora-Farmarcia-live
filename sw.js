// Service Worker para Calculadora de Farmacia PWA (CAL-03)
const CACHE_NAME = 'farmacia-pwa-v49';

const ARCHIVOS_ESTATICOS = [
    './',
    './index.html',
    './manifest.json',
    './catalogo_rd_inicial.json',
    './css/estilos.css',
    './js/zxing.min.js',
    './js/configuracion.js',
    './js/dominio.js',
    './js/almacenamiento.js',
    './js/servicio-ia.js',
    './js/servicio-catalogo.js',
    './js/ui-notificaciones.js',
    './js/ui-calculadora.js',
    './js/ui-factura.js',
    './js/ui-diccionario.js',
    './js/ui-historial.js',
    './js/interfaz.js',
    './js/pruebas.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg'
];

// Instalación: Precarga todos los recursos en caché
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[Service Worker] Precargando recursos para uso offline...');
            return cache.addAll(ARCHIVOS_ESTATICOS);
        }).then(() => self.skipWaiting())
    );
});

// Activación: Limpieza de versiones viejas de caché
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(claves => {
            return Promise.all(
                claves.map(clave => {
                    if (clave !== CACHE_NAME) {
                        console.log('[Service Worker] Eliminando caché obsoleta:', clave);
                        return caches.delete(clave);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Intercepción de peticiones (Cache First para recursos locales, Network Only para IA)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Las peticiones a la API de Google Gemini no se guardan en caché offline
    if (url.hostname.includes('googleapis.com')) {
        return event.respondWith(fetch(event.request));
    }

    event.respondWith(
        caches.match(event.request).then(respuestaCache => {
            if (respuestaCache) {
                // Actualiza en segundo plano para la próxima vez (Stale-While-Revalidate)
                fetch(event.request).then(respuestaRed => {
                    if (respuestaRed && respuestaRed.status === 200) {
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, respuestaRed));
                    }
                }).catch(() => {/* Modo offline silencioso */});
                return respuestaCache;
            }

            return fetch(event.request).then(respuestaRed => {
                if (!respuestaRed || respuestaRed.status !== 200 || respuestaRed.type !== 'basic') {
                    return respuestaRed;
                }
                const clonRespuesta = respuestaRed.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, clonRespuesta);
                });
                return respuestaRed;
            }).catch(() => {
                // Si la red falla y es navegación HTML, entrega index.html de la caché
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
