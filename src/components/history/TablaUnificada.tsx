"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Clock, Car, Camera, Activity, ChevronRight, Inbox,
    LogIn, LogOut, ParkingCircle, ShieldCheck, ShieldX,
    ShieldAlert, MoreHorizontal, Wifi, WifiOff, Eye,
} from "lucide-react";
import { VisorEventoAcceso } from "@/components/eventos/VisorEventoAcceso";
import { cn } from "@/lib/utils";
import { chapaDe, esSinLectura, MarcaOmniVision, MarcaVerificacion, textoChapa } from "@/components/vision/ChapaReleida";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Momento, Matricula, Miniatura, Nada } from "@/components/ui/celdas";
import { MarcaFormatoChapa } from "@/components/ui/MarcaFormatoChapa";
import { useTiempoReal, useDestello } from "@/lib/tiempo-real";
import { VisorCuadro } from "@/components/VisorCuadro";
import { useRegistrarDesdeCaptura } from "@/components/vision/buscar/RegistrarDesdeCaptura";
import { FlujoMatricula, type PasoFlujo } from "@/components/history/FlujoMatricula";
import { parseVehicleMeta } from "@/lib/vehicle-details";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";
import { Cronometro, useTranscurrido, leerDuracion } from "@/components/tracking/Cronometro";
import { Timer } from "lucide-react";
import { MosaicoHistorial, type Vista } from "@/components/history/MosaicoHistorial";
import type { EmpresaFila, VisionFila } from "@/lib/historial-vision";
import type { DatosVisor } from "@/components/VisorCuadro";
import { getImagePath } from "@/lib/image-path";
import { Sparkles } from "lucide-react";

export type FilaHistorial = {
    id: string;
    tipo: "ACCESO" | "PASO" | "ESTACIONADO" | "VISTO" | "OV_CHAPA" | "OV_OBJETO";
    momento: string;
    plate: string | null;
    persona: string | null;
    camara: string | null;
    deviceId: string | null;
    decision: string | null;
    sentido: string | null;
    confianza: number | null;
    lecturas: number | null;
    foto: string | null;
    estDesde: string | null;
    bbox: string | null;
    estCerrada: boolean;
    estHasta: string | null;
    detalles: string | null;
    permanencia: number | null;
    /** Entradas permitidas: cuándo salió después (null = no salió), y si se lo da por adentro. */
    salida?: string | null;
    adentro?: boolean;
    raw: any | null;
    /** Lo que vio OmniVision en la foto, si la lectura ya se analizó (sólo accesos). */
    vision?: VisionFila | null;
    /** La empresa (delivery, taxi…) de esa matrícula a esa hora, con su logo. */
    empresa?: EmpresaFila | null;
};

const POR_PAGINA = 60;

const lapso = (seg: number) => {
    if (seg < 60) return "< 1 min";
    if (seg < 3600) return `${Math.round(seg / 60)} min`;
    const h = Math.floor(seg / 3600);
    return `${h} h ${Math.round((seg % 3600) / 60)} min`;
};

/**
 * Cómo se presenta cada clase de fila.
 *
 * El tipo no es decorativo: un acceso decidió si la barrera abría, un avistamiento solo
 * dejó constancia, y una estadía ni siquiera es un momento sino un intervalo. Mezclarlos
 * en una tabla sin que cada uno se distinga a simple vista sería peor que tenerlos
 * separados, que es de donde venimos.
 */
export const RASGOS: Record<string, { Ico: any; rotulo: string; ayuda: string; chip: string; punto: string }> = {
    ACCESO_ENTRY: {
        Ico: LogIn, rotulo: "Entrada", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30", punto: "bg-emerald-400",
        ayuda: "Una cámara LPR de entrada leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    ACCESO_EXIT: {
        Ico: LogOut, rotulo: "Salida", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", punto: "bg-amber-400",
        ayuda: "Una cámara LPR de salida leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    PASO: {
        Ico: Camera, rotulo: "Avistamiento", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30", punto: "bg-violet-400",
        ayuda: "Una cámara interior vio pasar el vehículo. No abre barrera: sólo deja constancia de por dónde pasó.",
    },
    ESTACIONADO: {
        Ico: ParkingCircle, rotulo: "Estacionado", chip: "bg-slate-500/20 text-slate-700 dark:text-slate-200 border-slate-400/30", punto: "bg-slate-400",
        ayuda: "El vehículo se quedó quieto en el mismo lugar del cuadro más de un minuto. Es UNA fila por estadía, con su intervalo, no una fila por relectura.",
    },
    /* Lo que OmniVision ve en las cámaras RTSP (no LPR): ver api/history/unified. */
    OV_CHAPA: {
        Ico: Sparkles, rotulo: "Leída por OmniVision", chip: "bg-[var(--accion)]/10 text-[var(--accion)] border-[var(--accion)]/30", punto: "bg-[var(--accion)]",
        ayuda: "OmniVision leyó esta matrícula en una cámara que no es LPR (por RTSP). No abre barrera: deja constancia de dónde se vio el vehículo.",
    },
    OV_OBJETO: {
        Ico: Sparkles, rotulo: "OmniVision", chip: "bg-muted text-muted-foreground border-border", punto: "bg-muted-foreground/50",
        ayuda: "Un objeto (vehículo, persona, animal) que OmniVision vio en una cámara que no es LPR. Sale sólo si se lo pide en el filtro de tipos: son muchos por día.",
    },
    VISTO: {
        Ico: Eye, rotulo: "Visto", chip: "bg-muted text-muted-foreground border-border", punto: "bg-muted-foreground/50",
        ayuda: "La cámara lo vio, y eso es todo lo que se puede afirmar: ni cruzó por donde a esa cámara le interesa, ni se quedó el tiempo suficiente como para llamarlo estacionado.",
    },
};

