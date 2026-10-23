"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    LogIn, LogOut, ShieldCheck, ShieldX, ShieldAlert, Search, Repeat, Camera, Clock, Users, X, Radio,
    PanelRightOpen, Home, Car, Ticket, History, Maximize2, ChevronRight, Loader2, CircleDashed, AlertTriangle, Timer, Activity,
    ScanEye, ArrowDown, ArrowUp, SlidersHorizontal,
} from "lucide-react";
import { fondoDe, type TonoFondo } from "@/lib/monitor/fondos";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { metodoDeLectura } from "@/lib/lectura-metodo";
import { watchCatMeta } from "@/lib/watch-categories";
import { presentarLectura, ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { describirRutina, duracion, NOMBRE_CLASE, type Rutina, type Clase } from "@/lib/visitas/calculos";
import { cn } from "@/lib/utils";
import { chapaDe, MarcaOmniVision, MarcaVerificacion, textoChapa } from "@/components/vision/ChapaReleida";
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
 *  · Los cuatro números de quién está adentro abren su lista en un cajón: hora de ingreso,
 *    permanencia y la captura; tocar la captura la pone de protagonista.
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
    /** Quién está adentro, en cuatro números (lib/presencia). */
    presencia?: { residentes: number; visitasProveedores: number; desconocidos: number; atipicos: number } | null;
    /** Matrícula → logo de su empresa (ver lib/empresas-servidor). */
    logos?: Record<string, Logo>;
    /** Los interruptores de las pestañas de Usuarios: color propio y sonido al pasar, por clase. */
    comportamiento?: Comportamiento;
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
    /* La chapa ya va en el lugar de la chapa, con la marca de OmniVision (ChapaReleida): acá queda
       lo que cambia lo que hace el guardia — si está en una lista o de quién es. */
    if (!negra && !busqueda && !r.quien) return null;
    return (
        <span className={cn("inline-flex items-center gap-2 flex-wrap", grande ? "text-[17px]" : "text-[11px]")}>
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
    id: e.id, ts: e.timestamp, plate: (e.plateDetected || e.plateNumber || "").toUpperCase() || null, persona: e.user?.name || null, unidad: e.user?.unit?.name || null,
    // Aproximado hasta que la consulta (1,2 s después) traiga el registro completo (visita, invitación).
    registrada: !!(e.user || e.guest),
    camara: e.device?.name || e.location || null, sentido: e.direction || "ENTRY", decision: e.decision || "DENY", accessType: e.accessType || null,
    foto: e.snapshotPath || e.imagePath || null, detalles: e.details || null, metodo: metodoDeLectura(e.details || null),
}) : null;

const esListaNegra = (l: Lectura) => /lista negra/i.test(l.detalles || "");
/** La chapa que leyó OmniVision, con su caja, para dibujarla con las siluetas (CapaAnalisis). */
const chapaEnFoto = (l: Lectura) => (l.relectura?.plate && l.relectura.caja ? { plate: l.relectura.plate, caja: l.relectura.caja } : null);

/**
 * El color de quien pasa, para leerlo de lejos sin leer nada (traído de Los Olivos, 15/10):
 * rojo no autorizado (y lista negra o en búsqueda, más fuerte), verde autorizado, amarillo
 * proveedor, violeta visita. Tiñe TODA la pantalla de la pared —encabezado incluido, con
 * MarcoMonitor.setFondo—, el borde de la lectura grande y el de cada lectura de la tira.
 * Sin lectura, la pantalla queda como siempre.
 */
type Tinte = "autorizado" | "proveedor" | "visita" | "negra" | "denegado" | "desconocido";
const tinteDe = (l: Lectura | null | undefined, conEmpresa?: boolean): Tinte => {
    if (!l) return "desconocido";
    if (esListaNegra(l) || l.clase === "alerta" || l.clase === "busqueda") return "negra";
    if (l.decision !== "GRANT") return "denegado";
    if (l.clase === "proveedores" || conEmpresa) return "proveedor";
    if (l.clase === "visitas") return "visita";
    return "autorizado";
};
/** `color`: el tono puro; el fondo de la pantalla lo mezcla con negro (MEZCLA_FONDO) para que el texto se lea. */
/** El tono de cada tinte en el criterio común de las paredes (lib/monitor/fondos) y el anillo de su lectura. */
const TINTE: Record<Tinte, { tono: TonoFondo | null; anillo: string }> = {
    autorizado: { tono: "bien", anillo: "ring-emerald-400" },
    proveedor: { tono: "aviso", anillo: "ring-amber-400" },
    visita: { tono: "visita", anillo: "ring-violet-400" },
    denegado: { tono: "mal", anillo: "ring-red-500" },
    negra: { tono: "mal", anillo: "ring-red-500" },
    desconocido: { tono: null, anillo: "ring-white/25" },
};
/** La lista negra lleva más color: tiene que gritar. */
const fondoLpr = (t: Tinte) => fondoDe(TINTE[t].tono, t === "negra");
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

