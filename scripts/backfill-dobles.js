// Recorre todo el historial LPR por cámara y marca las dobles capturas (idempotente).
const { PrismaClient } = require('@prisma/client');
const { repite, chapa, VENTANA_MISMA_MS, VENTANA_CERCA_MS, NL } = require('../lib-dobles');
const p = new PrismaClient();
(async () => {
    const devs = await p.device.findMany({ where: { deviceType: 'LPR_CAMERA' }, select: { id: true, name: true } });
    let total = 0;
    for (const d of devs) {
        const evs = (await p.accessEvent.findMany({ where: { deviceId: d.id }, select: { id: true, timestamp: true, plateDetected: true }, orderBy: { timestamp: 'asc' } }))
            .map((e) => ({ id: e.id, t: e.timestamp.getTime(), plate: e.plateDetected }));
        const dup = new Map(); // id -> id original
        let ini = 0;
        for (let k = 0; k < evs.length; k++) {
            const e = evs[k];
            while (evs[ini].t < e.t - VENTANA_MISMA_MS) ini++;
            for (let m = k - 1; m >= ini; m--) {
                const q = evs[m];
                if (chapa(e.plate) !== NL && chapa(q.plate) === NL && e.t - q.t <= VENTANA_CERCA_MS) { if (!dup.has(q.id)) dup.set(q.id, e.id); continue; }
                if (repite(e, q)) { dup.set(e.id, q.id); break; }
            }
        }
        // agrupar por original para pocas consultas
        const ids = [...dup.keys()];
        for (let i = 0; i < ids.length; i += 500) {
            const lote = ids.slice(i, i + 500);
            await p.$transaction(lote.map((id) => p.accessEvent.update({ where: { id }, data: { isDuplicate: true, duplicateOfId: dup.get(id) } })));
        }
        total += ids.length;
        console.log(`${d.name.padEnd(22)} eventos ${String(evs.length).padStart(6)}  dobles ${String(ids.length).padStart(6)}  (${evs.length ? Math.round(ids.length * 100 / evs.length) : 0}%)`);
    }
    console.log('TOTAL dobles', total);
})().finally(() => p.$disconnect());
