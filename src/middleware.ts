import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { puedeAbrir, permisosDeSesion, tieneAlguno } from '@/lib/permisos'
import { claseDeAccion } from '@/lib/permisos-acciones'
import { claseDeApi, METODOS_DE_ESCRITURA } from '@/lib/permisos-api'
import { esVista, alcanceCubre, enlaceAbre, COOKIE_PANTALLA, PARAM_PANTALLA, type ClaveVista } from '@/lib/monitor/vistas'
import { accionPermitidaSinSesion, nombreDeAccion } from '@/lib/acciones-publicas'
import { firmaDeMedioValida, PARAM_FIRMA } from '@/lib/firma-medios'

/**
 * Lo único de go2rtc que pide un navegador: el vivo en MP4 (las 23 llamadas del cliente) y,
 * para Safari, el mismo vivo en HLS (ver GO2RTC_HLS). Todo lo demás de su API (listar streams con sus claves, leer y escribir la
 * configuración, sacar cuadros, reiniciarlo) lo usa el servidor por 127.0.0.1:1984, nunca a
 * través de acá. Si un reproductor nuevo necesita otro camino, se agrega acá con su porqué.
 * El vivo sigue sin pedir sesión: lo usan las páginas /pwa de los equipos de la garita, que no
 * tienen sesión del panel. Pedirla es el paso siguiente, cuando esas páginas tengan la suya.
 */
const GO2RTC_REPRODUCIR = ['/api/stream.mp4', '/api/stream.m3u8']
/**
 * HLS (stream.m3u8) es lo que reproduce un iPhone: Safari no abre el MP4 continuo de go2rtc
 * (15/10, la pared en el celular de Nico quedó toda en fotos). El primer pedido trae `src`; los
 * que siguen (lista, encabezado y segmentos) traen el `id` de sesión que armó go2rtc.
 */
const GO2RTC_HLS = ['/api/hls/playlist.m3u8', '/api/hls/init.mp4', '/api/hls/segment.m4s', '/api/hls/segment.ts']
const GO2RTC_ID_HLS = /^[A-Za-z0-9]{1,40}$/
/**
 * `src` tiene que ser el NOMBRE de un stream ya dado de alta (lpr_<id>, face_<id>…). go2rtc
 * también acepta ahí una URL y arma un stream nuevo con ella: sin esto, el vivo público servía
 * para hacerle abrir al servidor cualquier origen, incluidos los que ejecutan comandos.
 */
const GO2RTC_NOMBRE_STREAM = /^[A-Za-z0-9_-]{1,120}$/

/**
 * Lo único que una pantalla puede pedir con POST: rutas que no guardan ni cambian nada y usan
 * POST porque mandan una imagen. Hoy, las siluetas de la grabación: la pantalla le pasa al
 * servidor el cuadro que está mostrando y recibe lo que vio OmniVision (15/10, pared de cámaras).
 */
const PANTALLA_POST_DE_LECTURA = ['/api/monitor/camaras/siluetas']

/** Los caminos de medios: pasan con credencial, pedido interno o firma (ver más abajo). */
const MEDIOS = ['/api/files/', '/api/snapshot/', '/api/nvr/', '/api/clip/']
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

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
 * (ver lib/acciones-publicas). Sin sesión, sólo lo de la lista. Va antes que todo lo demás
 * porque no depende de la ruta.
 *
 * Con sesión del panel (23/10, openspec roles-y-permisos) la acción pide su permiso
 * (lib/permisos-acciones): antes pasaba todo, y un rol con sólo «Monitor» podía invocar
 * `restoreBackup`. Una acción que no está en la tabla no corre.
 */
