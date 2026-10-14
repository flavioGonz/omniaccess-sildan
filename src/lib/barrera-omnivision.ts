import { prisma } from "@/lib/prisma";

/**
 * La barrera abierta por una lectura de OmniVision (modo «Lectura OmniVision» con «Abre la barrera»).
 *
 * Hasta ahora ninguna lectura del servidor abría nada: la lectora Hikvision abre sola con su
 * lista, y una cámara leída por omni-lpr (la .86) sólo registraba. Este es el único lugar donde
 * una lectura nuestra acciona un relé, y por eso tiene tres llaves, todas necesarias:
 *
 *  1. La cámara tiene `lprAbre` (se eligió en su ficha).
 *  2. El servidor lo tiene habilitado: OMNI_ABRE_BARRERAS=si en el .env. El lab de IES mira
 *     cámaras de un barrio en producción; si una cámara cargada allá abriera desde el lab, abriría
 *     una barrera real desde una máquina de pruebas. Por eso la llave es del servidor y no de la
 *     base: una copia de la base en otro lado no hereda el permiso de abrir.
 *  3. La decisión fue PERMITIDO (credencial cargada, no está en lista negra).
 *
 * Y una pausa por cámara: el contenedor puede leer dos veces al mismo auto esperando.
 */
const LLAVE_SERVIDOR = "OMNI_ABRE_BARRERAS";
/** Entre dos aperturas de la misma cámara: lo que tarda una barrera en abrir y cerrar. */
const PAUSA_APERTURA_MS = 15_000;

const ultimaApertura = new Map<string, number>();

export const barrerasHabilitadas = () => (process.env[LLAVE_SERVIDOR] || "").trim().toLowerCase() === "si";

/** Qué pasó con la barrera, para anotar en el evento (`Barrera: …`). Null si no correspondía intentarlo. */
export async function abrirPorLectura(deviceId: string, decision: "GRANT" | "DENY"): Promise<string | null> {
    if (decision !== "GRANT") return null;
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!d || !d.lprAbre) return null;
    if (!barrerasHabilitadas()) return `no se abrió (este servidor no abre barreras: falta ${LLAVE_SERVIDOR}=si)`;
    const antes = ultimaApertura.get(deviceId) || 0;
    if (Date.now() - antes < PAUSA_APERTURA_MS) return "ya se había abierto hace segundos";
    if (String(d.brand) !== "HIKVISION") return `no se abrió (${d.brand}: sin apertura remota)`;
    ultimaApertura.set(deviceId, Date.now());
    const { HikvisionDriver } = await import("@/lib/drivers/HikvisionDriver");
    const r = await new HikvisionDriver().abrirRele(d as any);
    return r.ok ? "abierta por OmniVision" : `no se pudo abrir: ${r.error}`;
}
