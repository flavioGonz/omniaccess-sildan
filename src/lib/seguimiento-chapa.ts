import { diferencias, DIFERENCIAS_MAX } from "@/lib/chapas-parecidas";

/**
 * «Seguirlo»: la historia de UNA matrícula contada como la contaría quien la vigila — dónde está
 * ahora y desde cuándo, o cuándo se fue y cuánto estuvo; y antes de eso, por dónde pasó.
 *
 * Por qué existe (13/11, Nico: «cuando se detecta este tipo de matrículas requeridas, debe ser
 * posible ver su llegada y partida, un seguimiento más cercano»). Los datos ya estaban —las
 * estadías, los pasos, las lecturas de acceso—, pero en tres tablas y sin unir, y con un defecto
 * que partía la historia: el mismo auto, quieto, leído como SDH1707, SDM1707 y SCH1707 figuraba
 * como tres vehículos con tres estadías.
 *
 * NO sigue por parecido. Medido ese mismo día con seis modelos: reencontrar el mismo vehículo en
 * otra cámara por su aspecto acierta entre 7 y 15 % de las veces. Sigue por lo que sí es firme:
 * la chapa, el lugar y el tiempo.
 *
 * Acá va sólo el armado, sin base: recibe los hechos y devuelve la historia. Lo usan la ruta
 * (api/seguimiento) y las pruebas.
 */

export type Hecho = {
    /** estadia: estuvo quieta en un lugar · paso: una cámara la vio pasar · acceso: una lectora de barrera. */
    tipo: "estadia" | "paso" | "acceso";
    id: string; plate: string; deviceId: string | null; camara: string | null;
    desde: number; hasta: number;
    /** Sólo estadías: sigue ahí. */
    abierta?: boolean;
    /**
     * Sólo estadías: la midió el LUGAR (franja / analítica de estacionamiento) y no la chapa. Una
     * estadía por chapa se cierra cuando dejan de leerla —de noche, sin tránsito que la haga
     * releer— aunque el auto siga ahí; una por lugar se cierra cuando el lugar queda vacío.
     */
    porLugar?: boolean;
    foto?: string | null; sentido?: string | null; decision?: string | null;
};

export type Tramo = {
    clave: string; tipo: Hecho["tipo"]; deviceId: string | null; camara: string | null;
    desde: number; hasta: number; abierta: boolean;
    /** La midió el lugar: su cierre es una partida de verdad (ver Hecho.porLugar). */
    porLugar: boolean;
    /** Estadías: la primera vez que se la leyó en esta cámara dentro del rango, si es anterior a este tramo. */
    primeraEnCamara: number | null;
    /** Con qué chapas se la leyó en este tramo, de la más leída a la menos. */
    leidaComo: { chapa: string; lecturas: number }[];
    lecturas: number; foto: string | null; sentido: string | null; decision: string | null;
};

export type Seguimiento = {
    chapa: string;
    /**
     * esta: hay una estadía abierta · se-fue: su lugar quedó vacío (medido) · sin-lecturas: lo
     * último que se sabe terminó y no se la volvió a leer (pudo irse, o no pasó nadie que la
     * hiciera releer) · sin-datos.
     */
    estado: "esta" | "se-fue" | "sin-lecturas" | "sin-datos";
    /** El tramo que define el estado: donde está, o lo último que se supo. */
    actual: Tramo | null;
    tramos: Tramo[];
    /** Otras lecturas que se tomaron como la misma chapa mal leída, con cuántas veces. */
    variantes: { chapa: string; lecturas: number }[];
};

/** Dos estadías en la misma cámara separadas por menos que esto son la misma: el auto no se movió, lo releyeron. */
export const UNION_ESTADIA_MS = 20 * 60_000;
/** Una lectura hasta este tiempo antes o después de una estadía, en su misma cámara, es de esa estadía. */
export const DENTRO_DE_ESTADIA_MS = 60_000;
/** Dos pasos por la misma cámara separados por menos que esto son el mismo paso. */
export const UNION_PASO_MS = 2 * 60_000;

/** ¿`otra` puede ser `chapa` mal leída? Mismo largo y a lo sumo DIFERENCIAS_MAX letras distintas. */
export const puedeSerLaMisma = (chapa: string, otra: string) => chapa === otra || diferencias(chapa, otra) <= DIFERENCIAS_MAX;

