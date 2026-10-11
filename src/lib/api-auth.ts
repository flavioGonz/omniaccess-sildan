import { cookies, headers } from 'next/headers'
import { leerCookiePantalla, enlaceVigente } from '@/lib/pantalla-auth'
import { COOKIE_PANTALLA, type ClaveVista } from '@/lib/monitor/vistas'
import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'

const secretKey = process.env.JWT_SECRET
const key = secretKey ? new TextEncoder().encode(secretKey) : null

export interface AuthResult {
    authenticated: boolean
    userId?: string
    role?: string
    name?: string
    /**
     * Presente cuando quien pide no es una persona con sesión sino un enlace de pantalla
     * (un monitor de pared). Es una credencial de SÓLO LECTURA: toda ruta que escriba debe
     * rechazarla (`if (auth.pantalla) return forbiddenResponse()`), y las que leen deben
     * servir únicamente lo que esa vista muestra. `role` viene como "PANTALLA".
     */
    pantalla?: { enlaceId: string; vista: ClaveVista }
}

/**
 * Verify JWT session from cookies. Use in API routes that need auth.
 *
 * Acepta dos credenciales: la sesión del panel (cookie `session`) y, si no la hay, el
 * enlace de pantalla (cookie `pantalla`, ver lib/pantalla-auth). En el segundo caso se
 * reconfirma contra la base que el enlace no fue revocado, para que revocar corte en el
 * próximo pedido aunque la cookie siga en el navegador de la pared.
 */
export async function verifyApiAuth(): Promise<AuthResult> {
    if (!key) return { authenticated: false }

    try {
        const cookieStore = await cookies()
        const session = cookieStore.get('session')?.value
        if (session) {
            const { payload } = await jwtVerify(session, key, { algorithms: ['HS256'] })
            return {
                authenticated: true,
                userId: payload.sub as string,
                role: payload.role as string,
                name: payload.name as string,
            }
        }
        const pantalla = cookieStore.get(COOKIE_PANTALLA)?.value
        if (pantalla) {
            const cred = await leerCookiePantalla(pantalla)
            if (!cred) return { authenticated: false }
            let ip: string | null = null
            try { const h = await headers(); ip = (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim() || null } catch { }
            if (!(await enlaceVigente(cred, ip))) return { authenticated: false }
            return { authenticated: true, role: 'PANTALLA', name: 'Enlace de pantalla', pantalla: cred }
        }
        return { authenticated: false }
    } catch {
        return { authenticated: false }
    }
}

/** 403 para una credencial que existe pero no puede hacer esto (un enlace de pantalla intentando escribir). */
export function forbiddenResponse(motivo = 'Un enlace de pantalla sólo puede leer.') {
    return NextResponse.json({ error: motivo }, { status: 403 })
}

/**
 * Returns a 401 JSON response for unauthorized API requests.
 */
export function unauthorizedResponse() {
    return NextResponse.json(
        { error: 'No autorizado. Inicie sesión.' },
        { status: 401 }
    )
}
