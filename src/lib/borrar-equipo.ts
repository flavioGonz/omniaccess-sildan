import { prisma } from "@/lib/prisma";

/**
 * Borrar un equipo DE TODOS LADOS (21/10, Nico: «cuando se elimina un dispositivo se tiene que
 * eliminar de todos lados; que quede sólo en Auditoría»).
 *
 * Antes era `prisma.device.delete` y nada más. Lo que no colgaba por clave foránea quedaba
 * huérfano y seguía apareciendo o trabajando: su área en el árbol, sus reglas de OmniVision, su
 * lugar en la lista de cámaras analizadas, su canal en el mapa del NVR, sus streams en go2rtc,
 * sus muestras de salud, sus detecciones, sus lecturas… y los eventos de acceso e intrusión
 * quedaban con la cámara en blanco.
 *
 * Tres limpiezas:
 *  1. Las tablas que guardan el id del equipo (con o sin relación), con deleteMany.
 *  2. Los ajustes guardados como JSON que lo nombran: se recorren y se saca toda referencia (un
 *     elemento de lista, una clave, un objeto con deviceId/id/nvr igual al equipo). Más los que van
 *     por IP (el mapa de canales del NVR, las IPs con servidor de alarma), si ningún otro equipo
 *     tiene esa IP.
 *  3. Sus streams de go2rtc (los suyos y, si es un NVR, los de sus canales).
 * Queda la fila de Auditoría con el resumen de lo que se borró.
 */

/** Las tablas con el id del equipo. El orden importa poco: ninguna depende de otra salvo por el equipo. */
const TABLAS: { modelo: string; campo: string; rotulo: string }[] = [
    { modelo: "accessEvent", campo: "deviceId", rotulo: "eventos de acceso" },
    { modelo: "intrusionEvent", campo: "deviceId", rotulo: "eventos de intrusión" },
    { modelo: "detection", campo: "deviceId", rotulo: "detecciones" },
    { modelo: "objetoVisto", campo: "deviceId", rotulo: "objetos vistos por OmniVision" },
    { modelo: "eventoVision", campo: "deviceId", rotulo: "avisos de OmniVision" },
    { modelo: "plateSighting", campo: "deviceId", rotulo: "avistamientos de matrículas" },
    { modelo: "lecturaCamara", campo: "deviceId", rotulo: "lecturas de cámara" },
    { modelo: "trackingCamaraMuestra", campo: "deviceId", rotulo: "muestras de seguimiento" },
    { modelo: "deviceHealthSample", campo: "deviceId", rotulo: "muestras de salud" },
    { modelo: "deviceAlert", campo: "deviceId", rotulo: "alertas de salud" },
    { modelo: "cameraOutage", campo: "deviceId", rotulo: "caídas registradas" },
    { modelo: "alarmaGestion", campo: "deviceId", rotulo: "gestiones de alarma" },
    { modelo: "queueAlert", campo: "deviceId", rotulo: "alertas de fila" },
    { modelo: "queueSchedule", campo: "deviceId", rotulo: "horarios de fila" },
    { modelo: "notificationRule", campo: "deviceId", rotulo: "reglas de aviso" },
    { modelo: "reportSchedule", campo: "deviceId", rotulo: "reportes programados" },
    { modelo: "dispatchJob", campo: "deviceId", rotulo: "envíos pendientes" },
    { modelo: "zonaEntrenable", campo: "deviceId", rotulo: "analíticas entrenables" },
    { modelo: "fotoEntrenamiento", campo: "deviceId", rotulo: "fotos de entrenamiento" },
];

/** Campos de un objeto guardado en un ajuste que, si valen el id, hacen que el objeto sea «del equipo». */
const CAMPOS_QUE_NOMBRAN = ["deviceId", "id", "camara", "camaraId", "nvr", "nvrId", "device"];