export const rasgoDe = (f: { tipo: string; sentido: string | null }) =>
    f.tipo === "ACCESO" ? RASGOS[f.sentido === "EXIT" ? "ACCESO_EXIT" : "ACCESO_ENTRY"] : RASGOS[f.tipo];

/** Un evento del socket, con la forma que usa esta tabla. */
function desdeEvento(ev: any): FilaHistorial | null {
    const plate = (ev?.plateDetected || "").toUpperCase();
    if (!ev?.id || !ev?.timestamp) return null;
    return {
        id: ev.id,
        tipo: "ACCESO",
        momento: ev.timestamp,
        plate: plate || null,
        persona: ev.user?.name || null,
        camara: ev.device?.name || null,
        deviceId: ev.device?.id || ev.deviceId || null,
        decision: ev.decision || null,
        sentido: ev.direction || null,
        confianza: null,
        lecturas: null,
        foto: ev.snapshotPath || ev.imagePath || null,
        estDesde: null, estHasta: null, bbox: null, estCerrada: false,
        detalles: ev.details || null, permanencia: null,
        // Un acceso que acaba de ocurrir: si es entrada permitida, está adentro desde ahora.
        salida: null, adentro: ev.direction === "ENTRY" && ev.decision !== "DENY",
        raw: ev,
    };
}

/**
 * El tiempo transcurrido desde una lectura, en vivo y en voz baja.
 *
 * Para un avistamiento o un visto no hay intervalo que medir — fue un instante —, así que
 * no va el cronómetro con sus tonos de estadía, que pintarían de rojo cualquier lectura de
 * hace tres horas. Lo que sí sirve al que barre la tabla en vivo es saber hace cuánto fue.
 */
/** Lo que el lector escribe cuando no leyó (lib/relectura importa prisma: no entra en el navegador). */
const NO_LEIDAS_FILA = new Set(["NO_LEIDA", "UNKNOWN", "S/P"]);

/** La foto de una fila pedida chica: /api/files la achica y la guarda en disco; las otras rutas ignoran `w`. */
const MINIATURA_W = 160;
function miniatura(foto: string | null): string | null {
    const u = getImagePath(foto);
    return u ? `${u}${u.includes("?") ? "&" : "?"}w=${MINIATURA_W}` : null;
}

/** Lo que vio OmniVision, en una línea: «persona ×2 · auto», y la relectura si la hubo. */
export function textoVision(v?: VisionFila | null): string {
    if (!v) return "";
    return v.vio.map((x) => (x.n > 1 ? `${x.nombre} ×${x.n}` : x.nombre)).join(" · ");
}
function VisionCelda({ v }: { v?: VisionFila | null }) {
    if (!v || (!v.vio.length && !v.releida?.plate)) return <Nada />;
    return (
        <div className="leading-tight min-w-0">
            {v.vio.length > 0 && <div className="text-[11.5px] text-foreground truncate">{textoVision(v)}</div>}
            {v.releida?.plate && <div className="text-[10.5px] tono-info font-semibold truncate">releída: {v.releida.plate}{v.releida.estado === "DUDOSA" ? " (dudosa)" : ""}</div>}
        </div>
    );
}

function HaceCuanto({ desde }: { desde: string }) {
    const ms = useTranscurrido(desde);
    if (ms == null) return <Nada />;
    return <span className="text-[11.5px] text-muted-foreground tabular-nums">hace {leerDuracion(ms)}</span>;
}

