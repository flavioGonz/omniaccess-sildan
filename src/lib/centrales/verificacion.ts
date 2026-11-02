import { prisma } from "@/lib/prisma";
import { uploadToS3 } from "@/lib/s3";
import { camarasDeEvento, describirCamaras, type OrigenCamaras } from "@/lib/centrales/camaras";
import { veredicto as veredictoDe, ORDEN_VEREDICTO, type Analisis, type Veredicto } from "@/lib/vision-capa";

/**
 * La video verificación de un evento de central con OmniVision (2/11, Nico: «la ventana del evento
 * de central debe traer las capturas de las cámaras de cada zona, analizarlas y volver a verificar
 * con OmniVision»).
 *
 * Las fotos son de dos momentos:
 *  · del EVENTO: alarm-receiver saca un cuadro de cada cámara de la zona apenas llega la alarma
 *    (`details.fotos`);
 *  · de AHORA: las que pide el operador desde la ficha con «Volver a verificar»
 *    (`details.fotosAhora`). Sirven cuando el evento no trajo fotos (la zona no tenía cámaras en
 *    ese momento, o las cámaras no respondieron) y para ver si sigue habiendo alguien.
 * vision-analisis.js mira todas (una por cámara y momento) y guarda lo que vio en
 * `verifAnalisis.central`. El veredicto se calcula acá, sin geometría (una zona de central no tiene
 * línea): «hay alguien», «animal» o «nadie», y vale el más fuerte entre todas las fotos.
 */

export type MomentoFoto = "evento" | "ahora";
export type FotoGuardada = { camara: string; foto: string };
export type FotoCentral = {
    camara: string; nombre: string; foto: string; momento: MomentoFoto; en: string;
    /** Para el vivo y la grabación de esa cámara desde la ficha. */
    deviceId: string | null; grabador: boolean;
    analisis: Analisis | null; veredicto: Veredicto | null;
    /** La cámara no está elegida para OmniVision (Ajustes): la foto se ve, pero no se analizó. */
    fuera: boolean;
};
export type VerificacionCentral = {
    /** OK · PEDIDA (fotos de ahora en cola) · SIN_CAMARAS · SIN_FOTO · FUERA (ninguna cámara está en OmniVision) · ERROR · null (todavía no). */
    estado: string | null;
    veredicto: Veredicto | null;
    /** La foto que dio el veredicto (la primera con el veredicto más fuerte). */
    fuente: string | null;
    fotos: FotoCentral[];
    /** Las cámaras que tiene HOY la zona: si son cero, la ficha ofrece elegirlas. */
    config: { zona: number | null; origen: OrigenCamaras; area: string | null; camaras: number };
    pedida: { en: string; quien: string | null } | null;
};

type Detalles = { zona?: number | null; fotos?: FotoGuardada[]; fotosAhora?: { en: string; quien?: string | null; fotos: FotoGuardada[] } };
const leerDetalles = (d: string | null): Detalles => { try { return JSON.parse(d || "{}") || {}; } catch { return {}; } };

/** Las fotos de un evento, las del momento primero, en el orden en que se sacaron. */
export function fotosDe(det: { timestamp: Date; details: string | null }): { camara: string; foto: string; momento: MomentoFoto; en: string }[] {
    const d = leerDetalles(det.details);
    const evento = (Array.isArray(d.fotos) ? d.fotos : []).filter((f) => f?.foto).map((f) => ({ camara: String(f.camara), foto: String(f.foto), momento: "evento" as const, en: det.timestamp.toISOString() }));
    const ahora = (Array.isArray(d.fotosAhora?.fotos) ? d.fotosAhora!.fotos : []).filter((f) => f?.foto).map((f) => ({ camara: String(f.camara), foto: String(f.foto), momento: "ahora" as const, en: d.fotosAhora!.en }));
    return [...evento, ...ahora];
}

async function centralDe(deviceId: string | null) {
    return deviceId ? prisma.centralAlarma.findUnique({ where: { deviceId }, select: { id: true } }) : null;
}