function sinReferencias(valor: any, id: string): { valor: any; cambio: boolean } {
    let cambio = false;
    const refiere = (x: any): boolean =>
        x === id || (typeof x === "string" && x.includes(id)) ||
        (!!x && typeof x === "object" && !Array.isArray(x) && CAMPOS_QUE_NOMBRAN.some((k) => x[k] === id));
    const limpiar = (v: any): any => {
        if (Array.isArray(v)) {
            const f = v.filter((e) => { const r = refiere(e); if (r) cambio = true; return !r; });
            return f.map(limpiar);
        }
        if (v && typeof v === "object") {
            const out: any = {};
            for (const [k, x] of Object.entries(v)) {
                if (k === id || k.includes(id) || refiere(x)) { cambio = true; continue; }
                out[k] = limpiar(x);
            }
            return out;
        }
        return v;
    };
    const valorNuevo = limpiar(valor);
    return { valor: valorNuevo, cambio };
}

export async function borrarEquipoDeTodo(id: string, quien: string | null): Promise<{ ok: boolean; nombre?: string; resumen: string[]; error?: string }> {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, ip: true, deviceType: true } });
    if (!d) return { ok: false, resumen: [], error: "El equipo ya no existe." };
    const resumen: string[] = [];

    // 1) Las tablas con su id.
    for (const t of TABLAS) {
        try {
            const r = await (prisma as any)[t.modelo].deleteMany({ where: { [t.campo]: id } });
            if (r?.count) resumen.push(`${r.count} ${t.rotulo}`);
        } catch (e: any) { console.error(`[borrar-equipo] ${t.modelo}:`, e?.message); }
    }

    // 2) Los ajustes que lo nombran (por id), y los que van por IP.
    const otrosConIp = d.ip ? await prisma.device.count({ where: { ip: d.ip, NOT: { id } } }) : 1;
    const ajustes = await prisma.setting.findMany({ where: { value: { contains: id } }, select: { key: true, value: true } });
    let ajustesTocados = 0;
    for (const a of ajustes) {
        let j: any;
        try { j = JSON.parse(a.value); } catch { continue; } // texto suelto: no se adivina
        const r = sinReferencias(j, id);
        if (r.cambio) { await prisma.setting.update({ where: { key: a.key }, data: { value: JSON.stringify(r.valor) } }); ajustesTocados++; }
    }
    if (d.ip && !otrosConIp) {
        for (const clave of ["NVR_CHANNEL_MAP", "ALARM_CONFIGURED_IPS"]) {
            const fila = await prisma.setting.findUnique({ where: { key: clave } });
            if (!fila?.value?.includes(d.ip)) continue;
            try {
                const j = JSON.parse(fila.value);
                const nuevo = Array.isArray(j) ? j.filter((x: any) => x !== d.ip) : (() => { const o = { ...j }; delete o[d.ip]; return o; })();
                await prisma.setting.update({ where: { key: clave }, data: { value: JSON.stringify(nuevo) } }); ajustesTocados++;
            } catch { }
        }
    }
    if (ajustesTocados) resumen.push(`${ajustesTocados} ${ajustesTocados === 1 ? "ajuste" : "ajustes"} (áreas, reglas, OmniVision, mapa del NVR…)`);

    // 3) Sus streams de go2rtc (y los de sus canales, si es un NVR).
    try {
        const { quitarStreams } = await import("@/lib/go2rtc-sync");
        let nombres = [`lpr_${id}`, `lpr_${id}_hd`];
        try {
            const base = process.env.GO2RTC_API || "http://127.0.0.1:1984";
            const s = await fetch(`${base}/api/streams`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => r.json());
            nombres = [...new Set([...nombres, ...Object.keys(s || {}).filter((n) => n.includes(id))])];
        } catch { }
        await quitarStreams(nombres);
    } catch (e: any) { console.error("[borrar-equipo] go2rtc:", e?.message); }

    // El equipo (lo que cuelga con cascada se va con él).
    await prisma.device.delete({ where: { id } });

    // Si estaba apagado por su área, la lista de apagados se recalcula sin él.
    try {
        const { recalcularApagados } = await import("@/lib/apagado");
        const v = (await prisma.setting.findUnique({ where: { key: "DEVICE_AREAS" } }))?.value;
        if (v) await recalcularApagados(JSON.parse(v));
    } catch { }

    // Lo único que queda: la Auditoría, con qué se fue.
    if (quien) {
        await prisma.accionSistema.create({ data: { quien, accion: "Borró el equipo de todos lados", objetivo: d.name, ok: true, detalle: resumen.length ? resumen.join(" · ").slice(0, 500) : "no tenía nada más guardado" } }).catch(() => { });
    }
    return { ok: true, nombre: d.name, resumen };
}
