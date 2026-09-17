'use server'

import { cookies } from 'next/headers'
import { pantallaInicio } from '@/lib/landing'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'

// JWT_SECRET MUST come from environment - no hardcoded fallback
const secretKey = process.env.JWT_SECRET
if (!secretKey) {
    console.error('FATAL: JWT_SECRET environment variable is not set!')
}
const key = secretKey ? new TextEncoder().encode(secretKey) : new TextEncoder().encode('MISSING-KEY-DO-NOT-USE')

// ---- Rate Limiting (in-memory, per-IP) ----
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000  // 15 minutes
const LOCK_MS = 15 * 60 * 1000    // 15 minute lockout

function checkRateLimit(identifier: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const record = loginAttempts.get(identifier)

    if (!record) {
        loginAttempts.set(identifier, { count: 1, lastAttempt: now, lockedUntil: 0 })
        return { allowed: true }
    }

    // Check if locked out
    if (record.lockedUntil > now) {
        return { allowed: false, retryAfterMs: record.lockedUntil - now }
    }

    // Reset if window expired
    if (now - record.lastAttempt > WINDOW_MS) {
        loginAttempts.set(identifier, { count: 1, lastAttempt: now, lockedUntil: 0 })
        return { allowed: true }
    }

    record.count++
    record.lastAttempt = now

    if (record.count > MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCK_MS
        return { allowed: false, retryAfterMs: LOCK_MS }
    }

    return { allowed: true }
}

function resetRateLimit(identifier: string) {
    loginAttempts.delete(identifier)
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
    const now = Date.now()
    for (const [key, record] of loginAttempts) {
        if (now - record.lastAttempt > WINDOW_MS * 2) {
            loginAttempts.delete(key)
        }
    }
}, 30 * 60 * 1000)

export async function login(formData: FormData) {
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    // Rate limit by username
    const rateCheck = checkRateLimit(username.toLowerCase())
    if (!rateCheck.allowed) {
        const minutes = Math.ceil((rateCheck.retryAfterMs || 0) / 60000)
        return { error: `Demasiados intentos. Intente de nuevo en ${minutes} minutos.` }
    }

    // OA-LOGIN-ROL-CLARO: se busca por nombre sin filtrar rol; el rol se
    // controla más abajo, DESPUÉS de validar la clave, para no revelar qué cuentas
    // existen a quien no sabe la contraseña.
    const user = await prisma.user.findFirst({
        where: {
            name: username
        },
        include: {
            credentials: true
        }
    })

    if (!user) {
        return { error: 'Usuario o contraseña incorrectos' }
    }

    const passwordCred = user.credentials.find(c => c.type === 'PASSWORD' || c.type === 'PIN')
    if (!passwordCred) {
        return { error: 'Usuario o contraseña incorrectos' }
    }

    // Support both hashed and legacy plain-text passwords
    let passwordValid = false
    if (passwordCred.value.startsWith('$2a$') || passwordCred.value.startsWith('$2b$')) {
        // Already hashed with bcrypt
        passwordValid = await bcrypt.compare(password, passwordCred.value)
    } else {
        // Legacy plain-text - compare and migrate
        passwordValid = (passwordCred.value === password)
        if (passwordValid) {
            // Auto-migrate to bcrypt hash
            const hashed = await bcrypt.hash(password, 12)
            await prisma.credential.update({
                where: { id: passwordCred.id },
                data: { value: hashed }
            })
        }
    }

    if (!passwordValid) {
        return { error: 'Usuario o contraseña incorrectos' }
    }

    // Success - reset rate limit
    resetRateLimit(username.toLowerCase())

    // OA-LOGIN-ROL-CLARO: clave correcta, pero sólo ADMIN entra al panel.
    // Las cuentas de guardia (STAFF) usan la consola /guard, no este login.
    if (user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
        return { error: 'Esta cuenta no tiene acceso al panel de administración. Las cuentas de guardia ingresan por la consola (/guard).' }
    }

    if (!secretKey) {
        return { error: 'Error de configuración del servidor. Contacte al administrador.' }
    }

    const expiresCtx = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(key)

    const cookieStore = await cookies()
    cookieStore.set('session', token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        expires: expiresCtx,
        sameSite: 'lax',
        path: '/'
    })

    // Entrar directo al monitor del modo activo: es la pantalla de trabajo real,
    // y la misma que abre "Monitor en Vivo" en el menú.
    const modos = await prisma.setting.findMany({ where: { key: { in: ['MODULE_QUEUE', 'MODULE_FACE', 'MODULE_LPR'] } } })
    const activo = (k: string) => modos.find(m => m.key === k)?.value === 'true'
    redirect(pantallaInicio({ MODULE_QUEUE: activo('MODULE_QUEUE'), MODULE_FACE: activo('MODULE_FACE'), MODULE_LPR: activo('MODULE_LPR') }))
}

export async function resetPassword(formData: FormData) {
    const email = formData.get('email') as string
    return { success: 'Se han enviado las instrucciones a su correo' }
}

export async function logout() {
    const cookieStore = await cookies()
    cookieStore.set('session', '', { expires: new Date(0) })
    return { success: true }
}

export async function getSession() {
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value
    if (!session) return null
    if (!secretKey) return null
    try {
        const { payload } = await jwtVerify(session, key, {
            algorithms: ['HS256'],
        })
        return payload
    } catch (error) {
        return null
    }
}
