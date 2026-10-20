"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Los avisos en pantalla: UNA pila para todo lo que salta (20/10, Nico: «unificarlas, tanto LPR
 * como intrusión»; «el de intrusión de arriba es el que vamos a usar, pero desde abajo, con el
 * color de fondo según el tipo de detección»).
 *
 * Había tres sistemas que no se conocían: la barra roja de intrusión arriba (toda la app), las
 * «Alertas críticas» abajo a la izquierda y «Lecturas para revisar» abajo a la derecha (sólo el
 * Monitor LPR); y los avisos de patrones y de OmniVision no saltaban en ningún lado. Ahora cada
 * fuente PUBLICA sus avisos acá (`usePublicarAvisos`) y una sola pieza los dibuja
 * (components/avisos/PilaAvisos), abajo al centro, todos con la misma forma.
 *
 * El color dice QUÉ es (tipo); el nivel dice CUÁNTO insiste:
 *   - critico: no se cierra sin decidir, suena cada tanto y la pantalla respira en rojo;
 *   - alerta: queda hasta que se atiende o se cierra, un pitido al llegar, sin respirar.
 * «Para revisar» (sin lectura) no es un aviso: es un contador del Monitor LPR.
 *
 * Las acciones se guardan con el aviso y se buscan en el momento del clic (`accion`), así un
 * botón nunca corre con datos viejos de quien lo publicó.
 */

export type TipoAviso = "lista-negra" | "intrusion-real" | "intrusion" | "busqueda" | "merodeo" | "vision" | "patron";
export type NivelAviso = "critico" | "alerta";

export type AccionAviso = {
    clave: string;
    etiqueta: string;
    icono?: "ver" | "tomar" | "pasar" | "real" | "falsa" | "desactivar" | "historial";
    /** La acción principal va llena (blanca); las demás, translúcidas sobre el color del aviso. */
    principal?: boolean;
    /** Pide un segundo clic antes de correr: el texto de la confirmación. */
    confirmar?: string;
    ayuda?: string;
    correr: () => void | Promise<unknown>;
};

export type Aviso = {
    id: string;
    tipo: TipoAviso;
    nivel: NivelAviso;
    /** ISO del último evento del aviso. */
    ts: string;
    foto?: string | null;
    /** Rótulo chico, en mayúsculas espaciadas: «Lista negra», «Intrusión real en curso». */
    rotulo: string;
    /** Lo que se reconoce: la matrícula o la cámara. */
    titulo: string;
    /** «Cámara · sentido · motivo». */
    detalle?: string | null;
    /** Quién la atiende, si alguien la tomó. */
    operador?: string | null;
    /** Veces que se repitió (misma matrícula o cámara en pocos minutos). */
    veces?: number;
    acciones: AccionAviso[];
    /** Una X para sacarlo de la pantalla (no decide nada). Los críticos no la tienen. */
    cerrar?: () => void;
    /** Quien lo publica ya hace sonar el suyo (la intrusión tiene su propio ritmo). */
    sonidoPropio?: boolean;
};

/** El tono de cada tipo: siempre los del sistema (globals.css). Intrusión ajena es el rojo apagado de siempre. */
export const FONDO_TIPO: Record<TipoAviso, { fondo: string; texto: string; nombre: string }> = {
    "lista-negra": { fondo: "var(--mal)", texto: "#fff", nombre: "Lista negra" },
    "intrusion-real": { fondo: "var(--mal)", texto: "#fff", nombre: "Intrusión real" },
    intrusion: { fondo: "color-mix(in oklab, var(--mal) 82%, black)", texto: "#fff", nombre: "Intrusión" },
    busqueda: { fondo: "var(--aviso)", texto: "#16120a", nombre: "En búsqueda" },
    merodeo: { fondo: "var(--aviso)", texto: "#16120a", nombre: "Merodeo" },
    vision: { fondo: "var(--quieto)", texto: "#fff", nombre: "OmniVision" },
    patron: { fondo: "var(--info)", texto: "#fff", nombre: "Patrones" },
};
/** Los que se pueden apagar por pantalla. Lo crítico (lista negra, intrusión) no. */
export const TIPOS_APAGABLES: TipoAviso[] = ["busqueda", "merodeo", "vision", "patron"];

