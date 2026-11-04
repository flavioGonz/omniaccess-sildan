import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const SUBS_FILE = path.join(process.cwd(), 'push_subs.json');

/**
 * La PWA registra acá su suscripción de push (no hay sesión del navegador detrás, así que la ruta
 * es pública). Antes guardaba cualquier JSON tal cual, sin validar ni topear (4/11): endpoint a
 * cualquier host, campos arbitrarios y el archivo podía crecer sin fin. Ahora:
 *   - el endpoint tiene que ser https y de un servicio de push conocido (FCM, Mozilla, Apple, WNS);
 *   - sólo se guardan los campos estándar (endpoint + keys), no lo que venga de más;
 *   - hay un tope: pasado el máximo, se descartan las más viejas.
 */
const MAX_SUBS = Number(process.env.PUSH_MAX_SUBS || 5000);
const HOSTS_PUSH = [
    'fcm.googleapis.com', 'android.googleapis.com',
    'push.services.mozilla.com', 'updates.push.services.mozilla.com',
    'notify.windows.com', 'push.apple.com',
];
function endpointValido(endpoint: unknown): endpoint is string {
    if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
    let u: URL;
    try { u = new URL(endpoint); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    return HOSTS_PUSH.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}

export async function POST(request: Request) {
    try {
        const sub = await request.json();
        if (!sub || !endpointValido(sub.endpoint)) {
            return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
        }
        const keys = sub.keys && typeof sub.keys === 'object'
            ? { p256dh: String(sub.keys.p256dh || '').slice(0, 200), auth: String(sub.keys.auth || '').slice(0, 200) }
            : undefined;

        let subs: any[] = [];
        try { subs = JSON.parse(await fs.readFile(SUBS_FILE, 'utf-8')); } catch { /* no existe: vacío */ }
        if (!Array.isArray(subs)) subs = [];

        const ua = (request.headers.get('user-agent') || '').slice(0, 300);
        const exists = subs.find((s: any) => s.endpoint === sub.endpoint);
        if (!exists) {
            // Guardar sólo lo estándar, nunca `...sub` (no se filtran campos que mande quien llama).
            subs.push({ endpoint: sub.endpoint, keys, ua, createdAt: new Date().toISOString(), enabled: true });
            // Tope: si se pasa, se quedan las más nuevas (las de createdAt mayor).
            if (subs.length > MAX_SUBS) {
                subs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
                subs = subs.slice(0, MAX_SUBS);
            }
            await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2));
        } else if (ua && !exists.ua) {
            exists.ua = ua; await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2));
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[PUSH] Error saving subscription:', error);
        return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
    }
}