function Contador({ rotulo, valor, Icono, tono, activo, alTocar, href }: { rotulo: string; valor: number | null; Icono: any; tono?: "bien" | "mal" | "info" | "aviso"; activo?: boolean; alTocar?: () => void; href?: string }) {
    const clase = cn("flex items-center gap-3 lg:gap-4 rounded-2xl bg-card border px-4 lg:px-5 py-3 lg:py-4 text-left min-h-[72px]", tocable,
        activo ? "border-[var(--accion-en-oscuro)] ring-2 ring-[var(--accion-en-oscuro)]/40" : "border-border", !alTocar && !href && "active:scale-100");
    const cuerpo = (
        <>
            <span className={cn("grid h-11 w-11 lg:h-12 lg:w-12 place-items-center rounded-full shrink-0", tono === "bien" ? "pleno-bien" : tono === "mal" ? "pleno-mal" : tono === "info" ? "pleno-info" : tono === "aviso" ? "pleno-aviso" : "bg-muted text-muted-foreground")}><Icono size={22} /></span>
            <div className="min-w-0">
                <div className="text-[32px] lg:text-[40px] font-bold leading-none tabular-nums">{valor ?? "—"}</div>
                {/* Sin recortar: "Denegado…" con 1668 al lado no dice qué cuenta. Baja a dos renglones si hace falta. */}
                <div className="text-[13px] lg:text-[14px] text-muted-foreground mt-1 leading-tight">{rotulo}</div>
            </div>
        </>
    );
    if (href) return <a href={href} className={clase}>{cuerpo}</a>;
    return <button type="button" onClick={alTocar} disabled={!alTocar} aria-pressed={activo} className={clase}>{cuerpo}</button>;
}

