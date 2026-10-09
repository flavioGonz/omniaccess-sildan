import { prisma } from "@/lib/prisma";
import { esperarVeredicto, anotarAviso, AVISAN } from "@/lib/doble-verificacion";
import { VEREDICTOS, type Veredicto } from "@/lib/vision-capa";
import { enqueueDispatch } from "@/lib/dispatch-queue";
import { fecha, hora } from "@/lib/fechas";
import { ventanaAlerta } from "@/lib/clip-instante";
import { MARGEN_GRABACION_SEG } from "@/lib/clips";

/**
 * Motor de reglas de notificación, compartido por los tres modos.
 *
 * Hasta ahora las reglas solo servían para Filas (aforo/entrada/salida) y LPR
 * mandaba un Telegram por su cuenta, salteándose destinatarios, horarios,
 * plantillas y antirrebote. Acá entran los tres por la misma puerta.
 */

export type Modulo = "QUEUE" | "LPR" | "FACE" | "INTRUSION";

export type EventoNotificable = {
    modulo: Modulo;
    /** ALLOW | DENY | UNKNOWN | WATCHLIST — y en INTRUSION: LINECROSS | INTRUSION | REGION_ENTER | REGION_EXIT */
    evento: string;
    /** Intrusión: qué clasificó la cámara (human | vehicle), si lo dijo. */
    clase?: string | null;
    deviceId?: string | null;
    deviceName?: string | null;
    /** Matrícula (LPR) o nombre de la persona (FACE). */
    plate?: string | null;
    personName?: string | null;
    direction?: string | null;
    snapshotPath?: string | null;
    /**
     * Cuándo pasó (ISO o epoch ms). El clip de la alerta se corta alrededor de este momento;
     * si falta se usa el de encolado, que llega tarde lo que tarde el evento en llegar acá.
     */
    instante?: string | number | null;
    extra?: Record<string, any>;
};

type Destinatario = { id: string; name: string; channel: string; address: string; enabled: boolean };
type Plantilla = { id: string; name: string; channel: string; body: string };

async function ajuste<T>(clave: string, porDefecto: T): Promise<T> {
    try {
        const s = await prisma.setting.findUnique({ where: { key: clave } });
        if (!s?.value) return porDefecto;
        return JSON.parse(s.value) as T;
    } catch { return porDefecto; }
}

const ETIQUETA: Record<string, string> = {
    ALLOW: "Acceso permitido",
    DENY: "Acceso denegado",
    UNKNOWN: "No reconocido",
    WATCHLIST: "Vehículo en seguimiento",
    PARKED: "Vehículo estacionó",
    LEFT: "Vehículo se retiró",
    LINECROSS: "Cruce de línea",
    INTRUSION: "Intrusión en zona",
    REGION_ENTER: "Entrada a zona",
    REGION_EXIT: "Salida de zona",
};
const CLASE: Record<string, string> = { human: "Persona", vehicle: "Vehículo" };

/** Reemplaza las variables de la plantilla con lo que trae el evento. */
function armarTexto(plantilla: string | null, ev: EventoNotificable, ahora: Date) {
    const quien = ev.plate || ev.personName || "—";
    const vars: Record<string, string> = {
        "{evento}": ETIQUETA[ev.evento] || ev.evento,
        "{modulo}": ev.modulo,
        "{device}": ev.deviceName || "—",
        "{zone}": ev.deviceName || "—",
        "{channel}": ev.direction === "EXIT" ? "Salida" : "Entrada",
        "{plate}": ev.plate || "—",
        "{persona}": ev.personName || "—",
        "{quien}": quien,
        "{time}": hora(ahora),
        "{date}": fecha(ahora),
        "{clase}": CLASE[String(ev.clase || "")] || "—",
        "{count}": String(ev.extra?.count ?? ""),
        "{threshold}": String(ev.extra?.threshold ?? ""),
        "{wait}": String(ev.extra?.wait ?? ""),
    };
    const base = plantilla || (ev.modulo === "FACE"
        ? "👤 {evento}\n{persona}\n{device} · {channel}\n{date} {time}"
        : ev.modulo === "INTRUSION"
            ? "🚨 {evento}\n{device} · {clase}\n{date} {time}"
            : "🚗 {evento}\n{plate}\n{device} · {channel}\n{date} {time}");
    return Object.entries(vars).reduce((t, [k, v]) => t.split(k).join(v), base);
}

/** ¿La regla está dentro de su ventana de días y horas? */
function enHorario(regla: any, ahora: Date) {
    const dia = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const dias = String(regla.daysOfWeek || "1,2,3,4,5,6,7").split(",").map((d: string) => Number(d.trim()));
    if (!dias.includes(dia)) return false;
    const hhmm = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
    const desde = regla.startTime || "00:00";
    const hasta = regla.endTime || "23:59";
    // Una ventana que cruza la medianoche (22:00 a 06:00) también tiene que valer.
    return desde <= hasta ? hhmm >= desde && hhmm <= hasta : hhmm >= desde || hhmm <= hasta;
}

/**
 * Evalúa las reglas del módulo y encola lo que corresponda. Nunca lanza: una
 * notificación que falla no puede frenar un acceso.
 */
