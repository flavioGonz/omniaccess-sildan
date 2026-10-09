import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { puedeAbrir, permisosDeSesion } from '@/lib/permisos'
import { esVista, alcanceCubre, enlaceAbre, COOKIE_PANTALLA, PARAM_PANTALLA, type ClaveVista } from '@/lib/monitor/vistas'
import { accionPermitidaSinSesion } from '@/lib/acciones-publicas'

const secretKey = process.env.JWT_SECRET
const key = secretKey ? new TextEncoder().encode(secretKey) : null

/** ¿Trae una firma válida con esta forma? Sin la clave del servidor, nada es válido. */
async function firmaValida(token: string | undefined, tipo?: string): Promise<boolean> {
    if (!token || !key) return false
    try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
        return !tipo || payload.tipo === tipo
    } catch { return false }
}

/**
 * Las acciones de servidor viajan como POST a cualquier página que las importe, con el
 * encabezado `Next-Action`. Las páginas públicas (/guard, /login, /residente…) importan
 * módulos enteros de acciones, así que sin esto cualquiera desde internet podía invocar
 * acciones que no revisan quién llama — `deleteAllUsers`, `restoreBackup`, `saveAdmin`
 * (ver lib/acciones-publicas). Con sesión del panel pasa todo, como antes; sin sesión,
 * sólo lo de la lista. Va antes que todo lo demás porque no depende de la ruta.
 */
