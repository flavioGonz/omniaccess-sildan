"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    LogIn, LogOut, ShieldCheck, ShieldX, ShieldAlert, Search, Repeat, Camera, Clock, Users, X, Radio,
    PanelRightOpen, Home, Car, Ticket, History, Maximize2, ChevronRight, Loader2, CircleDashed, AlertTriangle, Timer, Activity,
    ScanEye, SlidersHorizontal, Siren, Building2, Sparkles,
} from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { metodoDeLectura } from "@/lib/lectura-metodo";
import { watchCatMeta } from "@/lib/watch-categories";
import { presentarLectura, rotulosContadores, ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { describirRutina, duracion, NOMBRE_CLASE, type Rutina, type Clase } from "@/lib/visitas/calculos";
import { cn } from "@/lib/utils";
import {
    claseDeLectura, ESTILO_MONITOR, ESTILO_APAGADO, NIVELES, COMPORTAMIENTO_DEFECTO, normalizarComportamiento,
    type ClaseMonitor, type ClaveComportamiento, type Comportamiento, type NivelListaNegra,
} from "@/lib/padron";
import type { RelecturaEvento } from "@/lib/relectura";
import type { Analisis } from "@/lib/vision-capa";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { conAncho } from "@/lib/ancho-foto";
import { LogoSobreFoto } from "@/components/empresas/LogoSobreFoto";
import { SUAVE, RESORTE, tocable, usarInactividad, CuentaAtras } from "@/components/monitor/tactil";
import { esPaseLibre, NOMBRE_PASE_LIBRE } from "@/lib/visitas/ajustes-base";
import { Semaforo, type EstadoSemaforo } from "@/components/monitor/Semaforos";

/**
 * La vista Control LPR: la última lectura grande y clara, si se abrió y por qué, la tira de
 * las últimas, los números del día y la fila de atención.
 *
 * Sirve para una pared que nadie toca y para una tablet o pantalla táctil en el puesto. La
 * pared sigue igual: si nadie toca, la protagonista es siempre la última lectura. Lo táctil
 * se suma sin quitarle eso:
 *
 *  · Tocar una lectura de la tira (o de la fila de atención) la FIJA como protagonista. Arriba
 *    queda claro que se está mirando el pasado ("Viendo 10:32:05") con un botón grande para
 *    volver al vivo, y a los VOLVER_AL_VIVO_MS sin tocar nada vuelve solo: una tablet que
 *    alguien dejó mirando una lectura vieja no puede quedarse así toda la noche.
 *  · Mientras está fijada, lo nuevo no se pierde: aparece un aviso "Nueva lectura" para saltar.
 *  · La ficha (cajón desde la derecha) contesta lo que se pregunta de un auto: de quién es, de
 *    qué lote, si es invitado y a dónde va, si está vigilado, cuándo entró y qué hizo hoy. Se
 *    cierra sola a los FICHA_SE_CIERRA_MS sin tocar.
 *  · Los contadores filtran la tira (tocar "Denegados hoy" deja sólo las denegadas).
 *  · Todo lo tocable mide 48 px o más y responde al dedo (se hunde un poco); nada depende
 *    del hover. Las transiciones son cortas (≤ 300 ms): informan, no adornan.
 *
 * Lo urgente llega por el socket (`access_event`); la consulta periódica trae los contadores y
 * la fila de atención, que necesitan la base.
 */
const INTERVALO_MS = 20_000;
const ULTIMAS_EN_TIRA = 30;
/** Sin tocar nada este tiempo, una lectura fijada vuelve al vivo. */
const VOLVER_AL_VIVO_MS = 30_000;
/** El ancho al que se pide la captura grande: el de una pared Full HD, no el original de la cámara. */
const ANCHO_PROTAGONISTA = 1600;
/** Cuánto se espera para volver a pedir una NO_LEIDA: vision-worker la relee en 1-5 s. */
const RELECTURA_ESPERA_MS = 6_000;
/** Sin tocar nada este tiempo, la ficha se cierra. */
const FICHA_SE_CIERRA_MS = 60_000;

type Modo = "ABIERTO" | "CERRADO";
type Lectura = {
    deviceId?: string | null;
    id: string; ts: string; plate: string | null; persona: string | null; unidad?: string | null; registrada?: boolean; camara: string | null; sentido: string; decision: string; accessType: string | null; foto: string | null; detalles: string | null; metodo: { metodo: string | null; confianza: number | null };
    /** Quién es (lib/monitor/identidad): la misma clase que el monitor LPR del panel. Vienen con la consulta, no con el socket. */
    clase?: ClaseMonitor | null; etiqueta?: string | null;
    ficha?: { nombre: string; nivel: NivelListaNegra; motivo: string | null } | null;
    /** En una NO_LEIDA: la chapa que sugirió la relectura del vehículo (vision-worker). */
    relectura?: RelecturaEvento | null;
    /** Lo que omni-vision vio en la foto (vision-analisis.js): siluetas, color y carrocería. */
    analisis?: Analisis | null;
};
type Atencion = { id: string | null; plate: string | null; tipo: "LISTA_NEGRA" | "EN_BUSQUEDA" | "MERODEO" | "AVISO"; motivo: string; ts: string; camara: string | null; avisoId?: string; avisoTipo?: string };
type VisitaEnBarrio = { tipo: "VISITA"; id: string; plate: string | null; tipoVisita?: string; tipoNombre: string; lote: string | null; nombre: string | null; empresa: string | null; origen: string; desde: string; vence: string; accessEventId: string | null };
type NoRegistrada = { tipo: "NO_REGISTRADA"; plate: string; desde: string; estimado: true; camara: string | null; accessEventId: string };
type Datos = {
    modo?: Modo; ultima: Lectura | null; tira: Lectura[];
    contadores: { entradas: number; salidas: number; denegados: number; noRegistrados?: number; adentro: number; actualizado: string; dia: string };
    enBarrio?: { visitas: VisitaEnBarrio[]; noRegistradas: NoRegistrada[] };
    atencion: Atencion[]; ahora: string;
    /** Matrícula → logo de su empresa (ver lib/empresas-servidor). */
    logos?: Record<string, Logo>;
    /** Los interruptores de las pestañas de Usuarios: color propio y sonido al pasar, por clase. */
    comportamiento?: Comportamiento;
    /** Olivos: semaforos de garita (rele de la lista de cada lectora). */
    semaforos?: { seg: number; camaras: EstadoSemaforo[] } | null;
};
type Logo = { nombre: string; logo: string; transparente: boolean };
type Ficha = {
    lectura: Lectura;
    persona: { nombre: string; rol: string; unidad: string | null } | null;
    vehiculo: { marca: string | null; modelo: string | null; color: string | null; tipo: string | null } | null;
    vigilancia: { categoria: string; motivo: string | null } | null;
    invitado: { nombre: string | null; anfitrion: string | null; lote: string | null; desde: string; hasta: string } | null;
    hoy: { id: string; ts: string; sentido: string; decision: string; camara: string | null }[];
    adentroDesde: string | null;
    registradaPor?: string | null;
    perfil?: { clase: string; diasVistos: number; entradas: number; salidas: number; primeraVez: string; ultimaVez: string; permanenciaMedianaMin: number | null; permanenciaP90Min: number | null; visitasConSalida: number; entradaNoVista: boolean; rutina: Rutina | null } | null;
    franja?: number[][]; franjaDias?: number;
    visita?: { id: string; tipo: string; loteNombre: string | null; entra: string; vence: string; origen: string } | null;
};
type Filtro = "todas" | "entradas" | "salidas" | "denegadas";

const ROL: Record<string, string> = { RESIDENT: "Residente", VISITOR: "Visitante", TEMPORARY_VISITOR: "Visitante", STAFF: "Personal", SECURITY: "Seguridad", OPERATOR: "Operador", PROVIDER: "Proveedor", ADMIN: "Administración", WHITELISTED: "Residente · VIP", BLACKLISTED: "Lista negra" };
/** Lo que la lectora escribe cuando no leyó. */
const esNoLeida = (p: string | null | undefined) => !p || ["NO_LEIDA", "UNKNOWN", "S/P"].includes(p.toUpperCase());

/**
 * La etiqueta de quién es, con el color de su clase (el mismo del monitor LPR). Con «Color
 * propio» apagado en esa pestaña, va en gris. La lista negra no se apaga.
 */
function EtiquetaClase({ l, comp, grande }: { l: Lectura; comp: Comportamiento; grande?: boolean }) {
    if (!l.clase) return null;
    const e = ESTILO_MONITOR[l.clase];
    const conColor = l.clase === "alerta" || (comp[l.clase as ClaveComportamiento]?.color ?? true);
    const texto = l.ficha ? `${NIVELES[l.ficha.nivel].titulo} · ${l.ficha.nombre}` : e.etiqueta;
    return (
        <span className={cn("inline-flex items-center rounded-md font-black uppercase tracking-wider whitespace-nowrap max-w-full truncate",
            grande ? "px-3 py-1 text-[15px]" : "px-1.5 py-0.5 text-[10px]", conColor ? e.badge : ESTILO_APAGADO.badge)}>{texto}</span>
    );
}

/**
 * La relectura de una NO_LEIDA: una SUGERENCIA, con signo de pregunta. En la pared no se puede
 * confirmar (eso es del guardia, en el monitor LPR con «Cargar matrícula»); acá se informa,
 * sobre todo si la chapa sugerida está en la lista negra o es de alguien del padrón.
 */
function Relectura({ r, grande }: { r?: RelecturaEvento | null; grande?: boolean }) {
    if (!r?.plate) return null;
    const cat = String(r.vigilancia?.category || "").toUpperCase();
    const negra = cat === "BLACKLISTED", busqueda = cat === "SEARCH";
    return (
        <span className={cn("inline-flex items-center gap-2 flex-wrap", grande ? "text-[17px]" : "text-[11px]")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {grande && r.chapa && <img src={r.chapa} alt="" draggable={false} className="h-12 rounded-md border border-white/40 bg-black" />}
            <span className={cn("uppercase font-black tracking-wider text-[var(--accion-en-oscuro)]", grande ? "text-[14px]" : "text-[9px]")}>omni-vision leyó</span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-md bg-black/60 text-white border border-white/30 font-bold tabular-nums tracking-[0.12em]", grande ? "px-3 py-1 text-[24px]" : "px-1.5 py-0.5")}>
                ¿{r.plate}?
            </span>
            <span className="text-white/75 tabular-nums">{r.confianza != null ? `${Math.round(r.confianza * 100)} %` : ""}{r.estado === "DUDOSA" ? " · dudosa" : ""}</span>
            {negra && <span className="px-2 py-0.5 rounded-md pleno-mal font-black uppercase tracking-wider text-[0.8em]">Lista negra</span>}
            {busqueda && <span className="px-2 py-0.5 rounded-md pleno-aviso font-black uppercase tracking-wider text-[0.8em]">En búsqueda</span>}
            {!r.vigilancia && r.quien && <span className="text-white/90 truncate">{r.quien.name}{r.quien.unidad ? ` · ${r.quien.unidad}` : ""}</span>}
        </span>
    );
}
const filtrosDe = (modo: Modo): { v: Filtro; l: string }[] => [{ v: "todas", l: "Todas" }, { v: "entradas", l: "Entradas" }, { v: "salidas", l: "Salidas" }, { v: "denegadas", l: modo === "ABIERTO" ? "No registradas" : "Denegadas" }];
/** En abierto "denegadas" son las no registradas, y entradas/salidas cuentan todas (no hay "permitidas"). */
const pasaFiltro = (l: Lectura, f: Filtro, modo: Modo) => {
    if (f === "todas") return true;
    if (f === "denegadas") return modo === "ABIERTO" ? !l.registrada && !esListaNegra(l) : l.decision !== "GRANT";
    const sentido = f === "salidas" ? l.sentido === "EXIT" : l.sentido !== "EXIT";
    return modo === "ABIERTO" ? sentido : l.decision === "GRANT" && sentido;
};

const desdeEvento = (e: any): Lectura | null => e?.id && e?.timestamp ? ({
    deviceId: e.deviceId || e.device?.id || null,
    id: e.id, ts: e.timestamp, plate: (e.plateDetected || e.plateNumber || "").toUpperCase() || null, persona: e.user?.name || null, unidad: e.user?.unit?.name || null,
    // Aproximado hasta que la consulta (1,2 s después) traiga el registro completo (visita, invitación).
    registrada: !!(e.user || e.guest),
    camara: e.device?.name || e.location || null, sentido: e.direction || "ENTRY", decision: e.decision || "DENY", accessType: e.accessType || null,
    foto: e.snapshotPath || e.imagePath || null, detalles: e.details || null, metodo: metodoDeLectura(e.details || null),
}) : null;

const esListaNegra = (l: Lectura) => l.clase === "alerta" || /lista negra/i.test(l.detalles || "");

/**
 * Olivos: el color de quien pasa, para leerlo de lejos sin leer nada. Rojo no autorizado (y
 * lista negra, más fuerte), verde autorizado, amarillo proveedor, violeta visita. Tiñe el fondo
 * de toda la pantalla, el borde de la lectura grande y la tarjeta de lote y nombre.
 */
type Tinte = "autorizado" | "proveedor" | "visita" | "negra" | "denegado" | "desconocido";
const tinteDe = (l: Lectura | null | undefined, conEmpresa?: boolean): Tinte => {
    if (!l) return "desconocido";
    if (esListaNegra(l) || l.clase === "busqueda") return "negra";
    if (l.decision !== "GRANT") return "denegado";
    if (l.clase === "proveedores" || conEmpresa) return "proveedor";
    if (l.clase === "visitas") return "visita";
    return "autorizado";
};
const TINTE: Record<Tinte, { fondo: string; suave: string; tarjeta: string; texto: string; anillo: string; rotulo: string }> = {
    autorizado: { fondo: "rgba(16,185,129,0.24)", suave: "rgba(16,185,129,0.1)", tarjeta: "bg-emerald-600/95 border-emerald-300/60", texto: "text-white", anillo: "ring-emerald-400", rotulo: "" },
    proveedor: { fondo: "rgba(245,158,11,0.26)", suave: "rgba(245,158,11,0.108)", tarjeta: "bg-amber-400/95 border-amber-100/70", texto: "text-black", anillo: "ring-amber-400", rotulo: "Proveedor" },
    visita: { fondo: "rgba(139,92,246,0.26)", suave: "rgba(139,92,246,0.108)", tarjeta: "bg-violet-600/95 border-violet-200/60", texto: "text-white", anillo: "ring-violet-400", rotulo: "Visita" },
    denegado: { fondo: "rgba(239,68,68,0.24)", suave: "rgba(239,68,68,0.1)", tarjeta: "bg-red-600/95 border-red-200/70", texto: "text-white", anillo: "ring-red-500", rotulo: "No autorizado" },
    negra: { fondo: "rgba(239,68,68,0.38)", suave: "rgba(239,68,68,0.158)", tarjeta: "bg-red-600/95 border-red-200/70", texto: "text-white", anillo: "ring-red-500", rotulo: "Lista negra" },
    desconocido: { fondo: "rgba(120,120,120,0.08)", suave: "rgba(120,120,120,0.033)", tarjeta: "bg-neutral-800/90 border-white/20", texto: "text-white", anillo: "ring-white/25", rotulo: "" },
};
const CLAVE_CAMARAS = "monitorLpr.camaras";
const CLAVE_CERRADOS = "monitorLpr.incidentesCerrados";
/**
 * El motivo del denegado, sacado de `details`. Ese campo mezcla el motivo con la ficha del
 * vehículo que leyó la cámara ("Marca: …, Modelo: …, Color: …"): se descartan esos pares y
 * queda lo que explica la decisión. Si no queda nada, es el caso corriente: no tiene credencial.
 */
const CLAVES_FICHA = /^(Marca|Modelo|Color|Tipo|Source|Metodo|Método|Confianza|PlateRect|PlateCrop|Camara|Cámara)\s*:/i;
const motivoDenegado = (l: Lectura) => {
    const d = l.detalles || "";
    const m = d.match(/Lista negra:\s*([^,·|]+)/i); if (m) return `Lista negra: ${m[1].trim()}`;
    const partes = d.split(/[,·|]/).map((x) => x.trim().replace(/\.$/, "")).filter((x) => x && !CLAVES_FICHA.test(x));
    const texto = partes[0] || "";
    if (/no reconocida/i.test(texto)) return "Matrícula no reconocida";
    return texto.replace(/^ALERTA:\s*/i, "") || "Sin credencial vigente";
};
/** El texto, el ícono y el tono de una lectura según el modo (lib/visitas/presentacion). */
const estadoDe = (l: Lectura, modo: Modo) => {
    const p = presentarLectura({ modo, decision: l.decision, registrada: !!l.registrada, listaNegra: esListaNegra(l) });
    const Ic = esListaNegra(l) ? ShieldAlert : p.tono === "bien" ? ShieldCheck : modo === "ABIERTO" ? CircleDashed : ShieldX;
    return { t: p.texto, Ic, c: p.pleno, ok: p.tono === "bien", error: p.error };
};
const quien = (l: Lectura) => [l.persona || (l.decision === "GRANT" ? "Autorizado" : "Desconocido"), l.unidad].filter(Boolean).join(" · ");
/** "en 2 h 10 min" / "vencido": para la vigencia de un pase. */
const faltan = (ts: string) => {
    const m = Math.round((new Date(ts).getTime() - Date.now()) / 60000);
    if (m <= 0) return "vencido";
    if (m < 60) return `en ${m} min`;
    const h = Math.floor(m / 60); return h < 48 ? `en ${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `en ${Math.floor(h / 24)} d`;
};

function Contador({ rotulo, valor, Icono, tono, activo, alTocar }: { rotulo: string; valor: number; Icono: any; tono?: "bien" | "mal" | "info"; activo?: boolean; alTocar?: () => void }) {
    return (
        <button type="button" onClick={alTocar} disabled={!alTocar} aria-pressed={activo}
            className={cn("flex items-center gap-3 lg:gap-4 rounded-2xl bg-card border px-4 lg:px-5 py-3 lg:py-4 text-left min-h-[72px]", tocable,
                activo ? "border-[var(--accion-en-oscuro)] ring-2 ring-[var(--accion-en-oscuro)]/40" : "border-border", !alTocar && "active:scale-100")}>
            <span className={cn("grid h-11 w-11 lg:h-12 lg:w-12 place-items-center rounded-full shrink-0", tono === "bien" ? "pleno-bien" : tono === "mal" ? "pleno-mal" : tono === "info" ? "pleno-info" : "bg-muted text-muted-foreground")}><Icono size={22} /></span>
            <div className="min-w-0">
                <div className="text-[32px] lg:text-[40px] font-bold leading-none tabular-nums">{valor}</div>
                {/* Sin recortar: "Denegado…" con 1668 al lado no dice qué cuenta. Baja a dos renglones si hace falta. */}
                <div className="text-[13px] lg:text-[14px] text-muted-foreground mt-1 leading-tight">{rotulo}</div>
            </div>
        </button>
    );
}

export function VistaLpr() {
    const { latir, setTitulo, setFondo, ajustes, silencio, tactil } = useMarco();
    useEffect(() => { setTitulo("Control LPR"); }, [setTitulo]);
    usarReloj();
    /* Qué cámaras mira ESTA pantalla: una garita puede querer ver sólo sus lectoras. Se guarda en el
       navegador (cada pantalla la suya) y también se puede fijar por la URL: ?camaras=id1,id2. */
    const [camSel, setCamSel] = useState<string[] | null>(null);
    const [selListo, setSelListo] = useState(false);
    useEffect(() => {
        try {
            const u = new URLSearchParams(window.location.search).get("camaras");
            const v = u ? u.split(",").filter(Boolean) : JSON.parse(localStorage.getItem(CLAVE_CAMARAS) || "null");
            if (Array.isArray(v) && v.length) setCamSel(v);
        } catch { }
        setSelListo(true);
    }, []);
    const guardarSel = useCallback((v: string[] | null) => {
        setCamSel(v && v.length ? v : null);
        try { if (v && v.length) localStorage.setItem(CLAVE_CAMARAS, JSON.stringify(v)); else localStorage.removeItem(CLAVE_CAMARAS); } catch { }
    }, []);
    const pasaCam = useCallback((id?: string | null) => !camSel || !id || camSel.includes(id), [camSel]);
    const { datos, error, recargar } = usarDatos<Datos>(selListo ? `/api/monitor/lpr${camSel ? `?camaras=${encodeURIComponent(camSel.join(","))}` : ""}` : null, INTERVALO_MS, latir);
    const [verSel, setVerSel] = useState(false);
    /* Lista negra: un incidente que tapa la pantalla y titila hasta que alguien lo cierra. */
    const [incidentes, setIncidentes] = useState<Lectura[]>([]);
    const cerrados = useRef<Set<string>>(new Set());
    useEffect(() => { try { cerrados.current = new Set(JSON.parse(localStorage.getItem(CLAVE_CERRADOS) || "[]")); } catch { } }, []);
    const abrirIncidente = useCallback((l: Lectura) => {
        if (cerrados.current.has(l.id)) return;
        if (Date.now() - new Date(l.ts).getTime() > 15 * 60_000) return;
        setIncidentes((xs) => (xs.some((x) => x.id === l.id) ? xs : [...xs, l]));
    }, []);
    const cerrarIncidente = useCallback((id: string) => {
        cerrados.current.add(id);
        try { localStorage.setItem(CLAVE_CERRADOS, JSON.stringify([...cerrados.current].slice(-200))); } catch { }
        setIncidentes((xs) => xs.filter((x) => x.id !== id));
    }, []);
    const [ultima, setUltima] = useState<Lectura | null>(null);
    const [tira, setTira] = useState<Lectura[]>([]);
    const [fijada, setFijada] = useState<Lectura | null>(null);
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [fichaId, setFichaId] = useState<string | null>(null);
    const [ampliada, setAmpliada] = useState<string | null>(null);
    /** Semaforos: llegan con la consulta y se corrigen al instante con cada lectura del socket. */
    const [semaforos, setSemaforos] = useState<EstadoSemaforo[]>([]);
    useEffect(() => { if (datos?.semaforos?.camaras) setSemaforos(datos.semaforos.camaras); }, [datos?.semaforos]);
    const semaforoSeg = datos?.semaforos?.seg ?? 8;
    useEffect(() => { if (!datos) return; setUltima((u) => (u && datos.ultima && u.ts > datos.ultima.ts ? u : datos.ultima)); setTira((t) => { const base = datos.tira; const ids = new Set(base.map((x) => x.id)); return [...t.filter((x) => !ids.has(x.id) && (!datos.ultima || x.id !== datos.ultima.id) && (!base[0] || x.ts > base[0].ts)), ...base].slice(0, ULTIMAS_EN_TIRA); }); }, [datos]);

    useEffect(() => { if (!datos) return; [datos.ultima, ...(datos.tira || [])].forEach((l) => { if (l && tinteDe(l) === "negra") abrirIncidente(l); }); }, [datos, abrirIncidente]);
    const modoSonido = ajustes?.sonido?.lpr || "off";
    const comportamiento = useMemo(() => normalizarComportamiento(datos?.comportamiento || COMPORTAMIENTO_DEFECTO), [datos?.comportamiento]);
    /** Barrio abierto o cerrado (Ajustes → Visitas y patrones); lo trae la consulta. */
    const modo: Modo = datos?.modo === "ABIERTO" ? "ABIERTO" : "CERRADO";
    useTiempoReal("access_event", (e: any) => {
        const l = desdeEvento(e); if (!l) return;
        latir();
        if (l.deviceId) {
            const rele = l.decision === "GRANT" && /Source:\s*Camera/i.test(l.detalles || "");
            setSemaforos((xs) => xs.map((c) => c.deviceId === l.deviceId ? { ...c, ultima: { id: l.id, ts: l.ts, plate: l.plate, decision: l.decision, rele } } : c));
        }
        if (!pasaCam(l.deviceId)) return;   // esta pantalla no mira esa cámara
        l.clase = claseDeLectura(e.user, e.watch?.category);
        if (tinteDe(l) === "negra") abrirIncidente(l);
        setUltima((prev) => { if (prev && prev.id !== l.id) setTira((t) => [prev, ...t.filter((x) => x.id !== prev.id)].slice(0, ULTIMAS_EN_TIRA)); return l; });
        if (!silencio && modoSonido !== "off") {
            // La clase sale del socket (usuario y vigilancia del evento), igual que en el monitor LPR.
            const clase = claseDeLectura(e.user, e.watch?.category);
            if (esListaNegra(l)) sonar("lista");
            // En abierto nadie deniega nada: el tono de "denegado" sonaría con cada auto sin padrón.
            else if (modo === "CERRADO" && l.decision === "DENY" && modoSonido === "denegado") sonar("denegado");
            // «Sonido al pasar» de su pestaña (Usuarios → «Cómo se comporta»).
            else if (clase && clase !== "alerta" && comportamiento[clase as ClaveComportamiento]?.sonido) sonar("aviso");
        }
        setTimeout(recargar, 1200);
        // La relectura de una NO_LEIDA tarda unos segundos (vision-worker): se vuelve a pedir para traerla.
        if (esNoLeida(l.plate)) setTimeout(recargar, RELECTURA_ESPERA_MS);
    });
    // Visitas que se abren o cierran, y avisos a la guardia: se vuelve a pedir el estado.
    useTiempoReal("visita", () => recargar());
    // omni-vision terminó de mirar la foto de una lectura: se trae para dibujarla.
    useTiempoReal("lectura_analizada", () => recargar());
    useTiempoReal("aviso_guardia", (d: any) => { recargar(); if (d?.accion === "nuevo" && !silencio && modoSonido !== "off") sonar("denegado"); });

    // Los contadores vuelven a cero a la medianoche del barrio sin recargar: se pide de nuevo al cambiar el día.
    const diaRef = useRef<string>("");
    useEffect(() => { const iv = setInterval(() => { const d = new Date().toDateString(); if (diaRef.current && diaRef.current !== d) recargar(); diaRef.current = d; }, 30_000); return () => clearInterval(iv); }, [recargar]);

    const volverAlVivo = useCallback(() => setFijada(null), []);
    const vueltaFijada = usarInactividad(!!fijada && !fichaId, VOLVER_AL_VIVO_MS, volverAlVivo);

    const c = datos?.contadores;
    const protagonista = fijada || ultima;
    const tinte = tinteDe(protagonista, !!(protagonista?.plate && datos?.logos?.[protagonista.plate]));
    // Toda la pantalla, encabezado incluido, toma el color de quien pasó.
    useEffect(() => {
        setFondo(tinte === "desconocido" ? null : `color-mix(in oklab, ${TINTE[tinte].fondo.replace(/,[\d.]+\)$/, ",1)")} ${tinte === "negra" ? 72 : 62}%, #050505)`);
    }, [tinte, setFondo]);
    useEffect(() => () => setFondo(null), [setFondo]);
    const nuevaMientrasFijada = fijada && ultima && ultima.id !== fijada.id && ultima.ts > fijada.ts ? ultima : null;
    const visibles = useMemo(() => tira.filter((l) => pasaFiltro(l, filtro, modo)), [tira, filtro, modo]);
    const rotulos = rotulosContadores(modo);
    const FILTROS = filtrosDe(modo);
    const alternarFiltro = (f: Filtro) => setFiltro((x) => (x === f ? "todas" : f));

    return (
        <div className="absolute inset-0 flex flex-col overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[1fr_440px] gap-3 lg:gap-4 p-3 lg:p-4 transition-colors duration-700"
            style={{ backgroundImage: tinte === "desconocido" ? undefined : `radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,0.10), transparent 70%)` }}>
            <div className="min-w-0 min-h-[420px] lg:min-h-0 flex-1 flex flex-col gap-3 lg:gap-4">
                {/* Protagonista */}
                <div className={cn("relative flex-1 min-h-[220px] rounded-2xl overflow-hidden bg-neutral-900 ring-2 transition-[box-shadow,--tw-ring-color] duration-300",
                    !protagonista ? "ring-white/10" : tinte !== "desconocido" ? cn("ring-4", TINTE[tinte].anillo) : estadoDe(protagonista, modo).error ? "ring-[var(--mal)]" : "ring-white/25")}>
                    <AnimatePresence mode="popLayout" initial={false}>
                        {protagonista ? (
                            <motion.div key={protagonista.id} initial={{ opacity: 0, scale: 1.015 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={SUAVE} className="absolute inset-0">
                                <Protagonista l={protagonista} tactil={tactil} modo={modo} comp={comportamiento} empresa={protagonista.plate ? datos?.logos?.[protagonista.plate] : null}
                                    alAmpliar={(f) => setAmpliada(f)} alAbrirFicha={() => setFichaId(protagonista.id)} />
                            </motion.div>
                        ) : (
                            <div className="absolute inset-0 grid place-items-center text-[22px] text-muted-foreground">{error && !datos ? `No se pudo leer: ${error}` : datos ? "Todavía no hay lecturas" : "Cargando…"}</div>
                        )}
                    </AnimatePresence>

                    {/* Mirando el pasado: se dice, y se vuelve con un toque o solo. */}
                    <AnimatePresence>
                        {fijada && (
                            <motion.div key="fijada" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={SUAVE}
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-stretch gap-1.5 rounded-2xl bg-black/30 backdrop-blur-md px-2 pt-2 pb-2.5 text-white min-w-[min(92%,520px)]">
                                <div className="flex items-center gap-3 pl-3">
                                    <History size={20} className="text-white/70 shrink-0" />
                                    <div className="min-w-0 flex-1 text-[15px] leading-tight">
                                        <div className="font-semibold truncate">Viendo la lectura de las {horaCorta(fijada.ts)}</div>
                                        <div className="text-white/60 text-[13px]">Vuelve al vivo sola en {Math.round(VOLVER_AL_VIVO_MS / 1000)} s sin tocar</div>
                                    </div>
                                    <button type="button" onClick={volverAlVivo} className={cn("h-12 px-5 rounded-xl inline-flex items-center gap-2 font-bold text-[15px] bg-[var(--accion)] text-white shrink-0", tocable)}>
                                        <Radio size={18} /> En vivo
                                    </button>
                                </div>
                                <CuentaAtras ms={VOLVER_AL_VIVO_MS} vuelta={vueltaFijada} className="px-1" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <AnimatePresence>
                        {nuevaMientrasFijada && (
                            <motion.button key={nuevaMientrasFijada.id} type="button" onClick={volverAlVivo}
                                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SUAVE}
                                className={cn("absolute top-[104px] left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-3 h-14 pl-3 pr-5 rounded-full text-white font-semibold text-[16px] bg-black/35 backdrop-blur-md border border-white/15", tocable)}>
                                <span className={cn("grid h-9 w-9 place-items-center rounded-full", estadoDe(nuevaMientrasFijada, modo).c)}>{(() => { const I = estadoDe(nuevaMientrasFijada, modo).Ic; return <I size={18} />; })()}</span>
                                Nueva lectura · <span className="tabular-nums tracking-[0.1em] font-bold">{nuevaMientrasFijada.plate || "S/L"}</span>
                                <ChevronRight size={18} className="text-white/60" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>

                {/* Contadores del día (filtran las detecciones de la derecha). */}
                <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Contador rotulo={rotulos.adentro} valor={c?.adentro ?? 0} Icono={Users} tono="info" />
                    <Contador rotulo={rotulos.entradas} valor={c?.entradas ?? 0} Icono={LogIn} tono="bien" activo={filtro === "entradas"} alTocar={() => alternarFiltro("entradas")} />
                    <Contador rotulo={rotulos.salidas} valor={c?.salidas ?? 0} Icono={LogOut} activo={filtro === "salidas"} alTocar={() => alternarFiltro("salidas")} />
                    <Contador rotulo={rotulos.rechazos} valor={(modo === "ABIERTO" ? c?.noRegistrados : c?.denegados) ?? 0} Icono={modo === "ABIERTO" ? CircleDashed : ShieldX} tono={modo === "ABIERTO" ? undefined : "mal"} activo={filtro === "denegadas"} alTocar={() => alternarFiltro("denegadas")} />
                </div>
            </div>

            {/* Derecha: lo que entiende el sistema de la lectura en pantalla y las detecciones. */}
            <aside className="shrink-0 lg:shrink flex flex-col gap-3 min-h-0">
                <InteligenciaLectura l={protagonista} empresa={protagonista?.plate ? datos?.logos?.[protagonista.plate] : null} alAbrirFicha={() => protagonista && setFichaId(protagonista.id)} />

                <div className="flex-1 min-h-[260px] rounded-2xl bg-card/90 border border-border p-3 flex flex-col gap-2 overflow-hidden">
                    <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><Radio size={14} /> Detecciones</span>
                        <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">{visibles.length} de {tira.length}</span>
                        <div className="relative">
                            <button type="button" onClick={() => setVerSel((v) => !v)} aria-expanded={verSel} title="Qué cámaras mira esta pantalla"
                                className={cn("h-9 px-3 rounded-full border text-[13px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5", tocable,
                                    camSel ? "bg-[var(--accion)] text-white border-transparent" : "bg-card text-muted-foreground border-border")}>
                                <SlidersHorizontal size={14} /> {camSel ? `${camSel.length}` : "Todas"}
                            </button>
                            <AnimatePresence>
                                {verSel && (
                                    <SelectorCamaras camaras={semaforos} sel={camSel} alCerrar={() => setVerSel(false)}
                                        alCambiar={(v) => { guardarSel(v); setTira([]); setUltima(null); }} />
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {FILTROS.map((f) => (
                            <button key={f.v} type="button" onClick={() => setFiltro(f.v)} aria-pressed={filtro === f.v}
                                className={cn("h-9 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap", tocable,
                                    filtro === f.v ? "bg-foreground text-background border-transparent" : "bg-card text-muted-foreground border-border")}>
                                {f.l}
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1.5 [scrollbar-width:thin]">
                        {visibles.length === 0 && <div className="grid place-items-center h-24 rounded-xl border border-dashed border-border text-[14px] text-muted-foreground">{tira.length ? "Ninguna con este filtro" : "Sin lecturas anteriores"}</div>}
                        <AnimatePresence initial={false}>
                            {visibles.map((l) => {
                                const f = getImagePath(l.foto); const est = estadoDe(l, modo); const sel = fijada?.id === l.id;
                                const emp = l.plate ? datos?.logos?.[l.plate] : null; const t = tinteDe(l, !!emp);
                                return (
                                    <motion.button key={l.id} type="button" layout="position" onClick={() => setFijada(l)}
                                        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={SUAVE}
                                        className={cn("relative shrink-0 flex items-center gap-3 rounded-xl p-1.5 pr-3 text-left border overflow-hidden", tocable,
                                            sel ? "border-[var(--accion-en-oscuro)] ring-2 ring-[var(--accion-en-oscuro)]" : "border-white/10")}
                                        style={{ backgroundColor: t === "desconocido" ? undefined : TINTE[t].fondo }}>
                                        <span className="relative w-[104px] h-[62px] shrink-0 rounded-lg overflow-hidden bg-neutral-900">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {f && <img src={conAncho(f, 240) || undefined} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2">
                                                {esNoLeida(l.plate) && l.relectura?.plate ? <Relectura r={l.relectura} /> : <span className="text-[18px] font-bold tabular-nums tracking-[0.1em] text-white">{l.plate || "S/L"}</span>}
                                                {emp && <span className="ml-auto shrink-0"><LogoSobreFoto empresa={emp} className="h-7 max-w-[96px]" /></span>}
                                            </span>
                                            <span className="block text-[12px] text-white/70 truncate">{horaCorta(l.ts)} · {l.sentido === "EXIT" ? "salida" : "entrada"}{l.camara ? ` · ${l.camara}` : ""}</span>
                                            <span className="block mt-0.5 truncate">{l.clase ? <EtiquetaClase l={l} comp={comportamiento} /> : <span className="text-[11px] text-white/60">{l.persona || (l.decision === "GRANT" ? "Autorizado" : "Sin registro")}</span>}</span>
                                        </span>
                                        <est.Ic size={18} className={cn("shrink-0", est.ok ? "text-[var(--bien)]" : est.error ? "text-[var(--mal)]" : "text-white/50")} />
                                    </motion.button>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </div>

                {((datos?.enBarrio?.visitas?.length || 0) + (datos?.enBarrio?.noRegistradas?.length || 0)) > 0 && <EnElBarrio datos={datos?.enBarrio} modo={modo} alAbrir={(id) => id && setFichaId(id)} />}
                {(datos?.atencion?.length || 0) > 0 && (
                <div className="shrink-0 max-h-[24vh] rounded-2xl bg-card border border-border p-3 lg:p-4 flex flex-col gap-3 overflow-hidden">
                    <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><ShieldAlert size={14} /> Atención · últimas 24 h</div>
                    {datos && datos.atencion.length === 0 && <div className="text-[18px] text-muted-foreground">Sin novedades</div>}
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2 [scrollbar-width:thin]">
                        {(datos?.atencion || []).map((a) => {
                            const av = a.tipo === "AVISO" ? ETIQUETA_AVISO[a.avisoTipo as TipoAviso] : null;
                            const est = av ? { t: av.titulo, Ic: AlertTriangle, c: av.tono === "mal" ? "pleno-mal" : av.tono === "aviso" ? "pleno-aviso" : av.tono === "info" ? "pleno-info" : "bg-neutral-700 text-white" }
                                : a.tipo === "LISTA_NEGRA" ? { t: "Lista negra", Ic: ShieldAlert, c: "pleno-mal" } : a.tipo === "EN_BUSQUEDA" ? { t: "En búsqueda", Ic: Search, c: "pleno-aviso" } : { t: "Merodeo", Ic: Repeat, c: "pleno-info" };
                            return (
                                <button key={a.avisoId || (a.plate || "") + a.tipo} type="button" disabled={!a.id} onClick={() => a.id && setFichaId(a.id)}
                                    className={cn("flex items-center gap-3 rounded-xl bg-muted/40 border border-border px-3 py-2.5 min-h-[60px] text-left", a.id && tocable)}>
                                    <span className={cn("grid h-10 w-10 place-items-center rounded-full shrink-0", est.c)}><est.Ic size={18} /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">{a.plate && <span className="text-[18px] font-bold tabular-nums tracking-[0.1em]">{a.plate}</span>}<span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{est.t}</span></span>
                                        <span className={cn("block text-[13px] text-muted-foreground", av ? "line-clamp-2" : "truncate")}>{a.motivo} · {hace(a.ts)}{a.camara ? ` · ${a.camara}` : ""}</span>
                                    </span>
                                    {a.id && <ChevronRight size={18} className="text-muted-foreground/60 shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
                )}
            </aside>

            <AnimatePresence>
                {incidentes[0] && <IncidenteListaNegra key={incidentes[0].id} l={incidentes[0]} total={incidentes.length}
                    empresa={incidentes[0].plate ? datos?.logos?.[incidentes[0].plate] : null}
                    alCerrar={() => cerrarIncidente(incidentes[0].id)} alVerFicha={() => setFichaId(incidentes[0].id)} />}
            </AnimatePresence>
            <FichaLectura id={fichaId} modo={modo} alCerrar={() => setFichaId(null)} alVerOtra={setFichaId} alAmpliar={setAmpliada}
                alFijar={(l) => { setFijada(ultima && l.id === ultima.id ? null : l); setFichaId(null); }} />

            {/* La captura a pantalla completa: un toque la cierra. */}
            <AnimatePresence>
                {ampliada && (
                    <motion.button key="ampliada" type="button" onClick={() => setAmpliada(null)} aria-label="Cerrar la captura"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                        className="fixed inset-0 z-[60] bg-black grid place-items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <motion.img src={ampliada} alt="" draggable={false} initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} transition={SUAVE} className="max-w-full max-h-full object-contain" />
                        <span className="absolute top-4 right-4 grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white"><X size={28} /></span>
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
}

/**
 * El vehículo principal de la foto según omni-vision (el más grande: el de la barrera), con su
 * color y carrocería si no son dudosos. Es lo que la lectora no dice.
 */
function ResumenVehiculo({ a }: { a?: Analisis | null }) {
    const v = (a?.objetos || []).filter((o) => o.grupo === "vehiculo")
        .sort((x, y) => (y.caja[2] - y.caja[0]) * (y.caja[3] - y.caja[1]) - (x.caja[2] - x.caja[0]) * (x.caja[3] - x.caja[1]))[0];
    if (!v) return null;
    const attr = (v.atributos || []).filter((t) => !t.dudoso && (t.id === "color" || t.id === "carroceria")).map((t) => t.valor);
    return (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-black/55 border border-white/20 px-3 py-1 text-[16px] text-white/90">
            <ScanEye size={16} className="text-[var(--accion-en-oscuro)]" />
            <span className="font-semibold">{[v.nombre, ...attr].join(" · ")}</span>
            <span className="text-white/55 tabular-nums">{Math.round(v.confianza * 100)} %</span>
        </div>
    );
}

/** La lectura grande. Tocar la foto la amplía; "Ficha" abre todo lo que se sabe de ese auto. */
function Protagonista({ l, tactil, modo, alAmpliar, alAbrirFicha, empresa, comp }: { l: Lectura; tactil: boolean; modo: Modo; alAmpliar: (f: string) => void; alAbrirFicha: () => void; empresa?: Logo | null; comp: Comportamiento }) {
    const foto = getImagePath(l.foto);
    /* En la pared se ve a ~1600 px: la original (2560 px, ~1 MB) tardaba en llegar y las siluetas
       quedaban dibujadas sobre negro. Ampliar sigue abriendo la original. */
    const fotoVista = conAncho(foto, ANCHO_PROTAGONISTA) || foto;
    const [cargada, setCargada] = useState<string | null>(null);
    const est = estadoDe(l, modo);
    // El motivo sólo se explica cuando hubo un rechazo de verdad (barrera, o lista negra).
    const conMotivo = est.error;
    return (
        <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {foto ? <img src={fotoVista!} alt="" draggable={false} onLoad={() => setCargada(fotoVista)} className="absolute inset-0 w-full h-full object-contain bg-black" /> : <div className="absolute inset-0 grid place-items-center text-white/30"><Camera size={64} /></div>}
            {foto && l.analisis && cargada === fotoVista && <CapaAnalisis analisis={l.analisis} atributos />}
            {foto && <button type="button" onClick={() => alAmpliar(foto)} aria-label="Ver la captura grande" className="absolute inset-0 cursor-zoom-in" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/40 pointer-events-none" />
            <div className="absolute top-0 inset-x-0 p-4 lg:p-6 flex items-start justify-between gap-4 pointer-events-none">
                <div className="flex items-center gap-3 text-[18px] text-white/85">
                    {l.sentido === "EXIT" ? <LogOut size={22} /> : <LogIn size={22} />}
                    <span className="font-bold">{l.sentido === "EXIT" ? "Salida" : "Entrada"}</span>
                    <span className="text-white/55 truncate">· {l.camara || "—"}</span>
                    {l.accessType !== "FACE" && <span className="pointer-events-auto" title={l.decision === "GRANT" && /Source:\s*Camera/i.test(l.detalles || "") ? "La cámara la encontró en su lista: el relé prendió el semáforo verde" : "No está en la lista de la cámara: semáforo en rojo"}><Semaforo luz={l.decision === "GRANT" && /Source:\s*Camera/i.test(l.detalles || "") ? "verde" : "rojo-nuevo"} chico /></span>}
                </div>
                <div className="text-right text-white/85">
                    <div className="text-[26px] lg:text-[30px] font-bold tabular-nums leading-none">{horaCorta(l.ts)}</div>
                    <div className="text-[14px] text-white/55 mt-1">{hace(l.ts)}{l.metodo.metodo ? ` · ${l.metodo.metodo}` : ""}{l.metodo.confianza != null ? ` · ${Math.round(l.metodo.confianza)} %` : ""}</div>
                </div>
            </div>
            <div className="absolute bottom-0 inset-x-0 p-4 lg:p-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pointer-events-none">
                <div className="min-w-0">
                    <div className="flex items-center gap-4">
                        <div className="inline-block px-5 py-2 rounded-xl bg-white text-black text-[clamp(36px,5.5vw,72px)] font-bold tabular-nums tracking-[0.14em] leading-none shadow-[0_8px_30px_rgba(0,0,0,.6)]">{l.plate || "S/L"}</div>
                        {/* La empresa al lado de la chapa: de lejos, en la pared, se lee antes el logo que el nombre. */}
                        <LogoSobreFoto empresa={empresa} className="h-[clamp(36px,4.5vw,64px)] max-w-[22vw]" />
                    </div>
                    {esNoLeida(l.plate) && l.relectura?.plate && <div className="mt-3"><Relectura r={l.relectura} grande /></div>}
                    <ResumenVehiculo a={l.analisis} />
                    {(l.persona || l.ficha) && (() => { const t = tinteDe(l, !!empresa); return (
                        <div className={cn("mt-3 inline-flex items-stretch rounded-2xl border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,.55)] max-w-full", TINTE[t].tarjeta, TINTE[t].texto, t === "negra" && "animate-pulse")}>
                            {l.unidad && (
                                <div className="px-5 py-2 flex flex-col justify-center border-r border-black/15 shrink-0">
                                    <span className="text-[12px] font-bold uppercase tracking-[0.2em] opacity-80">Lote</span>
                                    <span className="text-[clamp(28px,3.4vw,48px)] font-black leading-none tabular-nums">{l.unidad}</span>
                                </div>
                            )}
                            <div className="px-5 py-2 flex flex-col justify-center min-w-0">
                                <span className="text-[12px] font-bold uppercase tracking-[0.2em] opacity-80">{TINTE[t].rotulo || (l.clase ? ESTILO_MONITOR[l.clase].etiqueta : "Conocido")}</span>
                                <span className="text-[clamp(20px,2.3vw,32px)] font-bold leading-tight truncate">{l.ficha?.nombre || l.persona}</span>
                                {empresa && <span className="text-[13px] font-semibold opacity-85 inline-flex items-center gap-1"><Building2 size={13} /> {empresa.nombre}</span>}
                            </div>
                        </div>); })()}
                    <div className="mt-3 flex items-center gap-3">
                        {!(l.persona || l.ficha) && <><EtiquetaClase l={l} comp={comp} grande /><span className="text-[20px] lg:text-[22px] font-semibold text-white truncate">{quien(l)}</span></>}
                        <button type="button" onClick={alAbrirFicha}
                            className={cn("pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-md text-white font-semibold border border-white/20 shrink-0", tactil ? "h-12 px-5 text-[16px]" : "h-10 px-4 text-[14px]", tocable)}>
                            <PanelRightOpen size={18} /> Ficha
                        </button>
                    </div>
                </div>
                <div className={cn("ml-auto flex items-center gap-3 px-5 lg:px-6 py-3 lg:py-4 rounded-2xl text-white", est.c)}>
                    <est.Ic size={40} />
                    <div>
                        <div className="text-[clamp(22px,2.6vw,34px)] font-black uppercase tracking-[0.08em] leading-none">{est.t}</div>
                        {conMotivo && <div className="text-[16px] font-semibold opacity-90 mt-1 max-w-[420px] truncate">{motivoDenegado(l)}</div>}
                        {/* En búsqueda no deniega, así que no hay «motivo del rechazo»: el motivo de la ficha es lo que hay que leer. */}
                        {!conMotivo && l.ficha?.nivel === "SEARCH" && l.ficha.motivo && <div className="text-[16px] font-semibold opacity-90 mt-1 max-w-[420px] truncate">{l.ficha.motivo}</div>}
                    </div>
                </div>
            </div>
        </>
    );
}

/**
 * La ficha de una lectura, desde la derecha. Contesta, en este orden, lo que se pregunta de un
 * auto en la entrada: ¿se abrió y por qué?, ¿de quién es y de qué lote?, ¿es invitado y a dónde
 * va?, ¿está vigilado?, ¿qué auto es?, ¿qué hizo hoy? Nunca muestra teléfono ni documento.
 */
function FichaLectura({ id, modo, alCerrar, alVerOtra, alAmpliar, alFijar }: { id: string | null; modo: Modo; alCerrar: () => void; alVerOtra: (id: string) => void; alAmpliar: (f: string) => void; alFijar: (l: Lectura) => void }) {
    const [ficha, setFicha] = useState<Ficha | null>(null);
    const [error, setError] = useState<string | null>(null);
    const vuelta = usarInactividad(!!id, FICHA_SE_CIERRA_MS, alCerrar);
    const cargar = useCallback(async (x: string) => {
        setFicha(null); setError(null);
        try {
            const r = await fetch(`/api/monitor/lpr/lectura/${encodeURIComponent(x)}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setFicha(j);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
    }, []);
    useEffect(() => { if (id) cargar(id); }, [id, cargar]);

    const l = ficha?.lectura;
    const foto = l ? getImagePath(l.foto) : null;
    const est = l ? estadoDe(l, modo) : null;
    const vig = ficha?.vigilancia ? watchCatMeta(ficha.vigilancia.categoria) : null;

    return (
        <AnimatePresence>
            {id && (
                <>
                    <motion.button key="fondo" type="button" aria-label="Cerrar la ficha" onClick={alCerrar}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                        className="fixed inset-0 z-40 bg-black/55" />
                    <motion.aside key="ficha" role="dialog" aria-label="Ficha de la lectura"
                        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={RESORTE}
                        className="fixed inset-y-0 right-0 z-50 w-[min(560px,100vw)] bg-background border-l border-border flex flex-col">
                        <div className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3 border-b border-border">
                            <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Ficha de la lectura</div>
                                <div className="text-[15px] text-muted-foreground">Se cierra sola al minuto sin tocar</div>
                            </div>
                            <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground shrink-0", tocable)}><X size={26} /></button>
                        </div>
                        <CuentaAtras ms={FICHA_SE_CIERRA_MS} vuelta={vuelta} className="rounded-none bg-transparent [&>span]:bg-[var(--accion-en-oscuro)]/60" />

                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                            {error ? (
                                <div className="p-6 space-y-4">
                                    <p className="text-[17px]">No se pudo leer la ficha: {error}</p>
                                    <button type="button" onClick={() => id && cargar(id)} className={cn("h-12 px-6 rounded-xl bg-[var(--accion)] text-white font-bold", tocable)}>Reintentar</button>
                                </div>
                            ) : !ficha || !l || !est ? (
                                <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 size={28} className="animate-spin" /></div>
                            ) : (
                                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SUAVE} className="p-5 space-y-5">
                                    {/* La captura */}
                                    <button type="button" disabled={!foto} onClick={() => foto && alAmpliar(foto)}
                                        className={cn("relative block w-full aspect-video rounded-2xl overflow-hidden bg-neutral-900", foto && tocable)}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {foto ? <img src={foto} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain bg-black" /> : <span className="absolute inset-0 grid place-items-center text-white/30"><Camera size={40} /></span>}
                                        {foto && l.analisis && <CapaAnalisis analisis={l.analisis} atributos />}
                                        {foto && <span className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"><Maximize2 size={18} /></span>}
                                    </button>

                                    {/* Matrícula y decisión */}
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="px-4 py-1.5 rounded-xl bg-white text-black text-[34px] font-bold tabular-nums tracking-[0.14em] leading-none">{l.plate || "S/L"}</span>
                                        <span className={cn("inline-flex items-center gap-2 h-11 px-4 rounded-xl font-black uppercase tracking-[0.06em] text-[17px]", est.c)}><est.Ic size={20} /> {est.t}</span>
                                    </div>
                                    <div className="text-[15px] text-muted-foreground -mt-2">
                                        {l.sentido === "EXIT" ? "Salida" : "Entrada"} · {l.camara || "—"} · <span className="tabular-nums">{horaCorta(l.ts)}</span> · {hace(l.ts)}
                                        {est.error && <div className="mt-1 text-foreground font-semibold">{motivoDenegado(l)}</div>}
                                        {modo === "ABIERTO" && ficha.registradaPor && <div className="mt-1 text-foreground">Registrada por {({ padron: "el padrón", visita: "una visita en curso", invitacion: "una invitación vigente", lista_blanca: "la lista blanca" } as Record<string, string>)[ficha.registradaPor] || ficha.registradaPor}</div>}
                                    </div>

                                    {/* Quién */}
                                    <Bloque Icono={Home} titulo="De quién es">
                                        {ficha.persona ? (
                                            <div className="space-y-0.5">
                                                <div className="text-[20px] font-bold">{ficha.persona.nombre}</div>
                                                <div className="text-[15px] text-muted-foreground">{ROL[ficha.persona.rol] || ficha.persona.rol}{ficha.persona.unidad ? <> · <b className="text-foreground">{ficha.persona.unidad}</b></> : " · sin lote asignado"}</div>
                                            </div>
                                        ) : <div className="text-[16px] text-muted-foreground">No está en el padrón.</div>}
                                        {ficha.adentroDesde && <div className="mt-2 inline-flex items-center gap-2 text-[15px]"><span className="h-2.5 w-2.5 rounded-full bg-[var(--bien)]" /> Adentro desde las <b className="tabular-nums">{horaCorta(ficha.adentroDesde)}</b> ({hace(ficha.adentroDesde).replace("hace ", "")})</div>}
                                    </Bloque>

                                    {ficha.visita && (
                                        <Bloque Icono={Timer} titulo="Visita en curso">
                                            <div className="text-[18px] font-semibold">{esPaseLibre(ficha.visita.tipo) ? NOMBRE_PASE_LIBRE : ficha.visita.tipo}{ficha.visita.loteNombre ? <> → <b>{ficha.visita.loteNombre}</b></> : null}</div>
                                            <div className="text-[15px] text-muted-foreground">entró {horaCorta(ficha.visita.entra)} · {esPaseLibre(ficha.visita.tipo) ? "pase libre, sin tiempo" : `vence ${horaCorta(ficha.visita.vence)}`}{ficha.visita.origen === "INVITACION" ? " · por invitación" : ""}</div>
                                        </Bloque>
                                    )}

                                    {ficha.perfil && <BloquePerfil perfil={ficha.perfil} franja={ficha.franja} dias={ficha.franjaDias} />}

                                    {ficha.invitado && (
                                        <Bloque Icono={Ticket} titulo="Invitado">
                                            <div className="text-[18px] font-semibold">{ficha.invitado.nombre || "Invitado"}{ficha.invitado.lote ? <> → <b>{ficha.invitado.lote}</b></> : null}</div>
                                            <div className="text-[15px] text-muted-foreground">{ficha.invitado.anfitrion ? `Lo invitó ${ficha.invitado.anfitrion} · ` : ""}el pase vence {faltan(ficha.invitado.hasta)} (<span className="tabular-nums">{horaCorta(ficha.invitado.hasta)}</span>)</div>
                                        </Bloque>
                                    )}

                                    {ficha.vigilancia && vig && (
                                        <Bloque Icono={ShieldAlert} titulo="Lista negra">
                                            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-md border text-[12px] font-bold uppercase tracking-wider", vig.badge)}>{l.ficha ? NIVELES[l.ficha.nivel].titulo : vig.label}</span>
                                            {l.ficha && <div className="mt-1.5 text-[18px] font-semibold">{l.ficha.nombre}</div>}
                                            <div className="mt-1 text-[16px]">{ficha.vigilancia.motivo || "Sin motivo cargado"}</div>
                                        </Bloque>
                                    )}

                                    {esNoLeida(l.plate) && l.relectura && (
                                        <Bloque Icono={Search} titulo="Leída por omni-vision">
                                            {l.relectura.plate ? (
                                                <div className="space-y-2">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    {l.relectura.chapa && <img src={l.relectura.chapa} alt="" className="h-16 rounded-md border border-border bg-black" />}
                                                    <div className="text-[24px] font-bold tabular-nums tracking-[0.12em]">¿{l.relectura.plate}? <span className="text-[15px] font-normal text-muted-foreground tracking-normal">{l.relectura.confianza != null ? `${Math.round(l.relectura.confianza * 100)} %` : ""}{l.relectura.estado === "DUDOSA" ? " · dudosa" : ""}</span></div>
                                                    {l.relectura.vigilancia && <div className="text-[16px] tono-mal font-semibold">{String(l.relectura.vigilancia.category).toUpperCase() === "SEARCH" ? "En búsqueda" : "Lista negra"}: {l.relectura.vigilancia.motivo || l.relectura.vigilancia.label || "sin motivo"}</div>}
                                                    {l.relectura.quien && <div className="text-[16px]">{l.relectura.quien.name} · {ROL[l.relectura.quien.role] || l.relectura.quien.role}{l.relectura.quien.unidad ? ` · ${l.relectura.quien.unidad}` : ""}</div>}
                                                    <div className="text-[14px] text-muted-foreground">La lectora no leyó la chapa; omni-vision recortó el vehículo y la volvió a leer. Es una sugerencia: la confirma el guardia en el monitor LPR.</div>
                                                </div>
                                            ) : <div className="text-[16px] text-muted-foreground">Se intentó releer del vehículo y no se pudo leer la chapa.</div>}
                                        </Bloque>
                                    )}

                                    {ficha.vehiculo && (ficha.vehiculo.marca || ficha.vehiculo.modelo || ficha.vehiculo.color) && (
                                        <Bloque Icono={Car} titulo="Vehículo">
                                            <div className="text-[17px]">{[ficha.vehiculo.marca, ficha.vehiculo.modelo, ficha.vehiculo.color].filter(Boolean).join(" · ")}</div>
                                        </Bloque>
                                    )}

                                    {/* Hoy: cada paso se toca para verlo en grande */}
                                    <Bloque Icono={History} titulo={`Hoy · ${ficha.hoy.length} lectura${ficha.hoy.length === 1 ? "" : "s"}`}>
                                        <div className="flex flex-col gap-1.5">
                                            {ficha.hoy.map((x) => (
                                                <button key={x.id} type="button" onClick={() => x.id === l.id ? alFijar(l) : alVerOtra(x.id)}
                                                    className={cn("flex items-center gap-3 min-h-[52px] px-3 rounded-xl border text-left", tocable, x.id === l.id ? "border-[var(--accion-en-oscuro)] bg-muted/50" : "border-border bg-card")}>
                                                    {x.sentido === "EXIT" ? <LogOut size={18} className="text-muted-foreground" /> : <LogIn size={18} className="text-muted-foreground" />}
                                                    <span className="tabular-nums font-semibold text-[16px] w-[86px]">{horaCorta(x.ts)}</span>
                                                    <span className="flex-1 min-w-0 truncate text-[14px] text-muted-foreground">{x.camara || "—"}</span>
                                                    {modo === "ABIERTO"
                                                        ? <span className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{x.sentido === "EXIT" ? "salida" : "entrada"}</span>
                                                        : <span className={cn("text-[12px] font-bold uppercase tracking-wider", x.decision === "GRANT" ? "tono-bien" : "tono-mal")}>{x.decision === "GRANT" ? "permitido" : "denegado"}</span>}
                                                </button>
                                            ))}
                                            {!ficha.hoy.length && <div className="text-[15px] text-muted-foreground">Hoy no pasó.</div>}
                                        </div>
                                    </Bloque>

                                    <button type="button" onClick={() => alFijar(l)} className={cn("w-full h-14 rounded-2xl bg-[var(--accion)] text-white font-bold text-[17px] inline-flex items-center justify-center gap-2", tocable)}>
                                        <History size={20} /> Ver esta lectura en grande
                                    </button>
                                </motion.div>
                            )}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}

/** Fracción final del tiempo en la que la cuenta atrás pasa a ámbar (spec "Visitas en el barrio a la vista"). */
const FRACCION_AVISO = 0.2;
const mmss = (ms: number) => { const s = Math.floor(Math.abs(ms) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return `${ms < 0 ? "-" : ""}${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(ss).padStart(2, "0")}`; };

/**
 * "En el barrio ahora". Las visitas registradas, con su cuenta atrás (corre en el navegador
 * contra `vence`; el reloj de la vista refresca cada segundo), ordenadas por lo que vence
 * antes. En abierto, además, las matrículas no registradas que entraron hoy y no se vieron
 * salir, con el tiempo que llevan marcado como ESTIMADO: el 55 % de las entradas no se ve
 * salir, así que ese número no es un cronómetro, es una cota.
 */
function EnElBarrio({ datos, modo, alAbrir }: { datos: Datos["enBarrio"]; modo: Modo; alAbrir: (accessEventId: string | null) => void }) {
    const visitas = datos?.visitas || [];
    const noReg = modo === "ABIERTO" ? datos?.noRegistradas || [] : [];
    const ahora = Date.now();
    return (
        <div className="flex-1 min-h-[120px] max-h-[26vh] lg:max-h-none rounded-2xl bg-card border border-border p-3 lg:p-4 flex flex-col gap-3 overflow-hidden">
            <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><Timer size={14} /> En el barrio ahora · {visitas.length}{noReg.length ? ` + ${noReg.length} sin registrar` : ""}</div>
            {!visitas.length && !noReg.length && <div className="text-[18px] text-muted-foreground">Nadie registrado</div>}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2 [scrollbar-width:thin]">
                {visitas.map((v) => {
                    const resta = +new Date(v.vence) - ahora, total = Math.max(1, +new Date(v.vence) - +new Date(v.desde));
                    // Pase libre: no hay cuenta atrás; se muestra cuánto lleva adentro.
                    const libre = esPaseLibre(v.tipoVisita);
                    const estado = libre ? "ok" : resta < 0 ? "excedida" : resta < total * FRACCION_AVISO ? "cerca" : "ok";
                    return (
                        <button key={v.id} type="button" disabled={!v.accessEventId} onClick={() => alAbrir(v.accessEventId)}
                            className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 min-h-[60px] text-left", v.accessEventId && tocable,
                                estado === "excedida" ? "border-[var(--mal)] bg-[var(--mal-suave)]" : estado === "cerca" ? "border-[var(--aviso)] bg-muted/40" : "border-border bg-muted/40")}>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2"><span className="font-bold text-[15px]">{v.tipoNombre}</span>{v.plate && <span className="text-[15px] font-bold tabular-nums tracking-[0.1em]">{v.plate}</span>}</span>
                                <span className="block text-[13px] text-muted-foreground truncate">{v.lote ? `→ ${v.lote}` : "sin lote"}{v.empresa ? ` · ${v.empresa}` : v.nombre ? ` · ${v.nombre}` : ""}{v.origen === "INVITACION" ? " · por invitación" : ""}</span>
                            </span>
                            <span className={cn("text-right tabular-nums font-bold leading-none shrink-0", estado === "excedida" ? "text-[var(--mal-texto)]" : estado === "cerca" ? "text-[var(--aviso-texto)]" : "")}>
                                <span className="block text-[22px]">{libre ? duracion((ahora - +new Date(v.desde)) / 60000) : mmss(resta)}</span>
                                <span className="block text-[10px] uppercase tracking-wider mt-0.5 opacity-70">{libre ? "adentro" : estado === "excedida" ? "excedida" : "restan"}</span>
                            </span>
                        </button>
                    );
                })}
                {noReg.map((n) => (
                    <button key={n.plate} type="button" onClick={() => alAbrir(n.accessEventId)} className={cn("flex items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2 min-h-[52px] text-left", tocable)}>
                        <CircleDashed size={18} className="text-muted-foreground shrink-0" />
                        <span className="min-w-0 flex-1">
                            <span className="text-[15px] font-bold tabular-nums tracking-[0.1em]">{n.plate}</span>
                            <span className="block text-[12px] text-muted-foreground truncate">no registrada{n.camara ? ` · ${n.camara}` : ""}</span>
                        </span>
                        <span className="text-[14px] tabular-nums text-muted-foreground shrink-0">~{duracion((ahora - +new Date(n.desde)) / 60000)} <span className="text-[11px]">(estimado)</span></span>
                    </button>
                ))}
            </div>
        </div>
    );
}

const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

/**
 * El perfil de la matrícula en la ficha: qué clase es, cada cuánto viene, cuánto se queda y su
 * rutina. La rutina se DIBUJA con las lecturas reales (7 días × 24 horas, más oscuro = más
 * veces), no sólo con el resumen: así se ve también lo que no llega a ser rutina.
 */
function BloquePerfil({ perfil, franja, dias }: { perfil: NonNullable<Ficha["perfil"]>; franja?: number[][]; dias?: number }) {
    const max = Math.max(1, ...(franja || []).flat());
    return (
        <Bloque Icono={Activity} titulo="Comportamiento">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center h-8 px-3 rounded-lg bg-muted text-[14px] font-bold">{NOMBRE_CLASE[perfil.clase as Clase] || perfil.clase}</span>
                <span className="text-[15px] text-muted-foreground">vino {perfil.diasVistos} de los últimos {dias || 30} días</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
                <div><div className="text-muted-foreground text-[12px]">Se queda, normalmente</div><div className="font-semibold">{perfil.permanenciaMedianaMin != null ? duracion(perfil.permanenciaMedianaMin) : perfil.entradaNoVista ? "sin entrada leída" : "sin salidas leídas"}</div></div>
                <div><div className="text-muted-foreground text-[12px]">9 de cada 10 veces, menos de</div><div className="font-semibold">{perfil.permanenciaP90Min != null ? duracion(perfil.permanenciaP90Min) : "—"}</div></div>
            </div>
            <div className="mt-2 text-[15px]">{perfil.rutina ? <>Rutina: <b>{describirRutina(perfil.rutina)}</b></> : <span className="text-muted-foreground">Sin rutina detectada</span>}</div>
            {perfil.entradaNoVista && <div className="mt-1 text-[12px] text-muted-foreground">Sólo se la leyó saliendo: la cámara de Entrada casi no lee de noche.</div>}
            {franja && (
                <div className="mt-3">
                    <div className="grid grid-cols-[18px_repeat(24,minmax(0,1fr))] gap-[2px]">
                        {franja.map((fila, d) => (
                            <div key={d} className="contents">
                                <span className="text-[10px] text-muted-foreground leading-[14px]">{DIAS_CORTOS[d]}</span>
                                {fila.map((n, h) => (
                                    <span key={h} title={`${DIAS_CORTOS[d]} ${String(h).padStart(2, "0")}h · ${n} lectura${n === 1 ? "" : "s"}`}
                                        className="h-[14px] rounded-[3px]" style={{ background: n ? `color-mix(in oklab, var(--accion-en-oscuro) ${Math.round(25 + 75 * (n / max))}%, transparent)` : "var(--muted)" }} />
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className="mt-1 grid grid-cols-[18px_repeat(24,minmax(0,1fr))] text-[9px] text-muted-foreground tabular-nums">
                        <span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 6 === 0 ? h : ""}</span>)}
                    </div>
                </div>
            )}
        </Bloque>
    );
}

/**
 * Inteligencia sobre la lectura que está en pantalla: quién es, cuántos días vino, cuánto se
 * queda, su rutina, la grilla día × hora de los últimos días (estilo contribuciones de git, con
 * las lecturas reales) y los pasos de hoy. Sale de la misma consulta que la ficha.
 */
const cacheInteligencia = new Map<string, Ficha>();
function InteligenciaLectura({ l, empresa, alAbrirFicha }: { l: Lectura | null; empresa?: Logo | null; alAbrirFicha: () => void }) {
    const [ficha, setFicha] = useState<Ficha | null>(null);
    const [cargando, setCargando] = useState(false);
    const id = l?.id || null;
    const sinChapa = !l || esNoLeida(l.plate);
    useEffect(() => {
        if (!id || sinChapa) { setFicha(null); return; }
        const enCache = cacheInteligencia.get(id);
        if (enCache) { setFicha(enCache); return; }
        let vivo = true; setCargando(true);
        // Un respiro: si entran varias lecturas seguidas, se pide sólo la última.
        const t = setTimeout(() => {
            fetch(`/api/monitor/lpr/lectura/${encodeURIComponent(id)}`, { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!vivo || !j) return; cacheInteligencia.set(id, j); if (cacheInteligencia.size > 60) cacheInteligencia.delete(cacheInteligencia.keys().next().value as string); setFicha(j); })
                .catch(() => { }).finally(() => vivo && setCargando(false));
        }, 350);
        return () => { vivo = false; clearTimeout(t); };
    }, [id, sinChapa]);

    const p = ficha?.perfil; const franja = ficha?.franja; const dias = ficha?.franjaDias || 30;
    const max = Math.max(1, ...(franja || []).flat());
    const total = (franja || []).flat().reduce((a, b) => a + b, 0);
    return (
        <section className="shrink-0 rounded-2xl bg-card/90 border border-border p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><Sparkles size={14} /> Inteligencia</span>
                {l?.plate && !sinChapa && <span className="text-[15px] font-bold tabular-nums tracking-[0.1em]">{l.plate}</span>}
                {empresa && <LogoSobreFoto empresa={empresa} className="h-7 max-w-[110px]" />}
                {cargando && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                {l && <button type="button" onClick={alAbrirFicha} className={cn("ml-auto h-8 px-3 rounded-full border border-border text-[12px] font-semibold inline-flex items-center gap-1", tocable)}>Ficha <ChevronRight size={14} /></button>}
            </div>
            {!l ? <div className="text-[14px] text-muted-foreground">Esperando la primera lectura.</div>
                : sinChapa ? <div className="text-[14px] text-muted-foreground">Sin matrícula leída: no hay historia para analizar.</div>
                : !ficha ? <div className="h-[150px] rounded-xl bg-muted/40 animate-pulse" />
                : (<>
                    <div className="grid grid-cols-3 gap-2">
                        <Dato rotulo="Días vistos" valor={p ? `${p.diasVistos}/${dias}` : "—"} />
                        <Dato rotulo="Se queda" valor={p?.permanenciaMedianaMin != null ? duracion(p.permanenciaMedianaMin) : "—"} />
                        <Dato rotulo="Hoy" valor={`${ficha.hoy.length} ${ficha.hoy.length === 1 ? "paso" : "pasos"}`} />
                    </div>
                    <div className="text-[13px] leading-snug">
                        {p ? <><span className="font-semibold">{NOMBRE_CLASE[p.clase as Clase] || p.clase}</span>{" · "}{p.rutina ? <>rutina <b>{describirRutina(p.rutina)}</b></> : <span className="text-muted-foreground">sin rutina detectada</span>}</>
                            : <span className="text-muted-foreground">Primera vez que se la ve en {dias} días.</span>}
                        {ficha.adentroDesde && <span className="text-muted-foreground">{" · "}adentro desde {horaCorta(ficha.adentroDesde)}</span>}
                        {ficha.vigilancia && <span className="ml-1 px-1.5 py-0.5 rounded pleno-mal text-[11px] font-bold uppercase">{ficha.vigilancia.categoria}</span>}
                    </div>
                    {franja && (
                        <div>
                            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>Actividad · últimos {dias} días</span><span className="tabular-nums">{total} lecturas</span></div>
                            <div className="grid grid-cols-[14px_repeat(24,minmax(0,1fr))] gap-[2px]">
                                {franja.map((fila, d) => (
                                    <div key={d} className="contents">
                                        <span className="text-[9px] text-muted-foreground leading-[12px]">{DIAS_CORTOS[d]}</span>
                                        {fila.map((n, h) => (
                                            <span key={h} title={`${DIAS_CORTOS[d]} ${String(h).padStart(2, "0")}h · ${n} lectura${n === 1 ? "" : "s"}`}
                                                className="h-[12px] rounded-[2px]" style={{ background: n ? `color-mix(in oklab, #22c55e ${Math.round(30 + 70 * (n / max))}%, transparent)` : "color-mix(in oklab, var(--muted) 80%, transparent)" }} />
                                        ))}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-0.5 grid grid-cols-[14px_repeat(24,minmax(0,1fr))] text-[9px] text-muted-foreground tabular-nums">
                                <span />{Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 6 === 0 ? h : ""}</span>)}
                            </div>
                        </div>
                    )}
                    {ficha.hoy.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                            {ficha.hoy.slice(0, 12).map((x) => (
                                <span key={x.id} className={cn("inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] tabular-nums border", x.id === l.id ? "border-[var(--accion-en-oscuro)]" : "border-border",
                                    x.decision === "GRANT" ? "bg-emerald-500/10" : "bg-red-500/10")}>
                                    {x.sentido === "EXIT" ? <LogOut size={11} /> : <LogIn size={11} />}{horaCorta(x.ts)}
                                </span>
                            ))}
                        </div>
                    )}
                </>)}
        </section>
    );
}
function Dato({ rotulo, valor }: { rotulo: string; valor: string }) {
    return (
        <div className="rounded-xl bg-muted/50 px-2.5 py-1.5 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate">{rotulo}</div>
            <div className="text-[15px] font-bold tabular-nums truncate">{valor}</div>
        </div>
    );
}

function Bloque({ Icono, titulo, children }: { Icono: any; titulo: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Icono size={14} /> {titulo}</div>
            {children}
        </section>
    );
}

/** Qué cámaras mira esta pantalla, agrupadas por garita. */
function SelectorCamaras({ camaras, sel, alCambiar, alCerrar }: { camaras: EstadoSemaforo[]; sel: string[] | null; alCambiar: (v: string[] | null) => void; alCerrar: () => void }) {
    const [marcadas, setMarcadas] = useState<Set<string>>(new Set(sel || camaras.map((c) => c.deviceId)));
    const garitas = useMemo(() => {
        const m = new Map<string, EstadoSemaforo[]>();
        for (const c of camaras) m.set(c.garita, [...(m.get(c.garita) || []), c]);
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
    }, [camaras]);
    const alternar = (ids: string[]) => setMarcadas((prev) => {
        const n = new Set(prev); const todas = ids.every((i) => n.has(i));
        ids.forEach((i) => (todas ? n.delete(i) : n.add(i))); return n;
    });
    const aplicar = () => { const v = [...marcadas]; alCambiar(v.length === camaras.length ? null : v); alCerrar(); };
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE} className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={alCerrar}>
        <motion.div initial={{ scale: 0.97, y: 8 }} animate={{ scale: 1, y: 0 }} transition={SUAVE} onClick={(e) => e.stopPropagation()}
            className="w-[min(560px,94vw)] rounded-2xl bg-background border border-border shadow-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-muted-foreground" />
                <span className="font-bold text-[15px]">Cámaras de esta pantalla</span>
                <button type="button" onClick={() => setMarcadas(new Set(camaras.map((c) => c.deviceId)))} className="ml-auto text-[13px] text-muted-foreground hover:text-foreground">Todas</button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-[46vh] overflow-y-auto">
                {garitas.map(([g, cams]) => (
                    <div key={g} className="rounded-xl border border-border p-2">
                        <button type="button" onClick={() => alternar(cams.map((c) => c.deviceId))} className="text-[12px] font-black uppercase tracking-wider text-muted-foreground mb-1 hover:text-foreground">Garita {g}</button>
                        {cams.map((c) => (
                            <label key={c.deviceId} className="flex items-center gap-2 py-1.5 text-[14px] cursor-pointer select-none">
                                <input type="checkbox" checked={marcadas.has(c.deviceId)} onChange={() => alternar([c.deviceId])} className="h-5 w-5 accent-[var(--accion)]" />
                                <span className="truncate">{c.nombre}</span>
                            </label>
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-2 justify-end">
                <button type="button" onClick={alCerrar} className={cn("h-11 px-4 rounded-xl border border-border text-[14px]", tocable)}>Cancelar</button>
                <button type="button" onClick={aplicar} disabled={!marcadas.size} className={cn("h-11 px-5 rounded-xl bg-[var(--accion)] text-white font-bold text-[14px] disabled:opacity-50", tocable)}>Aplicar</button>
            </div>
        </motion.div>
        </motion.div>
    );
}

/**
 * Lista negra en la garita: la pantalla entera titila en rojo y no se va sola. El guardia tiene
 * que cerrar el incidente (dos toques: «Cerrar incidente» y confirmar), así no pasa inadvertido
 * aunque nadie estuviera mirando en el segundo en que entró.
 */
function IncidenteListaNegra({ l, total, empresa, alCerrar, alVerFicha }: { l: Lectura; total: number; empresa?: Logo | null; alCerrar: () => void; alVerFicha: () => void }) {
    const [confirmar, setConfirmar] = useState(false);
    const foto = getImagePath(l.foto);
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] grid place-items-center p-4" role="alertdialog" aria-label="Incidente de lista negra">
            <motion.div className="absolute inset-0 bg-red-700" animate={{ opacity: [0.55, 0.88, 0.55] }} transition={{ duration: 1.1, repeat: Infinity }} />
            <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} className="relative w-[min(920px,96vw)] rounded-3xl bg-neutral-950 border-4 border-red-500 shadow-[0_0_80px_rgba(239,68,68,.7)] overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 bg-red-600 text-white">
                    <Siren size={34} className="animate-pulse" />
                    <div className="flex-1">
                        <div className="text-[clamp(26px,3vw,40px)] font-black uppercase tracking-[0.12em] leading-none">Lista negra</div>
                        <div className="text-[15px] font-semibold opacity-90 mt-1">{l.sentido === "EXIT" ? "Salida" : "Entrada"} · {l.camara || "—"} · {horaCorta(l.ts)} ({hace(l.ts)})</div>
                    </div>
                    {total > 1 && <span className="px-3 py-1 rounded-full bg-black/30 font-bold">1 de {total}</span>}
                </div>
                <div className="grid md:grid-cols-[1.4fr_1fr] gap-0">
                    <div className="relative aspect-video bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {foto ? <img src={foto} alt="" className="absolute inset-0 w-full h-full object-contain" /> : <span className="absolute inset-0 grid place-items-center text-white/30"><Camera size={56} /></span>}
                    </div>
                    <div className="p-5 flex flex-col gap-3 text-white">
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className="px-4 py-1.5 rounded-xl bg-white text-black text-[clamp(30px,3.4vw,46px)] font-black tabular-nums tracking-[0.14em] leading-none">{l.plate || "S/L"}</span>
                            <LogoSobreFoto empresa={empresa} className="h-12 max-w-[160px]" />
                        </div>
                        {(l.ficha?.nombre || l.persona) && <div className="text-[22px] font-bold">{l.ficha?.nombre || l.persona}{l.unidad ? <span className="text-white/70 font-semibold"> · Lote {l.unidad}</span> : null}</div>}
                        <div className="rounded-xl bg-red-500/15 border border-red-500/40 p-3 text-[16px]"><b>Motivo:</b> {l.ficha?.motivo || motivoDenegado(l)}</div>
                        <div className="mt-auto flex flex-col gap-2">
                            <button type="button" onClick={alVerFicha} className={cn("h-12 rounded-xl bg-white/10 border border-white/20 font-semibold inline-flex items-center justify-center gap-2", tocable)}><PanelRightOpen size={18} /> Ver ficha</button>
                            {!confirmar ? (
                                <button type="button" onClick={() => setConfirmar(true)} className={cn("h-14 rounded-xl bg-red-600 hover:bg-red-500 font-black text-[17px] uppercase tracking-wide", tocable)}>Cerrar incidente</button>
                            ) : (
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setConfirmar(false)} className={cn("flex-1 h-14 rounded-xl bg-white/10 font-semibold", tocable)}>Volver</button>
                                    <button type="button" onClick={alCerrar} className={cn("flex-[2] h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-[16px]", tocable)}>Sí, ya lo atendí</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
