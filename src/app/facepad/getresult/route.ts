import { NextResponse } from 'next/server';

/**
 * Endpoint silencioso para healthchecks internos
 * Responde rápidamente sin logging detallado
 */
export async function POST() {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
}

export async function GET() {
    return NextResponse.json({
        endpoint: '/facepad/getresult',
        status: 'active',
        note: 'Internal healthcheck endpoint'
    });
}