// ───────────────────────── el almacén ─────────────────────────

const porFuente = new Map<string, Aviso[]>();
let lista: Aviso[] = [];
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of oyentes) o(); };

/** La firma de lo que se ve: si no cambió, no se vuelve a dibujar (las funciones no cuentan). */
const firma = (xs: Aviso[]) => JSON.stringify(xs.map(({ acciones, cerrar, ...r }) => ({ ...r, a: acciones.map((a) => a.clave + a.etiqueta), c: !!cerrar })));
let firmaActual = "";

function recalcular() {
    const todos = [...porFuente.values()].flat();
    // Lo crítico primero; dentro de cada nivel, lo más nuevo primero.
    todos.sort((a, b) => (a.nivel === b.nivel ? b.ts.localeCompare(a.ts) : a.nivel === "critico" ? -1 : 1));
    lista = todos;
    const f = firma(todos);
    if (f !== firmaActual) { firmaActual = f; avisar(); }
}

export function publicarAvisos(fuente: string, avisos: Aviso[]) {
    porFuente.set(fuente, avisos);
    recalcular();
}

/** El aviso vigente con ese id, para correr una acción con lo último que publicó su fuente. */
export function avisoVigente(id: string): Aviso | undefined {
    return lista.find((a) => a.id === id);
}

export function useAvisos(): Aviso[] {
    return useSyncExternalStore(
        (cb) => { oyentes.add(cb); return () => { oyentes.delete(cb); }; },
        () => lista,
        () => lista,
    );
}

/** Publicar desde un componente: se reemplaza lo de esa fuente en cada render y se retira al desmontar. */
export function usePublicarAvisos(fuente: string, avisos: Aviso[]) {
    useEffect(() => { publicarAvisos(fuente, avisos); });
    useEffect(() => () => publicarAvisos(fuente, []), [fuente]);
}

// ───────────────────────── preferencias de esta pantalla ─────────────────────────

/*
 * Por pantalla (este navegador), no globales: cada puesto de guardia decide si suena y qué tipos
 * le saltan. El silencio es el mismo para todo: antes la intrusión tenía su botón y el monitor
 * LPR otro, y se podía tener uno callado y el otro sonando sin saberlo.
 */
/** voz: leer en voz alta cada aviso nuevo (20/10, Nico: «además de sonido, la lectura con voz»). */
export type PrefsAvisos = { silencio: boolean; apagados: TipoAviso[]; voz: boolean };
const CLAVE_PREFS = "oa.avisos.prefs";
let prefs: PrefsAvisos = { silencio: false, apagados: [], voz: false };
let prefsLeidas = false;
const oyentesPrefs = new Set<() => void>();

function leerPrefs(): PrefsAvisos {
    if (prefsLeidas || typeof window === "undefined") return prefs;
    prefsLeidas = true;
    try {
        const j = JSON.parse(localStorage.getItem(CLAVE_PREFS) || "null");
        // El silencio de la intrusión, de antes de unificar, vale como punto de partida.
        const viejo = localStorage.getItem("oa.intrusion.silencio") === "1";
        prefs = { silencio: typeof j?.silencio === "boolean" ? j.silencio : viejo, apagados: Array.isArray(j?.apagados) ? j.apagados.filter((t: any) => TIPOS_APAGABLES.includes(t)) : [], voz: j?.voz === true };
    } catch { /* sin almacenamiento: los valores por defecto */ }
    return prefs;
}

export function cambiarPrefs(p: Partial<PrefsAvisos>) {
    prefs = { ...leerPrefs(), ...p };
    try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs)); } catch { }
    for (const o of oyentesPrefs) o();
}