const soloAvisar = () => process.env.OMNI_PERMISOS_SOLO_AVISAR === '1'
/** El payload de la sesión del panel, o null. */
async function sesionDelPanel(request: NextRequest): Promise<Record<string, unknown> | null> {
    const t = request.cookies.get('session')?.value
    if (!t || !key) return null
    try { return (await jwtVerify(t, key, { algorithms: ['HS256'] })).payload as Record<string, unknown> } catch { return null }
}
/** El rechazo por permiso (o null en modo «sólo avisar»), con su línea en el registro. */
function porPermiso(s: Record<string, unknown>, que: string, claves: readonly string[] | null): NextResponse | null {
    const avisar = soloAvisar()
    console.warn(`[permisos] ${avisar ? 'habría rechazado' : 'rechazado'}: ${s.name || s.sub || '?'} (${s.rolApp || s.role || 'sin rol'}) ${que} sin ${claves ? claves.join('|') : 'clasificar'}`)
    if (avisar) return null
    return NextResponse.json({ ok: false, error: claves ? 'Tu rol no tiene permiso para esto.' : 'Esta acción no está habilitada para ningún rol.', permiso: claves }, { status: 403 })
}
async function puertaDeAcciones(request: NextRequest): Promise<NextResponse | null> {
    const id = request.headers.get('next-action')
    if (!id || request.method !== 'POST') return null
    const s = await sesionDelPanel(request)
    if (s) {
        const nombre = nombreDeAccion(id)
        // Sin el manifiesto no se sabe qué acción es: se deja pasar como antes y queda en el registro.
        if (!nombre) { console.warn(`[permisos] acción sin nombre (id desconocido) en ${request.nextUrl.pathname}`); return null }
        const clase = claseDeAccion(nombre)
        if (clase === 'sesion' || clase === 'secreto') return null
        if (!clase) return porPermiso(s, nombre, null)
        return tieneAlguno(permisosDeSesion(s as any), clase) ? null : porPermiso(s, nombre, clase)
    }
    const guardia = await firmaValida(request.cookies.get('guardia')?.value, 'guardia')
    const { ok, nombre } = accionPermitidaSinSesion(id, guardia)
    if (ok) return null
    console.warn(`[acciones] rechazada sin sesión: ${nombre || 'id desconocido'} en ${request.nextUrl.pathname}${guardia ? ' (guardia identificado)' : ''}`)
    return NextResponse.json({ error: 'Esta acción necesita una sesión del panel' }, { status: 403 })
}

/**
 * La API que cambia algo, con sesión del panel (23/10, openspec roles-y-permisos): pide su permiso
 * (lib/permisos-api). Antes alcanzaba la sesión. Va arriba de todo porque algunas rutas salen antes
 * (las de medios, las públicas); las que tienen su propia regla están marcadas `propio`. Sin sesión
 * del panel no hace nada: siguen las reglas de cada ruta (token del equipo, enlace de pantalla).
 */
