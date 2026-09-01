"use client";

import { useEffect } from 'react';

// Utility to convert VAPID key
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
        // Feature check
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return;
        }

        const registerPush = async () => {
            try {
                // 1. Register Service Worker
                const registration = await navigator.serviceWorker.register('/sw.js');

                // 2. Check for existing subscription
                let subscription = await registration.pushManager.getSubscription();

                // 3. If no subscription, create one
                if (!subscription) {
                    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
                    if (!vapidKey) return console.error("No VAPID public key found");

                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(vapidKey)
                    });
                }

                // 4. Send subscription to backend
                await fetch('/api/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription)
                });


            } catch (error) {
                console.error("Push registration error:", error);
            }
        };

        // Delay execution slightly to not block initial render
        const timer = setTimeout(registerPush, 1000);
        return () => clearTimeout(timer);

    }, []);

    return null;
}
