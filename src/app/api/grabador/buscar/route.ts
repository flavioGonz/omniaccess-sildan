/**
 * La búsqueda inteligente en los grabadores, sin importar el fabricante (lib/grabador-busqueda).
 *
 *  POST { texto, desde, hasta, similitud? }                 → busca por texto en todos los que pueden
 *  POST multipart { imagen, objeto, desde, hasta, similitud } → busca por imagen
 *       → { tareas: "<token>" }  (una tarea por grabador; el token se devuelve tal cual al consultar)
 *  GET ?tareas=<token>&max=  → avance de todas juntas y los hallazgos, ya con su cámara
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { conSesion } from "@/lib/acuseek-nvr";
import { grabadoresConBusqueda, grabadorPorId, driverDe, camarasDeGrabador } from "@/lib/grabador-busqueda";

/** `s`: la similitud mínima pedida (0-100), para no mostrar lo que el grabador devuelva por debajo. */
type Tarea = { n: string; t: string; k: "texto" | "imagen"; o?: "persona" | "vehiculo"; s?: number };
const aToken = (x: Tarea[]) => Buffer.from(JSON.stringify(x)).toString("base64url");
const deToken = (s: string): Tarea[] => { try { const j = JSON.parse(Buffer.from(s, "base64url").toString()); return Array.isArray(j) ? j.slice(0, 16) : []; } catch { return []; } };
const MAX_DEFECTO = 80;
const SIN_GRABADOR = "Ningún grabador de esta instalación hace esa búsqueda.";

/**
 * El puntaje de cada hallazgo, en 0-100, y fuera lo que no llega a la similitud pedida.
 *
 * Por qué (13/11, Nico: la búsqueda en el NVR «trae cualquier cosa»). Leyendo el código se vio que
 * la similitud elegida en la barra se le mandaba al grabador al crear la búsqueda, pero lo que
 * volvía se mostraba ENTERO: si el grabador devolvía algo por debajo, salía igual.
 * Un hallazgo sin puntaje se deja: no hay con qué descartarlo.
 *
 * La escala: la búsqueda por imagen ya llega en 0-100 (lib/acuseek la convierte). La de texto
 * llega como la manda el equipo y NO está verificada contra uno: si todos los puntajes son ≤ 1 se
 * toman como fracción. Es una defensa, no una medición.
 */
function conPuntaje<T extends { puntaje?: number | null }>(hallazgos: T[], minimo?: number): T[] {
    const con = hallazgos.filter((h) => h.puntaje != null);
    const fraccion = con.length > 0 && con.every((h) => (h.puntaje as number) <= 1);
    const lista = fraccion ? hallazgos.map((h) => (h.puntaje != null ? { ...h, puntaje: Math.round(h.puntaje * 100) } : h)) : hallazgos;
    return minimo ? lista.filter((h) => h.puntaje == null || h.puntaje >= minimo) : lista;
}
/**
 * El orden: por momento (lo más nuevo primero), que es lo que espera el Historial; o por parecido
 * (`orden=parecido`), que es lo que espera quien busca «lo que más se le parece». Antes iba siempre
 * por momento, y en una búsqueda por foto lo más parecido quedaba perdido en el medio.
 */
function ordenar<T extends { momento: string; puntaje?: number | null }>(h: T[], porParecido: boolean): T[] {
    const porMomento = (a: T, b: T) => (a.momento < b.momento ? 1 : -1);
    return porParecido ? h.sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1) || porMomento(a, b)) : h.sort(porMomento);
}

