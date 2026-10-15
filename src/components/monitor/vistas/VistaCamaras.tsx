"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Server, VideoOff, ChevronLeft, ChevronRight, ChevronDown, Cpu, Image as ImageIcon, Loader2, ShieldAlert, Car, Check, Plus, Pencil, AppWindow, Monitor, Timer, LogIn, LogOut, LayoutGrid } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, horaCorta, hace, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { metaDe } from "@/components/intrusion/comun";
import { SUAVE, tocable } from "@/components/monitor/tactil";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import { DISPOSICIONES, disposicionDe, disposicionDeGrilla, DISPOSICION_POR_DEFECTO, CLAVE_CANAL, type Casilla, type VistaCamaras as VistaGuardada } from "@/lib/monitor/disposiciones";
import { Vivo, Foto, Geometria, Glifo, Flotante, estiloCasilla, fotoDe, vivoDe, ubicacion, grupoDe, reproduceH265, FOTO_MS, type Canal, type Alerta, type Lectura, type Modo } from "@/components/monitor/camaras/piezas";
import { Recursos } from "@/components/monitor/camaras/Recursos";
import { FichaCanal } from "@/components/monitor/camaras/Ficha";
import { EditorVista } from "@/components/monitor/camaras/Editor";
import { abrirVentana, listarPantallas, hayVariasPantallasApi, clavePrefs, type Pantalla } from "@/components/monitor/camaras/ventanas";
import { cn } from "@/lib/utils";

/**
 * La pared de video: los canales de los NVR y las cámaras sueltas, como en un NVR.
 *
 * El problema de fondo (medido el 15/10 en San Nicolás): todos los subflujos son H.265 a
 * 640×360. Un navegador que no decodifica H.265 necesita que el servidor convierta cada canal
 * a H.264 con su CPU — veinte canales a la vez es dejar al servidor sin aire para la lectura de
 * matrículas. Entonces cada pantalla decide sola: si su navegador reproduce H.265 todo va
 * directo (medido ese día en la PC de Nico: 16 canales directos, CPU del servidor en 6 %); si
 * no, a lo sumo MAX_CONVERTIDOS baldosas van convertidas y el resto es foto. Cada baldosa dice
 * cuál de las tres cosas es: una foto con aire de vivo sería una pantalla que miente.
 *
 * Dos maneras de mirar:
 *  · Automática: todos los canales (o los de un NVR) en la disposición elegida, por páginas.
 *    La cámara que detecta se pone roja y pasa a la primera casilla — la grande, si hay.
 *  · Una vista diseñada (Editor): la disposición y el canal de cada casilla, fijos. Se guardan
 *    en el servidor y las ve cualquier pantalla. Diseñarlas pide sesión con el permiso Monitores.
 *
 * Cada vista se puede desacoplar en otra ventana para otro monitor (ventanas.ts); cada ventana
 * guarda sus ajustes aparte. Arriba, lo que la pared le cuesta al servidor (Recursos).
 */

/** Cada cuánto se repite la lista de canales (y las detecciones). El socket adelanta lo urgente. */
const INTERVALO_MS = 30_000;
/** Tope de baldosas convertidas por pantalla cuando el navegador no reproduce H.265. */
const MAX_CONVERTIDOS = 4;
const PAGINA_SEG = [10, 20, 40] as const;
const PREFS_BASE = "omni.pared-camaras.v2";
/** Cuánto dura el destello de una baldosa LPR cuando lee una chapa. */
const DESTELLO_MS = 4000;
/** Cuántas chapas recientes entran en una baldosa chica y en una grande. */
const CHAPAS_CHICA = 2, CHAPAS_GRANDE = 4;
const AUTO = "auto";

type Datos = { canales: Canal[]; errores: { nvr: string; error: string }[]; go2rtc: boolean; ventanaAlertaMs: number; ahora: string; vistas: VistaGuardada[]; puedeEditar: boolean };
type Prefs = { vista: string; disposicion: string; pagSeg: number; pausa: boolean; nvr: string };
type Celda = { casilla: Casilla; canal: Canal | null; claveFaltante?: string | null };

const PREFS_INICIALES: Prefs = { vista: AUTO, disposicion: DISPOSICION_POR_DEFECTO, pagSeg: 20, pausa: false, nvr: "todos" };

