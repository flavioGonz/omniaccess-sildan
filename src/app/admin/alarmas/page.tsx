"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Siren, Home, Ticket, CircleDashed, AlertTriangle, RefreshCw, Radar, ShieldAlert, ScanEye, Repeat, Car, Check, X, LogOut, Undo2,
    Hand, CircleHelp, ImageOff, Film, Circle, Clock, FileText, Layers, Loader2, NotebookPen, Image as ImageIcon,
} from "lucide-react";
import { useClipEvento, CLIP_ANTES_S } from "@/lib/clip-evento";
import { Pestanias, type Pestania } from "@/components/ui/pestanias";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import { ElegirDispositivo, type Equipo } from "@/components/alarmas/ElegirDispositivo";
import { cn } from "@/lib/utils";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Filtros } from "@/components/ui/filtros";
import { Button } from "@/components/ui/button";
import { Matricula, Momento, Estado, type Tono } from "@/components/ui/celdas";
import { Cronometro } from "@/components/tracking/Cronometro";
import { useTiempoReal } from "@/lib/tiempo-real";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import type { Alarma, FuenteAlarma } from "@/lib/alarmas";
import { Miniatura } from "@/components/ui/celdas";
import { NotaGestion, usarNotaGestion } from "@/components/alarmas/NotaGestion";
import { GestionEnVivo } from "@/components/alarmas/GestionEnVivo";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { getAccessEvent } from "@/app/actions/history";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { getAnalyticsGeometryBatch, marcarDeteccion } from "@/app/actions/detections";
import type { Geom } from "@/components/intrusion/comun";
import type { Presencia, AutoAdentro, ResidenteAdentro, VisitaAdentro, ClasePresencia, Atipico } from "@/lib/presencia";

/**
 * Gestión de alarmas (16/10, Nico): «un panel de gestión centralizado de todos los tipos de
 * alarmas», y el lugar al que llevan los cuatro números de la pared (Control LPR) — residentes,
 * visitas y proveedores, desconocidos y atípicos dentro.
 *
 * Arriba, qué se mira: las alarmas o una de las cuatro listas de quién está adentro (eran cinco
 * tarjetas con ícono y número; a Nico no le gustaron, 16/10 — quedó un selector con la cuenta). Abajo, la tabla de lo elegido y, a la derecha, lo seleccionado con lo que
 * se hace con eso: real o falsa, atendida, «salió».
 *
 * El cálculo vive en el servidor (lib/alarmas.ts y lib/presencia.ts), con el porqué de cada criterio.
 */

type Ver = "todo" | "alarmas" | "atipicos" | "residentes" | "visitas" | "desconocidos";
const VER: Ver[] = ["todo", "alarmas", "atipicos", "residentes", "visitas", "desconocidos"];
/**
 * Una fila de «Todo» (16/10, Nico: «falta uno que sea todos, y que sea por defecto»): las
 * alarmas y los autos que están adentro sin ser del barrio (visitas, proveedores, desconocidos,
 * atípicos), en una sola lista por hora. Los residentes no: que un residente esté en su casa no
 * es algo que gestionar.
 */
type FilaTodo = { id: string; ts: string; alarma?: Alarma; auto?: AutoAdentro };
type Datos = { horas: number; alarmas: Alarma[]; errorAlarmas: string | null; presencia: Presencia | null; ahora: string };

/** Cada cuánto se vuelve a pedir, además de con cada evento del socket. */
const REFRESCO_MS = 20_000;

const NOMBRE_FUENTE: Record<FuenteAlarma, string> = { intrusion: "Intrusión", lpr: "LPR", patron: "Patrones", vision: "OmniVision" };
const ICONO_FUENTE: Record<FuenteAlarma, typeof Radar> = { intrusion: Radar, lpr: ShieldAlert, patron: Repeat, vision: ScanEye };
const NOMBRE_CLASE: Record<ClasePresencia, string> = {
    residente: "Residente", personal: "Personal", proveedor: "Proveedor", visita: "Visita", invitado: "Invitado", lista_blanca: "Lista blanca", no_registrado: "No registrado",
};
const TONO_CLASE: Record<ClasePresencia, Tono> = { residente: "bien", personal: "info", proveedor: "info", visita: "aviso", invitado: "aviso", lista_blanca: "bien", no_registrado: "neutro" };
const NOMBRE_ATIPICO: Record<Atipico, string> = { lista_negra: "Lista negra", en_busqueda: "En búsqueda", merodeo: "Merodeo", primera_vez: "Primera vez", alta_frecuencia: "Alta frecuencia" };
const TONO_ATIPICO: Record<Atipico, Tono> = { lista_negra: "mal", en_busqueda: "mal", merodeo: "aviso", primera_vez: "info", alta_frecuencia: "aviso" };
const tonoTexto = (t: string) => (t === "mal" ? "tono-mal" : t === "aviso" ? "tono-aviso" : t === "info" ? "tono-info" : "text-muted-foreground");

export default function GestionAlarmasPagina() {
    return <Suspense fallback={null}><GestionAlarmas /></Suspense>;
}

