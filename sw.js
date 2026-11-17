// Service worker: permite instalar la app y abrirla sin conexión, sin meterse en el resto de WordPress.
//
// · La página de la app (la raíz del ámbito, sin parámetros): red primero, siempre la versión publicada,
//   y una copia para abrirla sin conexión.
// · Código y estilos con huella en el nombre (…/assets/…): caché primero; esos archivos nunca cambian.
// · Fotos y fuentes: caché primero y se renuevan en segundo plano.
// · Todo lo demás (API, wp-admin, wp-login, otras páginas…) va directo a la red: nunca se guarda una
//   respuesta de la API ni una página de administración.
const CACHE = 'can-panxa-roja-v3';
const SHELL = new URL(self.registration.scope);
const PRIVATE = /\/(wp-json|wp-admin|wp-login\.php|xmlrpc\.php)(\/|$)|admin-ajax\.php/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL.href).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const save = (request, res) => {
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return res;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PRIVATE.test(url.pathname)) return;

  // La app: red primero; sin conexión, la última copia.
  if (request.mode === 'navigate') {
    if (url.pathname !== SHELL.pathname || url.search) return;
    event.respondWith(
      fetch(request)
        .then((res) => save(SHELL.href, res))
        .catch(() => caches.match(SHELL.href).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Código y estilos con huella: no cambian nunca.
  if (url.pathname.includes('/assets/') && !url.search) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => save(request, res))));
    return;
  }

  // Fotos y fuentes: al instante desde la caché y se renuevan en segundo plano.
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then((hit) => {
        const fresh = fetch(request)
          .then((res) => save(request, res))
          .catch(() => hit || Response.error());
        if (hit) event.waitUntil(fresh.catch(() => {}));
        return hit || fresh;
      }),
    );
  }
});

// Avisos del pedido: el servidor manda {title, body, url, tag, lang, icon, badge} cifrado.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Ca’n Panxa Roja', {
      body: data.body || '',
      icon: data.icon,
      badge: data.badge,
      lang: data.lang === 'ca' ? 'ca-ES' : 'es-ES',
      tag: data.tag || 'pedido', // el aviso nuevo de un pedido sustituye al anterior
      renotify: true,
      data: { url: data.url || '/pedidos' },
    }),
  );
});

// Al tocar el aviso: si la app está abierta, se trae al frente y abre el pedido; si no, se abre ahí.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.url || '/pedidos';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).pathname === SHELL.pathname) || wins[0];
      if (win) {
        win.postMessage({ abrir: route });
        return win.focus();
      }
      return self.clients.openWindow(`${SHELL.href}#${route}`);
    }),
  );
});