async function puertaDeApi(request: NextRequest): Promise<NextResponse | null> {
    const { pathname } = request.nextUrl
    if (!pathname.startsWith('/api/') || !METODOS_DE_ESCRITURA.has(request.method)) return null
    const s = await sesionDelPanel(request)
    if (!s) return null
    const clase = claseDeApi(pathname)
    if (clase === 'propio' || clase === 'sesion') return null
    if (!clase) return porPermiso(s, `${request.method} ${pathname}`, null)
    return tieneAlguno(permisosDeSesion(s as any), clase) ? null : porPermiso(s, `${request.method} ${pathname}`, clase)
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    const rechazo = (await puertaDeAcciones(request)) || (await puertaDeApi(request))
    if (rechazo) return rechazo

    // --- go2rtc: sólo lo que reproduce, nada de su administración ---
    // Por qué (15/10, medido desde internet sin sesión): /go2rtc/ se reenviaba entero a la API
    // de go2rtc. `GET /go2rtc/api/streams` devolvía las 32 URL RTSP con usuario y clave de cada
    // cámara y NVR, y la misma API acepta escribir la configuración y agregar orígenes `exec:`
    // (un comando en el servidor). `/go2rtc/api/config` daba el go2rtc.yaml entero. La aplicación
    // sólo usa la reproducción (ver GO2RTC_REPRODUCIR).
    // `/go2rtc` a secas también cae en la reescritura (`:path*` acepta cero tramos): es la
    // página de administración de go2rtc, con su editor de configuración.
    if (pathname === '/go2rtc' || pathname.startsWith('/go2rtc/')) {
        const sub = pathname.slice('/go2rtc'.length)
        const lee = request.method === 'GET' || request.method === 'HEAD'
        const q = request.nextUrl.searchParams
        if (lee && GO2RTC_HLS.includes(sub) && GO2RTC_ID_HLS.test(q.get('id') || '') && !q.has('src') && !q.has('name')) return NextResponse.next()
        const src = request.nextUrl.searchParams.getAll('src')
        const pide = (request.method === 'GET' || request.method === 'HEAD') && GO2RTC_REPRODUCIR.includes(sub)
        if (pide && src.length === 1 && GO2RTC_NOMBRE_STREAM.test(src[0]) && !request.nextUrl.searchParams.has('name')) return NextResponse.next()
        return new NextResponse('No disponible', { status: 403 })
    }

    // --- ALWAYS PUBLIC (no auth needed) ---
    if (
        pathname.startsWith('/_next') ||
        pathname === '/favicon.ico' ||
        pathname.startsWith('/branding') ||
        pathname.startsWith('/guards') ||
        pathname.startsWith('/sounds') ||
        pathname.startsWith('/io/') ||
        pathname === '/login' ||
        pathname === '/guard' ||
        pathname.startsWith('/guard-iphone') ||
        pathname.startsWith('/pwa') ||
        pathname.startsWith('/invitado') ||
        pathname.startsWith('/residente')
    ) {
        return NextResponse.next()
    }

    // --- MEDIOS: fotos, clips y grabaciones ---
    // Eran públicos (cualquiera con un enlace veía las capturas y pedía grabaciones al NVR). Ahora
    // pasan con sesión, guardia o pantalla identificados, un pedido interno (los procesos del
    // propio servidor y los contenedores del equipo hablan directo al puerto, sin el proxy) o un
    // enlace FIRMADO (lo que se manda afuera: Telegram, correo; ver lib/firma-medios).
    // MEDIOS_PUBLICOS=1 vuelve a lo de antes, por si algo de afuera que no se previó deja de andar.
    if (MEDIOS.some((m) => pathname.startsWith(m))) {
        if (process.env.MEDIOS_PUBLICOS === '1') return NextResponse.next()
        // Interno = del propio equipo. Next agrega x-forwarded-for con la dirección del socket aunque
        // el pedido no lo traiga (medido el 18/10: un curl a 127.0.0.1 llegó con el encabezado), así
        // que «sin encabezado» no sirve: se mira que sea UNA sola dirección y de loopback. Por el
        // proxy llega «cliente[, …]» y además X-Real-IP; un x-forwarded-for falso que mande alguien
        // de afuera queda adelante de su IP real («127.0.0.1, 1.2.3.4») y no pasa.
        const xff = (request.headers.get('x-forwarded-for') || '').trim()
        const interno = !request.headers.get('x-real-ip') && (!xff || LOOPBACK.has(xff))
        if (interno || firmaDeMedioValida(pathname, request.nextUrl.searchParams.get(PARAM_FIRMA))) return NextResponse.next()
        if (await firmaValida(request.cookies.get('session')?.value)) return NextResponse.next()
        if (await firmaValida(request.cookies.get('guardia')?.value, 'guardia')) return NextResponse.next()
        if (await firmaValida(request.cookies.get(COOKIE_PANTALLA)?.value, 'pantalla')) return NextResponse.next()
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // --- PUBLIC API ROUTES (webhooks, external integrations) ---
    if (
        pathname === '/api/health' ||
        // La versión y si la sesión sigue: la pregunta una pantalla que puede tener la sesión vencida.
        pathname === '/api/version' ||
        pathname.startsWith('/api/apk') ||
        pathname.startsWith('/api/webhooks/') ||
        pathname.startsWith('/api/devices/health/tick') ||
        pathname === '/api/subscribe' ||
        pathname.startsWith('/api/push/dispatch') ||
        // /api/events NO va aca: estaba en la lista publica y devolvia, sin sesion y a
        // quien preguntara, el historial de accesos de cualquier matricula. Ahora exige
        // sesion como el resto de la aplicacion.
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
                    if (request.method !== 'GET' && request.method !== 'HEAD' && !(request.method === 'POST' && PANTALLA_POST_DE_LECTURA.includes(pathname))) {
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

