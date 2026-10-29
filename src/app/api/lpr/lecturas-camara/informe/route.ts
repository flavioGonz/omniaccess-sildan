/**
 * GET /api/lpr/lecturas-camara/informe?formato=pdf|xlsx&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&camaras=id,id&fotos=1
 *
 * El informe de Lecturas de cámara (29/10, Nico: «exportar un reporte en PDF y Excel profesional,
 * estilizado OmniAccess, con portada… así podremos comparar mejor el desempeño de las analíticas
 * OmniVision y lo que las cámaras envían»). Mismo apareo que la pantalla (lib/lecturas-camara), las
 * cuentas en lib/informes/lecturas-resumen y cada formato en su archivo.
 *
 * Pide el permiso de la pantalla (Historial). Hasta DIAS_MAX días: lo que guarda el registro.
 */
import { NextRequest, NextResponse } from "next/server";
import { rechazoPorPermiso } from "@/lib/permiso-servidor";
import { getSession } from "@/app/actions/auth";
import { limitesDelDia } from "@/lib/fechas";
import { compararLecturas } from "@/lib/lecturas-camara";
import { armarInforme } from "@/lib/informes/lecturas-resumen";
import { leerMarca } from "@/lib/informes/marca";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
/** El registro de la cámara se guarda 30 días (camara-log.js): más no hay. */
const DIAS_MAX = 31;

export async function GET(req: NextRequest) {
    const no = await rechazoPorPermiso("historial", "informe de lecturas"); if (no) return no;
    const sp = req.nextUrl.searchParams;
    const formato = sp.get("formato") === "xlsx" ? "xlsx" : "pdf";
    const d = limitesDelDia(sp.get("desde") || ""), h = limitesDelDia(sp.get("hasta") || "");
    if (!d || !h) return NextResponse.json({ ok: false, error: "Faltan las fechas (AAAA-MM-DD)." }, { status: 400 });
    const desde = d.inicio, hasta = new Date(Math.min(h.fin.getTime(), Date.now()));
    if (hasta < desde) return NextResponse.json({ ok: false, error: "La fecha final es anterior a la inicial." }, { status: 400 });
    if (hasta.getTime() - desde.getTime() > DIAS_MAX * 86_400_000) return NextResponse.json({ ok: false, error: `Como mucho ${DIAS_MAX} días: es lo que guarda el registro de las cámaras.` }, { status: 400 });
    const elegidas = (sp.get("camaras") || "").split(",").map((x) => x.trim()).filter(Boolean);

    const t0 = Date.now();
    const r = await compararLecturas({ desde, hasta, camaras: elegidas.length ? elegidas : undefined });
    const usadas = elegidas.length ? r.camaras.filter((c) => elegidas.includes(c.id)) : r.camaras;
    const informe = armarInforme(r.filas, usadas);
    const marca = await leerMarca();
    const s: any = await getSession().catch(() => null);
    const comun = { informe, filas: r.filas, marca, desde, hasta, camaras: usadas.map((c) => c.nombre), generadoPor: String(s?.name || s?.sub || "OmniAccess") };

    const nombre = `informe-lecturas-${sp.get("desde")}-al-${sp.get("hasta")}`;
    let buf: Buffer, tipo: string;
    if (formato === "xlsx") {
        const { informeLecturasExcel } = await import("@/lib/informes/lecturas-excel");
        buf = await informeLecturasExcel(comun);
        tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
        const { informeLecturasPdf } = await import("@/lib/informes/lecturas-pdf");
        buf = await informeLecturasPdf({ ...comun, fotos: sp.get("fotos") === "1" });
        tipo = "application/pdf";
    }
    console.log(`[informe-lecturas] ${formato} ${sp.get("desde")}→${sp.get("hasta")} · ${r.filas.length} filas · ${Math.round(buf.length / 1024)} KB · ${Date.now() - t0} ms${r.truncado ? " · TRUNCADO" : ""}`);
    return new Response(new Uint8Array(buf), {
        headers: {
            "Content-Type": tipo, "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${nombre}.${formato}"`,
            ...(r.truncado ? { "X-Informe-Truncado": "1" } : {}),
        },
    });
}
