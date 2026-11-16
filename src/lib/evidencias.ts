/**
 * Evidencias: los videos que alguien decidió guardar o mandar, en un solo lugar.
 *
 * Por qué (16/11, Nico: «los clips guardados de seguimiento deben tener un elemento del menú,
 * Evidencias… clips enviados por WhatsApp, Telegram, clips de visual track, todo en ese módulo,
 * que guardará entiendo en MinIO como el resto. Verificá esto»). Verificado ese día en el lab:
 *
 *  · Lo que se graba con el botón Grabar (una cámara o varias, siguiendo a alguien por el
 *    seguimiento visual) SÍ queda en el almacén, con su portada. Pero sólo se veía en la bandeja
 *    del que lo grabó, las últimas 24 horas: después quedaba guardado y sin ninguna pantalla.
 *  · Un clip mandado por WhatsApp o Telegram desde la grabación NO quedaba guardado: se armaba en
 *    una carpeta temporal que se limpia a los 10 minutos. Quedaba el registro (quién, a quién,
 *    de qué cámara y momento) en Despachos, mezclado con las alertas, y el video se perdía.
 *  · Por correo no se manda ningún clip.
 *
 * Acá sólo la forma: de las filas de la base a una lista pareja. Sin base ni red (la usan el
 * servidor, la pantalla y las pruebas).
 */
export type EnvioEvidencia = { canal: string; estado: string; a: string[]; cuando: string; por: string | null; error: string | null };
export type Evidencia = {
    id: string;
    /** «grabado»: con el botón Grabar. «enviado»: un clip o un evento mandado desde el panel. */
    origen: "grabado" | "enviado";
    /** Cuándo se guardó o se mandó, y de qué momento es el video. */
    cuando: string; instante: string | null;
    titulo: string; detalle: string | null; quien: string | null;
    segundos: number | null; camaras: number | null;
    /** El video y su portada en el almacén. Sin video: `sinVideo` dice por qué. */
    video: string | null; foto: string | null; sinVideo: string | null;
    /** El nombre del archivo, para volver a mandarlo. */
    archivo: string | null;
    deviceId: string | null; matricula: string | null;
    envios: EnvioEvidencia[];
};

export type FilaClip = { id: string; usuario: string | null; usuarioId: string; rotulo: string | null; nombre: string | null; guardado: string | null; foto: string | null; segundos: number | null; camaras: number | null; tramos: unknown; creado: Date; terminado: Date | null };
export type FilaDespacho = { id: string; type: string; channel: string; status: string; payload: unknown; deviceId: string | null; lastError: string | null; createdAt: Date };

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
type Carga = Record<string, unknown>;
const cargaDe = (j: FilaDespacho): Carga => (j.payload && typeof j.payload === "object" ? (j.payload as Carga) : {});
/** Un teléfono o un chat no se muestra entero en una lista: alcanza con reconocerlo. */
export const disimular = (d: string) => (d.length > 4 ? `…${d.slice(-4)}` : d);

/** ¿Es un evento compartido a mano desde el panel? (Las alertas automáticas de las reglas no son evidencia: son avisos.) */
export const esCompartido = (j: FilaDespacho) => j.type === "ALERT" && cargaDe(j).evento === "compartido";

function envioDe(j: FilaDespacho): EnvioEvidencia {
    const p = cargaDe(j);
    const lista = Array.isArray(p.destinatarios) ? (p.destinatarios as Carga[]) : [];
    const a = lista.length ? lista.map((d) => texto(d.nombre) || disimular(String(d.telefono || d.destino || ""))).filter(Boolean)
        : [texto(p.to) || texto(p.chatId)].filter((x): x is string => !!x).map(disimular);
    return { canal: j.channel, estado: j.status, a, cuando: j.createdAt.toISOString(), por: texto(p.enviadoPor), error: j.lastError };
}

