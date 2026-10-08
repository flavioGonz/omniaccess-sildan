import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Registrar cada corrida de una tarea programada, y poder pausarla.
 *
 * El cron del CT llama las rutas /api/.../tick con `curl -s -o /dev/null`: la salida se
 * tira. Una tarea podía devolver 500 cada minuto durante días y no quedaba rastro en
 * ningún lado. Ahora cada corrida deja una fila con inicio, fin, si salió bien y qué hizo.
 *
 * La pausa vive en un ajuste y no en el crontab: editar el crontab desde una página web es
 * darle a la página permiso de correr cualquier comando como root. Pausar acá sólo hace que
 * la ruta conteste "pausada" sin hacer nada, y se deshace con un clic.
 */

export const CLAVE_PAUSADAS = "TAREAS_PAUSADAS";

/** Cuántos días de corridas se guardan. Una tarea por minuto son 1.440 filas por día. */
const RETENCION_DIAS = 7;
/** Una de cada tantas corridas poda lo viejo: podar en cada una sería un DELETE por minuto. */
const PODAR_CADA = 200;
/** La pausa se lee de la base como mucho cada esto. Pausar tarda a lo sumo esto en tomar efecto. */
const PAUSA_MS = 15_000;
/** Lo que se guarda de la respuesta. Alcanza para ver qué hizo sin llenar la tabla. */
const DETALLE_MAX = 400;

let pausas: { set: Set<string>; hasta: number } | null = null;

export async function tareasPausadas(fresco = false): Promise<Set<string>> {
    if (!fresco && pausas && pausas.hasta > Date.now()) return pausas.set;
    let set = new Set<string>();
    try {
        const v = (await prisma.setting.findUnique({ where: { key: CLAVE_PAUSADAS } }))?.value;
        const arr = v ? JSON.parse(v) : [];
        if (Array.isArray(arr)) set = new Set(arr.map(String));
    } catch { /* un ajuste roto no puede frenar las tareas: se toman como no pausadas */ }
    pausas = { set, hasta: Date.now() + PAUSA_MS };
    return set;
}
export function olvidarPausas() { pausas = null; }

/** Lo que la respuesta dice, en una línea: sin `ok`, sin la marca de tiempo. */
function resumir(cuerpo: any): string | null {
    if (!cuerpo || typeof cuerpo !== "object") return null;
    if (cuerpo.error) return String(cuerpo.error).slice(0, DETALLE_MAX);
    const { ok, ts, status, ...resto } = cuerpo;
    const s = JSON.stringify(resto);
    return s === "{}" ? null : s.slice(0, DETALLE_MAX);
}

/**
 * Envuelve el GET de una ruta tick. `clave` es la del catálogo (lib/tareas/catalogo).
 * Un 401 no se registra: no es una corrida, es alguien que tocó la puerta sin llave.
 */
export function conRegistro<A extends any[]>(clave: string, handler: (...a: A) => Promise<Response>) {
    return async (...a: A): Promise<Response> => {
        if ((await tareasPausadas()).has(clave)) return NextResponse.json({ ok: true, pausada: true });

        // Quién la corrió: el cron, salvo que la llame el panel ("Ejecutar ahora") con el token interno.
        const req = a[0] as Request | undefined;
        let origen = "cron";
        const pide = req?.headers?.get?.("x-tarea-origen");
        if (pide && process.env.TRACKING_TOKEN && req!.headers.get("x-tracking-token") === process.env.TRACKING_TOKEN) origen = pide.slice(0, 80);

        const inicio = new Date();
        let res: Response;
        try {
            res = await handler(...a);
        } catch (e: any) {
            await guardar(clave, inicio, false, e?.message || "Error sin mensaje", origen);
            throw e;
        }
        if (res.status === 401) return res;
        let cuerpo: any = null;
        try { cuerpo = await res.clone().json(); } catch { }
        const ok = res.ok && cuerpo?.ok !== false && cuerpo?.status !== "error";
        await guardar(clave, inicio, ok, resumir(cuerpo) || (ok ? null : `HTTP ${res.status}`), origen);
        return res;
    };
}

async function guardar(tarea: string, inicio: Date, ok: boolean, detalle: string | null, origen: string) {
    try {
        await prisma.ejecucionTarea.create({ data: { tarea, inicio, fin: new Date(), ok, detalle, origen } });
        if (Math.random() < 1 / PODAR_CADA) {
            await prisma.ejecucionTarea.deleteMany({ where: { inicio: { lt: new Date(Date.now() - RETENCION_DIAS * 86_400_000) } } });
        }
    } catch (e: any) {
        // Registrar no puede romper la tarea: si la tabla falla, la tarea igual corrió.
        console.error("[tareas] no se pudo registrar la corrida:", e?.message || e);
    }
}