export async function POST(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const esForm = (req.headers.get("content-type") || "").includes("multipart/form-data");
    let texto = "", imagen: Buffer | null = null, objeto: "persona" | "vehiculo" = "vehiculo", desde = "", hasta = "", similitud: number | undefined;
    if (esForm) {
        const fd = await req.formData();
        const f = fd.get("imagen"); if (f && typeof f !== "string") imagen = Buffer.from(await f.arrayBuffer());
        objeto = fd.get("objeto") === "persona" ? "persona" : "vehiculo";
        desde = String(fd.get("desde") || ""); hasta = String(fd.get("hasta") || ""); similitud = Number(fd.get("similitud")) || undefined;
    } else {
        const b = await req.json().catch(() => ({}));
        texto = String(b?.texto || "").trim(); desde = String(b?.desde || ""); hasta = String(b?.hasta || ""); similitud = Number(b?.similitud) || undefined;
    }
    if (!texto && !imagen) return NextResponse.json({ ok: false, error: "Falta qué buscar." }, { status: 400 });
    const ahora = new Date();
    if (!hasta) hasta = ahora.toISOString();
    if (!desde) desde = new Date(+ahora - 864e5).toISOString();
    const k: "texto" | "imagen" = imagen ? "imagen" : "texto";
    const quienes = (await grabadoresConBusqueda()).filter((x) => x.cap.activa && x.cap[k]);
    if (!quienes.length) return NextResponse.json({ ok: false, sinGrabador: true, error: SIN_GRABADOR }, { status: 404 });
    const tareas: Tarea[] = [], errores: string[] = [];
    await Promise.all(quienes.map(async (gr) => {
        const d = driverDe(gr.marca)!;
        try {
            const t = k === "texto" ? await d.buscarTexto!(gr.c, texto, { desde, hasta, similitud }) : await d.buscarImagen!(gr.c, imagen!, { desde, hasta, similitud, objeto });
            tareas.push({ n: gr.id, t, k, ...(k === "imagen" ? { o: objeto } : {}), ...(similitud ? { s: similitud } : {}) });
        } catch (e: any) { errores.push(`${gr.nombre}: ${e?.message || e}`); }
    }));
    if (!tareas.length) return NextResponse.json({ ok: false, error: errores.join(" · ") || "No se pudo buscar." }, { status: 502 });
    return NextResponse.json({ ok: true, tareas: aToken(tareas), grabadores: tareas.length, errores });
}

export async function GET(req: NextRequest) {
    const no = await conSesion(); if (no) return no;
    const tareas = deToken(req.nextUrl.searchParams.get("tareas") || "");
    const max = Math.min(200, Number(req.nextUrl.searchParams.get("max")) || MAX_DEFECTO);
    if (!tareas.length) return NextResponse.json({ ok: false, error: "Faltan las tareas." }, { status: 400 });
    const partes = await Promise.all(tareas.map(async (t) => {
        const gr = await grabadorPorId(t.n);
        const d = gr ? driverDe(gr.marca) : null;
        if (!gr || !d) return { terminada: true, progreso: 100, total: 0, hallazgos: [], error: "El grabador ya no está." };
        try {
            const a = t.k === "texto" ? await d.avanceTexto!(gr.c, t.t, max) : await d.avanceImagen!(gr.c, t.t, max, t.o || "vehiculo");
            const cams = await camarasDeGrabador(gr.id).catch(() => ({} as Record<number, any>));
            return {
                ...a,
                hallazgos: conPuntaje(a.hallazgos, t.s).map((h) => {
                    const cam = cams[h.canal];
                    const px = (u: string | null) => (u ? `/api/grabador/imagen?nvr=${encodeURIComponent(gr.id)}&u=${encodeURIComponent(u)}` : null);
                    return { ...h, id: `${gr.id}-${h.id}`, foto: px(h.foto), recorte: px(h.recorte), nvrId: gr.id, grabador: gr.nombre, deviceId: cam?.id || null, camara: cam?.nombre || `${gr.nombre} · canal ${h.canal}`, tipoCamara: cam?.tipo || null };
                }),
            };
        } catch (e: any) {
            // No se da por terminada: un VPro contesta «deviceError» el primer segundo de una tarea
            // nueva. Quien consulta decide cuántas vueltas insiste (TablaUnificada).
            console.error("[grabador/buscar]", gr.nombre, e?.message || e);
            return { terminada: false, progreso: 0, total: 0, hallazgos: [], error: `${gr.nombre}: ${e?.message || e}` };
        }
    }));
    return NextResponse.json({
        ok: true,
        terminada: partes.every((p) => p.terminada),
        progreso: Math.round(partes.reduce((s, p) => s + (p.progreso || 0), 0) / partes.length),
        total: partes.reduce((s, p) => s + (p.total || 0), 0),
        errores: partes.map((p) => p.error).filter(Boolean),
        hallazgos: ordenar(partes.flatMap((p) => p.hallazgos) as any[], req.nextUrl.searchParams.get("orden") === "parecido"),
    }, { headers: { "Cache-Control": "no-store" } });
}