/** Un clip grabado, con los envíos que se hicieron de ESE archivo. */
export function deClipGrabado(f: FilaClip, despachos: FilaDespacho[]): Evidencia {
    const tramos = Array.isArray(f.tramos) ? (f.tramos as Carga[]) : [];
    const desde = numero(tramos[0]?.desde);
    const nombres = [...new Set(tramos.map((t) => texto(t.nombre)).filter((x): x is string => !!x))];
    return {
        id: `clip-${f.id}`, origen: "grabado", cuando: (f.terminado || f.creado).toISOString(), instante: desde ? new Date(desde).toISOString() : null,
        titulo: f.rotulo || nombres[0] || "Clip grabado", detalle: nombres.length > 1 ? nombres.join(" → ") : null, quien: f.usuario || null,
        segundos: f.segundos, camaras: f.camaras, video: f.guardado, foto: f.foto,
        sinVideo: f.guardado ? null : "No se pudo guardar en el almacén cuando se grabó.", archivo: f.nombre,
        deviceId: texto(tramos[0]?.deviceId), matricula: null,
        envios: despachos.filter((j) => f.nombre && cargaDe(j).clipHecho === f.nombre).map(envioDe),
    };
}

/** Cuánto pueden separarse dos despachos de un mismo «compartir» (uno por destino, creados seguidos). */
const MISMO_ENVIO_MS = 90_000;

/**
 * Lo mandado desde el panel: un clip de la grabación (un despacho con todos sus destinos) o un
 * evento compartido (un despacho POR destino: se juntan). Los que mandan un clip grabado no van
 * acá: son envíos de ese clip (`sueltos` deja afuera los nombres que ya están en la lista).
 */
export function deDespachos(despachos: FilaDespacho[], clipsListados: Set<string> = new Set()): Evidencia[] {
    const out: Evidencia[] = [];
    const grupos = new Map<string, Evidencia>();
    for (const j of [...despachos].sort((a, b) => +a.createdAt - +b.createdAt)) {
        const p = cargaDe(j);
        if (j.type === "CLIP") {
            const v = p.ventana && typeof p.ventana === "object" ? (p.ventana as Carga) : null;
            const seg = (numero(v?.antes) ?? numero(p.antes) ?? 0) + (numero(v?.despues) ?? numero(p.despues) ?? 0);
            const guardado = texto(p.guardado);
            out.push({
                id: `envio-${j.id}`, origen: "enviado", cuando: j.createdAt.toISOString(), instante: texto(p.instante),
                titulo: texto(p.deviceName) || "Clip de la grabación", detalle: texto(p.nota), quien: texto(p.enviadoPor),
                segundos: seg || null, camaras: 1, video: guardado, foto: texto(p.foto),
                sinVideo: guardado ? null : j.status === "FAILED" ? "No salió: no hubo video que guardar." : "Se mandó, pero el video no quedó guardado (los envíos anteriores al 16/11 no se guardaban).",
                archivo: texto(p.clip), deviceId: j.deviceId, matricula: texto(p.matricula), envios: [envioDe(j)],
            });
        } else if (esCompartido(j)) {
            const hecho = texto(p.clipHecho);
            if (hecho && clipsListados.has(hecho)) continue;
            const clave = `${p.instante}|${p.asunto}|${p.enviadoPor}|${j.channel}`;
            const g = grupos.get(clave);
            if (g && +j.createdAt - Date.parse(g.envios[g.envios.length - 1].cuando) <= MISMO_ENVIO_MS) { g.envios.push(envioDe(j)); continue; }
            const e: Evidencia = {
                id: `envio-${j.id}`, origen: "enviado", cuando: j.createdAt.toISOString(), instante: texto(p.instante),
                titulo: texto(p.asunto) || texto(p.deviceName) || "Evento compartido", detalle: texto(p.deviceName), quien: texto(p.enviadoPor),
                segundos: null, camaras: null, video: null, foto: texto(p.snapshotPath),
                sinVideo: "Se compartió la foto del evento.", archivo: hecho, deviceId: j.deviceId, matricula: null, envios: [envioDe(j)],
            };
            grupos.set(clave, e); out.push(e);
        }
    }
    return out;
}

export const ordenarEvidencias = (l: Evidencia[]) => [...l].sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando));

/** Buscar por lo que se lee en la tarjeta: cámara, quién, matrícula, a quién se mandó. */
export function coincide(e: Evidencia, q: string): boolean {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [e.titulo, e.detalle, e.quien, e.matricula, ...e.envios.flatMap((x) => [...x.a, x.canal])].some((v) => !!v && v.toLowerCase().includes(t));
}
