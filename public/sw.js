self.addEventListener('push', function (event) {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: data.icon || '/iconos/filas-512.png',
            badge: data.badge || '/iconos/filas-192.png',
            vibrate: data.vibrate || [100, 50, 100],
            data: {
                dateOfArrival: Date.now(),
                primaryKey: '2',
                url: data.url || '/'
            },
            requireInteraction: true, // Keep notification visible until user interacts
            actions: [
                { action: 'open', title: 'Abrir Consola' }
            ]
        };

        // Badging API
        if ('setAppBadge' in navigator) {
            navigator.setAppBadge(1).catch(error => {
                console.log('Badge error', error);
            });
        }

        // Play sound inside service worker is tricky on some browsers, 
        // relying on system notification sound is often better.
        // However, we can use the 'silent' option false (default).

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', function (event) {
    console.log('Notification click received.');
    event.notification.close();
    if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge();
    }

    // Open the app/url
    const targetUrl = event.notification.data?.url || '/guard';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // Check if already on targetUrl, or just switch to existing tab
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (urlMatches(client.url, targetUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

function urlMatches(clientUrl, targetPath) {
    if (!clientUrl) return false;
    try {
        const u = new URL(clientUrl);
        return u.pathname.includes(targetPath.substring(1)); // 'guard' inside pathname?
    } catch (e) { return false; }
}
