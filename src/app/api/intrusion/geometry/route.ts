import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import {
    equipoDe, escribirRegla, verificarActiva, asegurarNotificacionCenter,
    puntosLinea, puntosZona, OBJETIVO_INTRUSION,
} from "@/lib/isapi-smart-rules";
import type { Linea, Zona } from "@/components/tracking/Calibracion";

export const dynamic = "force-dynamic";

type Geometria = { linea?: Linea | null; zona?: Zona | null };

async function leerDispositivo(id: string) {
    return prisma.device.findUnique({
        where: { id },
        select: {
            id: true, name: true, ip: true, username: true, password: true, authType: true,
            intrusionEnabled: true, intrusionGeometry: true, trackTrigger: true,
        },
    });
}

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const d = await leerDispositivo(req.nextUrl.searchParams.get("deviceId") || "");
    if (!d) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

    let geometria: Geometria = {};
    try { geometria = d.intrusionGeometry ? JSON.parse(d.intrusionGeometry) : {}; } catch { }

    return NextResponse.json({
        habilitada: d.intrusionEnabled === true,
        geometria,
        // Aviso honesto: si esta cámara dispara el seguimiento por su propia regla, no puede
        // además vigilar intrusión con la misma regla de hardware (ver POST).
        chocaConSeguimiento: d.trackTrigger === "camara",
    });
}

export async function POST(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    let body: any = {};
    try { body = await req.json(); } catch { }
    const d = await leerDispositivo(String(body.deviceId || ""));
    if (!d) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

    const habilitar: boolean = body.enabled !== false; // por defecto, activar
    const geo: Geometria = body.geometria || {};
    const linea = geo.linea || null;
    const zona = geo.zona || null;

    // La cámara tiene UNA sola LineDetection/1 y una FieldDetection/1. Si esta cámara ya usa
    // esa regla para disparar el seguimiento (trigger "camara"), intrusión pelearía por el
    // mismo slot y cada evento dispararía dos veces. No lo hacemos en silencio: se avisa.
    if (habilitar && d.trackTrigger === "camara") {
        return NextResponse.json({
            error: "Esta cámara ya usa su regla de detección para el seguimiento por cámara. " +
                "Intrusión y seguimiento por cámara comparten la única regla del hardware: " +
                "cambiá el disparo del seguimiento a 'escena' o desactivá intrusión en esta cámara.",
        }, { status: 409 });
    }

    // Guardamos SIEMPRE la geometría dibujada (no se pierde el trabajo del operador), aunque
    // después falle la escritura a la cámara.
    await prisma.device.update({
        where: { id: d.id },
        data: { intrusionGeometry: JSON.stringify({ linea, zona }) },
    });

    // Apagar: desactivar las reglas y marcar la cámara como no participante.
    if (!habilitar) {
        try {
            await escribirRegla(equipoDe(d), "linea", { activar: false, objetivo: OBJETIVO_INTRUSION });
            await escribirRegla(equipoDe(d), "zona", { activar: false, objetivo: OBJETIVO_INTRUSION });
        } catch (e: any) {
            return NextResponse.json({ error: `La cámara rechazó apagar la regla: ${e?.message || "sin detalle"}` }, { status: 502 });
        }
        await prisma.device.update({ where: { id: d.id }, data: { intrusionEnabled: false } });
        return NextResponse.json({ ok: true, habilitada: false });
    }

    if (!linea && !zona) {
        return NextResponse.json({ error: "Dibujá al menos una línea o una zona antes de activar intrusión." }, { status: 400 });
    }

    // Escribir a la cámara. Si algo falla, NO marcamos como aplicada (requisito del spec).
    try {
        await escribirRegla(equipoDe(d), "linea", linea
            ? { activar: true, puntos: puntosLinea(linea), sentido: linea.sentido, objetivo: OBJETIVO_INTRUSION }
            : { activar: false, objetivo: OBJETIVO_INTRUSION });
        await escribirRegla(equipoDe(d), "zona", zona
            ? { activar: true, puntos: puntosZona(zona), objetivo: OBJETIVO_INTRUSION }
            : { activar: false, objetivo: OBJETIVO_INTRUSION });

        // Releer: el <enabled> del cuerpo miente, así que confirmamos contra la cámara.
        if (linea && !(await verificarActiva(equipoDe(d), "linea"))) {
            throw new Error("la línea no quedó activa al releerla");
        }
        if (zona && !(await verificarActiva(equipoDe(d), "zona"))) {
            throw new Error("la zona no quedó activa al releerla");
        }

        // Que el disparo notifique al server (si el firmware no expone el trigger, no es fatal).
        if (linea) await asegurarNotificacionCenter(equipoDe(d), "linea");
        if (zona) await asegurarNotificacionCenter(equipoDe(d), "zona");
    } catch (e: any) {
        // Quedó guardada la geometría, pero la cámara no aplicó: no mentimos que está andando.
        await prisma.device.update({ where: { id: d.id }, data: { intrusionEnabled: false } });
        return NextResponse.json({ error: `La cámara rechazó la configuración: ${e?.message || "sin detalle"}` }, { status: 502 });
    }

    await prisma.device.update({ where: { id: d.id }, data: { intrusionEnabled: true } });
    return NextResponse.json({ ok: true, habilitada: true });
}