export async function verificacionCentral(id: string): Promise<VerificacionCentral | null> {
    const det = await prisma.detection.findUnique({ where: { id }, select: { type: true, deviceId: true, timestamp: true, details: true, verifEstado: true, verifAnalisis: true } });
    if (!det || det.type !== "CENTRAL") return null;
    const d = leerDetalles(det.details);
    const zona = d.zona ?? null;
    const central = await centralDe(det.deviceId);
    const [hoy, lista] = await Promise.all([
        camarasDeEvento(central?.id, zona).catch(() => ({ camaras: [], origen: "ninguna" as OrigenCamaras, area: null, otras: [] })),
        Promise.resolve(fotosDe(det)),
    ]);
    const refs = await describirCamaras([...new Set(lista.map((f) => f.camara))]);
    const ref = new Map(refs.map((r) => [r.id, r]));
    const vistos = new Map<string, Analisis>();
    const a = det.verifEstado === "OK" ? (det.verifAnalisis as any) : null;
    for (const x of Array.isArray(a?.central) ? a.central : []) if (x?.foto) vistos.set(String(x.foto), x as Analisis);
    const fuera = new Set<string>(Array.isArray(a?.fuera) ? a.fuera.map(String) : []);
    const fotos: FotoCentral[] = lista.map((f) => {
        const an = vistos.get(f.foto) || null;
        const r = ref.get(f.camara);
        return { ...f, nombre: r?.nombre || "Cámara", deviceId: r?.deviceId ?? null, grabador: !!r?.grabador, analisis: an, veredicto: an ? veredictoDe(an, null).estado : null, fuera: det.verifEstado === "FUERA" || fuera.has(f.foto) };
    });
    const con = fotos.filter((f) => f.veredicto);
    const mejor = con.sort((x, y) => ORDEN_VEREDICTO.indexOf(x.veredicto!) - ORDEN_VEREDICTO.indexOf(y.veredicto!))[0] || null;
    return {
        estado: det.verifEstado, veredicto: mejor?.veredicto ?? null, fuente: mejor?.foto ?? null, fotos,
        config: { zona, origen: hoy.origen, area: hoy.area, camaras: hoy.camaras.length },
        pedida: d.fotosAhora ? { en: d.fotosAhora.en, quien: d.fotosAhora.quien ?? null } : null,
    };
}

const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
/** Un cuadro de una cámara por go2rtc, como alarm-receiver (fotoDe) y el diagnóstico de imagen. */
async function cuadro(camara: string): Promise<Buffer | null> {
    const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(`lpr_${camara}`)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 2000 ? b : null;
}

/**
 * «Volver a verificar»: un cuadro de AHORA de cada cámara que la zona tiene HOY (si se le asignaron
 * cámaras después del evento, ya cuentan), al bucket de las alarmas, y el evento vuelve a la cola de
 * OmniVision, que mira las del momento y éstas.
 */
export async function verificarAhora(id: string, quien: string | null): Promise<{ ok: true; fotos: number } | { ok: false; error: string; status: number; sinCamaras?: boolean }> {
    const det = await prisma.detection.findUnique({ where: { id }, select: { type: true, deviceId: true, details: true } });
    if (!det || det.type !== "CENTRAL") return { ok: false, error: "No es un evento de central.", status: 404 };
    const d = leerDetalles(det.details);
    const central = await centralDe(det.deviceId);
    const hoy = await camarasDeEvento(central?.id, d.zona ?? null).catch(() => null);
    const camaras = (hoy?.camaras || []).slice(0, 4);
    if (!camaras.length) return { ok: false, status: 409, sinCamaras: true, error: d.zona != null ? `La zona ${d.zona} no tiene cámaras, ni su área ni el abonado.` : "El abonado no tiene cámaras." };
    const t = Date.now();
    const subidas = await Promise.all(camaras.map(async (c, i) => {
        const b = await cuadro(c.id);
        if (!b) return null;
        const foto = await uploadToS3(b, `${id}-ahora-${t}-${i}.jpg`, "image/jpeg", "alarmas").catch(() => null);
        return foto ? { camara: c.id, foto } : null;
    }));
    const fotos = subidas.filter(Boolean) as FotoGuardada[];
    if (!fotos.length) return { ok: false, status: 502, error: `Ninguna de las ${camaras.length} cámaras de la zona dio un cuadro.` };
    await prisma.detection.update({
        where: { id },
        data: { details: JSON.stringify({ ...d, fotosAhora: { en: new Date(t).toISOString(), quien, fotos } }), verifAt: null, verifEstado: "PEDIDA", verifError: null },
    });
    return { ok: true, fotos: fotos.length };
}