export function VistaLpr() {
    const { latir, setTitulo, setFondo, ajustes, silencio, tactil } = useMarco();
    useEffect(() => { setTitulo("Control LPR"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/lpr", INTERVALO_MS, latir);
    const [ultima, setUltima] = useState<Lectura | null>(null);
    const [tira, setTira] = useState<Lectura[]>([]);
    const [fijada, setFijada] = useState<Lectura | null>(null);
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [fichaId, setFichaId] = useState<string | null>(null);
    const [cajon, setCajon] = useState<ClaveLista | null>(null);
    const [ampliada, setAmpliada] = useState<string | null>(null);
    useEffect(() => { if (!datos) return; setUltima((u) => (u && datos.ultima && u.ts > datos.ultima.ts ? u : datos.ultima)); setTira((t) => { const base = datos.tira; const ids = new Set(base.map((x) => x.id)); return [...t.filter((x) => !ids.has(x.id) && (!datos.ultima || x.id !== datos.ultima.id) && (!base[0] || x.ts > base[0].ts)), ...base].slice(0, ULTIMAS_EN_TIRA); }); }, [datos]);

    const modoSonido = ajustes?.sonido?.lpr || "off";
    const comportamiento = useMemo(() => normalizarComportamiento(datos?.comportamiento || COMPORTAMIENTO_DEFECTO), [datos?.comportamiento]);
    /** Barrio abierto o cerrado (Ajustes → Visitas y patrones); lo trae la consulta. */
    const modo: Modo = datos?.modo === "ABIERTO" ? "ABIERTO" : "CERRADO";
    useTiempoReal("access_event", (e: any) => {
        const l = desdeEvento(e); if (!l) return;
        latir();
        // La clase del socket, para que el color de la pantalla sea el correcto desde el primer instante.
        l.clase = claseDeLectura(e.user, e.watch?.category) as any;
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
        // La relectura tarda unos segundos (vision-worker): se vuelve a pedir para traerla. Con
        // chapa leída también: si la cámara tiene doble verificación, llega igual (el socket no
        // trae el modo de la cámara, y una consulta de más no cuesta nada en la pared).
        setTimeout(recargar, RELECTURA_ESPERA_MS);
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

    const protagonista = fijada || ultima;
    const tinte = tinteDe(protagonista, !!(protagonista?.plate && datos?.logos?.[protagonista.plate]));
    // Toda la pantalla, encabezado incluido, toma el color de quien pasó.
    useEffect(() => { setFondo(fondoLpr(tinte)); }, [tinte, setFondo]);
    useEffect(() => () => setFondo(null), [setFondo]);
    const nuevaMientrasFijada = fijada && ultima && ultima.id !== fijada.id && ultima.ts > fijada.ts ? ultima : null;
    const visibles = useMemo(() => tira.filter((l) => pasaFiltro(l, filtro, modo)), [tira, filtro, modo]);
    const FILTROS = filtrosDe(modo);

    return (
        <div className="absolute inset-0 flex flex-col lg:grid lg:grid-cols-[1fr_380px] gap-3 lg:gap-4 p-3 lg:p-4">
            <div className="min-w-0 min-h-0 flex-1 flex flex-col gap-3 lg:gap-4">
                {/* Protagonista */}
                <div className={cn("relative flex-1 min-h-[220px] rounded-2xl overflow-hidden bg-neutral-900 ring-2 transition-[box-shadow,--tw-ring-color] duration-300",
                    !protagonista ? "ring-white/10" : TINTE[tinte].anillo)}>
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
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-stretch gap-1.5 rounded-2xl bg-black/75 backdrop-blur-md px-2 pt-2 pb-2.5 text-white min-w-[min(92%,520px)]">
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
                                className={cn("absolute top-[104px] left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-3 h-14 pl-3 pr-5 rounded-full text-white font-semibold text-[16px] bg-black/80 backdrop-blur-md border border-white/15", tocable)}>
                                <span className={cn("grid h-9 w-9 place-items-center rounded-full", estadoDe(nuevaMientrasFijada, modo).c)}>{(() => { const I = estadoDe(nuevaMientrasFijada, modo).Ic; return <I size={18} />; })()}</span>
                                Nueva lectura · <span className="tabular-nums tracking-[0.1em] font-bold">{nuevaMientrasFijada.plate || "S/L"}</span>
                                <ChevronRight size={18} className="text-white/60" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>

                {/* Filtro y tira: se desliza con el dedo, cada lectura se toca. */}
                <div className="shrink-0 flex flex-col gap-2">
                    <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {FILTROS.map((f) => (
                            <button key={f.v} type="button" onClick={() => setFiltro(f.v)} aria-pressed={filtro === f.v}
                                className={cn("h-11 px-5 rounded-full border text-[15px] font-semibold whitespace-nowrap", tocable,
                                    filtro === f.v ? "bg-foreground text-background border-transparent" : "bg-card text-muted-foreground border-border")}>
                                {f.l}
                            </button>
                        ))}
                        <span className="ml-auto pl-3 text-[13px] text-muted-foreground whitespace-nowrap tabular-nums">{visibles.length} de las últimas {tira.length}</span>
                    </div>
                    <div className="h-[124px] flex gap-3 overflow-x-auto overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {visibles.length === 0 && <div className="grid place-items-center w-full rounded-xl border border-dashed border-border text-[15px] text-muted-foreground">{tira.length ? "Ninguna con este filtro" : "Sin lecturas anteriores"}</div>}
                        <AnimatePresence initial={false}>
                            {visibles.map((l) => {
                                const f = getImagePath(l.foto); const est = estadoDe(l, modo); const ok = est.ok; const sel = fijada?.id === l.id;
                                return (
                                    <motion.button key={l.id} type="button" layout="position" onClick={() => setFijada(l)}
                                        initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.94 }} transition={SUAVE}
                                        className={cn("relative w-[200px] shrink-0 snap-start rounded-xl overflow-hidden bg-neutral-900 text-left", tocable,
                                            sel ? "ring-[3px] ring-[var(--accion-en-oscuro)]" : cn("ring-2", TINTE[tinteDe(l, !!(l.plate && datos?.logos?.[l.plate]))].anillo))}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {f && <img src={f} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}
                                        {f && l.analisis && <CapaAnalisis analisis={l.analisis} ajuste="cover" etiquetas={false} />}
                                        <span className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
                                        {l.plate && datos?.logos?.[l.plate] && <span className="absolute top-2 left-2"><LogoSobreFoto empresa={datos.logos[l.plate]} className="h-6 max-w-[90px]" /></span>}
                                        {l.clase && !(l.plate && datos?.logos?.[l.plate]) && <span className="absolute top-2 left-2 max-w-[184px]"><EtiquetaClase l={l} comp={comportamiento} /></span>}
                                        <span className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
                                            <span className="min-w-0">
                                                {(() => {
                                                    /* Una NO_LEIDA: la chapa que leyó OmniVision, con su destello. */
                                                    const ch = chapaDe(l.plate, l.relectura);
                                                    return (
                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                            <span className="text-[18px] font-bold text-white tabular-nums tracking-[0.1em] truncate">{ch.plate ? textoChapa(ch) : esNoLeida(l.plate) ? "S/L" : l.plate}</span>
                                                            {esNoLeida(l.plate) && l.relectura && <MarcaOmniVision r={l.relectura} oscuro tamano="sm" soloIcono={!ch.omni} />}
                                                            <MarcaVerificacion plate={l.plate} r={l.relectura} oscuro tamano="sm" soloIcono />
                                                        </span>
                                                    );
                                                })()}
                                                <span className="block text-[12px] text-white/65 tabular-nums">{horaCorta(l.ts)} · {l.sentido === "EXIT" ? "salida" : "entrada"}</span>
                                            </span>
                                            <est.Ic size={18} className={ok ? "text-[var(--bien)]" : est.error ? "text-[var(--mal)]" : "text-white/50"} />
                                        </span>
                                    </motion.button>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Quién está adentro, en cuatro números (16/10, Nico): reemplazan a entradas, salidas y
                denegados del día, al «adentro ahora» y al bloque «En el barrio ahora». Tocar uno abre
                su lista en un cajón acá mismo —la pared no se va al panel—; la fila de atención ocupa
                el resto hasta abajo. */}
            <aside className="shrink-0 lg:shrink flex flex-col gap-3 min-h-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
                    {LISTAS_PRESENCIA.map((x) => (
                        <Contador key={x.clave} rotulo={x.rotulo} valor={datos?.presencia?.[x.resumen] ?? null} Icono={x.Icono}
                            tono={x.clave === "atipicos" ? (datos?.presencia?.atipicos ? "aviso" : undefined) : x.tono} activo={cajon === x.clave} alTocar={() => setCajon(x.clave)} />
                    ))}
                </div>
                <div className="flex-1 min-h-[160px] rounded-2xl bg-card border border-border p-3 lg:p-4 flex flex-col gap-3 overflow-hidden">
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
            </aside>

            <CajonPresencia lista={cajon} alCerrar={() => setCajon(null)} alCambiar={setCajon} alAbrirFicha={(id) => setFichaId(id)}
                alFijar={(l) => { setFijada(ultima && l.id === ultima.id ? null : l); setCajon(null); }} />
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
            {foto && l.analisis && cargada === fotoVista && <CapaAnalisis analisis={l.analisis} atributos chapa={chapaEnFoto(l)} />}
            {foto && <button type="button" onClick={() => alAmpliar(foto)} aria-label="Ver la captura grande" className="absolute inset-0 cursor-zoom-in" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/40 pointer-events-none" />
            <div className="absolute top-0 inset-x-0 p-4 lg:p-6 flex items-start justify-between gap-4 pointer-events-none">
                <div className="flex items-center gap-3 text-[18px] text-white/85">
                    {l.sentido === "EXIT" ? <LogOut size={22} /> : <LogIn size={22} />}
                    <span className="font-bold">{l.sentido === "EXIT" ? "Salida" : "Entrada"}</span>
                    <span className="text-white/55 truncate">· {l.camara || "—"}</span>
                </div>
                <div className="text-right text-white/85">
                    <div className="text-[26px] lg:text-[30px] font-bold tabular-nums leading-none">{horaCorta(l.ts)}</div>
                    <div className="text-[14px] text-white/55 mt-1">{hace(l.ts)}{l.metodo.metodo ? ` · ${l.metodo.metodo}` : ""}{l.metodo.confianza != null ? ` · ${Math.round(l.metodo.confianza)} %` : ""}</div>
                </div>
            </div>
            <div className="absolute bottom-0 inset-x-0 p-4 lg:p-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pointer-events-none">
                <div className="min-w-0">
                    <div className="flex items-center gap-4">
                        {(() => {
                            /* La cámara no leyó: va la chapa que leyó OmniVision (doble verificación), con borde
                               punteado y su marca; si tampoco pudo, «S/L» y la marca lo dice. */
                            const ch = chapaDe(l.plate, l.relectura);
                            return (
                                <div className="flex flex-col items-start gap-1.5">
                                    <div className={cn("inline-block px-5 py-2 rounded-xl bg-white text-black text-[clamp(36px,5.5vw,72px)] font-bold tabular-nums tracking-[0.14em] leading-none shadow-[0_8px_30px_rgba(0,0,0,.6)]",
                                        ch.omni && "outline-dashed outline-[3px] outline-offset-[3px] outline-[var(--accion-en-oscuro)]")}>
                                        {ch.plate ? textoChapa(ch) : esNoLeida(l.plate) ? "S/L" : l.plate}
                                    </div>
                                    {esNoLeida(l.plate) && l.relectura && <MarcaOmniVision r={l.relectura} oscuro tamano="lg" />}
                                    <MarcaVerificacion plate={l.plate} r={l.relectura} oscuro tamano="lg" />
                                </div>
                            );
                        })()}
                        {/* La empresa al lado de la chapa: de lejos, en la pared, se lee antes el logo que el nombre. */}
                        <LogoSobreFoto empresa={empresa} className="h-[clamp(36px,4.5vw,64px)] max-w-[22vw]" />
                    </div>
                    {esNoLeida(l.plate) && l.relectura?.plate && <div className="mt-3"><Relectura r={l.relectura} grande /></div>}
                    <ResumenVehiculo a={l.analisis} />
                    <div className="mt-3 flex items-center gap-3">
                        <EtiquetaClase l={l} comp={comp} grande />
                        <span className="text-[20px] lg:text-[22px] font-semibold text-white truncate">{quien(l)}</span>
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

type ClaveLista = "residentes" | "visitas" | "desconocidos" | "atipicos";
type FilaPresencia = {
    clave: string; plate: string | null; titulo: string; sub: string | null; clase: string | null;
    entrada: string; vistoUltimo: string | null; camara: string | null; foto: string | null; accessEventId: string | null;
    estimado: boolean; atipico: { clave: string; nombre: string }[]; entradas24h: number | null;
};
type ListasPresencia = { modo: Modo; ventanas: { residentesDias: number; visitasHoras: number } } & Record<ClaveLista, FilaPresencia[]>;
const LISTAS_PRESENCIA: { clave: ClaveLista; rotulo: string; resumen: keyof NonNullable<Datos["presencia"]>; Icono: any; tono?: "bien" | "info"; explica: (l: ListasPresencia) => string }[] = [
    { clave: "residentes", rotulo: "Residentes dentro", resumen: "residentes", Icono: Home, tono: "bien", explica: (l) => `Con un auto adentro (se lo busca ${l.ventanas.residentesDias} días para atrás) o que entraron a pie.` },
    { clave: "visitas", rotulo: "Visitas y proveedores dentro", resumen: "visitasProveedores", Icono: Ticket, tono: "info", explica: () => "Visitas, invitados, proveedores y personal, con su auto o registrados a pie." },
    { clave: "desconocidos", rotulo: "Desconocidos dentro", resumen: "desconocidos", Icono: CircleDashed, explica: (l) => `Sin registro y cuya última lectura fue una entrada. A las ${l.ventanas.visitasHoras} h sin verse se dan por idos.` },
    { clave: "atipicos", rotulo: "Atípicos dentro", resumen: "atipicos", Icono: AlertTriangle, explica: () => "Lista negra o en búsqueda, merodeo, primera vez visto, o cuatro entradas o más en 24 h." },
];
type Orden = "permanencia" | "recientes" | "matricula" | "frecuencia";
/**
 * Cómo se ordena la lista (16/10, Nico: «un orden por tiempo de permanencia, y otros criterios»).
 * Cada orden tiene su sentido natural —lo que más interesa arriba—; tocarlo otra vez lo invierte.
 */
const ORDENES: { v: Orden; rotulo: string; natural: "desc" | "asc" }[] = [
    { v: "permanencia", rotulo: "Permanencia", natural: "desc" },
    { v: "recientes", rotulo: "Ingreso", natural: "desc" },
    { v: "frecuencia", rotulo: "Entradas 24 h", natural: "desc" },
    { v: "matricula", rotulo: "Matrícula", natural: "asc" },
];
/** Los cortes de «lleva más de», en horas. */
const LLEVA_MAS_DE_H = [1, 4, 12];
/** Sin tocar nada este tiempo, el cajón de una lista se cierra (como la ficha). */
const CAJON_SE_CIERRA_MS = 90_000;
const TONO_ATIPICO: Record<string, string> = { lista_negra: "pleno-mal", en_busqueda: "pleno-mal", merodeo: "pleno-aviso", alta_frecuencia: "pleno-aviso", primera_vez: "pleno-info" };
const CLASE_PRESENCIA: Record<string, string> = { residente: "pleno-bien", visita: "bg-violet-500/90 text-white", invitado: "bg-violet-500/90 text-white", proveedor: "pleno-aviso", personal: "pleno-info", lista_blanca: "pleno-bien" };
const NOMBRE_CLASE_PRESENCIA: Record<string, string> = { residente: "Residente", visita: "Visita", invitado: "Invitado", proveedor: "Proveedor", personal: "Personal", lista_blanca: "Lista blanca", no_registrado: "No registrado" };

/**
 * Una de las cuatro listas de quién está adentro, en un cajón de la propia pared (16/10, Nico: «no
 * me gusta que salga del Control LPR y lleve al admin, debe resolver con drawers dentro»).
 *
 * Cada fila: la captura chica, la matrícula, quién es, a qué hora entró y cuánto lleva adentro
 * (corre). Tocar la captura la pone de protagonista en la pantalla; tocar el resto abre la ficha
 * de esa lectura, con su perfil (cuánto se queda normalmente, su rutina). Sólo mirar: corregir
 * quién está adentro se hace desde Gestión de alarmas, con usuario.
 */
function CajonPresencia({ lista, alCerrar, alCambiar, alAbrirFicha, alFijar }: { lista: ClaveLista | null; alCerrar: () => void; alCambiar: (c: ClaveLista) => void; alAbrirFicha: (accessEventId: string) => void; alFijar: (l: Lectura) => void }) {
    const [datos, setDatos] = useState<ListasPresencia | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [trayendo, setTrayendo] = useState<string | null>(null);
    const vuelta = usarInactividad(!!lista, CAJON_SE_CIERRA_MS, alCerrar);
    const cargar = useCallback(async () => {
        setError(null);
        try {
            const r = await fetch("/api/monitor/lpr/presencia", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setDatos(j);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
    }, []);
    // Abierto, se refresca solo: la lista cambia con cada auto que pasa.
    useEffect(() => { if (!lista) return; cargar(); const iv = setInterval(cargar, 20_000); return () => clearInterval(iv); }, [lista, cargar]);
    /** La captura a la pantalla: se trae la lectura completa (con su análisis y su clase) y se fija. */
    const aPantalla = async (f: FilaPresencia) => {
        if (!f.accessEventId) return;
        setTrayendo(f.clave);
        try {
            const r = await fetch(`/api/monitor/lpr/lectura/${encodeURIComponent(f.accessEventId)}`, { cache: "no-store" });
            const j = await r.json().catch(() => null);
            if (r.ok && j?.lectura) alFijar(j.lectura);
        } finally { setTrayendo(null); }
    };
    const def = LISTAS_PRESENCIA.find((x) => x.clave === lista);
    const todas = lista && datos ? datos[lista] : [];
    const ahora = Date.now();

    // Orden y filtros. El orden se conserva al pasar de una lista a otra; los filtros propios de
    // cada lista (clase, motivo) no, porque en la otra no significan nada.
    const [orden, setOrden] = useState<Orden>("permanencia");
    const [sentido, setSentido] = useState<"desc" | "asc">("desc");
    const [masDeH, setMasDeH] = useState(0);
    const [confirmacion, setConfirmacion] = useState<"todos" | "confirmados" | "sin">("todos");
    const [etiqueta, setEtiqueta] = useState<string | null>(null);
    const [buscar, setBuscar] = useState("");
    const [verFiltros, setVerFiltros] = useState(false);
    useEffect(() => { setEtiqueta(null); }, [lista]);
    const elegirOrden = (o: Orden) => {
        if (o === orden) setSentido((x) => (x === "desc" ? "asc" : "desc"));
        else { setOrden(o); setSentido(ORDENES.find((x) => x.v === o)!.natural); }
    };
    /** Lo que se puede elegir como etiqueta en esta lista: el motivo en atípicos, la clase en visitas. */
    const etiquetas = useMemo(() => {
        const m = new Map<string, { rotulo: string; n: number }>();
        for (const f of todas) {
            const claves = lista === "atipicos" ? f.atipico.map((x) => [x.clave, x.nombre] as const) : lista === "visitas" && f.clase ? [[f.clase, NOMBRE_CLASE_PRESENCIA[f.clase] || f.clase] as const] : [];
            for (const [k, r] of claves) { const x = m.get(k); if (x) x.n++; else m.set(k, { rotulo: r, n: 1 }); }
        }
        return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n);
    }, [todas, lista]);
    const filas = useMemo(() => {
        const t = buscar.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "");
        const lleva = (f: FilaPresencia) => ahora - new Date(f.entrada).getTime();
        const x = todas
            .filter((f) => !masDeH || lleva(f) >= masDeH * 3_600_000)
            .filter((f) => confirmacion === "todos" || (confirmacion === "sin" ? f.estimado : !f.estimado))
            .filter((f) => !etiqueta || (lista === "atipicos" ? f.atipico.some((a) => a.clave === etiqueta) : f.clase === etiqueta))
            .filter((f) => !t || `${f.plate || ""} ${f.titulo} ${f.sub || ""}`.toUpperCase().replace(/[^A-Z0-9 ]/g, "").includes(t));
        const valor = (f: FilaPresencia): number | string => orden === "permanencia" ? lleva(f) : orden === "recientes" ? new Date(f.entrada).getTime() : orden === "frecuencia" ? f.entradas24h ?? -1 : f.plate || f.titulo;
        const signo = sentido === "desc" ? -1 : 1;
        return [...x].sort((a, b) => { const va = valor(a), vb = valor(b); return (va < vb ? -1 : va > vb ? 1 : 0) * signo; });
    }, [todas, orden, sentido, masDeH, confirmacion, etiqueta, buscar, lista]); // eslint-disable-line react-hooks/exhaustive-deps
    const hayFiltro = masDeH > 0 || confirmacion !== "todos" || !!etiqueta || !!buscar.trim();
    const limpiar = () => { setMasDeH(0); setConfirmacion("todos"); setEtiqueta(null); setBuscar(""); };
    const pill = (activa: boolean) => cn("h-10 px-3.5 rounded-full border text-[13.5px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5", tocable,
        activa ? "bg-foreground text-background border-transparent" : "bg-card text-muted-foreground border-border");

    return (
        <AnimatePresence>
            {lista && def && (
                <>
                    <motion.button key="fondo-presencia" type="button" aria-label="Cerrar la lista" onClick={alCerrar}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                        className="fixed inset-0 z-40 bg-black/55" />
                    <motion.aside key="cajon-presencia" role="dialog" aria-label={def.rotulo}
                        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={RESORTE}
                        className="fixed inset-y-0 right-0 z-50 w-[min(620px,100vw)] bg-background border-l border-border flex flex-col">
                        <div className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3 border-b border-border">
                            <span className={cn("grid h-12 w-12 place-items-center rounded-full shrink-0", def.clave === "atipicos" ? "pleno-aviso" : def.tono === "bien" ? "pleno-bien" : def.tono === "info" ? "pleno-info" : "bg-muted text-muted-foreground")}><def.Icono size={22} /></span>
                            <div className="min-w-0 flex-1">
                                <div className="text-[22px] font-bold leading-tight">{def.rotulo} <span className="tabular-nums text-muted-foreground font-semibold">{datos ? (hayFiltro ? `${filas.length} de ${todas.length}` : todas.length) : ""}</span></div>
                                <div className="text-[13px] text-muted-foreground leading-snug">{datos ? def.explica(datos) : "Cargando…"}</div>
                            </div>
                            <button type="button" onClick={alCerrar} aria-label="Cerrar" className={cn("grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground shrink-0", tocable)}><X size={26} /></button>
                        </div>
                        {/* Las otras tres listas, para pasar de una a otra sin cerrar. */}
                        <div className="shrink-0 flex gap-2 px-5 py-3 border-b border-border overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {LISTAS_PRESENCIA.map((x) => {
                                const activa = x.clave === lista, n = datos ? datos[x.clave].length : null;
                                return (
                                    <button key={x.clave} type="button" onClick={() => !activa && alCambiar(x.clave)} aria-pressed={activa}
                                        className={cn("h-11 px-4 rounded-full border text-[14px] font-semibold whitespace-nowrap inline-flex items-center gap-2", tocable,
                                            activa ? "bg-foreground text-background border-transparent" : "bg-card text-muted-foreground border-border")}>
                                        <x.Icono size={15} /> {x.rotulo.replace(" dentro", "")}{n != null && <span className="tabular-nums opacity-70">{n}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {/* Ordenar: tocar el mismo otra vez invierte el sentido. Y el botón de filtros. */}
                        <div className="shrink-0 flex items-center gap-2 px-5 pt-3 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground shrink-0">Ordenar</span>
                            {ORDENES.map((o) => {
                                const activa = orden === o.v;
                                return (
                                    <button key={o.v} type="button" onClick={() => elegirOrden(o.v)} aria-pressed={activa} className={pill(activa)}>
                                        {o.rotulo}{activa && (sentido === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />)}
                                    </button>
                                );
                            })}
                            <button type="button" onClick={() => setVerFiltros((v) => !v)} aria-pressed={verFiltros || hayFiltro}
                                className={cn(pill(verFiltros), "ml-auto", hayFiltro && !verFiltros && "border-[var(--accion-en-oscuro)] text-foreground")}>
                                <SlidersHorizontal size={14} /> Filtros{hayFiltro ? " ·" : ""}
                            </button>
                        </div>
                        <AnimatePresence initial={false}>
                            {verFiltros && (
                                <motion.div key="filtros" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SUAVE} className="shrink-0 overflow-hidden">
                                    <div className="px-5 pb-3 flex flex-col gap-2.5">
                                        <div className="relative">
                                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Matrícula, nombre o lote" inputMode="search"
                                                className="w-full h-11 pl-10 pr-10 rounded-xl bg-card border border-border text-[15px] focus:outline-none focus:ring-2 focus:ring-[var(--accion-en-oscuro)]/50" />
                                            {buscar && <button type="button" onClick={() => setBuscar("")} aria-label="Borrar" className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground"><X size={16} /></button>}
                                        </div>
                                        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <span className="text-[12px] text-muted-foreground shrink-0 w-[76px]">Lleva más de</span>
                                            {[0, ...LLEVA_MAS_DE_H].map((h) => <button key={h} type="button" onClick={() => setMasDeH(h)} aria-pressed={masDeH === h} className={pill(masDeH === h)}>{h ? `${h} h` : "Cualquiera"}</button>)}
                                        </div>
                                        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <span className="text-[12px] text-muted-foreground shrink-0 w-[76px]">Confirmación</span>
                                            {([["todos", "Todos"], ["confirmados", "Confirmados"], ["sin", "Sin confirmar"]] as const).map(([v, r]) => (
                                                <button key={v} type="button" onClick={() => setConfirmacion(v)} aria-pressed={confirmacion === v} className={pill(confirmacion === v)}>{r}</button>
                                            ))}
                                        </div>
                                        {etiquetas.length > 1 && (
                                            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                                <span className="text-[12px] text-muted-foreground shrink-0 w-[76px]">{lista === "atipicos" ? "Motivo" : "Tipo"}</span>
                                                <button type="button" onClick={() => setEtiqueta(null)} aria-pressed={!etiqueta} className={pill(!etiqueta)}>Todos</button>
                                                {etiquetas.map((e) => <button key={e.k} type="button" onClick={() => setEtiqueta(e.k)} aria-pressed={etiqueta === e.k} className={pill(etiqueta === e.k)}>{e.rotulo}<span className="tabular-nums opacity-70">{e.n}</span></button>)}
                                            </div>
                                        )}
                                        {hayFiltro && <button type="button" onClick={limpiar} className={cn("self-start h-10 px-3.5 rounded-full text-[13.5px] font-semibold text-[var(--accion-en-oscuro)] inline-flex items-center gap-1.5", tocable)}><X size={14} /> Quitar filtros</button>}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <CuentaAtras ms={CAJON_SE_CIERRA_MS} vuelta={vuelta} className="rounded-none bg-transparent [&>span]:bg-[var(--accion-en-oscuro)]/60" />

                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 flex flex-col gap-2.5">
                            {error && !datos ? (
                                <div className="p-4 space-y-4">
                                    <p className="text-[17px]">No se pudo leer la lista: {error}</p>
                                    <button type="button" onClick={cargar} className={cn("h-12 px-6 rounded-xl bg-[var(--accion)] text-white font-bold", tocable)}>Reintentar</button>
                                </div>
                            ) : !datos ? (
                                <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 size={28} className="animate-spin" /></div>
                            ) : filas.length === 0 ? (
                                <div className="p-10 text-center text-[18px] text-muted-foreground">
                                    {todas.length && hayFiltro ? <>Nadie con estos filtros<button type="button" onClick={limpiar} className={cn("block mx-auto mt-4 h-12 px-6 rounded-xl bg-muted text-foreground font-semibold text-[15px]", tocable)}>Quitar filtros</button></> : "Nadie en esta lista ahora"}
                                </div>
                            ) : filas.map((f) => {
                                const foto = getImagePath(f.foto);
                                const min = (ahora - new Date(f.entrada).getTime()) / 60000;
                                return (
                                    <div key={f.clave} className="flex items-stretch gap-3 rounded-2xl bg-card border border-border p-2.5">
                                        {/* La captura chica: tocarla la pone en pantalla. */}
                                        <button type="button" disabled={!f.accessEventId || !foto} onClick={() => aPantalla(f)} aria-label="Ver en pantalla"
                                            className={cn("relative w-[132px] shrink-0 aspect-video rounded-xl overflow-hidden bg-neutral-900", f.accessEventId && foto && tocable)}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {foto ? <img src={conAncho(foto, 320) || foto} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
                                                : <span className="absolute inset-0 grid place-items-center text-white/25">{f.plate ? <Car size={22} /> : <Users size={22} />}</span>}
                                            {foto && <span className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white">{trayendo === f.clave ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}</span>}
                                        </button>
                                        {/* El resto de la fila: la ficha de esa lectura (perfil, rutina, qué hizo hoy). */}
                                        <button type="button" disabled={!f.accessEventId} onClick={() => f.accessEventId && alAbrirFicha(f.accessEventId)}
                                            className={cn("min-w-0 flex-1 flex items-center gap-3 text-left", f.accessEventId && tocable)}>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-2 flex-wrap">
                                                    {f.plate && <span className="text-[20px] font-bold tabular-nums tracking-[0.1em] leading-none">{f.plate}</span>}
                                                    {f.clase && f.clase !== "no_registrado" && <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider", CLASE_PRESENCIA[f.clase] || "bg-muted text-muted-foreground")}>{NOMBRE_CLASE_PRESENCIA[f.clase] || f.clase}</span>}
                                                    {f.atipico.map((x) => <span key={x.clave} className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider", TONO_ATIPICO[x.clave] || "bg-muted")}>{x.nombre}</span>)}
                                                </span>
                                                <span className="block text-[14px] font-semibold truncate mt-1">{f.titulo}{f.sub ? <span className="font-normal text-muted-foreground"> · {f.sub}</span> : null}</span>
                                                <span className="block text-[12.5px] text-muted-foreground tabular-nums truncate">
                                                    Ingresó {horaCorta(f.entrada)}{new Date(f.entrada).toDateString() !== new Date().toDateString() ? ` del ${new Date(f.entrada).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })}` : ""}
                                                    {f.entradas24h != null && f.entradas24h > 1 ? ` · ${f.entradas24h} entradas en 24 h` : ""}
                                                    {f.camara ? ` · ${f.camara}` : ""}
                                                </span>
                                            </span>
                                            {/* Permanencia: corre con el reloj de la vista. */}
                                            <span className="text-right shrink-0 leading-none">
                                                <span className={cn("block text-[22px] font-bold tabular-nums", f.estimado && "text-muted-foreground")}>{f.estimado ? "~" : ""}{duracion(min)}</span>
                                                <span className="block text-[10px] uppercase tracking-wider mt-1 text-muted-foreground">{f.estimado ? "sin confirmar" : "adentro"}</span>
                                            </span>
                                            {f.accessEventId && <ChevronRight size={18} className="text-muted-foreground/60 shrink-0" />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
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
                                        {foto && l.analisis && <CapaAnalisis analisis={l.analisis} atributos chapa={chapaEnFoto(l)} />}
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

function Bloque({ Icono, titulo, children }: { Icono: any; titulo: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Icono size={14} /> {titulo}</div>
            {children}
        </section>
    );
}
