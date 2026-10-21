/**
 * /api/centrales/<id>/accion — lo que se le pide a la central por su driver (lib/centrales).
 *   POST { accion: "probar-vincular" | "vincular" | "leer-zonas" | "estado" | "armar" | "desarmar", particion?, modo? }
 * Vincular y leer zonas piden Dispositivos; armar y desarmar, «Control de centrales». Todo lo que
 * escribe en la central queda en Auditoría.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { destinoPara, driverDe, equipoDe } from "@/lib/centrales";
import { auditar, sesionCon } from "@/lib/centrales/sesion";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const accion = String(b?.accion || "");
    const permiso = accion === "armar" || accion === "desarmar" ? "centrales" : accion === "estado" ? undefined : "dispositivos";
    const { s, no } = await sesionCon(permiso as any); if (no) return no;
    const c = await prisma.centralAlarma.findFirst({ where: { OR: [{ id }, { deviceId: id }] }, include: { device: true } });
    if (!c) return NextResponse.json({ ok: false, error: "No existe esa central" }, { status: 404 });
    const drv = driverDe(c.modelo);
    const eq = equipoDe(c.device);
    try {
        if (accion === "probar-vincular" || accion === "vincular") {
            if (!drv.vincular) return NextResponse.json({ ok: false, error: "Esta central se configura a mano: los datos están en la ficha." }, { status: 400 });
            const d = await destinoPara(c);
            if (!d) return NextResponse.json({ ok: false, error: "Falta la dirección pública del receptor (Ajustes de centrales): es lo que se le escribe a la central." }, { status: 400 });
            const r = await drv.vincular(eq, d, accion === "probar-vincular");
            if (accion === "vincular") await auditar(s, "Le escribió el receptor a una central", c.device.name, r.ok, r.ok ? r.detalle : r.error);
            return NextResponse.json(r, { status: r.ok ? 200 : 502 });
        }
        if (accion === "leer-zonas") {
            if (!drv.zonas) return NextResponse.json({ ok: false, error: "Esta central no deja leer sus zonas: se cargan a mano o aparecen con su primer evento." }, { status: 400 });
            const zonas = await drv.zonas(eq);
            for (const z of zonas) await prisma.zonaCentral.upsert({ where: { centralId_zona: { centralId: c.id, zona: z.zona } }, update: { particion: z.particion, tipo: z.tipo, ...(z.nombre ? { nombre: z.nombre } : {}) }, create: { centralId: c.id, zona: z.zona, particion: z.particion, nombre: z.nombre, tipo: z.tipo } });
            return NextResponse.json({ ok: true, zonas });
        }
        if (accion === "estado") {
            if (!drv.estado) return NextResponse.json({ ok: false, error: "Esta central no informa su estado por OmniAccess." }, { status: 400 });
            return NextResponse.json({ ok: true, estado: await drv.estado(eq) });
        }
        if (accion === "armar" || accion === "desarmar") {
            const fn = accion === "armar" ? drv.armar : drv.desarmar;
            if (!fn) return NextResponse.json({ ok: false, error: "Esta central no se arma desde OmniAccess." }, { status: 400 });
            const particion = Number(b?.particion) || 1;
            const modo = b?.modo === "presente" ? "presente" : "ausente";
            const r = accion === "armar" ? await drv.armar!(eq, particion, modo) : await drv.desarmar!(eq, particion);
            await auditar(s, accion === "armar" ? `Armó una central (${modo})` : "Desarmó una central", `${c.device.name} · partición ${particion}`, r.ok, r.ok ? undefined : r.error);
            return NextResponse.json(r, { status: r.ok ? 200 : 502 });
        }
        return NextResponse.json({ ok: false, error: "Acción desconocida" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "La central no contestó" }, { status: 502 });
    }
}