export async function notificarEvento(ev: EventoNotificable): Promise<number> {
    try {
        const ahora = new Date();
        const reglas = await prisma.notificationRule.findMany({
            where: { enabled: true, modulo: ev.modulo as any },
        });
        if (reglas.length === 0) return 0;

        const [destinatarios, plantillas] = await Promise.all([
            ajuste<Destinatario[]>("DISPATCH_RECIPIENTS", []),
            ajuste<Plantilla[]>("DISPATCH_TEMPLATES", []),
        ]);

        let encolados = 0;

        // Con el clip en alertas prendido, WhatsApp y Telegram esperan a que exista el tramo
        // posterior del video (segundos "después" + lo que tarda el NVR en exponerlo). Apagado,
        // salen al instante como siempre. Se calcula una vez por evento.
        const conClip = (await prisma.setting.findUnique({ where: { key: "DISPATCH_ANIMATED" } }).catch(() => null))?.value === "true";
        const demoraClipMs = conClip ? ((await ventanaAlerta()).despues + MARGEN_GRABACION_SEG) * 1000 : 0;
        const instante = ev.instante != null && !Number.isNaN(new Date(ev.instante as any).getTime()) ? new Date(ev.instante as any) : ahora;

        /** Encola los avisos de una regla por todos sus canales y destinatarios. `veredicto`: el de omni-vision, si se esperó. */
        const encolar = async (regla: (typeof reglas)[number], veredicto?: string | null): Promise<number> => {
            let n = 0;
            const canales = String(regla.channels || "telegram").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

            for (const canal of canales) {
                const plantilla = plantillas.find((t) => t.channel === canal) || plantillas.find((t) => t.channel === "all");
                // La hora del texto es la del evento, no la de encolado: con el clip la alerta sale unos segundos después.
                // Si se esperó a omni-vision, el aviso lo dice: quien lo recibe sabe que no es una sombra.
                const texto = armarTexto(plantilla?.body || null, ev, instante) + (veredicto && VEREDICTOS[veredicto as Veredicto] ? `\nVerificado por omni-vision: ${VEREDICTOS[veredicto as Veredicto].rotulo.toLowerCase()}` : "");

                // Un despacho por destinatario de ese canal; si no hay ninguno,
                // uno solo y que el worker use el destino por defecto.
                const suyos = destinatarios.filter((d) => d.enabled !== false && d.channel === canal && d.address);
                const objetivos: (string | null)[] = suyos.length ? suyos.map((d) => d.address) : [null];

                for (const destino of objetivos) {
                    await enqueueDispatch({
                        type: "ALERT",
                        channel: canal,
                        delayMs: canal === "whatsapp" || canal === "telegram" ? Math.max(0, demoraClipMs - (Date.now() - instante.getTime())) : 0,
                        ruleId: regla.id,
                        deviceId: ev.deviceId || null,
                        payload: {
                            evento: ev.evento,
                            modulo: ev.modulo,
                            ruleName: regla.name,
                            deviceName: ev.deviceName,
                            channelName: ev.modulo === "INTRUSION" ? (CLASE[String(ev.clase || "")] || "Intrusión") : (ev.direction === "EXIT" ? "Salida" : "Entrada"),
                            plate: ev.plate || null,
                            persona: ev.personName || null,
                            asunto: `${ETIQUETA[ev.evento] || ev.evento} · ${ev.plate || ev.personName || ev.deviceName || ""}`.trim(),
                            snapshotPath: ev.snapshotPath || null,
                            instante: instante.toISOString(),
                            text: texto,
                            ...(destino ? { to: destino, chatId: destino } : {}),
                            ...(ev.extra || {}),
                            ...(veredicto ? { verificacion: veredicto } : {}),
                        },
                    });
                    n++;
                }
            }

            return n;
        };
        const diferidas: (typeof reglas)[number][] = [];

        for (const regla of reglas) {
            // Cámara: null en la regla significa "cualquiera".
            if (regla.deviceId && regla.deviceId !== ev.deviceId) continue;

            // Evento: vacío significa "cualquiera".
            const pedidos = String(regla.eventos || "").split(",").map((e) => e.trim().toUpperCase()).filter(Boolean);
            if (pedidos.length && !pedidos.includes(ev.evento.toUpperCase())) continue;

            if (!enHorario(regla, ahora)) continue;

            // Antirrebote: no repetir la misma regla dentro de su enfriamiento.
            if (regla.cooldownSec > 0 && regla.lastFiredAt) {
                const pasaron = (ahora.getTime() - new Date(regla.lastFiredAt).getTime()) / 1000;
                if (pasaron < regla.cooldownSec) continue;
            }

            // Doble verificación: la regla espera a omni-vision (lib/doble-verificacion), fuera de este pedido.
            if (ev.modulo === "INTRUSION" && (regla as any).verificacion === "confirmada") { diferidas.push(regla); continue; }

            encolados += await encolar(regla);
            await prisma.notificationRule.update({
                where: { id: regla.id },
                data: { lastFiredAt: ahora },
            }).catch(() => { });
        }

        if (diferidas.length) void (async () => {
            const { detectionId, veredicto } = await esperarVeredicto(ev);
            const avisa = veredicto == null || AVISAN.includes(veredicto);
            await anotarAviso(detectionId, veredicto == null ? "SIN_VEREDICTO" : avisa ? "ENVIADO" : "RETENIDO");
            if (!avisa) { console.log(`[reglas] aviso retenido por la doble verificación: ${ev.deviceName || ev.deviceId} · ${veredicto}`); return; }
            for (const regla of diferidas) {
                await encolar(regla, veredicto);
                await prisma.notificationRule.update({ where: { id: regla.id }, data: { lastFiredAt: new Date() } }).catch(() => { });
            }
        })().catch((e) => console.error("[reglas] doble verificación:", e?.message || e));

        return encolados;
    } catch (e: any) {
        console.error("[reglas] fallo evaluando notificaciones:", e?.message || e);
        return 0;
    }
}
