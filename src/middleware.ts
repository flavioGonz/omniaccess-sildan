import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const secretKey = process.env.JWT_SECRET
const key = secretKey ? new TextEncoder().encode(secretKey) : null

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

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
        pathname.startsWith('/pwa')
    ) {
        return NextResponse.next()
    }

    // --- PUBLIC API ROUTES (webhooks, external integrations) ---
    if (
        pathname.startsWith('/api/apk') ||
        pathname.startsWith('/api/webhooks/') ||
        pathname.startsWith('/api/devices/health/tick') ||
        pathname === '/api/subscribe' ||
        pathname.startsWith('/api/push/dispatch') ||
        pathname === '/api/events' ||
        pathname.startsWith('/api/files/') ||
        pathname === '/api/system-status' ||
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
        pathname.startsWith('/api/nvr/') ||
        pathname.startsWith('/api/clip/') ||
        pathname.startsWith('/facepad/')
    ) {
        return NextResponse.next()
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
            await jwtVerify(session, key, { algorithms: ['HS256'] })
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
}

