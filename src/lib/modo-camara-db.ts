import { prisma } from "@/lib/prisma";
import { esModoIntrusion, esModoLpr, type ModoIntrusion, type ModoLpr } from "@/lib/modo-camara";

/**
 * Poner el modo de una cámara (ver src/lib/modo-camara.ts); la acción del panel está en
 * app/actions/modo-camara.ts. Acá sólo se guarda lo que decide OmniAccess; NO se configura la cámara (servidor de alarmas, ANPR): eso lo hacen la puesta a
 * punto y el calibrador, que se ven paso por paso. Así este cambio es seguro desde cualquier
 * servidor, también desde el lab, que mira cámaras de un barrio y no debe tocarlas.
 *
 * Devuelve lo que queda pendiente para que el modo funcione de verdad, en palabras: un modo
 * que se ve elegido y no anda es un control que miente.
 */
export type PedidoModo = { lpr?: { modo: ModoLpr; abre?: boolean }; intrusion?: ModoIntrusion };

async function ajuste(clave: string) {
    return (await prisma.setting.findUnique({ where: { key: clave } }).catch(() => null))?.value ?? null;
}

/** Lo que el servidor tiene prendido y hace falta para cada modo. Se muestra al elegir. */
export async function capacidadesModo(): Promise<{ lector: boolean; relectura: boolean; verifIntrusion: boolean; abreBarreras: boolean }> {
    const { barrerasHabilitadas } = await import("@/lib/barrera-omnivision");
    let analiticas: Record<string, boolean> = {};
    try { analiticas = JSON.parse((await ajuste("VISION_ANALITICAS")) || "{}") || {}; } catch { }
    return {
        lector: (await ajuste("OMNI_LPR_ENABLED")) === "true",
        relectura: analiticas.relectura !== false,
        verifIntrusion: analiticas["verif-intrusion"] !== false,
        abreBarreras: barrerasHabilitadas(),
    };
}

/** Sin chequeo de sesión: lo llaman la acción del panel y la importación de canales (que ya lo chequearon). */
export async function aplicarModoCamara(id: string, pedido: PedidoModo): Promise<{ ok: boolean; error?: string; pendientes: string[] }> {
    const d = await prisma.device.findUnique({ where: { id } });
    if (!d) return { ok: false, error: "El equipo no existe.", pendientes: [] };
    const tipo = String(d.deviceType);
    const pendientes: string[] = [];
    const cap = await capacidadesModo();

    if (pedido.lpr) {
        const { modo, abre } = pedido.lpr;
        if (!esModoLpr(modo)) return { ok: false, error: `Modo LPR desconocido: ${modo}`, pendientes };
        if (!(tipo === "LPR_CAMERA" || tipo === "LPR_INTERIOR")) return { ok: false, error: "Sólo una cámara LPR tiene modo de lectura.", pendientes };
        if (tipo === "LPR_INTERIOR" && !d.trackAcceso) {
            // Una interior de seguimiento no se convierte en lectora de barrera por accidente.
            return { ok: false, error: "Es una cámara de seguimiento interior: se cambia desde su formulario.", pendientes };
        }
        let data: Record<string, unknown>;
        if (modo === "omnivision") {
            let rtsp = d.rtspUrl?.trim() || null;
            if (!rtsp && d.ip) { const { rtspDirect } = await import("@/lib/go2rtc-sync"); rtsp = rtspDirect(d as any, "101"); }
            data = { deviceType: "LPR_INTERIOR", trackAcceso: true, trackEnabled: true, lprVerifica: false, lprAbre: !!abre, rtspUrl: rtsp };
            if (!rtsp) pendientes.push("Falta el video (RTSP) de la cámara: sin eso omni-lpr no tiene qué leer.");
            if (!cap.lector) pendientes.push("El lector (Modos › LPR) está apagado: hasta prenderlo no se lee nada.");
            if (abre && !cap.abreBarreras) pendientes.push("Este servidor no abre barreras (falta OMNI_ABRE_BARRERAS=si): las lecturas se registran sin abrir.");
            if (!d.trackRoi && !d.trackLine) pendientes.push("Dibujale la zona o la línea de lectura en el calibrador: sin eso lee todo el cuadro.");
        } else {
            data = { deviceType: "LPR_CAMERA", trackAcceso: false, trackEnabled: false, lprVerifica: modo === "doble", lprAbre: false };
            if (modo === "doble" && !cap.lector) pendientes.push("El lector (Modos › LPR) está apagado: hasta prenderlo no se verifica nada.");
            if (modo === "doble" && !cap.relectura) pendientes.push("La relectura está apagada en OmniVision › Analíticas: hasta prenderla no se verifica nada.");
        }
        const nuevo = await prisma.device.update({ where: { id }, data: data as any });
        try { const { syncLprStream } = await import("@/lib/go2rtc-sync"); await syncLprStream(nuevo as any); } catch { }
    }

    if (pedido.intrusion) {
        const modo = pedido.intrusion;
        if (!esModoIntrusion(modo)) return { ok: false, error: `Modo de intrusión desconocido: ${modo}`, pendientes };
        if (tipo !== "CAMERA") return { ok: false, error: "Sólo una cámara de intrusión tiene ese modo.", pendientes };
        await prisma.device.update({ where: { id }, data: { intrusionModo: modo } });
        if (modo === "omnivision" || modo === "video") {
            // Sin el análisis prendido OmniVision no la mira: ni reglas propias ni registro para la búsqueda.
            const { ponerVision } = await import("@/lib/vision-camaras");
            await ponerVision(id, true);
        }
        if (modo === "doble" && !cap.verifIntrusion) pendientes.push("La verificación de intrusión está apagada en OmniVision › Analíticas: hasta prenderla los avisos pasan sin verificar.");
        if (modo === "omnivision") pendientes.push("Dibujale la línea o la zona en OmniVision › Reglas, sobre esta cámara.");
    }

    return { ok: true, pendientes };
}