export function TablaUnificada({ buscar, desde, hasta, tipos, identificacion = "ALL", resultado = "ALL", sentido = "ALL", version = 0, merodeo, color, tipoVeh, camaras, vision = [], barra, vista = "lista", onMerodeo, onResumen, onCargado }: {
    buscar: string; desde: string; hasta: string; tipos: string[];
    /** Los filtros de acceso: con qué se identificó, si abrió, en qué sentido. Viajan al servidor. */
    identificacion?: string; resultado?: string; sentido?: string;
    /** Subirlo fuerza una recarga desde la primera página (el botón de refrescar, una importación). */
    version?: number;
    /** Matrículas marcadas por merodeo; si viene vacío no se filtra. */
    merodeo?: Set<string>;
    /** Color y tipo de vehículo, sacados de los detalles de cada registro. */
    color?: string;
    tipoVeh?: string;
    /** Cámaras elegidas (por nombre); vacío = todas. Traído del historial del primer barrio (355749f),
     *  pero resuelto como los otros dos: sobre lo cargado, con las opciones que hay en pantalla. */
    camaras?: string[];
    /** Los controles de esta tabla, dentro de su mismo marco. */
    barra?: React.ReactNode;
    /** Lista (la tabla), o las mismas filas como capturas: grilla o bento. */
    vista?: Vista;
    /** Filtro OmniVision (ids de lib/historial-vision): viaja al servidor, que cruza con AnalisisFoto. */
    vision?: string[];
    onMerodeo?: (chapas: Set<string>) => void;
    /**
     * Lo que se puede decir de lo que está cargado: cuántos permitidos, cuántos denegados,
     * y qué colores y tipos de vehículo aparecen.
     *
     * Sale de la tabla y no de la página a propósito. La página calculaba estos números de
     * OTRA consulta — la vieja, la que ya no alimenta nada — así que los selectores
     * ofrecían colores que no estaban en pantalla y los contadores hablaban de un conjunto
     * distinto del que se estaba mirando. Un filtro tiene que ofrecer lo que hay.
     */
    onResumen?: (r: { grant: number; deny: number; colores: string[]; tipos: string[]; camaras: string[] }) => void;
    /** Cada vez que llegó una respuesta del servidor: para el reloj de "última actualización". */
    onCargado?: () => void;
}) {
    const [filas, setFilas] = useState<FilaHistorial[]>([]);
    const [hay, setHay] = useState(false);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pagina, setPagina] = useState(0);
    const [abierta, setAbierta] = useState<string | null>(null);
    /*
     * La fila ENTERA, no un recorte.
     *
     * Acá se armaba a mano un objeto con cinco campos — foto, chapa, cámara, momento y
     * confianza — y con eso se abría el visor. El visor sabe dibujar bastante más que eso:
     * la retícula sobre la matrícula, el cronómetro de la estadía, si el vehículo se fue.
     * Todo eso depende de `bbox`, `estado`, `estDesde` y `estCerrada`, que este recorte
     * dejaba afuera, así que desde el historial el visor se abría siempre a medias — y no
     * por falta de datos, que estaban en la fila, sino por el recorte.
     */
    const [viendo, setViendo] = useState<FilaHistorial | null>(null);

    const clave = useRef("");
    const [recargar, setRecargar] = useState(0);
    const { marcar, es: esNueva } = useDestello();

    const visionClave = vision.join(",");
    const [visionTruncado, setVisionTruncado] = useState(false);
    const [omni, setOmni] = useState<FranjaOmni | null>(null);
    const camarasClave = (camaras || []).join("\u0001");
    useEffect(() => { setPagina(0); }, [buscar, desde, hasta, tipos.join(","), identificacion, resultado, sentido, version, visionClave, camarasClave]);

    useEffect(() => {
        let vivo = true;
        setCargando(true);
        const q = new URLSearchParams({ take: String(POR_PAGINA), skip: String(pagina * POR_PAGINA) });
        if (buscar) q.set("search", buscar);
        if (desde) q.set("from", desde);
        if (hasta) q.set("to", hasta);
        if (tipos.length) q.set("tipos", tipos.join(","));
        if (identificacion !== "ALL") q.set("type", identificacion);
        if (resultado !== "ALL") q.set("decision", resultado);
        if (sentido !== "ALL") q.set("direction", sentido);
        if (visionClave) q.set("vision", visionClave);
        for (const c of camaras || []) q.append("cam", c);
        const esta = q.toString();
        clave.current = esta;

        fetch(`/api/history/unified?${esta}`, { cache: "no-store" })
            .then(async (r) => {
                if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
                return r.json();
            })
            .then((j) => {
                if (!vivo || clave.current !== esta) return;
                setError(null);
                setFilas((prev) => (pagina === 0 ? (j.filas || []) : [...prev, ...(j.filas || [])]));
                setHay(!!j.hay);
                setVisionTruncado(!!j.visionTruncado);
                if (pagina === 0) setOmni(j.omnivision || null);
                onCargado?.();
            })
            .catch((e) => {
                if (!vivo || clave.current !== esta) return;
                // Antes esto era un catch vacío: un servidor caído y un período sin
                // registros se veían exactamente igual, y de uno se espera mientras que
                // del otro se reintenta.
                setError(e?.message || "No hubo respuesta.");
                if (pagina === 0) setFilas([]);
            })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    // `version` entra por el reset de página; si ya estaba en 0 hace falta igual volver a pedir.
    }, [buscar, desde, hasta, tipos, identificacion, resultado, sentido, pagina, recargar, version, visionClave, camarasClave]); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * En vivo.
     *
     * La página ya abría un socket, pero lo que escuchaba iba a un estado que dejó de
     * alimentar la tabla cuando se unificó: el historial no se enteraba de un acceso nuevo
     * hasta recargar, y nadie lo notaba porque el socket "estaba puesto".
     *
     * La fila nueva se mete arriba SOLO si pasa los filtros que el operador eligió. Meterla
     * igual sería pasar por encima de lo que pidió, y encima de la peor manera: apareciendo
     * sola en una lista que estaba filtrada.
     */
    const { conectado } = useTiempoReal("access_event", useCallback((ev: any) => {
        if (pagina !== 0) return;
        if (ev?.accessType && ev.accessType !== "PLATE") return;
        if (tipos.length && !tipos.includes("ACCESO")) return;
        if (identificacion !== "ALL" && ev?.accessType !== identificacion) return;
        if (resultado !== "ALL" && ev?.decision !== resultado) return;
        if (sentido !== "ALL" && ev?.direction !== sentido) return;
        // Con el filtro OmniVision no: un acceso recién llegado todavía no se analizó, y meterlo
        // sería mostrar algo que no se sabe si cumple el filtro.
        if (visionClave) return;
        // Un evento es de ahora: sólo entra si el rango llega hasta hoy.
        if (hasta && new Date(hasta) < new Date(new Date().toDateString())) return;
        const f = desdeEvento(ev);
        if (!f) return;
        if (buscar) {
            const q = buscar.toLowerCase();
            const pega = [f.plate, f.persona, f.camara].some((v) => (v || "").toLowerCase().includes(q));
            if (!pega) return;
        }
        setFilas((prev) => (prev.some((x) => x.id === f.id) ? prev : [f, ...prev]));
        marcar(f.id);
    }, [pagina, tipos, identificacion, resultado, sentido, hasta, buscar, marcar, visionClave]));

    const alternar = useCallback((f: FilaHistorial) => {
        if (!f.plate) return;
        setAbierta((a) => (a === f.id ? null : f.id));
    }, []);

    /**
     * Merodeo: la misma matrícula muchas veces en poco tiempo sin llegar a entrar.
     *
     * Se calcula sobre lo que hay cargado, que es una aproximación honesta: con paginado
     * no se puede afirmar más que eso, y decirlo con la mitad de los datos sería peor que
     * no decirlo.
     */
    const merodeando = useMemo(() => {
        const porChapa = new Map<string, number>();
        for (const f of filas) {
            if (!f.plate) continue;
            if (f.tipo === "ACCESO" && f.decision !== "DENY") continue;
            porChapa.set(f.plate, (porChapa.get(f.plate) || 0) + 1);
        }
        return new Set([...porChapa.entries()].filter(([, n]) => n >= 4).map(([p]) => p));
    }, [filas]);
    useEffect(() => { onMerodeo?.(merodeando); }, [merodeando, onMerodeo]);

    /**
     * El resumen de lo cargado, para los contadores y para los selectores de color y tipo.
     * Se emite sólo cuando cambia de verdad: el padre lo guarda en estado, y un objeto
     * nuevo en cada render sería un ciclo padre↔hijo.
     */
    const firma = useRef("");
    useEffect(() => {
        if (!onResumen) return;
        let grant = 0, deny = 0;
        const colores = new Set<string>(), tiposVeh = new Set<string>(), cams = new Set<string>();
        for (const f of filas) {
            if (f.tipo === "ACCESO") (f.decision === "DENY" ? deny++ : grant++);
            const m = parseVehicleMeta(f.detalles);
            if (m.color) colores.add(m.color);
            if (m.typeLabel) tiposVeh.add(m.typeLabel);
            if (f.camara) cams.add(f.camara);
        }
        const r = { grant, deny, colores: [...colores].sort(), tipos: [...tiposVeh].sort(), camaras: [...cams].sort((a, b) => a.localeCompare(b)) };
        const nueva = JSON.stringify(r);
        if (nueva === firma.current) return;
        firma.current = nueva;
        onResumen(r);
    }, [filas, onResumen]);

    /**
     * Color y tipo se filtran acá, sobre lo cargado.
     *
     * Estos dos selectores existían en la pantalla, se veían, se podían cambiar, mostraban
     * su chip de "quitar filtro"... y no filtraban nada: el arreglo que filtraban dejó de
     * alimentar la tabla cuando se unificó el historial. Un control que no hace nada es
     * peor que no tenerlo, porque el operador cree que ya descartó lo que no buscaba.
     */
    const visibles = useMemo(() => {
        let v = merodeo && merodeo.size ? filas.filter((f) => f.plate && merodeo.has(f.plate)) : filas;
        const porColor = color && color !== "ALL";
        const porTipo = tipoVeh && tipoVeh !== "ALL";
        const porCamara = camaras && camaras.length > 0;
        if (porColor || porTipo || porCamara) {
            v = v.filter((f) => {
                if (porCamara && !(f.camara && camaras!.includes(f.camara))) return false;
                const m = parseVehicleMeta(f.detalles);
                if (porColor && m.color !== color) return false;
                if (porTipo && m.typeLabel !== tipoVeh) return false;
                return true;
            });
        }
        return v;
    }, [filas, merodeo, color, tipoVeh, camaras]);

    /**
     * La ficha del visor: padrón, OmniVision y empresa, pedidos al abrir (/api/history/ficha).
     *
     * Se armaba acá con lo que traía la fila, y mentía: la marca que creyó leer la CÁMARA
     * («Brand 1723») pasaba por dato del padrón y el visor decía «En el padrón» sobre una
     * NO_LEIDA; del dueño sólo estaba el nombre, así que lote, teléfono y cochera salían
     * vacíos aunque estuvieran cargados. Ahora se consulta el padrón de verdad, y si la cámara
     * no leyó pero OmniVision releyó la chapa, la ficha es la de la chapa releída.
     */
    const [datosVisor, setDatosVisor] = useState<{ id: string; datos: DatosVisor | null; cargando: boolean } | null>(null);
    /*
     * Registrar la chapa desde el visor (17/10, Nico: «le faltan los controles de poder agregar
     * la matrícula»). El visor ya tenía el botón, pero sólo se dibuja si le pasan con qué: acá
     * nunca se le pasó, y una chapa desconocida quedaba en «no está en el padrón» sin salida.
     * Es el mismo alta que el monitor de LPR y OmniVision (elegir qué es → el cajón del alta).
     * Al terminar se vuelve a pedir la ficha, así el visor pasa a «Registrada» sin cerrarlo.
     */
    const [vueltaFicha, setVueltaFicha] = useState(0);
    const alta = useRegistrarDesdeCaptura(() => setVueltaFicha((n) => n + 1));
    useEffect(() => {
        if (!viendo) { setDatosVisor(null); return; }
        let vivo = true;
        const id = viendo.id;
        setDatosVisor({ id, datos: null, cargando: true });
        const q = new URLSearchParams({ momento: viendo.momento });
        if (viendo.plate) q.set("plate", viendo.plate);
        if (viendo.tipo === "ACCESO" && viendo.raw?.id) q.set("evento", viendo.raw.id);
        fetch(`/api/history/ficha?${q}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (vivo) setDatosVisor({ id, datos: j, cargando: false }); })
            .catch(() => { if (vivo) setDatosVisor({ id, datos: null, cargando: false }); });
        return () => { vivo = false; };
    }, [viendo, vueltaFicha]);

    /**
     * Los pasos anteriores de esa chapa — sacados de la tabla que ya está cargada.
     *
     * No se pide nada al servidor: las filas están acá, ordenadas por hora, y filtrarlas
     * por matrícula cuesta una pasada. Pedir un historial por red para mostrar lo que ya se
     * tiene en memoria es la clase de llamada que después nadie entiende por qué existe.
     * Lo que sí es cierto — y conviene tener presente — es que sólo alcanza hasta donde
     * llegó el scroll: es el historial *cargado*, no el completo.
     */
    const historialDe = useCallback((f: FilaHistorial) => {
        /* Una NO_LEIDA no es una matrícula: «sus pasos anteriores» eran las otras cuarenta
           NO_LEIDA del día. Si OmniVision la releyó, son los de la chapa releída; si no, no hay. */
        const chapa = f.plate && !NO_LEIDAS_FILA.has(f.plate.toUpperCase()) ? f.plate : f.vision?.releida?.plate || null;
        if (!chapa) return undefined;
        return visibles
            .filter((o) => o.plate === chapa && o.id !== f.id)
            .slice(0, 40)
            .map((o) => ({
                id: o.id,
                momento: o.momento,
                camara: o.camara,
                direccion: o.sentido,
                decision: o.decision,
                // La foto, para la tira de pasos del visor: comparar se hace mirando.
                foto: getImagePath(o.foto),
            }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibles]);

    const columnas = useMemo<ColumnaTabla<FilaHistorial>[]>(() => [
        {
            clave: "momento", titulo: "Momento", icono: Clock, ancho: 140, ordenable: true,
            tituloAyuda: "Cuándo",
            ayuda: "El momento del evento, no el de su registro. En una estadía es el intervalo completo: desde que el vehículo se detuvo hasta la última vez que se lo vio ahí.",
            valor: (f) => f.momento,
            celda: (f) => (
                f.tipo === "ESTACIONADO" && f.estDesde ? (
                    <div className="leading-tight">
                        <div className="text-[13px] font-semibold tabular-nums text-foreground">
                            {horaSeg(new Date(f.momento))}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums">
                            desde {hora(new Date(f.estDesde))}
                            {" · "}{fechaCorta(new Date(f.momento))}
                        </div>
                    </div>
                ) : <Momento t={f.momento} />
            ),
        },
        {
            clave: "cuadro", titulo: "Cuadro", icono: Camera, ancho: 110, auxiliar: true,
            tituloAyuda: "El cuadro guardado",
            /* El cuadro va segundo, pegado al momento: estaba último, al final de una fila
               ancha, y la foto es lo primero que alguien mira para saber si una lectura es
               la que busca. */
            ayuda: "La foto del momento: hacé clic para verla grande y acercarla, que es como se juzga una matrícula chica.",
            celda: (f) => (
                /* Al ancho justo (el doble de la miniatura, por pantallas densas): la foto de una LPR
                   pesa 1–2 MB y la lista pedía sesenta enteras para dibujarlas de 80 px. */
                <Miniatura src={miniatura(f.foto)} alt={f.plate || ""}
                    alAbrir={f.foto ? () => setViendo(f) : undefined} />
            ),
        },
        {
            clave: "tipo", titulo: "Tipo", icono: Activity, ancho: 190, ordenable: true,
            tituloAyuda: "Qué clase de registro es",
            ayuda: "Entrada y salida las decide una cámara LPR y abren barrera. Un avistamiento lo hace una cámara interior y sólo deja constancia. Estacionado es un vehículo quieto dentro del encuadre.",
            valor: (f) => rasgoDe(f)?.rotulo,
            celda: (f) => {
                const r = rasgoDe(f);
                const estadia = f.tipo === "ESTACIONADO" && f.estDesde
                    ? lapso((new Date(f.estHasta || f.momento).getTime() - new Date(f.estDesde).getTime()) / 1000)
                    : null;
                return (
                    <Pista titulo={r.rotulo} texto={r.ayuda}>
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-bold", r.chip)}>
                            <r.Ico className="w-3 h-3" />
                            {r.rotulo}
                            {estadia && <span className="font-semibold opacity-80">· {estadia}</span>}
                        </span>
                    </Pista>
                );
            },
        },
        {
            clave: "identificacion", titulo: "Identificación", icono: Car, ordenable: true,
            tituloAyuda: "Matrícula o persona",
            ayuda: "Lo que identificó el sistema. Hacé clic en la fila para ver el flujo completo de esa matrícula: por qué cámaras pasó y cuánto tardó entre una y otra.",
            valor: (f) => f.plate || f.persona,
            celda: (f) => (
                <div className="flex items-center gap-2">
                    {(() => {
                        /* Una NO_LEIDA: la chapa que leyó OmniVision (doble verificación) con su marca, o
                           «Sin lectura» si tampoco pudo. Antes salía «NO_LEIDA» dibujado como si fuera una chapa. */
                        const ch = chapaDe(f.plate, f.vision?.releida);
                        if (f.plate && !esSinLectura(f.plate)) return <><Matricula p={f.plate} /><MarcaFormatoChapa plate={f.plate} /><MarcaVerificacion plate={f.plate} r={f.vision?.releida} tamano="xs" soloIcono /></>;
                        if (ch.plate) return <><Matricula p={textoChapa(ch)} className="border-dashed" /><MarcaOmniVision r={f.vision?.releida} tamano="xs" /></>;
                        if (f.plate) return <><span className="text-[13px] text-muted-foreground">Sin lectura</span>{f.vision?.releida && <MarcaOmniVision r={f.vision.releida} tamano="xs" soloIcono />}</>;
                        return <span className="text-[13px] text-muted-foreground">{f.persona || "—"}</span>;
                    })()}
                    {f.empresa && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={f.empresa.logo} alt={f.empresa.nombre} title={f.empresa.nombre}
                            className={cn("h-5 w-auto max-w-[64px] object-contain shrink-0", !f.empresa.transparente && "rounded bg-white px-1")} />
                    )}
                    {f.plate && f.persona && <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">{f.persona}</span>}
                    {f.plate && (
                        <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground/45 shrink-0 transition-transform", abierta === f.id && "rotate-90")} />
                    )}
                </div>
            ),
        },
        {
            clave: "camara", titulo: "Cámara", icono: Camera, ordenable: true,
            tituloAyuda: "Qué equipo lo registró",
            ayuda: "La cámara o el dispositivo de acceso que generó el registro.",
            valor: (f) => f.camara,
            celda: (f) => f.camara ? <span className="text-[13px]">{f.camara}</span> : <Nada />,
        },
        {
            clave: "resultado", titulo: "Resultado", icono: ShieldCheck, ancho: 150,
            tituloAyuda: "Cómo salió",
            ayuda: "En un acceso, si se permitió o se denegó. En un avistamiento, qué tan segura fue la lectura: verde arriba de 85%, ámbar entre 65 y 85, rojo debajo.",
            valor: (f) => f.tipo === "ACCESO"
                ? (f.decision === "DENY" ? "Denegado" : "Permitido")
                : (f.confianza != null ? `${Math.round(f.confianza * 100)}%` : ""),
            celda: (f) => {
                if (f.tipo === "ACCESO") {
                    return f.decision === "DENY" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 dark:text-rose-400"><ShieldX className="w-3.5 h-3.5" /> Denegado</span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><ShieldCheck className="w-3.5 h-3.5" /> Permitido</span>
                    );
                }
                const conf = f.confianza != null ? Math.round(f.confianza * 100) : null;
                if (conf == null) return <Nada />;
                return (
                    <span className={cn("text-xs font-semibold tabular-nums",
                        conf >= 85 ? "text-emerald-600 dark:text-emerald-400" : conf >= 65 ? "text-amber-600 dark:text-amber-400" : "text-rose-500 dark:text-red-400")}>
                        {conf}%
                        {f.lecturas != null && <span className="text-muted-foreground/60 font-normal"> · {f.lecturas} cuadros</span>}
                    </span>
                );
            },
        },
        {
            clave: "tiempo", titulo: "Tiempo", icono: Timer, ancho: 150,
            tituloAyuda: "El contador de tiempo",
            ayuda: "Depende de la fila. Entrada: cuánto lleva adentro ese vehículo; corre en vivo hasta que se registra su salida. Salida: cuánto estuvo adentro, quieto. Estacionado: la estadía, en vivo si sigue ahí. Avistamiento o visto: hace cuánto fue la lectura.",
            valor: (f) => {
                if (f.tipo === "ESTACIONADO" && f.estDesde) return leerDuracion(+new Date(f.estCerrada && f.estHasta ? f.estHasta : f.momento) - +new Date(f.estDesde));
                if (f.tipo === "ACCESO" && f.sentido === "EXIT") return f.permanencia != null ? leerDuracion(f.permanencia * 1000) : "";
                if (f.tipo === "ACCESO" && f.sentido === "ENTRY") return f.salida ? leerDuracion(+new Date(f.salida) - +new Date(f.momento)) : f.adentro ? "adentro" : "";
                return "";
            },
            celda: (f) => {
                if (f.tipo === "ESTACIONADO" && f.estDesde) {
                    // Si la estadía sigue abierta el reloj corre; la última vez visto no es el fin.
                    return (
                        <Pista titulo={f.estCerrada ? "Estadía" : "Sigue estacionado"} texto={f.estCerrada ? "Cuánto estuvo detenido en ese lugar, de principio a fin." : "Lleva este tiempo detenido en el mismo lugar del cuadro, y la cámara lo sigue viendo ahí."}>
                            <Cronometro tamano="chico" desde={f.estDesde} hasta={f.estCerrada ? (f.estHasta || f.momento) : null} />
                        </Pista>
                    );
                }
                if (f.tipo === "ACCESO" && f.sentido === "EXIT") {
                    if (f.permanencia == null) return <Nada />;
                    return (
                        <Pista titulo="Permanencia" texto="Cuánto estuvo adentro este vehículo, desde su propia entrada hasta esta salida.">
                            <Cronometro tamano="chico" desde={new Date(+new Date(f.momento) - f.permanencia * 1000)} hasta={f.momento} />
                        </Pista>
                    );
                }
                if (f.tipo === "ACCESO" && f.sentido === "ENTRY") {
                    if (f.decision === "DENY") return <Nada />;
                    if (f.salida) {
                        return (
                            <Pista titulo="Ya salió" texto={`Entró y volvió a salir a las ${horaSeg(new Date(f.salida))}. El reloj quedó quieto en lo que estuvo adentro.`}>
                                <Cronometro tamano="chico" desde={f.momento} hasta={f.salida} />
                            </Pista>
                        );
                    }
                    if (f.adentro) {
                        return (
                            <Pista titulo="Adentro" texto="No hay una salida registrada después de esta entrada: el vehículo sigue adentro y el reloj corre en vivo.">
                                <Cronometro tamano="chico" desde={f.momento} />
                            </Pista>
                        );
                    }
                    return (
                        <Pista titulo="Sin salida registrada" texto="Pasó más de un día y medio sin que una cámara de salida leyera esta matrícula. Lo más probable es que la salida no se haya leído; por eso el reloj no corre.">
                            <span className="text-[11px] text-muted-foreground/70">sin salida</span>
                        </Pista>
                    );
                }
                return <HaceCuanto desde={f.momento} />;
            },
        },
        {
            clave: "omnivision", titulo: "OmniVision", icono: Sparkles, ancho: 170, auxiliar: true,
            tituloAyuda: "Lo que vio OmniVision",
            ayuda: "Qué encontró la inteligencia en la foto de la lectura: personas, vehículos, animales. Y si una NO_LEIDA la volvió a leer, la matrícula sugerida. Las lecturas se analizan unos segundos después de llegar; las de antes del 9/10 no tienen análisis.",
            valor: (f) => (f.vision?.vio || []).map((v) => v.nombre).join(", "),
            celda: (f) => <VisionCelda v={f.vision} />,
        },
        {
            clave: "senales", titulo: "Señales", icono: ShieldAlert, ancho: 110,
            tituloAyuda: "Señales",
            // La permanencia se mudó a la columna Tiempo, que es donde se la busca; acá queda lo que es una alerta.
            ayuda: "Merodeo marca una matrícula que aparece muchas veces en poco tiempo sin llegar a entrar.",
            valor: (f) => (f.plate && merodeo?.has(f.plate) ? "Merodeo" : ""),
            celda: (f) => {
                const merodea = !!(f.plate && merodeo?.has(f.plate));
                if (!merodea) return <Nada />;
                return (
                    <div className="flex flex-col gap-0.5">
                        {merodea && (
                            <Pista titulo="Merodeo" texto="Esta matrícula aparece muchas veces en poco tiempo sin llegar a entrar. Es una señal para mirar, no una conclusión.">
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-500 dark:text-rose-300">
                                    <ShieldAlert className="w-3 h-3" /> Merodeo
                                </span>
                            </Pista>
                        )}
                    </div>
                );
            },
        },
        {
            clave: "ficha", titulo: "Ficha", icono: MoreHorizontal, alinear: "der", ancho: 80, auxiliar: true,
            tituloAyuda: "La ficha completa",
            ayuda: "En los accesos, abre el detalle: fotos, datos del vehículo, permisos y por qué se decidió lo que se decidió.",
            celda: (f) => f.raw ? (
                <VisorEventoAcceso event={f.raw}>
                    <button onClick={(e) => e.stopPropagation()} title="Ficha completa del acceso"
                        className="inline-flex w-7 h-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent items-center justify-center transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                </VisorEventoAcceso>
            ) : <Nada />,
        },
    ], [abierta, merodeo]);

    const reintentar = useCallback(() => { setError(null); setRecargar((n) => n + 1); }, []);
    const traer = useCallback(() => setPagina((p) => p + 1), []);
    const pie = (
        <span className="flex items-center gap-1.5">
            {conectado
                ? <><Wifi size={11} className="text-emerald-500" /> En vivo</>
                : <><WifiOff size={11} className="text-muted-foreground/60" /> Sin conexión en vivo</>}
            <span className="opacity-50">·</span>
            <span className="tabular-nums">{visibles.length} registros</span>
            {visionTruncado && <span className="tono-aviso">· el filtro OmniVision miró las 5.000 lecturas más nuevas que lo cumplen</span>}
        </span>
    );

    return (
        <>
            {omni && buscar && <FranjaOmniVision datos={omni} buscar={buscar} />}
            {vista !== "lista" ? (
                <MosaicoHistorial vista={vista} filas={visibles} hay={hay} cargando={cargando} error={error}
                    alReintentar={reintentar} traer={traer} merodeando={merodeando} alAbrir={setViendo}
                    barra={barra} pie={pie} />
            ) : <Tabla<FilaHistorial>
                filas={visibles}
                clave={(f) => f.id}
                columnas={columnas}
                barra={barra}
                id="historial"
                nombreArchivo="historial"
                cargando={cargando}
                error={error}
                alReintentar={reintentar}
                vacio={{ icono: Inbox, titulo: "Nada en este período", ayuda: "Probá ampliar el rango de fechas, o quitar algún filtro de tipo." }}
                alClickFila={alternar}
                filaActiva={(f) => abierta === f.id}
                filaDestacada={(f) => esNueva(f.id)}
                expandir={(f) => (abierta === f.id && f.plate) ? (
                    <FlujoMatricula
                        plate={f.plate}
                        at={f.momento}
                        /* Un paso del flujo no es la fila: tiene su propia cámara y su
                           propio momento. Se hereda de la fila lo que el paso no trae. */
                        onVerFoto={(p: PasoFlujo) => p.foto && setViendo({
                            ...f, foto: p.foto, camara: p.camara, momento: p.momento, confianza: p.confianza,
                        })}
                    />
                ) : null}
                masFilas={{ hay, cargando, traer, modo: "scroll" }}
                alto="calc(100vh - 300px)"
                pie={pie}
            />}

            {viendo && (
                <VisorCuadro
                    fila={{
                        plate: viendo.plate || "",
                        cameraName: viendo.camara,
                        deviceId: viendo.deviceId,
                        timestamp: viendo.momento,
                        confidence: viendo.confianza,
                        reads: viendo.lecturas,
                        snapshotUrl: viendo.foto,
                        bbox: viendo.bbox,
                        decision: viendo.decision,
                        estado: viendo.tipo === "ACCESO" ? "PASO" : viendo.tipo,
                        estDesde: viendo.estDesde,
                        estHasta: viendo.estHasta,
                        estCerrada: viendo.estCerrada,
                        /* Lo que trae un evento de acceso y una lectura de calle no. El
                           visor es uno solo: dibuja lo que le llega y omite lo que no. */
                        direccion: viendo.sentido,
                        tipoAcceso: viendo.raw?.accessType || null,
                        detalles: viendo.detalles,
                        permanenciaMs: viendo.permanencia != null ? viendo.permanencia * 1000 : null,
                        rostroUrl: viendo.raw?.user?.cara || null,
                    }}
                    ficha={datosVisor?.datos?.ficha ?? null}
                    datos={{
                        ...(datosVisor?.datos || {}),
                        // Mientras llega, lo que ya trae la fila: las siluetas no esperan a la ficha.
                        vision: datosVisor?.datos?.vision ?? viendo.vision?.analisis ?? null,
                        empresa: datosVisor?.datos?.empresa ?? viendo.empresa ?? null,
                    }}
                    cargandoFicha={!!datosVisor?.cargando}
                    historial={historialDe(viendo)}
                    onRegistrar={alta.abrirRegistro}
                    tapado={alta.abierto}
                    onCerrar={() => setViendo(null)}
                />
            )}
            {alta.cajones}
        </>
    );
}

type FranjaOmni = {
    error: string | null; total: number; accesos: number;
    objetos: { id: string; camara: string; clase: string; grupo: string; momento: string; recorte: string | null; prob: number }[];
};

/**
 * Lo que OmniVision vio parecido a la búsqueda, arriba de la tabla.
 *
 * La tabla ya trae los accesos que coinciden (misma cámara, mismo rato); esto muestra además lo
 * que OmniVision vio aunque no haya sido un acceso —una persona en la vereda, una camioneta que
 * no entró—, que es lo que encuentra OmniVision › Buscar. Así una búsqueda en el historial no
 * se pierde lo que la otra pantalla sí ve.
 */
function FranjaOmniVision({ datos, buscar }: { datos: FranjaOmni; buscar: string }) {
    if (datos.error) {
        return (
            <div className="mb-3 rounded-[10px] border chip-aviso px-3.5 py-2.5 text-[12px] flex items-center gap-2">
                <Sparkles size={13} /> OmniVision no contestó, así que la búsqueda por cómo se ve no está en esta lista ({datos.error}).
            </div>
        );
    }
    if (!datos.total) return null;
    return (
        <div className="mb-3 rounded-[10px] border border-border bg-card px-3.5 py-3">
            <div className="flex items-center gap-2 flex-wrap">
                <Sparkles size={14} className="tono-accion" />
                <span className="text-[13px] font-semibold">Lo más parecido a «{buscar}» según OmniVision <span className="text-muted-foreground font-normal tabular-nums">· {datos.total}</span></span>
                <Pista titulo="Búsqueda por cómo se ve" texto="Compara la frase con el recorte de cada cosa que vio OmniVision (SigLIP), como en OmniVision › Buscar. Son posibles, no aciertos: ordenados del más parecido al menos." ancho={300}>
                    <span className="text-[11.5px] text-muted-foreground underline decoration-dotted underline-offset-2 cursor-help">¿cómo?</span>
                </Pista>
                {datos.accesos > 0 && <span className="text-[11.5px] text-muted-foreground">· {datos.accesos} acceso{datos.accesos === 1 ? "" : "s"} de esos momentos están en la tabla</span>}
                <a href={`/admin/vision/buscar?q=${encodeURIComponent(buscar)}`} className="ml-auto text-[12px] font-semibold tono-accion hover:underline">Ver todo en Buscar</a>
            </div>
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {datos.objetos.map((o) => (
                    <a key={o.id} href={`/admin/vision/buscar?q=${encodeURIComponent(buscar)}`} title={`${o.clase} · ${o.camara} · ${fechaCorta(o.momento)} ${horaSeg(o.momento)}`}
                        className="shrink-0 w-[112px] rounded-[6px] border border-border overflow-hidden hover:border-[var(--accion)] transition-colors">
                        <div className="h-[84px] bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {o.recorte && <img src={`/api/vision/imagen/${o.recorte}?w=224`} alt="" loading="lazy" className="w-full h-full object-cover" />}
                        </div>
                        <div className="px-1.5 py-1 text-[10.5px] leading-tight">
                            <div className="font-semibold truncate">{o.camara}</div>
                            <div className="text-muted-foreground tabular-nums">{fechaCorta(o.momento)} {hora(o.momento)}</div>
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
}
