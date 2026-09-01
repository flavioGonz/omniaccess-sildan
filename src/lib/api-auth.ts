import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { NextResponse } from 'next/server'

const secretKey = process.env.JWT_SECRET
const key = secretKey ? new TextEncoder().encode(secretKey) : null

export interface AuthResult {
    authenticated: boolean
    userId?: string
    role?: string
    name?: string
}

/**
 * Verify JWT session from cookies. Use in API routes that need auth.
 */
export async function verifyApiAuth(): Promise<AuthResult> {
    if (!key) return { authenticated: false }

    try {
        const cookieStore = await cookies()
        const session = cookieStore.get('session')?.value
        if (!session) return { authenticated: false }

        const { payload } = await jwtVerify(session, key, { algorithms: ['HS256'] })
        return {
            authenticated: true,
            userId: payload.sub as string,
            role: payload.role as string,
            name: payload.name as string,
        }
    } catch {
        return { authenticated: false }
    }
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
