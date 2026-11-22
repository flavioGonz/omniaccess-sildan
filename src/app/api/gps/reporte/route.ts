import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { leerClaves } from "@/lib/gps-reportes-catalogo";
import { armarReporteGps } from "@/lib/gps-reportes-servidor";
import { leerMarca } from "@/lib/informes/marca";
import { RECORRIDO_MAX_DIAS } from "@/lib/gps-filtro";
import { paraInput } from "@/lib/fechas";

export const dynamic = "force-dynamic";

/**
 * GET /api/gps/reporte → los reportes de rastreo, para bajar.
 *
 *   ?imeis=a,b      de qué vehículos (sin esto, de todos los dados de alta)
 *   &desde=…&hasta=…  el período, como instantes ISO (sin «hasta», hasta ahora)
 *   &reportes=…     cuáles, separados por coma (lib/gps-reportes-catalogo); sin esto, todos menos el listado crudo
 *   &formato=xlsx|pdf
 *
 * Empezó (21/11) siendo una planilla fija de un vehículo y siete días: `?imei=…&dias=7`. Ese
 * enlace sigue andando igual —hay quien lo tiene guardado—; lo que cambió es lo que trae.
 *
 * La cuenta la hace lib/gps-reportes, la misma para la vista previa de la pantalla: lo que se ve
 * antes de bajar es lo que baja.
 */
export async function GET(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes("dispositivos")) return NextResponse.json({ error: "Tu rol no puede ver los equipos." }, { status: 403 });

    const q = req.nextUrl.searchParams;
    const formato = q.get("formato") === "pdf" ? "pdf" : "xlsx";
    const pedidos = [...(q.get("imeis") || "").split(","), q.get("imei") || ""].map((x) => x.replace(/\D/g, "").slice(0, 20)).filter(Boolean);
    const imeis = pedidos.length ? [...new Set(pedidos)] : null;
    const dias = Math.min(Math.max(Number(q.get("dias")) || 7, 1), RECORRIDO_MAX_DIAS);
    const fecha = (v: string | null) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
    const desde = fecha(q.get("desde")) || new Date(Date.now() - dias * 86_400_000), hasta = fecha(q.get("hasta"));
    if (hasta && hasta <= desde) return NextResponse.json({ error: "El «hasta» es anterior al «desde»." }, { status: 400 });
    if (desde > new Date()) return NextResponse.json({ error: "El período todavía no empezó." }, { status: 400 });

    const t0 = Date.now();
    const r = await armarReporteGps({ imeis, desde, hasta, claves: leerClaves(q.get("reportes")) });
    if (!r.vehiculos.length) return NextResponse.json({ error: imeis ? "Ese rastreador no existe o no está dado de alta." : "No hay rastreadores dados de alta." }, { status: 404 });
    const marca = await leerMarca();

    let buf: Buffer, tipo: string;
    if (formato === "pdf") {
        const { reporteGpsPdf } = await import("@/lib/informes/gps-pdf");
        buf = await reporteGpsPdf(r, marca, String(s?.name || s?.sub || "OmniAccess"));
        tipo = "application/pdf";
    } else {
        const { reporteGpsExcel } = await import("@/lib/informes/gps-excel");
        buf = await reporteGpsExcel(r, marca);
        tipo = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    const de = r.vehiculos.length === 1 ? (r.vehiculos[0].matricula || r.vehiculos[0].nombre).replace(/[^0-9A-Za-z_-]+/g, "-") : `flota-${r.vehiculos.length}`;
    const archivo = `rastreo-${de}-${paraInput(r.desde)}-al-${paraInput(r.hasta)}.${formato}`;
    /* Por dónde anduvo un vehículo es un dato que se cuida: queda anotado quién se lo llevó. */
    await auditar(s, "equipos.gps.reporte", r.vehiculos.length === 1 ? r.vehiculos[0].imei : "varios", true, `${formato} · ${r.vehiculos.length} vehículo(s) · ${paraInput(r.desde)} al ${paraInput(r.hasta)} · ${r.tablas.map((t) => t.clave).join(",")}`).catch(() => { });
    console.log(`[reporte-gps] ${formato} · ${r.vehiculos.length} vehículo(s) · ${r.tablas.reduce((a, t) => a + t.filasTotales, 0)} filas · ${Math.round(buf.length / 1024)} KB · ${Date.now() - t0} ms`);
    return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": tipo, "Content-Disposition": `attachment; filename="${archivo}"`, "Cache-Control": "no-store", ...(r.recortado ? { "X-Reporte-Recortado": "1" } : {}) },
    });
}
