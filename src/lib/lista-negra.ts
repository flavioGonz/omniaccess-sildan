import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import type { ListaCamara } from "@/lib/drivers/IDeviceDriver";
import { normalizeWatchCat, type WatchCategory } from "@/lib/watch-categories";

/**
 * La lista negra, contestada desde un solo lugar.
 *
 * "¿Esta matrícula está en lista negra, y por qué?" lo preguntan la decisión de la barrera
 * (server.js para ANPR, paso-por-acceso para RTSP, setEventPlate para la carga manual), las
 * listas que se cargan en la cámara, el monitor y el bot. Hasta el 7/10 cada uno lo contestaba
 * distinto —o no lo preguntaba: la decisión no miraba ninguna lista y la cámara recibía a los
 * de lista negra como permitidos—. Esto es la única respuesta.
 *
 * Fuentes, en este orden: la fila activa de PlateWatch (manual, o vinculada a una persona), y
 * si no hay, la credencial PLATE de un usuario con rol BLACKLISTED (el módulo facial sigue
 * usando el rol; acá se lee como respaldo y no se escribe).
 *
 * server.js y waha-handler.js no pueden importar esto (CommonJS, otro proceso): lib-lista-negra.js
 * ejecuta LA MISMA consulta SQL (CONSULTA_VIGILANCIA, copiada textual). Si se cambia acá, se
 * cambia allá.
 */

export type OrigenVigilancia = "manual" | "persona" | "rol";

export type Vigilancia = {
    plate: string;
    category: WatchCategory;
    label: string;
    motivo: string | null;
    color: string | null;
    notify: boolean;
    origen: OrigenVigilancia;
    userId: string | null;
    userName: string | null;
};

export type RespuestaListaNegra = {
    negra: boolean;
    motivo: string | null;
    origen: OrigenVigilancia | null;
    watch: Vigilancia | null;
};

export const normalizarMatricula = (p: string | null | undefined) =>
    String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Una sola sentencia para las dos fuentes. `prio` ordena: la fila manual le gana al rol, para que
 * una persona con rol BLACKLISTED a la que un operador marcó como VIP a mano se vea como el
 * operador decidió (y la pantalla avise del rol aparte).
 */
export const CONSULTA_VIGILANCIA = `
SELECT * FROM (
  SELECT 1 AS prio, w.plate, w.category, w.label, w.motivo, w.color, w.notify, w."userId",
         u.name AS "userName", CASE WHEN w."userId" IS NULL THEN 'manual' ELSE 'persona' END AS origen
    FROM "PlateWatch" w LEFT JOIN "User" u ON u.id = w."userId"
   WHERE w.active = true AND upper(regexp_replace(w.plate, '[^A-Za-z0-9]', '', 'g')) = $1
  UNION ALL
  SELECT 2 AS prio, c.value AS plate, 'BLACKLISTED' AS category, u.name AS label, NULL AS motivo,
         NULL AS color, true AS notify, u.id AS "userId", u.name AS "userName", 'rol' AS origen
    FROM "Credential" c JOIN "User" u ON u.id = c."userId"
   WHERE c.type = 'PLATE' AND u.role = 'BLACKLISTED'
     AND upper(regexp_replace(c.value, '[^A-Za-z0-9]', '', 'g')) = $1
) v ORDER BY prio LIMIT 1`;

export async function vigilanciaDe(plate: string | null | undefined): Promise<Vigilancia | null> {
    const p = normalizarMatricula(plate);
    if (!p) return null;
    const filas: any[] = await prisma.$queryRawUnsafe(CONSULTA_VIGILANCIA, p);
    const f = filas[0];
    if (!f) return null;
    const category = normalizeWatchCat(f.category);
    if (!category) return null;   // una categoría que no se reconoce no vigila nada
    return {
        plate: p, category, label: f.label || "", motivo: f.motivo ?? null, color: f.color ?? null,
        notify: f.notify !== false, origen: f.origen, userId: f.userId ?? null, userName: f.userName ?? null,
    };
}

export async function estaEnListaNegra(plate: string | null | undefined): Promise<RespuestaListaNegra> {
    try {
        const w = await vigilanciaDe(plate);
        if (!w || w.category !== "BLACKLISTED") return { negra: false, motivo: null, origen: null, watch: w };
        const motivo = w.motivo || (w.origen === "rol" ? `usuario en lista negra${w.userName ? ` (${w.userName})` : ""}` : w.label || null);
        return { negra: true, motivo, origen: w.origen, watch: w };
    } catch (e) {
        // Si la consulta falla, no se inventa un "no está": se dice que no se pudo saber. Quien
        // decide trata esto como "no negra" pero el error queda en el log.
        console.error("[lista-negra] no se pudo consultar:", (e as any)?.message);
        return { negra: false, motivo: null, origen: null, watch: null };
    }
}

/** Texto que se escribe en `details` del evento cuando la lista negra forzó la decisión. */
export const detalleListaNegra = (motivo: string | null) => `Lista negra: ${motivo || "sin motivo cargado"}`;