/** Los ajustes de esta ventana; los parámetros de la dirección mandan sobre lo guardado. */
function leerPrefs(): { prefs: Prefs; canalSolo: string | null } {
    let p = { ...PREFS_INICIALES };
    try { p = { ...p, ...JSON.parse(localStorage.getItem(clavePrefs(PREFS_BASE)) || "{}") }; } catch { }
    let canalSolo: string | null = null;
    try {
        const q = new URLSearchParams(window.location.search);
        const g = disposicionDeGrilla(Number(q.get("grilla")));
        if (g) p.disposicion = g;
        if (q.get("disposicion") && DISPOSICIONES.some((d) => d.clave === q.get("disposicion"))) p.disposicion = q.get("disposicion")!;
        if (q.get("vista")) p.vista = q.get("vista")!;
        const c = q.get("canal"); if (c && CLAVE_CANAL.test(c)) canalSolo = c;
    } catch { }
    if (!DISPOSICIONES.some((d) => d.clave === p.disposicion)) p.disposicion = DISPOSICION_POR_DEFECTO;
    if (!PAGINA_SEG.includes(p.pagSeg as any)) p.pagSeg = PREFS_INICIALES.pagSeg;
    return { prefs: p, canalSolo };
}

/** Botón de la barra de arriba: misma altura y superficie que los medidores de recursos. */
function BotonBarra({ children, onClick, activo, titulo, className }: { children: React.ReactNode; onClick: () => void; activo?: boolean; titulo?: string; className?: string }) {
    return (
        <button type="button" onClick={onClick} title={titulo} aria-expanded={activo}
            className={cn("h-10 px-3 rounded-[10px] inline-flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap transition-colors", tocable,
                activo ? "bg-muted text-foreground" : "bg-muted/60 hover:bg-muted text-foreground", className)}>
            {children}
        </button>
    );
}
function OpcionMenu({ children, onClick, elegida, className }: { children: React.ReactNode; onClick: () => void; elegida?: boolean; className?: string }) {
    return (
        <button type="button" onClick={onClick} className={cn("w-full flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] hover:bg-muted", elegida && "font-semibold", className)}>
            {children}
            {elegida && <Check size={15} className="ml-auto text-[var(--accion-en-oscuro)] shrink-0" />}
        </button>
    );
}

const MODO_ROTULO: Record<Modo, { t: string; Ic: any; titulo: string }> = {
    directo: { t: "Vivo", Ic: null, titulo: "En vivo, directo desde la cámara (H.265 en este equipo)" },
    convertido: { t: "Convertido", Ic: Cpu, titulo: "En vivo, convertido a H.264 por el servidor" },
    foto: { t: `Foto c/${FOTO_MS / 1000} s`, Ic: ImageIcon, titulo: "Foto que se renueva: este equipo no reproduce H.265 y el servidor ya convierte el máximo de canales" },
};

function ChapaMini({ l, nueva }: { l: Lectura; nueva?: boolean }) {
    const ok = l.decision === "GRANT" && !l.listaNegra;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 bg-black/65 text-white text-[12px]", nueva && (ok ? "ring-2 ring-[var(--bien)]" : "ring-2 ring-[var(--mal)]"))}>
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", ok ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
            {l.sentido === "EXIT" ? <LogOut size={11} className="text-white/55" /> : <LogIn size={11} className="text-white/55" />}
            <span className="font-bold tabular-nums tracking-wide">{l.plate || "SIN LEER"}</span>
            <span className="text-white/55 tabular-nums">{horaCorta(l.ts).slice(0, 5)}</span>
        </span>
    );
}

