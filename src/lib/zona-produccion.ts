/**
 * Cómo llega una analítica «Cómo está un lugar» a la guardia: en qué etapa está, qué le falta
 * para avisar y qué conviene hacer ahora.
 *
 * Por qué existe (Nico, 15/10: «¿cómo se activan y se ponen en producción?»): la pantalla decía
 * «Entrenada · 97 %» y «Sólo registra» en dos chips sueltos, y en ningún lado que el paso
 * siguiente era prender «Avisar» en Configurar, ni si la analítica estaba en condiciones de
 * hacerlo. Una analítica al 64 % con 25 ejemplos del estado que avisa se veía igual de lista que
 * una al 97 % con 89. Esto lo decide en un solo lugar, con números, y lo usan la lista y la ficha.
 *
 * Archivo sin base ni red: sólo cuentas sobre lo que ya trae /api/vision/zonas.
 */
import { RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";

/**
 * Acierto mínimo (exactitud balanceada en ejemplos que no vio) para recomendar que avise. Debajo
 * de 90 % la guardia recibe un aviso equivocado cada tantos y deja de mirarlos: un aviso que no
 * se mira es peor que no tenerlo.
 */
export const ACIERTO_PRODUCCION = 0.9;
/** De lo normal, cuánto puede marcar como el estado que avisa (falsas alarmas al umbral de la zona). */
export const FALSAS_MAX = 0.05;
/** Del estado que avisa, cuánto tiene que reconocer al umbral de la zona. */
export const RECONOCE_MIN = 0.8;
/** Más que esto de diferencia entre un estado y el otro y el modelo aprende sobre todo uno. */
export const DESBALANCE_MAX = 5;
/** Con tantas muestras esperando etiqueta conviene sentarse a etiquetar. */
export const ESPERANDO_MUCHAS = 40;
/** Si desde el último entrenamiento se sumaron tantos ejemplos (en proporción), vale volver a entrenar. */
export const CRECIO_DESDE_ENTRENAR = 0.2;

export type ZonaParaEtapa = {
    nombre: string; positivo: string; negativo: string; avisar: boolean; activa: boolean; sostenerSeg: number;
    horario?: { desde: string; hasta: string } | null;
    modelo: { exactitud: number | null; n: { pos: number; neg: number }; matriz?: { vp: number; fp: number; vn: number; fn: number } | null } | null;
    estado: { al?: string; error?: string | null } | null;
    conteo: { pos: number; neg: number; sin: number };
};

export type Etapa = "apagada" | "pausada" | "aprendiendo" | "prueba" | "lista" | "produccion";
export type Tono = "neutro" | "bien" | "aviso" | "mal" | "info" | "quieto";

/** El camino, en orden: lo dibuja la lista arriba de la tabla. */
export const CAMINO: { etapa: Etapa; rotulo: string; que: string }[] = [
    { etapa: "aprendiendo", rotulo: "Aprendiendo", que: "Decide con las frases de los dos estados y junta una foto cada tanto. Vos etiquetás." },
    { etapa: "prueba", rotulo: "En prueba", que: "Entrenada con tus ejemplos. Registra cada vez que se sostiene el estado, pero no avisa a nadie." },
    { etapa: "lista", rotulo: "Lista para avisar", que: `Pasó las pruebas: ${Math.round(ACIERTO_PRODUCCION * 100)} % de acierto o más, ${RECOMENDADO_POR_CLASE} ejemplos de cada estado y pocas falsas alarmas.` },
    { etapa: "produccion", rotulo: "Avisa a la guardia", que: "Cuando el estado se sostiene el tiempo elegido, en su horario, le llega un aviso a la guardia con la foto." },
];

export const ROTULO_ETAPA: Record<Etapa, { rotulo: string; tono: Tono }> = {
    apagada: { rotulo: "Apagada", tono: "quieto" },
    pausada: { rotulo: "Pausada", tono: "quieto" },
    aprendiendo: { rotulo: "Aprendiendo", tono: "info" },
    prueba: { rotulo: "En prueba", tono: "neutro" },
    lista: { rotulo: "Lista para avisar", tono: "bien" },
    produccion: { rotulo: "Avisa a la guardia", tono: "aviso" },
};

export type Chequeo = { ok: boolean; texto: string; detalle?: string };

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Las condiciones para avisar, cada una con su número real. */
export function chequeos(z: ZonaParaEtapa, analiticaPrendida: boolean): Chequeo[] {
    const m = z.modelo;
    const mt = m?.matriz || null;
    const falsas = mt && mt.fp + mt.vn > 0 ? mt.fp / (mt.fp + mt.vn) : null;
    const reconoce = mt && mt.vp + mt.fn > 0 ? mt.vp / (mt.vp + mt.fn) : null;
    return [
        { ok: !!m, texto: "Entrenada con ejemplos del lugar", detalle: m ? `con ${m.n.pos} + ${m.n.neg}` : "todavía decide con las frases" },
        { ok: z.conteo.pos >= RECOMENDADO_POR_CLASE && z.conteo.neg >= RECOMENDADO_POR_CLASE, texto: `${RECOMENDADO_POR_CLASE} ejemplos de cada estado`, detalle: `${z.conteo.pos} «${z.positivo}» · ${z.conteo.neg} «${z.negativo}»` },
        { ok: m?.exactitud != null && m.exactitud >= ACIERTO_PRODUCCION, texto: `Acierto de ${pct(ACIERTO_PRODUCCION)} o más en ejemplos que no vio`, detalle: m?.exactitud != null ? pct(m.exactitud) : "sin medir" },
        { ok: reconoce != null && reconoce >= RECONOCE_MIN, texto: `Reconoce «${z.positivo}» (${pct(RECONOCE_MIN)} o más)`, detalle: mt ? `${mt.vp} de ${mt.vp + mt.fn}` : "sin medir" },
        { ok: falsas != null && falsas <= FALSAS_MAX, texto: `Pocas falsas alarmas (${pct(FALSAS_MAX)} o menos)`, detalle: mt ? `${mt.fp} de ${mt.fp + mt.vn} «${z.negativo}» marcados como «${z.positivo}»` : "sin medir" },
        { ok: !!z.estado?.al && !z.estado?.error, texto: "Mirando sin errores", detalle: z.estado?.error || (z.estado?.al ? "toma fotos" : "todavía no miró") },
        { ok: analiticaPrendida, texto: "Analíticas entrenables prendidas", detalle: analiticaPrendida ? "OmniVision › Analíticas" : "apagadas en OmniVision › Analíticas: no mira ninguna" },
    ];
}

export function etapaDe(z: ZonaParaEtapa, analiticaPrendida: boolean): Etapa {
    if (!analiticaPrendida) return "apagada";
    if (!z.activa) return "pausada";
    if (z.avisar) return "produccion";
    if (!z.modelo) return "aprendiendo";
    return chequeos(z, analiticaPrendida).every((c) => c.ok) ? "lista" : "prueba";
}

export type Sugerencia = { tono: Tono; texto: string };

/** Qué conviene hacer ahora con esta analítica, de lo más urgente a lo menos. */
export function sugerencias(z: ZonaParaEtapa, analiticaPrendida: boolean): Sugerencia[] {
    const s: Sugerencia[] = [];
    const etapa = etapaDe(z, analiticaPrendida);
    const { pos, neg, sin } = z.conteo;
    if (z.estado?.error) s.push({ tono: "mal", texto: `No puede mirar: ${z.estado.error}. Revisá la cámara.` });
    if (z.avisar && !z.modelo) s.push({ tono: "mal", texto: "Avisa a la guardia decidiendo sólo con las frases. Volvé a «En prueba» hasta entrenarla." });
    if (etapa === "produccion" && z.modelo?.exactitud != null && z.modelo.exactitud < ACIERTO_PRODUCCION)
        s.push({ tono: "aviso", texto: `Avisa con ${pct(z.modelo.exactitud)} de acierto: va a mandar avisos equivocados. Sumá ejemplos y volvé a entrenar.` });
    if (pos < RECOMENDADO_POR_CLASE) s.push({ tono: "aviso", texto: `Faltan ${RECOMENDADO_POR_CLASE - pos} ejemplos de «${z.positivo}». Si casi no pasa, provocalo (o simulalo) y tocá «Mirar ahora».` });
    if (neg < RECOMENDADO_POR_CLASE) s.push({ tono: "aviso", texto: `Faltan ${RECOMENDADO_POR_CLASE - neg} ejemplos de «${z.negativo}».` });
    const mayor = Math.max(pos, neg), menor = Math.min(pos, neg);
    if (menor > 0 && mayor / menor > DESBALANCE_MAX)
        s.push({ tono: "info", texto: `Hay ${mayor} de un estado y ${menor} del otro: el modelo aprende sobre todo «${pos > neg ? z.positivo : z.negativo}». Sumá del que falta antes de seguir etiquetando el otro.` });
    if (sin >= ESPERANDO_MUCHAS) s.push({ tono: "info", texto: `${sin} fotos esperan etiqueta. Empezá por las que el modelo menos sabe decidir (Etiquetar).` });
    if (z.modelo) {
        const antes = z.modelo.n.pos + z.modelo.n.neg, ahora = pos + neg;
        if (antes > 0 && (ahora - antes) / antes >= CRECIO_DESDE_ENTRENAR)
            s.push({ tono: "info", texto: `Se sumaron ${ahora - antes} ejemplos desde el último entrenamiento: volvé a entrenar para que los use.` });
    }
    if (etapa === "lista") s.push({ tono: "bien", texto: `Lista: puede avisar a la guardia cuando «${z.positivo}» se sostenga ${Math.round(z.sostenerSeg / 60)} min${z.horario ? `, de ${z.horario.desde} a ${z.horario.hasta}` : ""}.` });
    if (etapa === "prueba" && !s.length) s.push({ tono: "info", texto: "Dejala en prueba unos días y mirá «Veces que se sostuvo»: si cada vez fue cierto, está para avisar." });
    return s;
}