export function armarSeguimiento(chapa: string, hechos: Hecho[]): Seguimiento {
    const orden = hechos.filter((h) => puedeSerLaMisma(chapa, h.plate)).sort((a, b) => a.desde - b.desde);
    const tramos: (Tramo & { conteo: Map<string, number> })[] = [];
    for (const h of orden) {
        const union = h.tipo === "estadia" ? UNION_ESTADIA_MS : h.tipo === "paso" ? UNION_PASO_MS : 0;
        // Se junta con el último tramo del mismo tipo en la misma cámara, si se tocan o casi.
        const previo = union ? [...tramos].reverse().find((t) => t.tipo === h.tipo && t.deviceId === h.deviceId && t.camara === h.camara) : undefined;
        if (previo && h.desde - previo.hasta <= union) {
            previo.hasta = Math.max(previo.hasta, h.hasta);
            previo.abierta = previo.abierta || !!h.abierta;
            previo.porLugar = previo.porLugar || !!h.porLugar;
            previo.lecturas++;
            previo.conteo.set(h.plate, (previo.conteo.get(h.plate) || 0) + 1);
            if (h.foto) previo.foto = h.foto;
            continue;
        }
        tramos.push({
            clave: `${h.tipo}:${h.id}`, tipo: h.tipo, deviceId: h.deviceId, camara: h.camara, desde: h.desde, hasta: h.hasta, abierta: !!h.abierta, porLugar: !!h.porLugar, primeraEnCamara: null,
            leidaComo: [], lecturas: 1, foto: h.foto || null, sentido: h.sentido || null, decision: h.decision || null, conteo: new Map([[h.plate, 1]]),
        });
    }
    /*
     * Una lectura (de acceso o de paso) hecha por la misma cámara DURANTE una estadía es esa
     * estadía releída, no otro hecho: una lectora que mira un auto estacionado lo vuelve a leer
     * cada vez que algo se mueve. Visto en el lab el 13/11: 39 «accesos» en una semana de un auto
     * que no se movió. Se suman a la estadía (cuentan como lecturas suyas) y salen de la lista.
     */
    const estadias = tramos.filter((t) => t.tipo === "estadia");
    for (let i = tramos.length - 1; i >= 0; i--) {
        const t = tramos[i];
        if (t.tipo === "estadia") continue;
        const de = estadias.find((e) => e.deviceId === t.deviceId && e.camara === t.camara && t.desde >= e.desde - DENTRO_DE_ESTADIA_MS && t.hasta <= e.hasta + DENTRO_DE_ESTADIA_MS);
        if (!de) continue;
        de.lecturas += t.lecturas;
        for (const [c, n] of t.conteo) de.conteo.set(c, (de.conteo.get(c) || 0) + n);
        tramos.splice(i, 1);
    }
    const variantes = new Map<string, number>();
    const listos: Tramo[] = tramos.map(({ conteo, ...t }) => {
        for (const [c, n] of conteo) if (c !== chapa) variantes.set(c, (variantes.get(c) || 0) + n);
        return { ...t, leidaComo: [...conteo].map(([c, n]) => ({ chapa: c, lecturas: n })).sort((a, b) => b.lecturas - a.lecturas) };
    }).sort((a, b) => b.hasta - a.hasta);
    for (const t of listos) {
        if (t.tipo !== "estadia") continue;
        const primera = Math.min(...listos.filter((x) => x.tipo === "estadia" && x.deviceId === t.deviceId && x.camara === t.camara).map((x) => x.desde));
        t.primeraEnCamara = primera < t.desde ? primera : null;
    }
    // Dónde está: la estadía abierta más reciente. Si no hay, lo último que se supo.
    const abierta = listos.find((t) => t.tipo === "estadia" && t.abierta) || null;
    const ultimo = listos[0] || null;
    return {
        chapa, estado: abierta ? "esta" : !ultimo ? "sin-datos" : ultimo.tipo === "estadia" && ultimo.porLugar ? "se-fue" : "sin-lecturas", actual: abierta || ultimo, tramos: listos,
        variantes: [...variantes].map(([c, n]) => ({ chapa: c, lecturas: n })).sort((a, b) => b.lecturas - a.lecturas),
    };
}

/** «19 h 24 min», «3 min», «2 d 4 h»: cuánto duró algo, para leerlo de un vistazo. */
export function cuantoDuro(ms: number): string {
    const min = Math.max(0, Math.round(ms / 60_000));
    if (min < 1) return "menos de 1 min";
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
    const d = Math.floor(h / 24), hh = h % 24;
    return hh ? `${d} d ${hh} h` : `${d} d`;
}

/** La frase del aviso «se fue»: de dónde, a qué hora y cuánto estuvo. */
export function motivoDePartida(camara: string | null, desde: number | null, hasta: number, leidaComo?: string | null): string {
    const hora = new Date(hasta).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
    return `Se fue${camara ? ` de ${camara}` : ""} a las ${hora}.${desde && hasta > desde ? ` Estuvo ${cuantoDuro(hasta - desde)}.` : ""}${leidaComo ? ` La estadía estaba a nombre de ${leidaComo} (misma cámara, lectura parecida).` : ""}`;
}
