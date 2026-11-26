/**
 * POST /api/devices/exportar → el inventario de equipos, para bajar (26/11).
 *
 *   { formato: "pdf" | "xlsx" | "paquete", claves?: boolean, salud?: boolean, frase?: string }
 *
 *  · pdf / xlsx: el informe con tapa (lib/informes/equipos-*). `claves` agrega usuario Y clave de
 *    cada equipo; `salud` pregunta ahora a cada NVR por sus discos.
 *  · paquete: el JSON para llevar los equipos, sus áreas y parámetros a otra instancia
 *    (lib/equipos-paquete). Los secretos van cifrados con `frase`; sin frase, no van.
 *
 * Es POST y no GET para que la frase no quede en una URL (historial, registros del proxy). Las
 * claves y el paquete con secretos piden «Editar dispositivos», el mismo permiso que ver la clave
 * de un equipo en su ficha. Cada exportación queda en Auditoría, diciendo si llevó claves.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { prisma } from "@/lib/prisma";
import { leerMarca } from "@/lib/informes/marca";
import { armarInventario } from "@/lib/informes/equipos-datos";
import { armarPaquete, FRASE_MIN } from "@/lib/equipos-paquete";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    const formato = b?.formato === "pdf" ? "pdf" : b?.formato === "paquete" ? "paquete" : "xlsx";
    const claves = !!b?.claves, salud = b?.salud !== false;
    const frase = typeof b?.frase === "string" ? b.frase : "";
    const edita = permisosDeSesion(s).includes("dispositivos.editar");
    if ((claves || (formato === "paquete" && frase)) && !edita) return NextResponse.json({ error: "Para exportar con claves hace falta el permiso Editar dispositivos." }, { status: 403 });
    if (formato === "paquete" && frase && frase.length < FRASE_MIN) return NextResponse.json({ error: `La frase tiene que tener al menos ${FRASE_MIN} caracteres.` }, { status: 400 });
    const quien = String(s?.name || s?.sub || "panel");
    const dia = new Date().toISOString().slice(0, 10);

    let buf: Buffer, tipo: string, nombre: string, detalle: string;
    if (formato === "paquete") {
        const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "omniaccess";
        const p = await armarPaquete({ frase: frase || null, instancia: host });
        buf = Buffer.from(JSON.stringify(p, null, 2), "utf8");
        tipo = "application/json"; nombre = `omniaccess-equipos-${dia}.omniaccess.json`;
        detalle = `paquete · ${p.equipos.length} equipos · ${p.areas.length} áreas · ${p.secretos ? "secretos cifrados con frase" : "sin secretos"}`;
    } else {
        const [inv, marca] = await Promise.all([armarInventario({ conClaves: claves, conSalud: salud }), leerMarca()]);
        if (formato === "pdf") {
            const { inventarioPdf } = await import("@/lib/informes/equipos-pdf");
            buf = await inventarioPdf(inv, marca, quien); tipo = "application/pdf"; nombre = `inventario-equipos-${dia}.pdf`;
        } else {
            const { inventarioExcel } = await import("@/lib/informes/equipos-excel");
            buf = await inventarioExcel(inv, marca, quien); tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; nombre = `inventario-equipos-${dia}.xlsx`;
        }
        detalle = `${formato} · ${inv.equipos.length} equipos · ${claves ? "CON CLAVES" : "sin claves"}${salud ? " · salud de NVR en vivo" : ""}`;
    }
    await prisma.accionSistema.create({ data: { quien, accion: "equipos.exportar", objetivo: nombre, ok: true, detalle } }).catch(() => { });
    return new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": tipo, "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "no-store" },
    });
}
