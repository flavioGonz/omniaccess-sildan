/**
 * /api/centrales/<id> — la ficha de una central.
 *   GET  [?clave=1]  → { central, zonas, mensajes, alertas, modelo }   (?clave=1: la clave AES, con permiso Dispositivos y Auditoría)
 *   PATCH { nombre?, supervisionSeg?, lanVpn?, prueba?, protocolo?, camaras?: string[], zonas?: [{ zona, nombre, areaId, camaras }], nuevaClave? }
 *         `camaras`: las del abonado (ids de equipo o `nvrch-<nvr>-<ch>`); las de una zona, hasta 4.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MODELOS, claveNueva, guardarClave, leerClave, leerDestino } from "@/lib/centrales";
import { auditar, sesionCon } from "@/lib/centrales/sesion";
import { SUPERVISION_MAX } from "@/lib/centrales/limites";
import { exigirFuncion } from "@/lib/funcion-servidor";

const sinCache = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const conClave = req.nextUrl.searchParams.get("clave") === "1";
    const { s, no } = await sesionCon(conClave ? "hub.config" : undefined); if (no) return no;
    const c = await prisma.centralAlarma.findFirst({ where: { OR: [{ id }, { deviceId: id }] }, include: { device: { select: { id: true, name: true, ip: true, httpPort: true, username: true, deviceModel: true } }, zonas: { orderBy: { zona: "asc" } } } });
    if (!c) return NextResponse.json({ ok: false, error: "No existe esa central" }, { status: 404 });
    const [mensajes, alertas, destino] = await Promise.all([
        prisma.mensajeCentral.findMany({ where: { centralId: c.id }, orderBy: { recibido: "desc" }, take: 60, select: { id: true, recibido: true, ip: true, transporte: true, idMensaje: true, cifrado: true, seq: true, datos: true, respuesta: true, error: true, eventos: true, detectionId: true } }),
        prisma.deviceAlert.findMany({ where: { deviceId: c.deviceId, active: true }, select: { type: true, severity: true, message: true, openedAt: true } }).catch(() => []),
        leerDestino(),
    ]);
    let clave: string | null = null;
    if (conClave) { clave = leerClave(c); await auditar(s, "Vio la clave de cifrado de una central", c.device.name, true); }
    const { claveCifrada, ...resto } = c;
    return NextResponse.json({ ok: true, central: { ...resto, cifrado: !!claveCifrada }, clave, mensajes, alertas, destino, modelo: MODELOS.find((m) => m.modelo === c.modelo) || MODELOS[0] }, sinCache);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const funcionApagada = await exigirFuncion("FUNC_ALARMAS_RECEPCION"); if (funcionApagada) return funcionApagada;
    const { id } = await params;
    const { s, no } = await sesionCon("hub.config"); if (no) return no;
    const c = await prisma.centralAlarma.findFirst({ where: { OR: [{ id }, { deviceId: id }] }, include: { device: { select: { name: true } } } });
    if (!c) return NextResponse.json({ ok: false, error: "No existe esa central" }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const data: any = {};
    if (b.supervisionSeg != null) data.supervisionSeg = Math.min(SUPERVISION_MAX, Math.max(30, Number(b.supervisionSeg) || 600));
    if (b.lanVpn != null) data.lanVpn = !!b.lanVpn;
    if (b.prueba != null) data.prueba = !!b.prueba;
    if (b.protocolo) data.protocolo = b.protocolo === "ADM-CID" ? "ADM-CID" : "SIA-DCS";
    // Las cámaras del abonado (openspec alarmas-como-funciones): sin repetir, hasta 32.
    if (Array.isArray(b.camaras)) data.camaras = [...new Set(b.camaras.map((x: unknown) => String(x || "").trim()).filter(Boolean))].slice(0, 32);
    let nueva: string | null = null;
    try {
        if (b.nuevaClave) { nueva = claveNueva(); data.claveCifrada = guardarClave(nueva); data.modoClave = null; }
        if (Object.keys(data).length) await prisma.centralAlarma.update({ where: { id: c.id }, data });
        if (b.nombre && String(b.nombre).trim()) await prisma.device.update({ where: { id: c.deviceId }, data: { name: String(b.nombre).trim().slice(0, 80) } });
        if (Array.isArray(b.zonas)) {
            for (const z of b.zonas.slice(0, 512)) {
                const zona = Number(z?.zona);
                if (!Number.isInteger(zona) || zona < 0) continue;
                const valores = { nombre: z.nombre ? String(z.nombre).slice(0, 80) : null, areaId: z.areaId || null, camaras: Array.isArray(z.camaras) ? [...new Set<string>(z.camaras.map(String))].slice(0, 4) : [], particion: z.particion != null ? Number(z.particion) : null };
                await prisma.zonaCentral.upsert({ where: { centralId_zona: { centralId: c.id, zona } }, update: valores, create: { centralId: c.id, zona, ...valores } });
            }
            if (Array.isArray(b.borrarZonas) && b.borrarZonas.length) await prisma.zonaCentral.deleteMany({ where: { centralId: c.id, zona: { in: b.borrarZonas.map(Number) } } });
        }
    } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message || "No se pudo guardar" }, { status: 400 }); }
    await auditar(s, nueva ? "Cambió la clave de cifrado de una central" : "Editó una central de alarma", c.device.name, true, Object.keys(data).filter((k) => k !== "claveCifrada").join(", ") || (b.zonas ? "zonas" : undefined));
    return NextResponse.json({ ok: true, clave: nueva });
}
