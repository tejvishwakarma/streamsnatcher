// StreamSnatcher Service Worker
const CACHE_NAME = 'streamsnatcher-v3';
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/css/cookie-consent.css',
    '/static/js/app.js',
    '/static/images/logo.png',
    '/static/images/favicon.png',
    '/static/manifest.json'
];

// ==================== STREAMING DOWNLOAD SUPPORT ====================
// Stores active download streams: fileId -> { controller, filename, mimeType, size }
const pendingDownloads = new Map();

self.addEventListener('message', (event) => {
    const { type, fileId, filename, mimeType, size, chunk } = event.data;

    switch (type) {
        case 'INIT_DOWNLOAD': {
            // Create a ReadableStream with an external controller
            let streamController;
            const stream = new ReadableStream({
                start(controller) {
                    streamController = controller;
                }
            });

            pendingDownloads.set(fileId, {
                stream,
                controller: streamController,
                filename: filename || 'download',
                mimeType: mimeType || 'application/octet-stream',
                size: size || 0
            });

            // Acknowledge — client can now open the download URL
            event.source.postMessage({ type: 'DOWNLOAD_READY', fileId });
            break;
        }

        case 'DOWNLOAD_CHUNK': {
            const download = pendingDownloads.get(fileId);
            if (download && download.controller) {
                try {
                    download.controller.enqueue(new Uint8Array(chunk));
                } catch (err) {
                    console.error('SW: Failed to enqueue chunk:', err);
                }
            }
            break;
        }

        case 'DOWNLOAD_DONE': {
            const download = pendingDownloads.get(fileId);
            if (download && download.controller) {
                try {
                    download.controller.close();
                } catch (err) {
                    console.error('SW: Failed to close stream:', err);
                }
                pendingDownloads.delete(fileId);
            }
            break;
        }

        case 'DOWNLOAD_ABORT': {
            const download = pendingDownloads.get(fileId);
            if (download && download.controller) {
                try {
                    download.controller.error(new Error('Transfer cancelled'));
                } catch (err) { /* already closed */ }
                pendingDownloads.delete(fileId);
            }
            break;
        }
    }
});

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // ---- Streaming download intercept ----
    if (url.pathname.startsWith('/sw-download/')) {
        const fileId = url.pathname.replace('/sw-download/', '');
        const download = pendingDownloads.get(fileId);

        if (download) {
            const headers = new Headers({
                'Content-Type': download.mimeType,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(download.filename)}"`,
            });

            // Include Content-Length if known (helps browser show progress)
            if (download.size > 0) {
                headers.set('Content-Length', download.size.toString());
            }

            event.respondWith(new Response(download.stream, { headers }));
        } else {
            event.respondWith(new Response('Download not found', { status: 404 }));
        }
        return;
    }

    // ---- Skip WebSocket and API requests ----
    if (url.pathname.startsWith('/ws/') ||
        url.pathname.startsWith('/api/') ||
        request.method !== 'GET') {
        return;
    }

    // ---- Network first, cache fallback ----
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && url.origin === location.origin) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(request, responseClone));
                }
                return response;
            })
            .catch(() => {
                return caches.match(request)
                    .then((cachedResponse) => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        if (request.mode === 'navigate') {
                            return caches.match('/');
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});