export function usePrefsAvisos(): PrefsAvisos {
    return useSyncExternalStore(
        (cb) => { oyentesPrefs.add(cb); return () => { oyentesPrefs.delete(cb); }; },
        leerPrefs,
        () => prefs,
    );
}

/** El silencio compartido, con la forma de un useState (lo usa la alerta de intrusión). */
export function useSilencioAvisos(): [boolean, (v: boolean) => void] {
    const p = usePrefsAvisos();
    const set = useCallback((v: boolean) => cambiarPrefs({ silencio: v }), []);
    return [p.silencio, set];
}

// ───────────────────────── voz ─────────────────────────

/** Una matrícula se deletrea («A A Y, 6 1 8 7»): leída como palabra no la entiende nadie. */
const esChapa = (t: string) => /^[A-Z]{1,4}\d{2,5}$|^[A-Z0-9]{6,8}$/.test(t) && /\d/.test(t);
const deletrear = (t: string) => t.replace(/([A-Z]+)(\d+)/, "$1 $2").split("").join(" ").replace(/\s{3}/g, ", ");

/**
 * Leer un aviso en voz alta (speechSynthesis, sin servicios de afuera). Dice el tipo, la matrícula
 * deletreada o la cámara, y lo primero del detalle. Si llegan varios juntos lee el más importante
 * y cuántos más hay: leerlos todos tapa el siguiente aviso.
 */
export function leerAvisos(nuevos: Aviso[]) {
    try {
        const s = window.speechSynthesis; if (!s || !nuevos.length) return;
        const a = nuevos[0];
        const titulo = esChapa(a.titulo) ? `matrícula ${deletrear(a.titulo)}` : a.titulo;
        const donde = (a.detalle || "").split(" · ")[0];
        const texto = [a.rotulo, titulo, donde && donde !== a.titulo ? donde : null, nuevos.length > 1 ? `y ${nuevos.length - 1} avisos más` : null].filter(Boolean).join(". ");
        const u = new SpeechSynthesisUtterance(texto);
        const voces = s.getVoices();
        u.voice = voces.find((v) => /^es[-_](UY|AR)/i.test(v.lang)) || voces.find((v) => /^es/i.test(v.lang)) || null;
        u.lang = u.voice?.lang || "es-UY"; u.rate = 1.02;
        s.cancel(); s.speak(u);
    } catch { /* sin voz */ }
}

// ───────────────────────── sonido ─────────────────────────

let ctxAudio: any = null;
/** El pitido de siempre (Web Audio, sin archivos). urgente = el patrón doble de la intrusión. */
export function pitidoAviso(urgente = true) {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
        ctxAudio = ctxAudio || new Ctx();
        if (ctxAudio.state === "suspended") ctxAudio.resume();
        const tonos = urgente ? [988, 1319, 988, 1319] : [880, 660];
        tonos.forEach((f, i) => {
            const o = ctxAudio.createOscillator(); const g = ctxAudio.createGain(); o.connect(g); g.connect(ctxAudio.destination);
            o.type = "square"; o.frequency.value = f; const t = ctxAudio.currentTime + i * 0.16;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
            o.start(t); o.stop(t + 0.15);
        });
    } catch { /* sin audio */ }
}

/** El navegador no deja sonar hasta el primer gesto: se destraba con el primer clic o tecla. */
export function useDestrabarAudio() {
    const hecho = useRef(false);
    useEffect(() => {
        const destrabar = () => {
            if (hecho.current) return;
            try { const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; ctxAudio = ctxAudio || new Ctx(); ctxAudio.resume?.(); hecho.current = true; } catch { }
        };
        window.addEventListener("pointerdown", destrabar); window.addEventListener("keydown", destrabar);
        return () => { window.removeEventListener("pointerdown", destrabar); window.removeEventListener("keydown", destrabar); };
    }, []);
}