function GestionAlarmas() {
    const router = useRouter();
    const sp = useSearchParams();
    const pedido = sp.get("ver") as Ver | null;
    const [ver, setVerEstado] = useState<Ver>(pedido && VER.includes(pedido) ? pedido : "todo");
    useEffect(() => { if (pedido && VER.includes(pedido)) setVerEstado(pedido); }, [pedido]);
    const setVer = (v: Ver) => { setVerEstado(v); setSel(null); router.replace(`/admin/alarmas?ver=${v}`, { scroll: false }); };

    const [horas, setHoras] = useState(24);
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const traer = useCallback(() => {
        fetch(`/api/alarmas?h=${horas}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as Datos; })
            .then((j) => { setDatos(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudieron leer las alarmas."))
            .finally(() => setCargando(false));
    }, [horas]);
    useEffect(() => { setCargando(true); traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);
    // Lo que puede cambiar la lista llega por el socket: se vuelve a pedir con un respiro, para no
    // pedir diez veces cuando pasan varios autos seguidos.
    const [pulso, setPulso] = useState(0);
    const latir = useCallback(() => setPulso((n) => n + 1), []);
    useEffect(() => { if (!pulso) return; const t = setTimeout(traer, 2000); return () => clearTimeout(t); }, [pulso, traer]);
    const { conectado } = useTiempoReal("access_event", latir);
    useTiempoReal("aviso_guardia", latir);
    useTiempoReal("general_detection", latir);
    useTiempoReal("alarma_atendida", latir);
    useTiempoReal("presencia", latir);
    useTiempoReal("visita", latir);

    const [sel, setSel] = useState<string | null>(null);
    const [hecho, setHecho] = useState<{ texto: string; deshacer?: () => void } | null>(null);
    const [fallo, setFallo] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState<string | null>(null);
    const mandar = useCallback(async (url: string, cuerpo: Record<string, unknown>, clave: string) => {
        setOcupado(clave); setFallo(null);
        try {
            const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
            const j = await r.json().catch(() => null);
            if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            traer();
            return true;
        } catch (e: any) { setFallo(e?.message || "No se pudo guardar."); return false; }
        finally { setOcupado(null); }
    }, [traer]);
    const salio = useCallback(async (a: AutoAdentro) => {
        if (await mandar("/api/presencia", { plate: a.plate, estado: "AFUERA" }, a.plate))
            setHecho({ texto: `${a.plate} marcado afuera`, deshacer: () => { void mandar("/api/presencia", { plate: a.plate, estado: "ADENTRO" }, a.plate); setHecho(null); } });
    }, [mandar]);
    const cerrarVisita = useCallback(async (id: string, plate: string | null) => {
        if (await mandar("/api/presencia", { visitaId: id }, id)) setHecho({ texto: `Visita${plate ? ` de ${plate}` : ""} cerrada` });
    }, [mandar]);

    const p = datos?.presencia || null;
    const alarmas = datos?.alarmas || [];
    const pendientes = alarmas.filter((a) => a.estado === "pendiente");

    // ── Qué se mira ──
    const vistas: Pestania<Ver>[] = [
        { valor: "todo", rotulo: "Todo", icono: Layers, ayuda: "Las alarmas y los autos que están adentro sin ser del barrio, por hora" },
        { valor: "alarmas", rotulo: "Alarmas", icono: Siren, cuenta: datos ? pendientes.length : undefined, tono: "mal", ayuda: "Alarmas sin atender" },
        { valor: "atipicos", rotulo: "Atípicos dentro", icono: AlertTriangle, cuenta: p?.resumen.atipicos, tono: "aviso" },
        { valor: "residentes", rotulo: "Residentes dentro", icono: Home, cuenta: p?.resumen.residentes },
        { valor: "visitas", rotulo: "Visitas y proveedores", icono: Ticket, cuenta: p?.resumen.visitasProveedores },
        { valor: "desconocidos", rotulo: "Desconocidos dentro", icono: CircleDashed, cuenta: p?.resumen.desconocidos },
    ];

    // ── Filtros de la tabla ──
    const [busqueda, setBusqueda] = useState("");
    /** Los orígenes elegidos; ninguno = todos. Así no hay un segundo «Todas» al lado del de estado. */
    const [origenes, setOrigenes] = useState<FuenteAlarma[]>([]);
    const alternarOrigen = (f: FuenteAlarma) => setOrigenes((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]));
    const [estado, setEstado] = useState<"pendiente" | "atendida" | "todas">("pendiente");
    /** Un equipo puntual (16/10): de qué cámara, lectora o NVR. Null = todos. */
    const [equipo, setEquipo] = useState<Equipo | null>(null);
    const deEquipo = (deviceId: string | null | undefined, camara: string | null | undefined, e: Equipo | null = equipo) => !e || deviceId === e.id || (!!camara && camara === e.name);
    const [subVisitas, setSubVisitas] = useState<"vehiculos" | "registradas">("vehiculos");
    useEffect(() => { setBusqueda(""); }, [ver]);
    const t = busqueda.trim().toUpperCase().replace(/[^A-Z0-9Ñ ]/g, "");
    const pasa = (...campos: (string | null | undefined)[]) => !t || campos.some((c) => (c || "").toUpperCase().replace(/[^A-Z0-9Ñ ]/g, "").includes(t));

    const filasAlarmas = useMemo(() => alarmas
        .filter((a) => deEquipo(a.deviceId, a.camara))
        .filter((a) => !origenes.length || origenes.includes(a.fuente))
        .filter((a) => estado === "todas" || a.estado === estado)
        .filter((a) => pasa(a.titulo, a.plate, a.camara, a.detalle)), [alarmas, origenes, estado, t, equipo]); // eslint-disable-line react-hooks/exhaustive-deps
    const cuentaFuente = (f: FuenteAlarma) => alarmas.filter((a) => a.fuente === f && (estado === "todas" || a.estado === estado) && deEquipo(a.deviceId, a.camara)).length;
    const cuentaEstado = (e: "pendiente" | "atendida") => alarmas.filter((a) => a.estado === e && (!origenes.length || origenes.includes(a.fuente)) && deEquipo(a.deviceId, a.camara)).length;
    const cuentaEquipo = useCallback((e: Equipo) => alarmas.filter((a) => (estado === "todas" || a.estado === estado) && deEquipo(a.deviceId, a.camara, e)).length, [alarmas, estado]); // eslint-disable-line react-hooks/exhaustive-deps

    const autosDe = (v: Ver): AutoAdentro[] => !p ? [] : v === "atipicos" ? p.atipicos : v === "desconocidos" ? p.autosVisitas.filter((a) => a.clase === "no_registrado") : v === "visitas" ? p.autosVisitas.filter((a) => a.clase !== "no_registrado") : [];
    // Las listas de quién está adentro arrancan por la permanencia más larga (16/10, Nico: «arriba
    // del todo los que más tiempo dentro tienen»): el que entró primero es el que más lleva.
    const porPermanencia = <T extends { entrada: string }>(xs: T[]) => [...xs].sort((a, b) => (a.entrada < b.entrada ? -1 : a.entrada > b.entrada ? 1 : 0));
    const filasAutos = useMemo(() => porPermanencia(autosDe(ver).filter((a) => pasa(a.plate, a.persona, a.unidad, NOMBRE_CLASE[a.clase], ...a.atipico.map((x) => NOMBRE_ATIPICO[x])))), [p, ver, t]); // eslint-disable-line react-hooks/exhaustive-deps
    const filasResidentes = useMemo(() => porPermanencia((p?.residentes || []).filter((r) => pasa(r.nombre, r.unidad, ...r.autos))), [p, t]); // eslint-disable-line react-hooks/exhaustive-deps
    const filasVisitas = useMemo(() => porPermanencia((p?.visitas || []).filter((v) => pasa(v.plate, v.nombre, v.empresa, v.lote, v.tipoNombre))), [p, t]); // eslint-disable-line react-hooks/exhaustive-deps
    const filasTodo = useMemo<FilaTodo[]>(() => {
        const out: FilaTodo[] = filasAlarmas.map((a) => ({ id: a.id, ts: a.ts, alarma: a }));
        // Los autos adentro no son alarmas atendibles: entran sólo mirando lo pendiente o todo, y sin acotar por origen.
        if (p && estado !== "atendida" && !origenes.length) {
            const vistos = new Set<string>();
            for (const a of [...p.atipicos, ...p.autosVisitas]) {
                if (vistos.has(a.plate)) continue;
                vistos.add(a.plate);
                if (!deEquipo(null, a.camara) || !pasa(a.plate, a.persona, a.unidad, NOMBRE_CLASE[a.clase], ...a.atipico.map((x) => NOMBRE_ATIPICO[x]))) continue;
                out.push({ id: `p:${a.plate}`, ts: a.entrada, auto: a });
            }
        }
        return out.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
    }, [filasAlarmas, p, estado, origenes, t, equipo]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Columnas ──
    const colsAlarmas = useMemo<ColumnaTabla<Alarma>[]>(() => [
        // La captura de la alarma, primero (16/10, Nico): es lo que se reconoce de un vistazo.
        { clave: "foto", titulo: "", ancho: 92, auxiliar: true, celda: (a) => <Miniatura src={fotoChica(a.foto, 320)} alt={a.titulo} ancho={80} alto={48} /> },
        { clave: "tipo", titulo: "Alarma", valor: (a) => `${a.titulo} · ${NOMBRE_FUENTE[a.fuente]}`, celda: (a) => { const I = ICONO_FUENTE[a.fuente]; return (
            <div className="flex items-center gap-2.5 min-w-0">
                <I size={15} className={cn("shrink-0", tonoTexto(a.tono))} />
                <div className="min-w-0 leading-tight"><div className="text-[13px] font-semibold truncate">{a.titulo}</div><div className="text-[11px] text-muted-foreground">{NOMBRE_FUENTE[a.fuente]}</div></div>
            </div>); } },
        { clave: "donde", titulo: "Matrícula · cámara", ancho: 190, valor: (a) => [a.plate, a.camara].filter(Boolean).join(" · "), celda: (a) => (
            <div className="min-w-0 flex flex-col items-start gap-0.5">{a.plate && <Matricula p={a.plate} />}<span className="text-[11.5px] text-muted-foreground truncate max-w-full">{a.camara || (a.plate ? "" : "—")}</span></div>) },
        { clave: "detalle", titulo: "Detalle", valor: (a) => a.detalle || "", celda: (a) => <span className="text-[12px] text-muted-foreground line-clamp-2">{a.detalle || "—"}</span> },
        { clave: "hora", titulo: "Hora", ancho: 92, ordenable: true, valor: (a) => a.ts, celda: (a) => <Momento t={a.ts} /> },
        { clave: "estado", titulo: "Estado", ancho: 104, valor: (a) => a.estado === "pendiente" ? "Pendiente" : a.resultado || "Atendida", celda: (a) => a.estado === "pendiente"
            ? <Estado tono="mal">Pendiente</Estado>
            : <Estado tono={a.resultado === "falsa" ? "quieto" : a.resultado === "real" ? "aviso" : "bien"}>{a.resultado === "falsa" ? "Falsa" : a.resultado === "real" ? "Real" : "Atendida"}</Estado> },
    ], []);

    const colsTodo = useMemo<ColumnaTabla<FilaTodo>[]>(() => [
        { clave: "foto", titulo: "", ancho: 92, auxiliar: true, celda: (f) => <Miniatura src={fotoChica(f.alarma ? f.alarma.foto : f.auto!.foto, 320)} alt="" ancho={80} alto={48} /> },
        { clave: "que", titulo: "Qué", valor: (f) => f.alarma ? f.alarma.titulo : NOMBRE_CLASE[f.auto!.clase], celda: (f) => {
            if (f.alarma) { const a = f.alarma; const I = ICONO_FUENTE[a.fuente]; return (
                <div className="flex items-center gap-2.5 min-w-0"><I size={15} className={cn("shrink-0", tonoTexto(a.tono))} />
                    <div className="min-w-0 leading-tight"><div className="text-[13px] font-semibold truncate">{a.titulo}</div><div className="text-[11px] text-muted-foreground">{NOMBRE_FUENTE[a.fuente]}</div></div></div>); }
            const a = f.auto!; const at = a.atipico[0];
            return (
                <div className="flex items-center gap-2.5 min-w-0">{at ? <AlertTriangle size={15} className={cn("shrink-0", tonoTexto(TONO_ATIPICO[at]))} /> : <Car size={15} className="shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 leading-tight"><div className="text-[13px] font-semibold truncate">{at ? a.atipico.map((x) => NOMBRE_ATIPICO[x]).join(" · ") : `${NOMBRE_CLASE[a.clase]} adentro`}</div><div className="text-[11px] text-muted-foreground">Presencia</div></div></div>);
        } },
        { clave: "donde", titulo: "Matrícula · cámara", ancho: 190, valor: (f) => [f.alarma?.plate || f.auto?.plate, f.alarma?.camara || f.auto?.camara].filter(Boolean).join(" · "), celda: (f) => {
            const plate = f.alarma ? f.alarma.plate : f.auto!.plate, cam = f.alarma ? f.alarma.camara : f.auto!.camara;
            return <div className="min-w-0 flex flex-col items-start gap-0.5">{plate && <Matricula p={plate} />}<span className="text-[11.5px] text-muted-foreground truncate max-w-full">{cam || (plate ? "" : "—")}</span></div>;
        } },
        { clave: "detalle", titulo: "Detalle", valor: (f) => f.alarma ? f.alarma.detalle || "" : [f.auto!.persona, f.auto!.unidad].filter(Boolean).join(" · "), celda: (f) => (
            <span className="text-[12px] text-muted-foreground line-clamp-2">{f.alarma ? f.alarma.detalle || "—" : [f.auto!.persona, f.auto!.unidad].filter(Boolean).join(" · ") || NOMBRE_CLASE[f.auto!.clase]}</span>) },
        { clave: "hora", titulo: "Hora", ancho: 92, ordenable: true, valor: (f) => f.ts, celda: (f) => <Momento t={f.ts} /> },
        { clave: "estado", titulo: "Estado", ancho: 116, valor: (f) => f.alarma ? f.alarma.estado : "Adentro", celda: (f) => {
            if (!f.alarma) return <Cronometro desde={f.auto!.entrada} tamano="chico" />;
            const a = f.alarma;
            return a.estado === "pendiente" ? <Estado tono="mal">Pendiente</Estado>
                : <Estado tono={a.resultado === "falsa" ? "quieto" : a.resultado === "real" ? "aviso" : "bien"}>{a.resultado === "falsa" ? "Falsa" : a.resultado === "real" ? "Real" : "Atendida"}</Estado>;
        } },
    ], []); // eslint-disable-line react-hooks/exhaustive-deps

    const colIngreso = <T extends { entrada: string }>(): ColumnaTabla<T>[] => [
        { clave: "entrada", titulo: "Ingreso", ancho: 92, ordenable: true, valor: (x) => x.entrada, celda: (x) => <Momento t={x.entrada} /> },
        { clave: "estadia", titulo: "Permanencia", ancho: 116, ordenable: true, valor: (x) => Date.now() - new Date(x.entrada).getTime(), celda: (x) => <Cronometro desde={x.entrada} tamano="chico" /> },
    ];
    const colsAutos = useMemo<ColumnaTabla<AutoAdentro>[]>(() => [
        { clave: "plate", titulo: "Matrícula", ancho: 128, valor: (a) => a.plate, celda: (a) => (
            <div className="flex flex-col items-start gap-1">
                <Matricula p={a.plate} />
                {a.marcaManual ? <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Hand size={10} /> a mano</span>
                    : a.estimado ? <span className="inline-flex items-center gap-1 text-[10.5px] tono-aviso" title="La entrada es vieja y ninguna cámara la volvió a ver: puede haber salido sin que se leyera"><CircleHelp size={10} /> sin confirmar</span> : null}
            </div>) },
        { clave: "quien", titulo: ver === "atipicos" ? "Por qué" : "Quién", valor: (a) => [...a.atipico.map((x) => NOMBRE_ATIPICO[x]), a.persona, a.unidad, NOMBRE_CLASE[a.clase]].filter(Boolean).join(" · "), celda: (a) => (
            <div className="min-w-0 leading-tight">
                {a.atipico.length > 0 && <div className="flex flex-wrap gap-1 mb-1">{a.atipico.map((x) => <Estado key={x} tono={TONO_ATIPICO[x]}>{NOMBRE_ATIPICO[x]}</Estado>)}</div>}
                <div className="text-[13px] font-semibold truncate">{a.persona || <span className="text-muted-foreground font-normal">{NOMBRE_CLASE[a.clase]}</span>}</div>
                {(a.persona || a.unidad) && <div className="text-[11px] text-muted-foreground truncate">{[a.persona ? NOMBRE_CLASE[a.clase] : null, a.unidad].filter(Boolean).join(" · ")}</div>}
            </div>) },
        ...colIngreso<AutoAdentro>(),
        { clave: "e24", titulo: "Entradas 24 h", ancho: 96, alinear: "der", valor: (a) => a.entradas24h, celda: (a) => <span className="tabular-nums text-[13px]">{a.entradas24h}</span> },
        { clave: "visto", titulo: "Última lectura", ancho: 140, valor: (a) => a.vistoUltimo, celda: (a) => <div className="leading-tight min-w-0"><Momento t={a.vistoUltimo} />{a.camara && <div className="text-[10.5px] text-muted-foreground truncate">{a.camara}</div>}</div> },
    ], [ver]); // eslint-disable-line react-hooks/exhaustive-deps
    const colsResidentes = useMemo<ColumnaTabla<ResidenteAdentro>[]>(() => [
        { clave: "nombre", titulo: "Residente", valor: (r) => r.nombre, celda: (r) => <div className="leading-tight min-w-0"><div className="text-[13px] font-semibold truncate">{r.nombre}</div><div className="text-[11px] text-muted-foreground truncate">{r.unidad || "Sin unidad"}{r.estimado ? " · sin confirmar" : ""}</div></div> },
        { clave: "autos", titulo: "Con", valor: (r) => r.autos.join(" "), celda: (r) => r.autos.length ? <div className="flex flex-wrap gap-1">{r.autos.map((x) => <Matricula key={x} p={x} />)}</div> : <span className="text-[12px] text-muted-foreground">A pie</span> },
        ...colIngreso<ResidenteAdentro>(),
    ], []); // eslint-disable-line react-hooks/exhaustive-deps
    const colsVisitas = useMemo<ColumnaTabla<VisitaAdentro>[]>(() => [
        { clave: "plate", titulo: "Matrícula", ancho: 120, valor: (v) => v.plate || "", celda: (v) => <Matricula p={v.plate} /> },
        { clave: "quien", titulo: "Quién", valor: (v) => [v.nombre, v.empresa, v.lote].filter(Boolean).join(" · "), celda: (v) => (
            <div className="leading-tight min-w-0">
                <div className="text-[13px] font-semibold truncate">{v.nombre || v.empresa || <span className="text-muted-foreground font-normal">Sin nombre</span>}</div>
                <div className="flex items-center gap-1.5 mt-0.5"><Estado tono="aviso">{v.tipoNombre}</Estado>{v.lote && <span className="text-[11px] text-muted-foreground truncate">{v.lote}</span>}</div>
            </div>) },
        ...colIngreso<VisitaAdentro>(),
        { clave: "vence", titulo: "Vence", ancho: 92, valor: (v) => v.vence, celda: (v) => <div className={cn(v.excedida && "tono-mal")}><Momento t={v.vence} />{v.excedida && <div className="text-[10.5px] font-semibold">excedida</div>}</div> },
        { clave: "accion", titulo: "", ancho: 124, auxiliar: true, alinear: "der", celda: (v) => (
            <button type="button" disabled={ocupado === v.id} onClick={(e) => { e.stopPropagation(); void cerrarVisita(v.id, v.plate); }}
                className="h-7 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 text-[var(--accion)] hover:bg-accent disabled:opacity-50"><LogOut size={13} /> Cerrar visita</button>) },
    ], [ocupado, cerrarVisita]);

    // ── Lo seleccionado ──
    const alarmaSel = ver === "alarmas" || ver === "todo" ? alarmas.find((a) => a.id === sel) || null : null;
    const plateSel = sel?.startsWith("p:") ? sel.slice(2) : sel;
    const autoSel = ver !== "alarmas" && ver !== "residentes" && !alarmaSel ? (p ? [...p.autosResidentes, ...p.autosVisitas, ...p.atipicos].find((a) => a.plate === plateSel) || null : null) : null;

    /*
     * Los filtros de la tabla en UN renglón (17/10, Nico: «el origen está mal ubicado, mucho texto;
     * debe ser iconográfico, con react-tooltip, en la misma fila que 24 h / 3 días / 7 días»).
     * Izquierda: buscar y el estado (¿qué falta atender?). Derecha: de dónde viene —cuatro íconos
     * que se prenden y se apagan, con su cuenta; ninguno prendido es todos—, el equipo y hasta cuándo
     * para atrás. Lo que decía cada chip en palabras pasó a la ayuda al pasar el mouse.
     */
    const etiquetaEstado = estado === "pendiente" ? "sin atender" : estado === "atendida" ? "atendidas" : "en total";
    const barraAlarmas = (
        <div className="flex items-center gap-2 flex-wrap">
            <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Matrícula, cámara o tipo"
                grupos={[{ clave: "estado", titulo: "¿Atendidas o no?", valor: estado, alElegir: (v) => setEstado(v as any), opciones: [
                    { valor: "pendiente", rotulo: "Sin atender", cuenta: cuentaEstado("pendiente"), tono: cuentaEstado("pendiente") ? "mal" : undefined },
                    { valor: "atendida", rotulo: "Atendidas", cuenta: cuentaEstado("atendida") },
                    { valor: "todas", rotulo: "Todas" }] }]} />
            <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5 gap-0.5" role="group" aria-label="Origen">
                    {(["intrusion", "lpr", "patron", "vision"] as FuenteAlarma[]).map((f) => {
                        const I = ICONO_FUENTE[f], on = origenes.includes(f), n = cuentaFuente(f);
                        return (
                            <button key={f} type="button" onClick={() => alternarOrigen(f)} aria-pressed={on} aria-label={NOMBRE_FUENTE[f]}
                                data-tooltip-id="tt-alarmas" data-tooltip-content={`${NOMBRE_FUENTE[f]} · ${n} ${etiquetaEstado}. ${on ? "Tocá para quitarlo." : origenes.length ? "Tocá para sumarlo." : "Tocá para ver sólo este origen."}`}
                                className={cn("relative h-[30px] w-[34px] rounded-md grid place-items-center transition-colors",
                                    on ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-background", !n && !on && "opacity-40")}>
                                <I size={15} />
                                {n > 0 && <span className={cn("absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9.5px] font-bold tabular-nums grid place-items-center", on ? "bg-white text-[var(--accion)]" : f === "intrusion" || f === "lpr" ? "pleno-mal" : "bg-foreground text-background")}>{n > 99 ? "99+" : n}</span>}
                            </button>
                        );
                    })}
                    {origenes.length > 0 && (
                        <button type="button" onClick={() => setOrigenes([])} aria-label="Todos los orígenes" data-tooltip-id="tt-alarmas" data-tooltip-content="Ver todos los orígenes"
                            className="h-[30px] w-[26px] rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background"><X size={13} /></button>
                    )}
                </div>
                <ElegirDispositivo compacto valor={equipo} alElegir={setEquipo} cuenta={cuentaEquipo} />
                <span className="w-px h-5 bg-border" />
                <Filtros grupos={[{ clave: "rango", titulo: "Hasta cuándo para atrás se miran las alarmas", valor: String(horas), alElegir: (v) => setHoras(Number(v)),
                    opciones: [{ valor: "24", rotulo: "24 h" }, { valor: "72", rotulo: "3 días" }, { valor: "168", rotulo: "7 días" }] }]} />
            </div>
        </div>
    );
    const comun = { alto: "100%", className: "flex-1 min-h-0", seleccionCeldas: false, cargando: cargando && !datos, error: !datos ? error : null, alReintentar: traer };
    const vacio = (titulo: string) => ({ titulo: t ? "Nada con esa búsqueda" : titulo, ayuda: t ? undefined : "Se actualiza sola con cada lectura y cada aviso." });

    return (
        <div className="h-full flex flex-col">
            <Tooltip id="tt-alarmas" place="bottom" positionStrategy="fixed" className="!max-w-[260px] !text-[12px] !rounded-lg !z-[9999]" />
            {/* Cabecera */}
            <div className="shrink-0 px-6 pt-4 pb-3 border-b border-border flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted/60 text-[var(--accion)] shrink-0"><Siren size={20} /></span>
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold tracking-tight">Gestión de alarmas</h1>
                            <p className="text-xs text-muted-foreground truncate">Intrusión, LPR, patrones y OmniVision en un solo lugar, y quién está adentro del barrio</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg bg-muted/60 text-[12px] font-semibold", conectado ? "tono-bien" : "text-muted-foreground")} title={conectado ? "Las alarmas llegan en tiempo real" : "Sin tiempo real: se actualiza cada 20 s"}>
                            <Circle size={7} className={cn("fill-current", conectado && "animate-pulse")} /> {conectado ? "En vivo" : "Cada 20 s"}
                        </span>
                        <button type="button" onClick={traer} title="Volver a pedir" className="w-[34px] h-[34px] rounded-lg grid place-items-center bg-muted/60 text-muted-foreground hover:text-foreground"><RefreshCw size={15} className={cn(cargando && "animate-spin")} /></button>
                    </div>
                </div>
                <Pestanias valor={ver} opciones={vistas} alElegir={setVer} />
            </div>

            {/* Cuerpo: la tabla de lo elegido y lo seleccionado a la derecha. */}
            <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_400px] xl:divide-x divide-border">
                <div className="min-h-0 flex flex-col gap-3 p-4">
                    {(hecho || fallo) && (
                        <div className={cn("shrink-0 flex items-center gap-2 h-9 px-3 rounded-md text-[12.5px]", fallo ? "chip-mal" : "bg-muted/60")}>
                            <span className="flex-1 truncate">{fallo || hecho?.texto}</span>
                            {!fallo && hecho?.deshacer && <button type="button" onClick={hecho.deshacer} className="inline-flex items-center gap-1 font-semibold text-[var(--accion)]"><Undo2 size={13} /> Deshacer</button>}
                            <button type="button" onClick={() => { setHecho(null); setFallo(null); }} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                        </div>
                    )}
                    <div key={ver} className="oa-aparecer flex-1 min-h-0 flex flex-col">
                    {ver === "todo" ? (
                        <Tabla<FilaTodo> {...comun} id="alarmas-todo" filas={filasTodo} clave={(f) => f.id} columnas={colsTodo}
                            alClickFila={(f) => setSel((x) => (x === f.id ? null : f.id))} filaActiva={(f) => f.id === sel}
                            filaDestacada={(f) => !!f.alarma && f.alarma.estado === "pendiente" && Date.now() - new Date(f.ts).getTime() < 60_000}
                            vacio={vacio("Nada que gestionar")}
                            pie={<span className="tabular-nums">{filasTodo.filter((f) => f.alarma).length} alarmas y {filasTodo.filter((f) => f.auto).length} autos adentro sin ser del barrio · últimas {horas} h</span>}
                            barra={barraAlarmas} />
                    ) : ver === "alarmas" ? (
                        <Tabla<Alarma> {...comun} id="alarmas" filas={filasAlarmas} clave={(a) => a.id} columnas={colsAlarmas}
                            alClickFila={(a) => setSel((x) => (x === a.id ? null : a.id))} filaActiva={(a) => a.id === sel}
                            filaDestacada={(a) => a.estado === "pendiente" && Date.now() - new Date(a.ts).getTime() < 60_000}
                            vacio={vacio(estado === "pendiente" ? "No hay alarmas sin atender" : "Sin alarmas en este rango")}
                            pie={<span className="tabular-nums">{filasAlarmas.length} de {alarmas.length} en las últimas {horas} h{datos?.errorAlarmas ? ` · ${datos.errorAlarmas}` : ""}</span>}
                            barra={barraAlarmas} />
                    ) : ver === "residentes" ? (
                        <Tabla<ResidenteAdentro> {...comun} id="alarmas-residentes" filas={filasResidentes} clave={(r) => r.userId} columnas={colsResidentes}
                            vacio={vacio("No hay residentes adentro")}
                            pie={<span>Un residente está adentro si un auto suyo entró y no se lo vio salir en {p?.ventanas.residentesDias ?? 7} días, o si entró a pie.</span>}
                            barra={<Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Nombre, lote o matrícula" />} />
                    ) : ver === "visitas" && subVisitas === "registradas" ? (
                        <Tabla<VisitaAdentro> {...comun} id="alarmas-visitas-registradas" filas={filasVisitas} clave={(v) => v.id} columnas={colsVisitas}
                            vacio={vacio("No hay visitas registradas abiertas")}
                            barra={<Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Matrícula, nombre o lote"
                                grupos={[{ clave: "sub", titulo: "Qué lista", valor: subVisitas, alElegir: (v) => setSubVisitas(v as any), opciones: [
                                    { valor: "vehiculos", rotulo: "Vehículos", cuenta: autosDe("visitas").length }, { valor: "registradas", rotulo: "Visitas registradas", cuenta: p?.visitas.length ?? 0 }] }]} />} />
                    ) : (
                        <Tabla<AutoAdentro> {...comun} id={`alarmas-${ver}`} filas={filasAutos} clave={(a) => a.plate} columnas={colsAutos}
                            alClickFila={(a) => setSel((x) => (x === a.plate ? null : a.plate))} filaActiva={(a) => a.plate === sel}
                            vacio={vacio(ver === "atipicos" ? "Nada fuera de lo común adentro" : ver === "desconocidos" ? "No hay desconocidos adentro" : "No hay visitas ni proveedores adentro")}
                            pie={<span>{p?.modo === "ABIERTO" ? `Barrio abierto: la salida no siempre se lee. Lo que no es del barrio se da por ido a las ${p.ventanas.visitasHoras} h; «sin confirmar» es una entrada vieja sin otra lectura.` : "Por la última lectura permitida de cada matrícula."}</span>}
                            barra={<Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Matrícula, nombre o motivo"
                                grupos={ver === "visitas" ? [{ clave: "sub", titulo: "Qué lista", valor: subVisitas, alElegir: (v) => setSubVisitas(v as any), opciones: [
                                    { valor: "vehiculos", rotulo: "Vehículos", cuenta: autosDe("visitas").length }, { valor: "registradas", rotulo: "Visitas registradas", cuenta: p?.visitas.length ?? 0 }] }] : undefined} />} />
                    )}
                    </div>
                </div>

                {/* Lo seleccionado: la foto a todo el ancho y sin marco, qué es, y qué se hace con eso. */}
                <aside className="hidden xl:flex flex-col min-h-0 overflow-y-auto">
                    {alarmaSel ? <DetalleAlarma key={alarmaSel.id} a={alarmaSel} alHecho={(texto) => { setHecho({ texto }); traer(); }} alRecargar={traer} />
                        : autoSel ? <DetalleAuto a={autoSel} ocupado={ocupado === autoSel.plate || ocupado === autoSel.visitaId} alSalio={() => void salio(autoSel)} alCerrarVisita={() => autoSel.visitaId && void cerrarVisita(autoSel.visitaId, autoSel.plate)} />
                        : (
                            <div className="flex-1 grid place-items-center p-8 text-center">
                                <div className="max-w-[260px] text-muted-foreground">
                                    <Siren size={26} className="mx-auto mb-3 opacity-40" />
                                    <div className="text-[13px] font-semibold text-foreground">Elegí una fila</div>
                                    <div className="text-[12.5px] mt-1">{ver === "alarmas" || ver === "todo" ? "Se ve la captura y se marca como real, falsa o atendida." : ver === "residentes" ? "Los residentes no tienen acciones: se corrigen desde sus autos." : "Se ve la última captura y, si se fue sin que se leyera, se marca «salió»."}</div>
                                </div>
                            </div>
                        )}
                </aside>
            </div>
        </div>
    );
}

/** Al pasar el mouse sobre la foto: que se note que se abre la ficha. */
function VerFichaEncima() {
    return (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/35 transition-colors">
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/65 text-white text-[12px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"><FileText size={13} /> Ver ficha del evento</span>
        </span>
    );
}

/**
 * La captura del evento, y detrás el VIDEO de ese evento en loop (17/10, Nico: «el drawer trae la
 * foto del evento, pero de fondo carga un video en loop del evento concreto»): la foto sale al
 * instante; el clip del grabador (los segundos de antes, lib/clip-evento) se pide mientras se
 * mira y entra encima cuando ya corre, sin cuadro negro. La píldora de arriba dice qué se ve y
 * alterna (la misma preferencia que el Monitor de Intrusión y la ficha).
 */
function Foto({ src, clip }: { src: string | null; clip?: { id: string | null; deviceId: string | null; instante: string } }) {
    const [ok, setOk] = useState(true);
    useEffect(() => { setOk(true); }, [src]);
    const c = useClipEvento({ id: clip?.id, deviceId: clip?.deviceId, instante: clip?.instante, activo: !!clip?.deviceId && !!clip?.id });
    const enVideo = c.clipOn && c.clip.estado === "listo" && c.clipVisible;
    const conClip = !!clip?.deviceId && !!clip?.id;
    return (
        <div className="relative aspect-video bg-black shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src && ok ? <img key={src} src={src} alt="" className="absolute inset-0 w-full h-full object-contain" onError={() => setOk(false)} />
                : !enVideo && <div className="absolute inset-0 grid place-items-center text-white/30 text-[12px]"><span className="inline-flex items-center gap-1.5"><ImageOff size={18} /> Sin captura</span></div>}
            {c.clipOn && c.clip.estado === "listo" && c.clip.url && (
                <video key={c.clip.url} src={c.clip.url} autoPlay muted loop playsInline onPlaying={() => c.setClipVisible(true)} onError={() => c.setClipVisible(false)}
                    className={cn("absolute inset-0 w-full h-full object-contain transition-opacity duration-500", c.clipVisible ? "opacity-100" : "opacity-0")} />
            )}
            {conClip && (
                // span y no button: la foto suele estar adentro del botón que abre la ficha.
                <span role="button" tabIndex={0} aria-pressed={c.clipOn}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); c.cambiarClip(!c.clipOn); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); c.cambiarClip(!c.clipOn); } }}
                    title={!c.clipOn ? `Ver en loop los ${CLIP_ANTES_S} s antes de la foto` : c.clip.estado === "sin" ? `Sin video: ${c.clip.motivo}. Tocá para ver sólo la foto` : c.clip.estado === "listo" ? "Video del evento en loop. Tocá para ver sólo la foto" : "Trayendo el video del grabador…"}
                    className="absolute top-2.5 left-2.5 z-[2] h-7 pl-2 pr-2.5 rounded-full bg-black/55 hover:bg-black/75 text-white/90 inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums cursor-pointer">
                    {!c.clipOn ? <><ImageIcon size={13} /> Foto</>
                        : enVideo ? <><span className="w-1.5 h-1.5 rounded-full bg-[var(--accion-en-oscuro)]" /><Repeat size={13} /> {CLIP_ANTES_S} s antes</>
                            : c.clip.estado === "sin" ? <><ImageIcon size={13} /> Sin video</>
                                : <><Loader2 size={13} className="animate-spin" /> Video…</>}
                </span>
            )}
        </div>
    );
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border last:border-0"><span className="text-[12px] text-muted-foreground">{rotulo}</span><span className="text-[13px] font-semibold text-right min-w-0">{children}</span></div>;
}

/** La captura de una alarma, al ancho pedido: las rutas de la aplicación se achican; los archivos van por su ruta. */
function fotoChica(f: string | null, ancho: number) {
    if (!f) return null;
    return f.startsWith("/api/") ? conAncho(f, ancho) : conAncho(getImagePath(f), ancho);
}

/**
 * La alarma elegida: la captura, qué es, cuándo y dónde; la nota de gestión; la decisión; y «Ver
 * ficha», que abre la misma ventana que el monitor (16/10, Nico): la del evento del monitor LPR
 * para una lectura, la de intrusión para una analítica.
 */
function DetalleAlarma({ a, alHecho, alRecargar }: { a: Alarma; alHecho: (texto: string) => void; alRecargar: () => void }) {
    const I = ICONO_FUENTE[a.fuente];
    const foto = fotoChica(a.foto, 960);
    const clip = { id: a.id, deviceId: a.deviceId, instante: a.ts };
    const conVeredicto = a.fuente === "intrusion" || a.fuente === "lpr";
    const t = new Date(a.ts);
    const nota = usarNotaGestion(a.id, { nota: a.nota, por: a.notaPor, ts: a.notaAt });
    const decidir = async (resultado: "real" | "falsa" | null) => {
        if (await nota.guardar({ atender: true, resultado })) alHecho(`${a.titulo}${a.plate ? ` · ${a.plate}` : ""}: ${resultado === "falsa" ? "falsa alarma" : resultado === "real" ? "real" : "atendida"}`);
    };

    // «Ver ficha» de una lectura: el evento completo, como lo pide la ventana del monitor LPR.
    const eventoId = a.fuente === "lpr" || a.fuente === "patron" ? a.accessEventId : null;
    const [evento, setEvento] = useState<any>(null);
    useEffect(() => { setEvento(null); if (eventoId) getAccessEvent(eventoId).then(setEvento).catch(() => setEvento(null)); }, [eventoId]);
    // «Ver ficha» de una intrusión: la ventana de intrusión, con su geometría para dibujar la línea.
    const [fichaIntrusion, setFichaIntrusion] = useState(false);
    /** La grabación de ese momento, en su ventana, sin irse de Gestión de alarmas (16/10, Nico). */
    const [grabacion, setGrabacion] = useState(false);
    const [geom, setGeom] = useState<Geom | undefined>(undefined);
    useEffect(() => { setGeom(undefined); if (fichaIntrusion && a.deviceId) getAnalyticsGeometryBatch([a.deviceId]).then((g) => setGeom((g as any)?.[a.deviceId!])).catch(() => { }); }, [fichaIntrusion, a.deviceId]);
    const det = a.fuente === "intrusion" ? {
        id: a.id.slice(2), deviceId: a.deviceId, deviceName: a.camara, type: a.tipo, eventType: null, timestamp: a.ts,
        snapshotPath: a.foto && !a.foto.startsWith("/api/snapshot/") ? a.foto : null,
        acknowledged: a.estado === "atendida", ackKind: a.resultado === "falsa" ? "false" : a.resultado === "real" ? "real" : null,
        label: a.detalle === "Persona" ? "human" : a.detalle === "Vehículo" ? "vehicle" : null,
    } : null;

    return (
        <>
            {/* Tocar la foto abre la ficha del evento (17/10, Nico): la misma de «Ver ficha». */}
            {eventoId && evento ? (
                <EventDetailsDialog event={evento} timeStatus={null}>
                    <button type="button" className="group relative block w-full text-left" aria-label="Abrir la ficha del evento"><Foto src={foto} clip={clip} /><VerFichaEncima /></button>
                </EventDetailsDialog>
            ) : det ? (
                <button type="button" onClick={() => setFichaIntrusion(true)} className="group relative block w-full text-left" aria-label="Abrir la ficha de la detección"><Foto src={foto} clip={clip} /><VerFichaEncima /></button>
            ) : <Foto src={foto} clip={clip} />}
            <div className="px-5 pt-4 pb-5 flex flex-col gap-4">
                <div>
                    <div className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", tonoTexto(a.tono))}><I size={13} /> {NOMBRE_FUENTE[a.fuente]}</div>
                    <div className="text-[17px] font-bold tracking-tight">{a.titulo}{a.plate ? <span className="ml-2 align-middle"><Matricula p={a.plate} /></span> : null}</div>
                    {a.detalle && <div className="text-[13px] text-muted-foreground mt-0.5">{a.detalle}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {det && <Button size="sm" variant="outline" onClick={() => setFichaIntrusion(true)}><FileText size={14} /> Ver ficha</Button>}
                    {eventoId && (evento
                        ? <EventDetailsDialog event={evento} timeStatus={null}><Button size="sm" variant="outline"><FileText size={14} /> Ver ficha</Button></EventDetailsDialog>
                        : <Button size="sm" variant="outline" disabled><FileText size={14} /> Ver ficha</Button>)}
                    {a.deviceId && <Button size="sm" variant="outline" onClick={() => setGrabacion(true)}><Film size={14} /> Grabación</Button>}
                    {a.plate && <Button size="sm" variant="outline" asChild><a href={`/admin/history?search=${encodeURIComponent(a.plate)}`}><Clock size={14} /> Historial</a></Button>}
                </div>
                <div>
                    <Dato rotulo="Cuándo"><span className="tabular-nums">{t.toLocaleDateString("es-UY", { weekday: "short", day: "2-digit", month: "2-digit" })} · {t.toLocaleTimeString("es-UY", { hour12: false })}</span></Dato>
                    {a.camara && <Dato rotulo="Cámara">{a.camara}</Dato>}
                    <Dato rotulo="Estado">{a.estado === "pendiente" ? <span className="tono-mal">Pendiente</span> : <span>{a.resultado === "falsa" ? "Falsa alarma" : a.resultado === "real" ? "Real" : "Atendida"}{a.atendidaPor ? ` · ${a.atendidaPor}` : ""}</span>}</Dato>
                </div>

                {/* La nota se escribe acá; se guarda (o se decide) desde la barra de abajo, que queda fija:
                    guardar la nota es secundario (borde), la decisión es la acción (llena). */}
                <NotaGestion n={nota} sinBoton />

                {/* Quién la opera y la bitácora de lo que se hizo (16/10). */}
                <div className="border-t border-border pt-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Gestión</div>
                    <GestionEnVivo clave={a.id} deviceId={a.deviceId} inicio={[
                        { id: `origen-${a.id}`, ts: a.ts, por: a.camara || NOMBRE_FUENTE[a.fuente], texto: `abrió la alarma: ${a.titulo}`, detalle: a.detalle, tipo: "origen" },
                        ...(a.estado === "atendida" && a.atendidaAt ? [{ id: `atendida-${a.id}`, ts: a.atendidaAt, por: a.atendidaPor, texto: a.resultado === "real" ? "la marcó real" : a.resultado === "falsa" ? "la marcó falsa alarma" : "la dio por atendida", tipo: (a.resultado === "real" ? "mal" : "bien") as "mal" | "bien", legado: "decision" as const }] : []),
                        ...(a.nota && a.notaAt ? [{ id: `nota-${a.id}`, ts: a.notaAt, por: a.notaPor, texto: "escribió una nota", detalle: `«${a.nota}»`, tipo: "info" as const, legado: "nota" as const }] : []),
                    ]} />
                </div>
                {/* Las acciones acopladas abajo (17/10, Nico: «los botones de acción se deben acoplar al
                    scroll»): con la actividad larga quedaban fuera de vista. Quedan pegadas al pie del
                    panel mientras se baja, siempre a mano. */}
                <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-auto px-5 py-3 bg-background/95 backdrop-blur border-t border-border flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={!nota.sucia || nota.guardando} onClick={() => void nota.guardar()}>
                        {nota.guardando ? <Loader2 size={14} className="animate-spin" /> : <NotebookPen size={14} />} Guardar nota
                    </Button>
                    {conVeredicto ? (<span className="ml-auto flex items-center gap-2">
                        {(a.estado === "pendiente" || a.resultado !== "falsa") && <Button size="sm" variant="outline" disabled={nota.guardando} onClick={() => void decidir("falsa")}><X size={14} /> {a.estado === "pendiente" ? "Falsa alarma" : "Era falsa"}</Button>}
                        {(a.estado === "pendiente" || a.resultado !== "real") && <Button size="sm" disabled={nota.guardando} onClick={() => void decidir("real")} className="pleno-mal hover:brightness-110"><Check size={14} /> {a.estado === "pendiente" ? "Es real" : "Era real"}</Button>}
                    </span>) : a.estado === "pendiente" ? (
                        <Button size="sm" disabled={nota.guardando} onClick={() => void decidir(null)} className="ml-auto pleno-bien hover:brightness-110"><Check size={14} /> Atendida</Button>
                    ) : null}
                </div>
            </div>

            {grabacion && a.deviceId && (
                <VerGrabacion deviceId={a.deviceId} nombre={a.camara} tab="rec" instanteMs={t.getTime()} onClose={() => setGrabacion(false)} />
            )}
            {fichaIntrusion && det && (
                <FichaDeteccion det={det} geom={geom} onClose={() => { setFichaIntrusion(false); alRecargar(); }}
                    onMarcar={async (id, k) => marcarDeteccion(id, k)} />
            )}
        </>
    );
}

function DetalleAuto({ a, ocupado, alSalio, alCerrarVisita }: { a: AutoAdentro; ocupado: boolean; alSalio: () => void; alCerrarVisita: () => void }) {
    return (
        <>
            <Foto src={getImagePath(a.foto)} clip={{ id: a.accessEventId, deviceId: a.deviceId, instante: a.vistoUltimo }} />
            <div className="px-5 pt-4 pb-5 flex flex-col gap-3">
                <div>
                    <div className="flex items-center gap-2"><Matricula p={a.plate} className="text-[15px]" /><Estado tono={TONO_CLASE[a.clase]}>{NOMBRE_CLASE[a.clase]}</Estado></div>
                    <div className="text-[15px] font-bold tracking-tight mt-1.5">{a.persona || "Sin datos de quién es"}</div>
                    {a.unidad && <div className="text-[12.5px] text-muted-foreground">{a.unidad}</div>}
                    {a.atipico.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{a.atipico.map((x) => <Estado key={x} tono={TONO_ATIPICO[x]}>{NOMBRE_ATIPICO[x]}</Estado>)}</div>}
                </div>
                <div>
                    <Dato rotulo="Entró"><span className="tabular-nums">{new Date(a.entrada).toLocaleString("es-UY", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span></Dato>
                    <Dato rotulo="Lleva adentro"><Cronometro desde={a.entrada} tamano="chico" /></Dato>
                    <Dato rotulo="Última lectura"><span className="tabular-nums">{new Date(a.vistoUltimo).toLocaleTimeString("es-UY", { hour12: false })}</span>{a.camara ? ` · ${a.camara}` : ""}</Dato>
                    <Dato rotulo="Entradas en 24 h"><span className="tabular-nums">{a.entradas24h}</span></Dato>
                    {a.estimado && <Dato rotulo="Confirmado"><span className="tono-aviso">No: entrada vieja sin otra lectura</span></Dato>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {a.visitaId
                        ? <Button size="sm" disabled={ocupado} onClick={alCerrarVisita}><LogOut size={14} /> Cerrar visita</Button>
                        : <Button size="sm" disabled={ocupado} onClick={alSalio} title="La salida no se leyó: marcarlo afuera hasta su próxima lectura"><LogOut size={14} /> Salió</Button>}
                    <Button size="sm" variant="outline" asChild><a href={`/admin/history?search=${encodeURIComponent(a.plate)}`}><Car size={14} /> Historial de la matrícula</a></Button>
                </div>
            </div>
        </>
    );
}