async function puertaDeAcciones(request: NextRequest): Promise<NextResponse | null> {
    const id = request.headers.get('next-action')
    if (!id || request.method !== 'POST') return null
    if (await firmaValida(request.cookies.get('session')?.value)) return null
    const guardia = await firmaValida(request.cookies.get('guardia')?.value, 'guardia')
    const { ok, nombre } = accionPermitidaSinSesion(id, guardia)
    if (ok) return null
    console.warn(`[acciones] rechazada sin sesión: ${nombre || 'id desconocido'} en ${request.nextUrl.pathname}${guardia ? ' (guardia identificado)' : ''}`)
    return NextResponse.json({ error: 'Esta acción necesita una sesión del panel' }, { status: 403 })
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    const rechazo = await puertaDeAcciones(request)
    if (rechazo) return rechazo

    // --- ALWAYS PUBLIC (no auth needed) ---
    if (
        pathname.startsWith('/_next') ||
        pathname === '/favicon.ico' ||
        pathname.startsWith('/branding') ||
        pathname.startsWith('/guards') ||
        pathname.startsWith('/sounds') ||
        pathname.startsWith('/io/') ||
        pathname.startsWith('/go2rtc/') ||
        pathname === '/login' ||
        pathname === '/guard' ||
        pathname.startsWith('/guard-iphone') ||
        pathname.startsWith('/pwa') ||
        pathname.startsWith('/invitado') ||
        pathname.startsWith('/residente')
    ) {
        return NextResponse.next()
    }

    // --- PUBLIC API ROUTES (webhooks, external integrations) ---
    if (
        pathname === '/api/health' ||
        pathname.startsWith('/api/apk') ||
        pathname.startsWith('/api/webhooks/') ||
        pathname.startsWith('/api/devices/health/tick') ||
        pathname === '/api/subscribe' ||
        pathname.startsWith('/api/push/dispatch') ||
        // /api/events NO va aca: estaba en la lista publica y devolvia, sin sesion y a
        // quien preguntara, el historial de accesos de cualquier matricula. Ahora exige
        // sesion como el resto de la aplicacion.
        pathname.startsWith('/api/files/') ||
        pathname.startsWith('/api/topology/') ||
        pathname === '/api/queue-report' ||
        pathname.startsWith('/api/queue/poll') ||
        pathname.startsWith('/api/queue/vca-config') ||
        pathname.startsWith('/api/chatbot/') ||
        pathname.startsWith('/api/queue/report/send') ||
        pathname.startsWith('/api/queue/reset') ||
        pathname.startsWith('/api/queue/schedule/tick') ||
        pathname.startsWith('/api/queue/report/tick') ||
        pathname.startsWith('/api/onvif/notify') ||
        pathname.startsWith('/api/snapshot/') ||
        pathname.startsWith('/api/tracking/') ||
        // La entrada interna del motor de reglas: server.js (proceso aparte, sin sesión) la
        // llama con x-tracking-token y la ruta lo verifica. Sin esta línea el middleware le
        // contestaba 401 y NINGUNA regla de LPR, Face o intrusión disparaba desde los eventos
        // (server.js ignora el estado de la respuesta, así que fallaba en silencio).
        pathname === '/api/notifications/event' ||
        pathname === '/api/visitas/tick' ||   // cron del CT con x-tracking-token; la ruta lo verifica
        pathname === '/api/vigilancia/bot' ||   // bot de WhatsApp → lista de vigilancia (token propio)
        pathname.startsWith('/api/invitado/') ||   // el QR del pase: lo baja el bot y el invitado
        pathname.startsWith('/api/branding/') ||   // logos subidos (login, QR): los ve quien no inició sesión
        pathname.startsWith('/api/nvr/') ||
        pathname.startsWith('/api/clip/') ||
        pathname.startsWith('/api/min-interior') ||
        pathname.startsWith('/facepad/')
    ) {
        return NextResponse.next()
    }

    // --- MONITORES: las vistas de pantalla y sus APIs aceptan sesión O enlace de pantalla ---
    // El enlace llega una vez como ?pantalla=<token> y se canjea por una cookie firmada en
    // /api/monitor/pantalla/entrar (Node: ahí se mira la base). Acá sólo se verifica la firma
    // y el alcance: qué vista abre y qué APIs puede leer (lib/monitor/vistas).
    if (pathname === '/api/monitor/pantalla/entrar' || pathname.startsWith('/monitor/enlace-invalido')) {
        return NextResponse.next()
    }
    const esApiMonitor = pathname.startsWith('/api/monitor/') || pathname === '/api/system-status'
    if (pathname.startsWith('/monitor') || esApiMonitor) {
        const token = request.nextUrl.searchParams.get(PARAM_PANTALLA)
        if (token && !esApiMonitor) {
            const url = new URL('/api/monitor/pantalla/entrar', request.url)
            url.searchParams.set(PARAM_PANTALLA, token)
            url.searchParams.set('volver', pathname)
            return NextResponse.redirect(url)
        }
        const session = request.cookies.get('session')?.value
        if (session && key) {
            try {
                const { payload } = await jwtVerify(session, key, { algorithms: ['HS256'] })
                const perms = permisosDeSesion(payload as any)
                if (esApiMonitor || puedeAbrir(perms, pathname)) return NextResponse.next()
                if (!esApiMonitor) {
                    const url = new URL('/admin/sin-permiso', request.url); url.searchParams.set('ruta', pathname)
                    return NextResponse.redirect(url)
                }
            } catch { /* sesión vencida: se prueba con el enlace de pantalla */ }
        }
        const cookiePantalla = request.cookies.get(COOKIE_PANTALLA)?.value
        if (cookiePantalla && key) {
            try {
                const { payload } = await jwtVerify(cookiePantalla, key, { algorithms: ['HS256'] })
                const vista = payload.tipo === 'pantalla' && esVista(payload.vista as string) ? (payload.vista as ClaveVista) : null
                if (vista) {
                    // Un enlace de pantalla sólo LEE. Las server actions viajan como POST a la
                    // propia página: sin esta línea, quien tuviera el token podría invocar
                    // cualquier acción del servidor desde /monitor/<vista>.
                    if (request.method !== 'GET' && request.method !== 'HEAD') {
                        return NextResponse.json({ error: 'Un enlace de pantalla sólo puede leer' }, { status: 403 })
                    }
                    if (esApiMonitor) {
                        if (alcanceCubre(vista, pathname)) return NextResponse.next()
                        return NextResponse.json({ error: 'Este enlace de pantalla no abre esta información' }, { status: 403 })
                    }
                    const destino = pathname.split('/')[2] || ''
                    if (destino === '' || enlaceAbre(vista, destino)) return NextResponse.next()
                    return NextResponse.redirect(new URL('/monitor/enlace-invalido?motivo=otra-vista', request.url))
                }
            } catch { /* cookie inválida o vencida */ }
        }
        if (esApiMonitor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        return NextResponse.redirect(new URL('/login?volver=' + encodeURIComponent(pathname), request.url))
    }

    // --- PROTECTED API ROUTES (need session) ---
    if (pathname.startsWith('/api/')) {
        const session = request.cookies.get('session')?.value
        if (!session || !key) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }
        try {
            await jwtVerify(session, key, { algorithms: ['HS256'] })
            return NextResponse.next()
        } catch {
            return NextResponse.json({ error: 'Sesion expirada' }, { status: 401 })
        }
    }

    // --- PROTECTED PAGES (/admin/*) ---
    if (pathname.startsWith('/admin')) {
        const session = request.cookies.get('session')?.value
        if (!session || !key) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        try {
            const { payload } = await jwtVerify(session, key, { algorithms: ['HS256'] })
            // Permisos del rol de aplicación (lib/permisos). Administrador ve todo aunque el
            // token sea de antes de un permiso nuevo; una sesión vieja sin `perms` se trata
            // como antes (OPERATOR lo de operar).
            const perms = permisosDeSesion(payload as any)
            if (pathname !== '/admin/sin-permiso' && !puedeAbrir(perms, pathname)) {
                const url = new URL('/admin/sin-permiso', request.url)
                url.searchParams.set('ruta', pathname)
                return NextResponse.redirect(url)
            }
            return NextResponse.next()
        } catch {
            return NextResponse.redirect(new URL('/login', request.url))
        }
    }

    // Root -> login
    if (pathname === '/') {
        return NextResponse.redirect(new URL('/login', request.url))
    }

    return NextResponse.next()
}


export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
    // Node y no Edge: la puerta de acciones lee el manifiesto de acciones del disco
    // (.next/server/server-reference-manifest.json) para saber qué acción es cada id.
    runtime: 'nodejs',
}

