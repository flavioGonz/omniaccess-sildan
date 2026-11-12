/**
 * El reloj de las capturas programadas para el conjunto de entrenamiento (openspec
 * capturas-programadas-entrenamiento). Vive en vision-worker, al lado de vision-zonas.js.
 *
 * Una vez por minuto mira qué programación tiene su hora cumplida (o un «Tomar ahora» pendiente)
 * y le pide a la aplicación que dé la vuelta. No toma la foto acá: elegir el stream, registrar el
 * canal del grabador y guardar con el tope de tamaño ya está escrito en la aplicación, para
 * «Sacar foto ahora» (cuadroDeCamara). Dos copias se iban a separar.
 *
 * No usa la GPU ni omni-vision: sigue andando mientras el entrenador tiene parado el detector,
 * que es justo cuando más se quieren fotos nuevas.
 *
 * Cada pasada deja un latido en Setting: la pantalla lo mira para no mostrar una «próxima vuelta»
 * que no va a ocurrir si este proceso está caído.
 */
const APP = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:10001").replace(/\/$/, "");
/** Cada cuánto se mira si a alguna le toca (la cadencia de cada una la pone su `cadaMin`). */
const PASADA_MS = 60_000;
/** Una vuelta de 30 cámaras que no dan cuadro son 30 × 16 s: con esto sobra, y si se cuelga no frena el reloj para siempre. */
const TIEMPO_VUELTA_MS = 12 * 60_000;
/** La misma clave que CLAVE_LATIDO en src/lib/capturas-programadas.ts: si cambia allá, cambia acá. */
const CLAVE_LATIDO = "CAPTURAS_LATIDO";

function iniciar({ prisma, log }) {
    const contadores = { vueltas: 0, guardadas: 0, salteadas: 0, fallos: 0, errores: 0, ultimoError: null };
    let corriendo = true;

    async function token() {
        return process.env.TRACKING_TOKEN || (await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } }).catch(() => null))?.value || "";
    }

    async function pasada() {
        const ahora = new Date();
        await prisma.setting.upsert({ where: { key: CLAVE_LATIDO }, update: { value: ahora.toISOString() }, create: { key: CLAVE_LATIDO, value: ahora.toISOString() } });
        // Sólo las que pueden tener algo que hacer; el resto de las reglas (tope, fecha, cola, franja) las decide la vuelta.
        const tocan = await prisma.capturaProgramada.findMany({
            where: { activa: true, terminada: null, OR: [{ proximaAt: { lte: ahora } }, { forzarAt: { not: null } }] },
            select: { id: true, nombre: true }, orderBy: { proximaAt: "asc" },
        });
        if (!tocan.length) return;
        const t = await token();
        if (!t) throw new Error("falta TRACKING_TOKEN: la aplicación no acepta la vuelta sin él");
        // De a una programación: dos a la vez sobre el mismo grabador es la carga que se quiere evitar.
        for (const p of tocan) {
            if (!corriendo) return;
            try {
                const r = await fetch(`${APP}/api/vision/objetos/capturas/vuelta`, {
                    method: "POST", headers: { "content-type": "application/json", "x-tracking-token": t }, body: JSON.stringify({ id: p.id }), signal: AbortSignal.timeout(TIEMPO_VUELTA_MS),
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j.error || `la aplicación respondió ${r.status}`);
                if (j.que === "tomar") {
                    contadores.vueltas++; contadores.guardadas += j.guardadas; contadores.salteadas += j.salteadas; contadores.fallos += j.fallos;
                    log(`capturas «${p.nombre}»: ${j.guardadas} guardadas, ${j.salteadas} repetidas${j.fallos ? `, ${j.fallos} sin cuadro` : ""} (${Math.round(j.ms / 100) / 10} s)`);
                }
            } catch (e) {
                contadores.errores++; contadores.ultimoError = String(e.message).slice(0, 200);
                log(`capturas «${p.nombre}»: ${e.message}`);
            }
        }
    }

    (async () => {
        while (corriendo) {
            try { await pasada(); }
            catch (e) { contadores.errores++; contadores.ultimoError = String(e.message).slice(0, 200); log("capturas:", e.message); }
            await new Promise((r) => setTimeout(r, PASADA_MS));
        }
    })();

    return { contadores, parar: () => { corriendo = false; } };
}

module.exports = { iniciar };