// ── Listas para la cámara ──────────────────────────────────────────────────────────────

export type ListasCamara = { blancas: string[]; negras: string[] };

/**
 * Qué tiene que tener cada lectora: blancas = credenciales PLATE que NO están en lista negra;
 * negras = lista negra activa (manual, persona o rol). Una matrícula no puede estar en las dos.
 */
export async function listasParaCamara(): Promise<ListasCamara> {
    const [creds, manuales, porRol] = await Promise.all([
        prisma.credential.findMany({ where: { type: "PLATE" }, select: { value: true } }),
        prisma.plateWatch.findMany({ where: { active: true, category: "BLACKLISTED" }, select: { plate: true } }),
        prisma.credential.findMany({ where: { type: "PLATE", user: { role: "BLACKLISTED" as any } }, select: { value: true } }),
    ]);
    const negras = new Set<string>();
    for (const w of manuales) { const n = normalizarMatricula(w.plate); if (n) negras.add(n); }
    for (const c of porRol) { const n = normalizarMatricula(c.value); if (n) negras.add(n); }
    const blancas = new Set<string>();
    for (const c of creds) { const n = normalizarMatricula(c.value); if (n && !negras.has(n)) blancas.add(n); }
    return { blancas: [...blancas], negras: [...negras] };
}

export type ResultadoCamaras = {
    ok: { id: string; name: string; accion: string }[];
    fallo: { id: string; name: string; error: string }[];
};

/**
 * Aplica en TODAS las lectoras Hikvision el estado de una matrícula: si entra a lista negra,
 * pasa a la blackList (un PUT la mueve: la cámara reemplaza el registro); si sale, vuelve a la
 * whiteList cuando tiene credencial, o se borra de la cámara cuando no la tiene.
 *
 * Devuelve qué pasó en cada cámara. Nunca lanza: una cámara apagada no puede impedir que la
 * entrada quede en la lista (la barrera la deniega igual por servidor), pero tampoco se puede
 * decir "listo" cuando una cámara no respondió.
 */
export async function aplicarListaNegraEnCamaras(plate: string, negra: boolean): Promise<ResultadoCamaras> {
    const p = normalizarMatricula(plate);
    const resultado: ResultadoCamaras = { ok: [], fallo: [] };
    if (!p) return resultado;
    const camaras = await prisma.device.findMany({ where: { deviceType: "LPR_CAMERA", brand: "HIKVISION" }, orderBy: { name: "asc" } });
    if (camaras.length === 0) return resultado;
    const tieneCredencial = !negra && !!(await prisma.credential.findFirst({ where: { type: "PLATE", value: { in: [p, plate] } }, select: { id: true } }));
    const driver = new HikvisionDriver();
    await Promise.all(camaras.map(async (cam) => {
        try {
            if (negra) { await driver.addPlateToCamera(cam, p, "blackList"); resultado.ok.push({ id: cam.id, name: cam.name, accion: "lista negra" }); }
            else if (tieneCredencial) { await driver.addPlateToCamera(cam, p, "whiteList"); resultado.ok.push({ id: cam.id, name: cam.name, accion: "lista blanca" }); }
            else { await driver.removePlateFromCamera(cam, p); resultado.ok.push({ id: cam.id, name: cam.name, accion: "quitada" }); }
        } catch (e: any) {
            resultado.fallo.push({ id: cam.id, name: cam.name, error: e?.message || "sin respuesta" });
        }
    }));
    return resultado;
}

/** Una línea para mostrarle al operador o al bot qué pasó con las cámaras. */
export function resumirCamaras(r: ResultadoCamaras): string {
    if (r.ok.length === 0 && r.fallo.length === 0) return "Sin lectoras Hikvision cargadas: la barrera la decide el servidor.";
    const partes: string[] = [];
    if (r.ok.length) partes.push(`${r.ok.map((c) => c.name).join(", ")}: actualizada${r.ok.length > 1 ? "s" : ""}`);
    if (r.fallo.length) partes.push(`${r.fallo.map((c) => `${c.name} (${c.error})`).join(", ")}: NO respondió — la barrera la deniega igual por servidor`);
    return partes.join(" · ");
}

// ── Lo que cada camino de carga necesita ─────────────────────────────────────────────────

export type MatriculaParaCamara = { plate: string; lista: ListaCamara };

/** Todo lo que una lectora tiene que tener, cada matrícula con su lista. Para las sincronizaciones completas. */
export async function matriculasParaCargar(): Promise<MatriculaParaCamara[]> {
    const { blancas, negras } = await listasParaCamara();
    return [...blancas.map((plate) => ({ plate, lista: "whiteList" as const })), ...negras.map((plate) => ({ plate, lista: "blackList" as const }))];
}

/** En qué lista va UNA matrícula hoy. Para las altas sueltas (credencial nueva, bot, importación). */
export async function listaParaMatricula(plate: string): Promise<ListaCamara> {
    return (await estaEnListaNegra(plate)).negra ? "blackList" : "whiteList";
}
