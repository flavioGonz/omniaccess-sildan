import { prisma } from "@/lib/prisma";
import { arreglarIntrusion } from "@/lib/intrusion-estado";
import { MODOS_INTRUSION, modoIntrusionDe } from "@/lib/modo-camara";

/**
 * Que una cámara nueva quede avisando a OmniAccess SOLA, al darla de alta (26/11). Nico: «esto
 * debés hacerlo al importarlas al sistema, sin borrar cualquier otro servidor que tengan; debe ser
 * automático».
 *
 * Medido ese día en el lab: de 40 cámaras de intrusión, 26 no tenían a OmniAccess como servidor de
 * alarmas. Casi todas habían entrado por el descubridor o importando los canales de un NVR, dos
 * caminos que creaban la cámara y no le escribían nada; sólo el alta guiada de una cámara suelta lo
 * hacía. La cámara quedaba «en línea», con sus reglas dibujadas, y OmniAccess nunca se enteraba.
 *
 * Lo que se hace, por cámara: OmniAccess como servidor de alarmas (en un lugar libre: los otros
 * servidores no se tocan) y «avisar al centro» en las reglas que ya tenga dibujadas. Sólo si el modo
 * de la cámara avisa (en «OmniVision» o «sólo video» la cámara no manda nada). Dahua no: sus eventos
 * llegan por la suscripción al NVR.
 *
 * Corre en segundo plano y de a una: un alta de treinta cámaras no puede esperar treinta escrituras
 * ISAPI antes de contestar (el proxy corta a los 60 s), y la misma cámara no se escribe dos veces a
 * la vez. Lo que pasó queda en Auditoría.
 */
const COLA: { ids: string[]; quien: string }[] = ((globalThis as { __colaAvisos?: { ids: string[]; quien: string }[] }).__colaAvisos ||= []);
let corriendo = false;

export function prepararAvisosEnFondo(ids: string[], quien: string): void {
    const lista = [...new Set(ids.filter(Boolean))];
    if (!lista.length) return;
    COLA.push({ ids: lista, quien });
    if (!corriendo) void vaciar();
}

async function vaciar() {
    corriendo = true;
    try {
        while (COLA.length) {
            const { ids, quien } = COLA.shift()!;
            const hechos: string[] = [], fallas: string[] = [];
            for (const id of ids) {
                try {
                    const r = await prepararUna(id);
                    if (r === null) continue;
                    (r.ok ? hechos : fallas).push(`${r.nombre}${r.ok ? "" : `: ${r.errores.join("; ")}`}`);
                } catch (e) { fallas.push(`${id}: ${e instanceof Error ? e.message : "error"}`); }
            }
            if (hechos.length || fallas.length) {
                await prisma.accionSistema.create({
                    data: {
                        quien, accion: "equipos.avisos-automaticos", objetivo: `${hechos.length + fallas.length} cámaras`, ok: fallas.length === 0,
                        detalle: [hechos.length ? `Avisan a OmniAccess: ${hechos.join(", ")}` : "", fallas.length ? `No quedaron avisando: ${fallas.join(" | ")}` : ""].filter(Boolean).join(" · ").slice(0, 500),
                    },
                }).catch(() => { });
            }
        }
    } finally { corriendo = false; }
}

/** null = no corresponde (no es intrusión que avisa, o es Dahua). */
async function prepararUna(id: string): Promise<{ ok: boolean; nombre: string; errores: string[] } | null> {
    const d = await prisma.device.findUnique({ where: { id }, select: { name: true, deviceType: true, brand: true, intrusionModo: true } });
    if (!d || String(d.deviceType) !== "CAMERA" || String(d.brand).toUpperCase() !== "HIKVISION") return null;
    const modo = modoIntrusionDe({ deviceType: String(d.deviceType), intrusionModo: d.intrusionModo }, null);
    if (!modo || !MODOS_INTRUSION[modo].avisos) return null;
    const r = await arreglarIntrusion(id, ["servidor", "centro"]);
    return { ok: r.ok, nombre: d.name, errores: r.errores };
}
