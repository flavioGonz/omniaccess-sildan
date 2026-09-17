"use client";

import { useEffect } from 'react';

// Convierte la clave VAPID de base64url a Uint8Array
function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function PushNotificationManager() {
    useEffect(() => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

        const registrar = async () => {
            try {
                await navigator.serviceWorker.register('/sw.js');

                // Sin esto el primer arranque falla con
                // "AbortError: Subscription failed - no active Service Worker":
                // register() vuelve antes de que el worker esté activo.
                const registration = await navigator.serviceWorker.ready;

                // No suscribimos si todavía no hay permiso: subscribe() dispararía
                // el cartel del navegador, y en la tablet eso pasaba en el login.
                if (!('Notification' in window) || Notification.permission !== 'granted') return;

                let subscription = await registration.pushManager.getSubscription();

                if (!subscription) {
                    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
                    if (!vapidKey) return console.error("No VAPID public key found");

                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(vapidKey)
                    });
                }

                await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription)
                });
            } catch (error) {
                console.error("Push registration error:", error);
            }
        };

        const timer = setTimeout(registrar, 1000);
        // la consola avisa cuando el guardia concede el permiso
        window.addEventListener('oa-push-listo', registrar);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('oa-push-listo', registrar);
        };
    }, []);

    return null;
}