function Baldosa({ celda, modo, alerta, lecturas, destello, alTocar, alResultado }: {
    celda: Celda; modo: Modo; alerta: Alerta | null; lecturas: Lectura[]; destello: Lectura | null;
    alTocar: () => void; alResultado: (c: Canal, modo: Modo, ok: boolean) => void;
}) {
    const c = celda.canal;
    const grande = celda.casilla.w > 1;
    if (!c) {
        return (
            <div style={estiloCasilla(celda.casilla)} className="relative min-h-0 rounded-[10px] bg-neutral-950 ring-1 ring-white/5 grid place-items-center text-[12px] text-white/25">
                {celda.claveFaltante ? "El canal de esta casilla ya no está" : ""}
            </div>
        );
    }
    const caido = c.online === false;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const ult = !alerta && c.ultima ? metaDe(c.ultima.tipo) : null;
    const foto = fotoDe(c, grande ? 960 : 640);
    const r = MODO_ROTULO[modo];
    const okDestello = destello ? destello.decision === "GRANT" && !destello.listaNegra : null;
    return (
        <motion.button type="button" layout="position" onClick={alTocar} transition={SUAVE} aria-label={`Abrir ${c.nombre}`} style={estiloCasilla(celda.casilla)}
            className={cn("relative min-h-0 rounded-[10px] overflow-hidden bg-neutral-950 text-left", tocable,
                alerta ? "ring-4 ring-[var(--mal)]" : destello ? (okDestello ? "ring-4 ring-[var(--bien)]" : "ring-4 ring-[var(--mal)]") : "ring-1 ring-white/10")}>
            {caido ? (
                <span className="absolute inset-0 grid place-items-center text-white/45">
                    <span className="flex flex-col items-center gap-2"><VideoOff size={grande ? 36 : 26} /><span className="text-[13px] font-semibold">Sin señal en el NVR</span></span>
                </span>
            ) : modo === "foto" ? (
                foto ? <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-cover" /> : null
            ) : (
                <Vivo src={vivoDe(c.stream, modo === "convertido")} alResultado={(ok) => alResultado(c, modo, ok)} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {c.geom && !caido && <Geometria geom={c.geom} alerta={!!alerta} ajuste="cover" />}

            <div className="absolute top-0 inset-x-0 px-3 pt-2 pb-6 bg-gradient-to-b from-black/75 to-transparent flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className={cn("font-bold text-white leading-tight truncate", grande ? "text-[18px]" : "text-[14px]")}>{c.nombre}</div>
                    <div className="text-[11.5px] text-white/65 inline-flex items-center gap-1 truncate max-w-full">{c.nvr && <Server size={10} />} {ubicacion(c)}</div>
                </div>
                {c.funcion && (
                    <span title={c.funcion === "lpr" ? "Lee matrículas" : "Vigila una línea o una zona"} className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white/80 shrink-0">
                        {c.funcion === "lpr" ? <Car size={14} /> : <ShieldAlert size={14} />}
                    </span>
                )}
            </div>

            <div className="absolute bottom-2 left-2 right-2 flex items-end gap-2">
                <div className="min-w-0 flex-1 flex flex-col items-start gap-1">
                    {alerta && m && (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold pleno-mal max-w-full truncate"><m.Icon size={13} /> {m.label} · <span className="tabular-nums">{horaCorta(alerta.ts)}</span></span>
                    )}
                    {ult && c.ultima && (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold bg-black/60 text-white/75 max-w-full truncate"><ult.Icon size={12} /> {ult.label} · {hace(c.ultima.ts)}</span>
                    )}
                    {lecturas.slice(0, grande ? CHAPAS_GRANDE : CHAPAS_CHICA).map((l) => <ChapaMini key={l.id} l={l} nueva={destello?.id === l.id} />)}
                </div>
                {!caido && (
                    <span title={r.titulo} className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white/75 shrink-0">
                        {r.Ic ? <r.Ic size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--mal)]" />} {r.t}
                    </span>
                )}
            </div>
        </motion.button>
    );
}

export function VistaCamaras() {
    const { latir, setTitulo } = useMarco();
    usarReloj(5000);
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/camaras", INTERVALO_MS, latir);

    // Lo que sabe este navegador y cómo quiere ver esta ventana. null = primer render (servidor).
    const [h265, setH265] = useState<boolean | null>(null);
    const [prefs, setPrefsState] = useState<Prefs | null>(null);
    const [canalSolo, setCanalSolo] = useState<string | null>(null);
    useEffect(() => { setH265(reproduceH265()); const l = leerPrefs(); setPrefsState(l.prefs); setCanalSolo(l.canalSolo); }, []);
    const setPrefs = useCallback((cambio: Partial<Prefs>) => setPrefsState((p) => {
        const n = { ...(p || PREFS_INICIALES), ...cambio };
        try { localStorage.setItem(clavePrefs(PREFS_BASE), JSON.stringify(n)); } catch { }
        return n;
    }), []);

    // Cuántos vivos arrancaron y cuántos no, por canal y modo: la prueba de verdad.
    const [resultados, setResultados] = useState<Record<string, boolean>>({});
    const alResultado = useCallback((c: Canal, modo: Modo, ok: boolean) => setResultados((r) => { const k = `${c.clave}|${modo}`; return r[k] === ok ? r : { ...r, [k]: ok }; }), []);

    // Lo que llega por el socket, sin esperar la próxima vuelta.
    const [alertasVivas, setAlertasVivas] = useState<Record<string, Alerta>>({});
    const [lecturasVivas, setLecturasVivas] = useState<Record<string, Lectura[]>>({});
    const [destellos, setDestellos] = useState<Record<string, Lectura>>({});
    useTiempoReal("general_detection", (d: any) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setAlertasVivas((p) => ({ ...p, [d.deviceId]: { id: d.id, tipo: d.type, ts: d.timestamp || new Date().toISOString() } }));
        latir();
        // Si quien avisó es un NVR (canal sin mapear), el canal lo resuelve la consulta.
        setTimeout(recargar, 1500);
    });
    useTiempoReal("access_event", (e: any) => {
        const dev = e?.deviceId || e?.device?.id;
        if (!e?.id || !dev) return;
        const l: Lectura = { id: e.id, ts: e.timestamp || new Date().toISOString(), plate: (e.plateDetected || e.plateNumber || "").toUpperCase() || null, decision: e.decision || "DENY", sentido: e.direction || "ENTRY", listaNegra: /lista negra/i.test(e.details || "") };
        setLecturasVivas((p) => ({ ...p, [dev]: [l, ...(p[dev] || []).filter((x) => x.id !== l.id)].slice(0, CHAPAS_GRANDE * 2) }));
        setDestellos((p) => ({ ...p, [dev]: l }));
        setTimeout(() => setDestellos((p) => { if (p[dev]?.id !== l.id) return p; const n = { ...p }; delete n[dev]; return n; }), DESTELLO_MS);
        latir();
    });
    const ventana = datos?.ventanaAlertaMs || 120_000;
    const alertaDe = useCallback((c: Canal): Alerta | null => {
        const viva = c.equipoId ? alertasVivas[c.equipoId] : undefined;
        const a = [c.alerta, viva].filter(Boolean).sort((x, y) => +new Date(y!.ts) - +new Date(x!.ts))[0] || null;
        return a && Date.now() - +new Date(a.ts) < ventana ? a : null;
    }, [alertasVivas, ventana]);
    const lecturasDe = useCallback((c: Canal): Lectura[] => {
        if (c.funcion !== "lpr" && !(c.equipoId && lecturasVivas[c.equipoId])) return [];
        const vivas = c.equipoId ? lecturasVivas[c.equipoId] || [] : [];
        const ids = new Set(vivas.map((x) => x.id));
        return [...vivas, ...c.lecturas.filter((x) => !ids.has(x.id))];
    }, [lecturasVivas]);

    const todos = datos?.canales || [];
    const porClave = useMemo(() => new Map(todos.map((c) => [c.clave, c])), [todos]);
    const nvrs = useMemo(() => [...new Set(todos.map(grupoDe))], [todos]);
    const guardada = prefs && prefs.vista !== AUTO ? datos?.vistas.find((v) => v.id === prefs.vista) || null : null;
    const modoVista: "solo" | "guardada" | "auto" = canalSolo ? "solo" : guardada ? "guardada" : "auto";
    const disp = disposicionDe(modoVista === "solo" ? "1" : guardada ? guardada.disposicion : prefs?.disposicion);
    const filtro = prefs?.nvr && (prefs.nvr === "todos" || nvrs.includes(prefs.nvr)) ? prefs.nvr : "todos";

    // Automática: las que detectan van primero (a la casilla grande, si hay); el resto en el orden del NVR.
    const ordenados = useMemo(() => {
        const f = todos.filter((c) => filtro === "todos" || grupoDe(c) === filtro);
        const con = f.filter((c) => alertaDe(c)).sort((a, b) => +new Date(alertaDe(b)!.ts) - +new Date(alertaDe(a)!.ts));
        return [...con, ...f.filter((c) => !alertaDe(c))];
    }, [todos, filtro, alertaDe]);
    const porPagina = disp.casillas.length;
    const paginas = modoVista === "auto" ? Math.max(1, Math.ceil(ordenados.length / porPagina)) : 1;
    const [pagina, setPagina] = useState(0);
    const hayAlerta = ordenados.some((c) => alertaDe(c));
    const pausada = !!prefs?.pausa;
    useEffect(() => { if (hayAlerta) setPagina(0); }, [hayAlerta]);
    useEffect(() => {
        if (modoVista !== "auto" || paginas <= 1 || pausada || hayAlerta) return;
        const iv = setInterval(() => setPagina((p) => (p + 1) % paginas), (prefs?.pagSeg || 20) * 1000);
        return () => clearInterval(iv);
    }, [modoVista, paginas, pausada, hayAlerta, prefs?.pagSeg]);
    const pag = Math.min(pagina, paginas - 1);

    const celdas: Celda[] = useMemo(() => {
        if (modoVista === "solo") return [{ casilla: disp.casillas[0], canal: porClave.get(canalSolo!) || null, claveFaltante: canalSolo }];
        if (modoVista === "guardada") return disp.casillas.map((casilla, i) => { const k = guardada!.canales[i]; return { casilla, canal: k ? porClave.get(k) || null : null, claveFaltante: k }; });
        const lista = ordenados.slice(pag * porPagina, pag * porPagina + porPagina);
        return disp.casillas.map((casilla, i) => ({ casilla, canal: lista[i] || null }));
    }, [modoVista, disp, porClave, canalSolo, guardada, ordenados, pag, porPagina]);
    const enPantalla = celdas.map((x) => x.canal).filter(Boolean) as Canal[];

    useEffect(() => {
        setTitulo(modoVista === "solo" ? (porClave.get(canalSolo!)?.nombre || "Cámara") : guardada ? `Cámaras · ${guardada.nombre}` : "Cámaras");
    }, [setTitulo, modoVista, guardada, canalSolo, porClave]);

    // Qué es cada baldosa: directo si el navegador puede (y ese canal no falló); si no, las
    // primeras MAX_CONVERTIDOS van convertidas —las grandes primero— y el resto es foto.
    const modos = useMemo(() => {
        const m = new Map<string, Modo>();
        let convertidos = 0;
        const orden = [...celdas].filter((x) => x.canal).sort((a, b) => b.casilla.w - a.casilla.w);
        for (const { canal: c } of orden) {
            if (!c) continue;
            if (h265 && resultados[`${c.clave}|directo`] !== false) { m.set(c.clave, "directo"); continue; }
            if (convertidos < MAX_CONVERTIDOS && c.online !== false && resultados[`${c.clave}|convertido`] !== false) { m.set(c.clave, "convertido"); convertidos++; continue; }
            m.set(c.clave, "foto");
        }
        return m;
    }, [celdas, h265, resultados]);

    const directos = Object.entries(resultados).filter(([k]) => k.endsWith("|directo")).map(([, v]) => v);
    const directosOk = directos.filter(Boolean).length;
    const directosMal = directos.filter((x) => !x).length;

    // La ficha a pantalla completa, por clave (así se actualiza con cada vuelta de datos).
    const [abiertaClave, setAbiertaClave] = useState<string | null>(null);
    const abierta = abiertaClave ? porClave.get(abiertaClave) || null : null;
    const mover = useCallback((paso: 1 | -1) => {
        if (!abiertaClave || !enPantalla.length) return;
        const i = enPantalla.findIndex((c) => c.clave === abiertaClave);
        setAbiertaClave(enPantalla[(i + paso + enPantalla.length) % enPantalla.length].clave);
    }, [abiertaClave, enPantalla]);

    // Menús de la barra.
    const [menu, setMenu] = useState<null | "vista" | "disposicion" | "nvr" | "paginas" | "ventanas">(null);
    const cerrarMenu = useCallback(() => setMenu(null), []);
    const alternar = (m: NonNullable<typeof menu>) => setMenu((x) => (x === m ? null : m));
    const [editando, setEditando] = useState<VistaGuardada | null>(null);
    const [pantallas, setPantallas] = useState<Pantalla[] | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t); }, [aviso]);

    const paramsVista = (): Record<string, string> => modoVista === "solo" ? { canal: canalSolo! } : guardada ? { vista: guardada.id } : { vista: AUTO, disposicion: disp.clave };
    const nombreVentana = () => (modoVista === "solo" ? `canal-${canalSolo}` : guardada ? `vista-${guardada.id}` : `auto-${Date.now().toString(36)}`);
    const desacoplar = (pantalla?: Pantalla | null) => {
        if (!abrirVentana(paramsVista(), nombreVentana(), pantalla)) setAviso("El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio y probá de nuevo.");
        setMenu(null);
    };
    const detectarPantallas = async () => {
        const p = await listarPantallas();
        if (!p) setAviso("El navegador no dio acceso a los monitores. Abrí la ventana común y arrastrala al otro monitor.");
        setPantallas(p);
    };

    if (editando) {
        return (
            <EditorVista inicial={editando} canales={todos} alSalir={(r) => {
                setEditando(null);
                if (r === "borrada") setPrefs({ vista: AUTO });
                else if (r) setPrefs({ vista: r.id });
                recargar();
            }} />
        );
    }

    const nombreVista = modoVista === "solo" ? (porClave.get(canalSolo!)?.nombre || "Una cámara") : guardada ? guardada.nombre : filtro === "todos" ? "Todas las cámaras" : filtro;

    return (
        <div className="absolute inset-0 flex flex-col gap-2.5 p-3">
            <LiveEdgeKeeper />
            {/* La barra: qué se mira y cómo, a la izquierda; lo que cuesta y las ventanas, a la derecha. */}
            <div className="shrink-0 flex items-center gap-1.5">
                {modoVista !== "solo" && (<>
                    <div className="relative">
                        <BotonBarra onClick={() => alternar("vista")} activo={menu === "vista"} titulo="Elegir o diseñar una vista">
                            <LayoutGrid size={15} className="text-muted-foreground" /> <span className="max-w-[220px] truncate">{nombreVista}</span> <ChevronDown size={14} className="text-muted-foreground" />
                        </BotonBarra>
                        <Flotante abierto={menu === "vista"} alCerrar={cerrarMenu} className="w-[300px]">
                            <OpcionMenu onClick={() => { setPrefs({ vista: AUTO }); setPagina(0); setMenu(null); }} elegida={modoVista === "auto"}>
                                <LayoutGrid size={16} className="text-muted-foreground" /> <span className="flex-1">Automática <span className="text-muted-foreground font-normal">· todos los canales, por páginas</span></span>
                            </OpcionMenu>
                            {(datos?.vistas || []).length > 0 && <div className="my-1 h-px bg-border" />}
                            {(datos?.vistas || []).map((v) => (
                                <OpcionMenu key={v.id} onClick={() => { setPrefs({ vista: v.id }); setMenu(null); }} elegida={guardada?.id === v.id}>
                                    <Glifo d={disposicionDe(v.disposicion)} tam={20} className="text-muted-foreground shrink-0" />
                                    <span className="truncate">{v.nombre}</span>
                                    <span className="text-[12px] text-muted-foreground tabular-nums">{v.canales.filter(Boolean).length}</span>
                                </OpcionMenu>
                            ))}
                            {datos?.puedeEditar && (<>
                                <div className="my-1 h-px bg-border" />
                                {guardada && <OpcionMenu onClick={() => { setEditando(guardada); setMenu(null); }}><Pencil size={15} className="text-muted-foreground" /> Editar «{guardada.nombre}»</OpcionMenu>}
                                <OpcionMenu onClick={() => {
                                    const d = disposicionDe(modoVista === "auto" ? disp.clave : DISPOSICION_POR_DEFECTO);
                                    // Arranca con lo que se está viendo: casi siempre se diseña a partir de eso.
                                    setEditando({ id: "", nombre: "", disposicion: d.clave, canales: d.casillas.map((_, i) => (modoVista === "auto" ? celdas[i]?.canal?.clave : null) || null) });
                                    setMenu(null);
                                }}><Plus size={15} className="text-muted-foreground" /> Nueva vista</OpcionMenu>
                            </>)}
                            {datos && !datos.puedeEditar && <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Diseñar vistas pide entrar al panel con el permiso Monitores.</p>}
                        </Flotante>
                    </div>

                    {modoVista === "auto" && (<>
                        <div className="relative">
                            <BotonBarra onClick={() => alternar("disposicion")} activo={menu === "disposicion"} titulo="Cómo se divide la pantalla">
                                <Glifo d={disp} tam={22} /> <span className="tabular-nums">{disp.casillas.length}</span> <ChevronDown size={14} className="text-muted-foreground" />
                            </BotonBarra>
                            <Flotante abierto={menu === "disposicion"} alCerrar={cerrarMenu} className="w-[264px]">
                                <div className="grid grid-cols-3 gap-1">
                                    {DISPOSICIONES.map((d) => (
                                        <button key={d.clave} type="button" onClick={() => { setPrefs({ disposicion: d.clave }); setPagina(0); setMenu(null); }} aria-pressed={disp.clave === d.clave}
                                            className={cn("flex flex-col items-center gap-1.5 rounded-[8px] py-2.5 transition-colors",
                                                disp.clave === d.clave ? "bg-[color-mix(in_oklab,var(--accion-en-oscuro)_20%,transparent)] text-[var(--accion-en-oscuro)]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                                            <Glifo d={d} tam={34} />
                                            <span className="text-[11px] font-semibold">{d.nombre}</span>
                                        </button>
                                    ))}
                                </div>
                            </Flotante>
                        </div>
                        {nvrs.length > 1 && (
                            <div className="relative">
                                <BotonBarra onClick={() => alternar("nvr")} activo={menu === "nvr"} titulo="Mostrar los canales de un solo grabador">
                                    <Server size={15} className="text-muted-foreground" /> {filtro === "todos" ? "Todos los NVR" : filtro} <ChevronDown size={14} className="text-muted-foreground" />
                                </BotonBarra>
                                <Flotante abierto={menu === "nvr"} alCerrar={cerrarMenu} className="w-[240px]">
                                    {["todos", ...nvrs].map((n) => (
                                        <OpcionMenu key={n} onClick={() => { setPrefs({ nvr: n }); setPagina(0); setMenu(null); }} elegida={filtro === n}>
                                            <span className="flex-1 truncate">{n === "todos" ? "Todos los NVR" : n}</span>
                                            <span className="text-[12px] text-muted-foreground tabular-nums">{n === "todos" ? todos.length : todos.filter((c) => grupoDe(c) === n).length}</span>
                                        </OpcionMenu>
                                    ))}
                                </Flotante>
                            </div>
                        )}
                        {paginas > 1 && (
                            <div className="relative flex items-center gap-1">
                                <BotonBarra onClick={() => setPagina((p) => (p - 1 + paginas) % paginas)} titulo="Página anterior" className="px-2"><ChevronLeft size={16} /></BotonBarra>
                                <BotonBarra onClick={() => alternar("paginas")} activo={menu === "paginas"} titulo="Cada cuánto pasa de página">
                                    <span className="tabular-nums">{pag + 1}/{paginas}</span>
                                    <span className="inline-flex items-center gap-1 text-muted-foreground font-normal"><Timer size={13} /> {pausada ? "fija" : hayAlerta ? "fija por detección" : `${prefs?.pagSeg || 20} s`}</span>
                                </BotonBarra>
                                <BotonBarra onClick={() => setPagina((p) => (p + 1) % paginas)} titulo="Página siguiente" className="px-2"><ChevronRight size={16} /></BotonBarra>
                                <Flotante abierto={menu === "paginas"} alCerrar={cerrarMenu} className="w-[200px] left-9">
                                    <OpcionMenu onClick={() => { setPrefs({ pausa: true }); setMenu(null); }} elegida={pausada}>Quedarse en esta página</OpcionMenu>
                                    {PAGINA_SEG.map((s) => <OpcionMenu key={s} onClick={() => { setPrefs({ pausa: false, pagSeg: s }); setMenu(null); }} elegida={!pausada && prefs?.pagSeg === s}>Pasar cada {s} s</OpcionMenu>)}
                                </Flotante>
                            </div>
                        )}
                    </>)}
                </>)}

                <div className="ml-auto flex items-center gap-1.5 min-w-0">
                    <Recursos h265={h265} directosOk={directosOk} directosMal={directosMal} />
                    <div className="relative shrink-0">
                        <BotonBarra onClick={() => alternar("ventanas")} activo={menu === "ventanas"} titulo="Desacoplar esta vista en otra ventana, para otro monitor">
                            <AppWindow size={16} /> <span className="hidden xl:inline">Ventanas</span>
                        </BotonBarra>
                        <Flotante abierto={menu === "ventanas"} alCerrar={cerrarMenu} lado="derecha" className="w-[300px]">
                            <OpcionMenu onClick={() => desacoplar(null)}><AppWindow size={15} className="text-muted-foreground" /> Abrir «{nombreVista}» en otra ventana</OpcionMenu>
                            {hayVariasPantallasApi() && (<>
                                <div className="my-1 h-px bg-border" />
                                {!pantallas ? (
                                    <OpcionMenu onClick={detectarPantallas}><Monitor size={15} className="text-muted-foreground" /> Detectar los monitores</OpcionMenu>
                                ) : pantallas.map((p) => (
                                    <OpcionMenu key={p.id} onClick={() => desacoplar(p)}>
                                        <Monitor size={15} className="text-muted-foreground" />
                                        <span className="flex-1 truncate">Abrir en {p.nombre}{p.principal ? " (principal)" : ""}</span>
                                        <span className="text-[11px] text-muted-foreground tabular-nums">{p.width}×{p.height}</span>
                                    </OpcionMenu>
                                ))}
                            </>)}
                            <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Cada ventana guarda su vista y su disposición. En la ventana nueva, el primer toque la pone en pantalla completa.</p>
                        </Flotante>
                    </div>
                </div>
            </div>

            {aviso && <div className="shrink-0 rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">{aviso}</div>}
            {datos?.errores?.length ? (
                <div className="shrink-0 rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">
                    {datos.errores.map((e) => `${e.nvr}: no se pudieron leer sus canales (${e.error})`).join(" · ")}
                </div>
            ) : null}
            {datos && !datos.go2rtc && (
                <div className="shrink-0 rounded-[10px] chip-mal border px-3 py-2 text-[13px]">El servidor de video (go2rtc) no responde: los vivos no van a abrir.</div>
            )}
            {!canalSolo && prefs && prefs.vista !== AUTO && !guardada && datos && (
                <div className="shrink-0 rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">Esa vista ya no existe: se muestra la automática.</div>
            )}

            <div className="flex-1 min-h-0 grid gap-2" style={{ gridTemplateColumns: `repeat(${disp.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${disp.filas}, minmax(0, 1fr))` }}>
                {!datos && !error && <div className="col-span-full row-span-full grid place-items-center text-[18px] text-muted-foreground"><Loader2 className="animate-spin" /></div>}
                {error && !datos && (
                    <div className="col-span-full row-span-full grid place-items-center text-center">
                        <div>
                            <div className="text-[18px] text-[var(--mal-texto)]">No se pudo leer la lista de canales: {error}</div>
                            <button type="button" onClick={recargar} className={cn("mt-3 h-11 px-4 rounded-[6px] bg-[var(--accion)] text-white font-semibold", tocable)}>Reintentar</button>
                        </div>
                    </div>
                )}
                {datos && todos.length === 0 && <div className="col-span-full row-span-full grid place-items-center text-[18px] text-muted-foreground">No hay canales para mostrar.</div>}
                {datos && h265 !== null && todos.length > 0 && celdas.map((celda, i) => (
                    <Baldosa key={celda.canal?.clave || `vacia-${i}`} celda={celda} modo={celda.canal ? modos.get(celda.canal.clave) || "foto" : "foto"}
                        alerta={celda.canal ? alertaDe(celda.canal) : null} lecturas={celda.canal ? lecturasDe(celda.canal) : []}
                        destello={celda.canal?.equipoId ? destellos[celda.canal.equipoId] || null : null}
                        alTocar={() => celda.canal && setAbiertaClave(celda.canal.clave)} alResultado={alResultado} />
                ))}
            </div>

            <FichaCanal c={abierta} h265={!!h265 && (abierta ? resultados[`${abierta.clave}|directo`] !== false : true)}
                alerta={abierta ? alertaDe(abierta) : null} lecturas={abierta ? lecturasDe(abierta) : []}
                alCerrar={() => setAbiertaClave(null)} alMover={enPantalla.length > 1 ? mover : null}
                alVentana={abierta ? () => { if (!abrirVentana({ canal: abierta.clave }, `canal-${abierta.clave}`, null)) setAviso("El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio."); } : undefined} />
        </div>
    );
}
