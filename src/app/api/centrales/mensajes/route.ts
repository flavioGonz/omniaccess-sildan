/**
 * GET /api/centrales/mensajes?h=24 — lo que llegó de las centrales de alarma, de todas, para la
 * pestaña «Centrales» de Gestión de alarmas (22/10, Nico: «¿no debe tener un módulo para mostrar
 * los mensajes que llegan, estilizados?»).
 *
 * Es el registro del receptor (MensajeCentral), no las alarmas: entran el armado y desarmado, las
 * fallas, las pruebas, la supervisión y también lo que se confirmó sin usarse (una cuenta que no está
 * dada de alta, una trama ilegible). Las alarmas, además, siguen siendo filas de «Alarmas».
 *
 * Cada mensaje lleva el nombre de su central y, si sus eventos traen zona, el nombre y el área de
 * esa zona: la pantalla no tiene que pedir cada central para poder decir «Zona 3 · Portón».
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sesionCon } from "@/lib/centrales/sesion";
import { leerPrioridadesGuardadas } from "@/lib/centrales/prioridades-servidor";
import { exigirFuncion } from "@/lib/funcion-servidor";

const RANGOS_H = [24, 72, 168];
/** Tope de filas: 7 días de supervisión de varias centrales son miles; la pantalla no necesita más. */
const TOPE = 3000;

export async function GET(req: NextRequest) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { no } = await sesionCon(); if (no) return no;
    const pedido = Number(req.nextUrl.searchParams.get("h"));
    const h = RANGOS_H.includes(pedido) ? pedido : 24;
    const desde = new Date(Date.now() - h * 3600_000);
    try {
        const [mensajes, centrales, prioridades] = await Promise.all([
            prisma.mensajeCentral.findMany({
                where: { recibido: { gte: desde } }, orderBy: { recibido: "desc" }, take: TOPE,
                select: { id: true, recibido: true, centralId: true, cuenta: true, ip: true, transporte: true, idMensaje: true, cifrado: true, crudo: true, datos: true, horaCentral: true, respuesta: true, error: true, eventos: true, detectionId: true },
            }),
            prisma.centralAlarma.findMany({ select: { id: true, cuenta: true, deviceId: true, estado: true, prueba: true, device: { select: { name: true } }, zonas: { select: { zona: true, nombre: true, areaId: true } } } }),
            leerPrioridadesGuardadas(),
        ]);
        // Qué alarmas siguen sin tratar: la fila P1 late mientras tanto (22/10).
        const detIds = [...new Set(mensajes.map((m) => m.detectionId).filter(Boolean))] as string[];
        const sinTratar = new Set(detIds.length ? (await prisma.detection.findMany({ where: { id: { in: detIds }, acknowledged: false }, select: { id: true } })).map((d) => d.id) : []);
        return NextResponse.json({
            ok: true, horas: h, tope: mensajes.length >= TOPE, prioridades,
            sinTratar: [...sinTratar],
            centrales: centrales.map((c) => ({ id: c.id, cuenta: c.cuenta, deviceId: c.deviceId, nombre: c.device?.name || `Central ${c.cuenta}`, estado: c.estado, prueba: c.prueba, zonas: c.zonas })),
            mensajes,
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "No se pudieron leer los mensajes." }, { status: 500 });
    }
}
