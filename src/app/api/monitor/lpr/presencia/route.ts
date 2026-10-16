import { NextResponse } from "next/server";
import { autorizarMonitor, SIN_CACHE } from "@/lib/monitor/servidor";
import { calcularPresencia, type AutoAdentro, type Atipico, NOMBRE_ATIPICO } from "@/lib/presencia";

export const dynamic = "force-dynamic";

/** Cuántos van en cada lista de la pared como mucho: más no se recorre con el dedo. */
const MAX_POR_LISTA = 300;

const NOMBRE_CLASE: Record<string, string> = {
    residente: "Residente", personal: "Personal", proveedor: "Proveedor", visita: "Visita", invitado: "Invitado", lista_blanca: "Lista blanca", no_registrado: "No registrado",
};

export type FilaPresenciaPared = {
    clave: string; plate: string | null; titulo: string; sub: string | null; clase: string | null;
    entrada: string; vistoUltimo: string | null; camara: string | null; foto: string | null; accessEventId: string | null;
    estimado: boolean; atipico: { clave: Atipico; nombre: string }[]; entradas24h: number | null;
};

const deAuto = (a: AutoAdentro): FilaPresenciaPared => ({
    clave: a.plate, plate: a.plate, titulo: a.persona || NOMBRE_CLASE[a.clase] || "Sin datos",
    sub: [a.persona ? NOMBRE_CLASE[a.clase] : null, a.unidad].filter(Boolean).join(" · ") || null, clase: a.clase,
    entrada: a.entrada, vistoUltimo: a.vistoUltimo, camara: a.camara, foto: a.foto, accessEventId: a.accessEventId,
    estimado: a.estimado, atipico: a.atipico.map((x) => ({ clave: x, nombre: NOMBRE_ATIPICO[x] })), entradas24h: a.entradas24h,
});

/**
 * GET /api/monitor/lpr/presencia → las cuatro listas de quién está adentro para los cajones de
 * Control LPR (16/10, Nico: «debe resolver con drawers dentro, no llevar al admin»). Vive bajo
 * /api/monitor/lpr para que la abra también un enlace de pantalla (alcance de la vista lpr).
 * Sólo lectura: corregir quién está adentro se hace desde Gestión de alarmas, con usuario.
 */
export async function GET() {
    const p = await autorizarMonitor("/api/monitor/lpr/presencia");
    if (p.error) return p.error;
    try {
        const pr = await calcularPresencia();
        const autoDe = new Map([...pr.autosResidentes, ...pr.autosVisitas].map((a) => [a.plate, a]));
        const residentes: FilaPresenciaPared[] = pr.residentes.map((r) => {
            const a = r.autos.map((x) => autoDe.get(x)).find(Boolean);
            return {
                clave: r.userId, plate: r.autos[0] || null, titulo: r.nombre, sub: [r.unidad, r.autos.length > 1 ? `${r.autos.length} autos` : r.autos.length ? null : "a pie"].filter(Boolean).join(" · ") || null,
                clase: "residente", entrada: r.entrada, vistoUltimo: a?.vistoUltimo || null, camara: a?.camara || null, foto: a?.foto || null, accessEventId: a?.accessEventId || null,
                estimado: r.estimado, atipico: [], entradas24h: a?.entradas24h ?? null,
            };
        });
        const conChapa = new Set(pr.autosVisitas.map((a) => a.plate));
        const visitas: FilaPresenciaPared[] = [
            ...pr.autosVisitas.filter((a) => a.clase !== "no_registrado").map(deAuto),
            // Las visitas registradas sin chapa (a pie, en moto): no tienen lectura que mostrar.
            ...pr.visitas.filter((v) => !v.plate || !conChapa.has(v.plate)).map((v) => ({
                clave: `v:${v.id}`, plate: v.plate, titulo: v.nombre || v.empresa || v.tipoNombre, sub: [v.tipoNombre, v.lote ? `→ ${v.lote}` : null].filter(Boolean).join(" · "),
                clase: "visita", entrada: v.entrada, vistoUltimo: null, camara: null, foto: null, accessEventId: null, estimado: false, atipico: [], entradas24h: null,
            })),
        ].sort((a, b) => (a.entrada < b.entrada ? 1 : -1));
        return NextResponse.json({
            modo: pr.modo, ventanas: pr.ventanas, calculado: pr.calculado,
            residentes: residentes.slice(0, MAX_POR_LISTA),
            visitas: visitas.slice(0, MAX_POR_LISTA),
            desconocidos: pr.autosVisitas.filter((a) => a.clase === "no_registrado").map(deAuto).slice(0, MAX_POR_LISTA),
            atipicos: pr.atipicos.map(deAuto).slice(0, MAX_POR_LISTA),
        }, { headers: SIN_CACHE });
    } catch (e: any) {
        console.error("[monitor/lpr/presencia]", e?.message || e);
        return NextResponse.json({ error: "No se pudo calcular quién está adentro." }, { status: 500, headers: SIN_CACHE });
    }
}
