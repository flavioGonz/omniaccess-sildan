import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureAlert, resolveAlert } from "@/lib/device-health";

/**
 * La salud de las centrales de alarma, en la vuelta de la salud (cada minuto):
 *  · SUPERVISIÓN: una central que pasa dos períodos (más un margen) sin mandar nada — ni un NULL ni
 *    la prueba periódica — queda «Sin supervisión» y se alerta. Con el próximo mensaje el receptor
 *    la vuelve a «En línea» y acá se cierra la alerta.
 *  · FALLAS: corte de corriente, batería baja, comunicación… quedan abiertas mientras el último
 *    evento de ese tipo sea la falla y no su fin.
 * Una central de PRUEBA (el simulador) anota las alertas pero no manda Telegram: no le llega nada
 * a la guardia por una prueba.
 */
const MARGEN_SEG = 60;
const VENTANA_FALLAS_MS = 7 * 24 * 3600_000;

async function alertar(prueba: boolean, deviceId: string, nombre: string, tipo: string, severidad: string, texto: string) {
    if (!prueba) return ensureAlert(deviceId, nombre, tipo, severidad, texto);
    const ya = await prisma.deviceAlert.findFirst({ where: { deviceId, type: tipo, active: true } });
    if (!ya) await prisma.deviceAlert.create({ data: { deviceId, type: tipo, severity: severidad, message: `${texto} (central de prueba: sin aviso)`, active: true } });
}
async function cerrar(prueba: boolean, deviceId: string, nombre: string, tipo: string) {
    if (!prueba) return resolveAlert(deviceId, nombre, tipo);
    const ya = await prisma.deviceAlert.findFirst({ where: { deviceId, type: tipo, active: true } });
    if (ya) await prisma.deviceAlert.update({ where: { id: ya.id }, data: { active: false, resolvedAt: new Date() } });
}

export async function evaluarCentrales(): Promise<number> {
    const centrales = await prisma.centralAlarma.findMany({ include: { device: { select: { name: true } } } });
    const ahora = Date.now();
    for (const c of centrales) {
        const nombre = c.device?.name || `Central ${c.cuenta}`;
        // Supervisión
        if (c.ultimoMensajeAt) {
            const callada = ahora - c.ultimoMensajeAt.getTime() > (2 * c.supervisionSeg + MARGEN_SEG) * 1000;
            if (callada && c.estado !== "SIN_SUPERVISION") {
                await prisma.centralAlarma.update({ where: { id: c.id }, data: { estado: "SIN_SUPERVISION" } });
                await alertar(c.prueba, c.deviceId, nombre, "central", "critical", `Sin supervisión: la central no reporta desde ${c.ultimoMensajeAt.toLocaleString("es-UY", { timeZone: "America/Montevideo" })} (espera algo cada ${Math.round(c.supervisionSeg / 60)} min).`);
            } else if (!callada) {
                await cerrar(c.prueba, c.deviceId, nombre, "central");
            }
        }
        // Fallas abiertas: el último evento de cada tipo manda.
        const msgs = await prisma.mensajeCentral.findMany({ where: { centralId: c.id, respuesta: "ACK", recibido: { gte: new Date(ahora - VENTANA_FALLAS_MS) }, eventos: { not: Prisma.AnyNull } }, orderBy: { recibido: "asc" }, select: { eventos: true } }).catch(() => []);
        const ultimo = new Map<string, { abierta: boolean; texto: string }>();
        for (const m of msgs) for (const e of ((m.eventos as any[]) || [])) {
            if (e?.categoria === "FALLA") ultimo.set(e.tipo, { abierta: true, texto: e.texto });
            else if (e?.categoria === "FALLA_FIN") ultimo.set(e.tipo, { abierta: false, texto: e.texto });
        }
        for (const [tipo, f] of ultimo) {
            const clave = `central-falla-${String(tipo).toLowerCase()}`;
            if (f.abierta) await alertar(c.prueba, c.deviceId, nombre, clave, "warning", `Falla en la central: ${f.texto}.`);
            else await cerrar(c.prueba, c.deviceId, nombre, clave);
        }
    }
    return centrales.length;
}
