"use client";

// Panel de administración del motor de rostros (CompreFace) — estilo "manejo de LPR".
// A todo el ancho, con la fila de recursos que contesta "¿anda?" (motor, GPU, padrón,
// cámaras faciales, capturas), el padrón CON LAS CARAS, el selector de cámaras faciales
// (para capturar rostros con las cámaras de IES), el umbral y la prueba de reconocer.
//
// Diseño (claude/DESIGN.md): la captura es el producto → las CARAS son el foco y lo único
// con sombra (--sombra-captura). Un solo azul de acción; los tonos sólo dicen estado;
// jerarquía por superficie + línea, sin sombras en tarjetas. Fila de datos tomada del
// mismo patrón de TrackingSection (Omni-LPR).

import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import Link from "next/link";
import {
    ScanFace, RefreshCcw, Trash2, Upload, Loader2, CheckCircle2, AlertTriangle,
    Users, SlidersHorizontal, Eraser, UserX, ArrowRight, Zap, Camera, Power,
    MonitorPlay, Check, Video, ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sileo as toast } from "sileo";
import { getImagePath } from "@/lib/image-path";
import { cn } from "@/lib/utils";
import {
    testCompareFaceConnection, deleteCompareFaceSubject, clearAllVisitorFaces,
    recognizeTestAction, getFaceUmbral, setFaceUmbral, getPadronEnriquecido,
    getEstadoMotorFace, getCamarasParaFace, setFaceCamaras, setModuloFace,
} from "@/app/actions/face-admin";

type Conn = { estado: "cargando" | "ok" | "error"; count?: number; error?: string };
type ItemPadron = { subject: string; userId: string | null; cara: string | null; role: string | null; matched: boolean };
type EstadoFace = Awaited<ReturnType<typeof getEstadoMotorFace>>;
type CamFace = { id: string; name: string; tipo: string; facial: boolean };
type Gpu = { hay: boolean; uso?: number; watts?: number | null; temp?: number | null; memUsada?: number; memTotal?: number; enGpu?: boolean | null };

const CAPTURA = "var(--sombra-captura)";

function tonoRol(role: string | null): { label: string; texto: string; suave: string } | null {
    if (!role) return null;
    if (role === "BLACKLISTED") return { label: "Restringido", texto: "var(--mal-texto,#b91c1c)", suave: "var(--mal-suave,rgba(220,38,38,.12))" };
    if (role === "WHITELISTED") return { label: "Especial", texto: "var(--info-texto,#1d4ed8)", suave: "var(--info-suave,rgba(37,99,235,.12))" };
    return { label: "Estándar", texto: "var(--quieto-texto,#6d28d9)", suave: "var(--quieto-suave,rgba(124,58,237,.12))" };
}
function haceCuanto(iso: string | null): string {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
    return `hace ${Math.floor(s / 86400)}d`;
}

export default function MotorRostrosSection() {
    const [conn, setConn] = useState<Conn>({ estado: "cargando" });
    const [est, setEst] = useState<EstadoFace | null>(null);
    const [gpu, setGpu] = useState<Gpu | null>(null);
    const [items, setItems] = useState<ItemPadron[] | null>(null);
    const [padronError, setPadronError] = useState<string | null>(null);
    const [borrando, setBorrando] = useState<string | null>(null);
    const [vaciando, setVaciando] = useState(false);
    const [umbral, setUmbral] = useState<number>(0.89);
    const [umbralGuardando, setUmbralGuardando] = useState(false);
    const [moduloBusy, setModuloBusy] = useState(false);

    const cargarEstado = useCallback(async () => {
        setConn({ estado: "cargando" });
        const [r, e] = await Promise.all([testCompareFaceConnection(), getEstadoMotorFace()]);
        setConn(r.success ? { estado: "ok", count: r.subjectsCount } : { estado: "error", error: r.error });
        setEst(e);
    }, []);
    const cargarPadron = useCallback(async () => {
        setPadronError(null); setItems(null);
        const r = await getPadronEnriquecido();
        if (r.success) setItems(r.items as ItemPadron[]); else setPadronError(r.error || "No se pudo leer el padrón");
    }, []);
    const cargarGpu = useCallback(async () => {
        try { const { data } = await axios.get("/api/gpu/vivo"); setGpu(data); } catch { setGpu({ hay: false }); }
    }, []);

    useEffect(() => {
        cargarEstado(); cargarPadron(); cargarGpu();
        getFaceUmbral().then(setUmbral).catch(() => {});
        const t = setInterval(() => { cargarGpu(); cargarEstado(); }, 15000);
        return () => clearInterval(t);
    }, [cargarEstado, cargarPadron, cargarGpu]);

    const borrarSujeto = async (s: string) => {
        setBorrando(s);
        const r = await deleteCompareFaceSubject(s); setBorrando(null);
        if (r.success) { toast.success({ title: `Borrado: ${s}` }); cargarPadron(); cargarEstado(); }
        else toast.error({ title: "No se pudo borrar" });
    };
    const vaciarPadron = async () => {
        if (!confirm("¿Vaciar el padrón completo del motor? Borra TODOS los rostros enrolados (incluidos los famosos del demo). No se puede deshacer.")) return;
        setVaciando(true);
        const r = await clearAllVisitorFaces(); setVaciando(false);
        if (r.success) { toast.success({ title: "Padrón vaciado", description: r.message }); cargarPadron(); cargarEstado(); }
        else toast.error({ title: "No se pudo vaciar" });
    };
    const guardarUmbral = async () => {
        setUmbralGuardando(true);
        const r = await setFaceUmbral(umbral); setUmbralGuardando(false);
        if (r.success) { setUmbral(r.value); toast.success({ title: `Umbral: ${r.value}` }); }
    };
    const toggleModulo = async () => {
        if (!est) return;
        setModuloBusy(true);
        const r = await setModuloFace(!est.moduloFace); setModuloBusy(false);
        if (r.success) { toast.success({ title: r.on ? "Modo face prendido" : "Modo face apagado" }); cargarEstado(); }
    };

    const demoCount = items?.filter(i => !i.matched).length || 0;
    const gpuVal = gpu?.hay ? (gpu.watts != null ? `${Math.round(gpu.watts)} W` : `${Math.round(gpu.uso || 0)} %`) : "—";
    const gpuPie = gpu?.hay
        ? `${gpu.enGpu === false ? "motor en CPU · " : ""}${Math.round(gpu.uso || 0)}% · ${gpu.memTotal ? `${((gpu.memUsada || 0) / 1024).toFixed(1)}/${(gpu.memTotal / 1024).toFixed(0)} GB` : ""}${gpu.temp != null ? ` · ${gpu.temp}°C` : ""}`
        : (gpu ? "sin GPU / driver" : "midiendo…");

    return (
        <div className="space-y-6">
            {/* ── Encabezado + pastilla de estado + acciones ── */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[10px] bg-card border border-border flex items-center justify-center">
                        <ScanFace size={20} className="text-[color:var(--accion)]" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h2 className="text-[20px] font-bold tracking-[-0.015em] leading-[1.2] text-foreground">Motor de rostros</h2>
                            <Pastilla conn={conn} modulo={est?.moduloFace} />
                        </div>
                        <p className="text-[12.5px] text-muted-foreground">CompreFace reconociendo rostros del modo face. Se administra acá, sin entrar al contenedor.</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
                    <IconoAccion titulo={est?.moduloFace ? "Apagar el modo face" : "Prender el modo face"} onClick={toggleModulo} ocupado={moduloBusy} activo={est?.moduloFace}>
                        <Power size={14} />
                    </IconoAccion>
                    <Link href="/monitor/face" className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Abrir el monitor de rostros en vivo">
                        <MonitorPlay size={14} />
                    </Link>
                    <span className="w-px h-4 bg-border mx-0.5" />
                    <IconoAccion titulo="Actualizar" onClick={() => { cargarEstado(); cargarPadron(); cargarGpu(); }} ocupado={conn.estado === "cargando"}>
                        <RefreshCcw size={14} />
                    </IconoAccion>
                </div>
            </div>

            {/* ── Los datos que contestan "¿anda?" ── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-3 rounded-[10px] border border-border bg-card px-5 py-4">
                <Dato rotulo="Motor"
                    valor={conn.estado === "ok" ? "Conectado" : conn.estado === "error" ? "Sin conexión" : "…"}
                    tono={conn.estado === "error" ? "text-[color:var(--mal-texto,#b91c1c)]" : conn.estado === "ok" ? "text-[color:var(--bien-texto,#15803d)]" : undefined}
                    pie="CompreFace" />
                <Dato rotulo="GPU" valor={gpuVal} tono={gpu?.enGpu === false ? "text-[color:var(--aviso-texto,#b45309)]" : undefined} pie={gpuPie} />
                <Dato rotulo="Padrón" valor={String(conn.count ?? est?.camarasCount ?? "—")} pie={`${items?.filter(i => i.matched).length ?? 0} con usuario`} />
                <Dato rotulo="Cámaras faciales" valor={String(est?.camarasCount ?? 0)} pie={est?.camaras?.length ? est.camaras.join(", ") : "ninguna elegida"} />
                <Dato rotulo="Rostros hoy" valor={String(est?.rostrosHoy ?? 0)}
                    pie={est?.ultimoRostro ? `último ${haceCuanto(est.ultimoRostro.cuando)}` : "sin capturas hoy"} />
            </div>

            {/* ── Padrón (2/3) + columna derecha (umbral + cámaras) ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
                {/* Padrón con caras */}
                <section className="space-y-3 min-w-0">
                    <div className="flex items-center justify-between">
                        <Rotulo icon={<Users size={13} />}>Padrón enrolado</Rotulo>
                        {items && items.length > 0 && (
                            <Button size="sm" variant="outline" onClick={vaciarPadron} disabled={vaciando}
                                className="h-8 text-[12px] gap-1.5 text-[color:var(--mal-texto,#b91c1c)] border-[color:var(--mal-texto,#b91c1c)]/25 hover:bg-[color:var(--mal-suave,rgba(220,38,38,.1))]">
                                {vaciando ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}
                                {demoCount > 0 ? `Vaciar (${demoCount} del demo)` : "Vaciar padrón"}
                            </Button>
                        )}
                    </div>
                    <div className="rounded-[10px] border border-border bg-card p-4 min-h-[180px]">
                        {items === null && !padronError && (
                            <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Cargando padrón…</div>
                        )}
                        {padronError && (
                            <div className="flex items-center gap-2 text-[13px] py-10 justify-center">
                                <AlertTriangle size={15} className="text-[color:var(--mal-texto,#b91c1c)]" />
                                <span className="text-muted-foreground">{padronError}</span>
                                <Button size="sm" variant="outline" onClick={cargarPadron} className="h-7 text-[12px]">Reintentar</Button>
                            </div>
                        )}
                        {items && items.length === 0 && (
                            <div className="text-[13px] text-muted-foreground py-12 text-center">
                                El padrón está vacío.<br />Enrolá rostros desde la ficha de un usuario o el registro de rostros.
                            </div>
                        )}
                        {items && items.length > 0 && (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-5">
                                {items.map((it) => (
                                    <CaraCard key={it.subject} item={it} borrando={borrando === it.subject} onBorrar={() => borrarSujeto(it.subject)} />
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* Columna derecha */}
                <div className="space-y-6">
                    {/* Umbral */}
                    <section className="space-y-3">
                        <Rotulo icon={<SlidersHorizontal size={13} />}>Umbral de identidad</Rotulo>
                        <div className="rounded-[10px] border border-border bg-card p-4">
                            <p className="text-[12.5px] text-muted-foreground leading-[1.5]">
                                Similitud mínima (0–1) para que cuente como identidad. Medido en el lab:
                                {" "}<span className="tabular-nums font-semibold text-foreground">~0.89</span>. Por debajo, el acceso queda “desconocido”.
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                                <Input type="number" step="0.01" min="0.5" max="0.99" value={umbral}
                                    onChange={(e) => setUmbral(parseFloat(e.target.value))} className="w-24 tabular-nums font-semibold" />
                                <Button size="sm" onClick={guardarUmbral} disabled={umbralGuardando}>
                                    {umbralGuardando ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* Cámaras faciales */}
                    <CamarasFaciales onCambio={cargarEstado} />
                </div>
            </div>

            {/* ── Probar reconocer (todo el ancho) ── */}
            <ProbarReconocer umbral={umbral} />
        </div>
    );
}

function Pastilla({ conn, modulo }: { conn: Conn; modulo?: boolean }) {
    const base = "px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5";
    if (conn.estado === "cargando") return <span className={cn(base, "text-muted-foreground bg-muted")}><Loader2 size={11} className="animate-spin" /> consultando</span>;
    if (conn.estado === "error") return <span className={base} style={{ color: "var(--mal-texto,#b91c1c)", background: "var(--mal-suave,rgba(220,38,38,.12))" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--mal,#dc2626)" }} />sin conexión</span>;
    return (
        <span className={base} style={{ color: modulo ? "var(--bien-texto,#15803d)" : "var(--quieto-texto,#6d28d9)", background: modulo ? "var(--bien-suave,rgba(22,163,74,.12))" : "var(--quieto-suave,rgba(124,58,237,.12))" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: modulo ? "var(--bien,#16a34a)" : "var(--quieto,#7c3aed)" }} />
            {modulo ? "modo face activo" : "conectado · face apagado"}
        </span>
    );
}

function IconoAccion({ children, titulo, onClick, ocupado, activo }: { children: React.ReactNode; titulo: string; onClick: () => void; ocupado?: boolean; activo?: boolean }) {
    return (
        <button onClick={onClick} disabled={ocupado} title={titulo}
            className={cn("w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-50",
                activo ? "text-[color:var(--accion)] bg-[color:var(--accion)]/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
            {ocupado ? <Loader2 size={13} className="animate-spin" /> : children}
        </button>
    );
}

function Dato({ rotulo, valor, pie, tono }: { rotulo: string; valor: string; pie?: string; tono?: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rotulo}</div>
            <div className={cn("text-xl font-bold tabular-nums mt-0.5 truncate", tono || "text-foreground")}>{valor}</div>
            {pie && <div className="text-[11px] text-muted-foreground truncate" title={pie}>{pie}</div>}
        </div>
    );
}

function CamarasFaciales({ onCambio }: { onCambio: () => void }) {
    const [cams, setCams] = useState<CamFace[] | null>(null);
    const [guardando, setGuardando] = useState<string | null>(null);
    const cargar = useCallback(async () => { try { setCams(await getCamarasParaFace()); } catch { setCams([]); } }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const toggle = async (c: CamFace) => {
        if (!cams) return;
        setGuardando(c.id);
        const nuevos = cams.filter(x => x.facial).map(x => x.id);
        const next = c.facial ? nuevos.filter(id => id !== c.id) : [...nuevos, c.id];
        const r = await setFaceCamaras(next);
        setGuardando(null);
        if (r.success) {
            setCams(cams.map(x => x.id === c.id ? { ...x, facial: !x.facial } : x));
            toast.success({ title: c.facial ? `${c.name} ya no es facial` : `${c.name} marcada facial` });
            onCambio();
        }
    };

    return (
        <section className="space-y-3">
            <Rotulo icon={<Video size={13} />}>Cámaras faciales</Rotulo>
            <div className="rounded-[10px] border border-border bg-card p-4">
                <p className="text-[12.5px] text-muted-foreground leading-[1.5]">Elegí qué cámaras capturan rostros. Conviene las de IES que miran caras de cerca; las de escena abierta no dan cara usable.</p>
                <div className="mt-3 max-h-64 overflow-y-auto -mx-1 px-1">
                    {cams === null && <div className="text-[13px] text-muted-foreground py-6 flex items-center gap-2 justify-center"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
                    {cams && cams.length === 0 && <div className="text-[13px] text-muted-foreground py-6 text-center">No hay cámaras.</div>}
                    {cams && cams.length > 0 && (
                        <ul className="space-y-1">
                            {cams.map((c) => (
                                <li key={c.id}>
                                    <button onClick={() => toggle(c)} disabled={guardando === c.id}
                                        className={cn("w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] border text-left transition-colors",
                                            c.facial ? "border-[color:var(--accion)]/40 bg-[color:var(--accion)]/[0.06]" : "border-border bg-background hover:bg-muted/50")}>
                                        <span className="min-w-0 flex items-center gap-2">
                                            <Camera size={13} className={c.facial ? "text-[color:var(--accion)]" : "text-muted-foreground"} />
                                            <span className="text-[13px] text-foreground truncate">{c.name}</span>
                                        </span>
                                        <span className="shrink-0 flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground tabular-nums">{c.tipo.replace(/_/g, " ").toLowerCase()}</span>
                                            <span className={cn("w-5 h-5 rounded-[6px] border flex items-center justify-center",
                                                c.facial ? "bg-[color:var(--accion)] border-[color:var(--accion)]" : "border-border")}>
                                                {guardando === c.id ? <Loader2 size={11} className="animate-spin text-muted-foreground" /> : c.facial ? <Check size={12} className="text-white" /> : null}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
}

function CaraCard({ item, borrando, onBorrar }: { item: ItemPadron; borrando: boolean; onBorrar: () => void }) {
    const url = getImagePath(item.cara);
    const rol = tonoRol(item.role);
    return (
        <div className="group">
            <div className="relative aspect-square rounded-[10px] overflow-hidden border border-border bg-muted" style={url ? { boxShadow: CAPTURA } : undefined}>
                {url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={url} alt={item.subject} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1"><UserX size={22} /><span className="text-[9px] font-bold uppercase tracking-[0.14em]">sin foto</span></div>}
                <button onClick={onBorrar} disabled={borrando}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-[6px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "var(--vidrio-oscuro,rgba(10,13,18,.8))", backdropFilter: "blur(4px)" }} title="Borrar del padrón">
                    {borrando ? <Loader2 size={13} className="animate-spin text-white" /> : <Trash2 size={13} className="text-white" />}
                </button>
            </div>
            <div className="mt-1.5"><span className="text-[13px] font-semibold text-foreground truncate block" title={item.subject}>{item.subject}</span></div>
            {rol
                ? <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold" style={{ color: rol.texto, background: rol.suave }}>{rol.label}</span>
                : <span className="inline-block mt-0.5 text-[10px] text-muted-foreground">no es usuario (demo)</span>}
        </div>
    );
}

function ProbarReconocer({ umbral }: { umbral: number }) {
    const [preview, setPreview] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [cargando, setCargando] = useState(false);
    const [res, setRes] = useState<{ caras: any[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const elegir = (f: File) => { setFile(f); setRes(null); setError(null); const r = new FileReader(); r.onloadend = () => setPreview(r.result as string); r.readAsDataURL(f); };
    const reconocer = async () => {
        if (!file) return;
        setCargando(true); setError(null); setRes(null);
        const fd = new FormData(); fd.append("photo", file);
        const r = await recognizeTestAction(fd); setCargando(false);
        if (r.success) setRes({ caras: r.caras }); else setError(r.error || "No se pudo reconocer");
    };

    return (
        <section className="space-y-3">
            <Rotulo icon={<ImageIcon size={13} />}>Probar reconocer</Rotulo>
            <div className="rounded-[10px] border border-border bg-card p-4">
                <p className="text-[12.5px] text-muted-foreground leading-[1.5]">Subí una foto y mirá qué reconoce contra el padrón. No toca la base de usuarios.</p>
                <div className="mt-3 flex flex-col sm:flex-row gap-5 items-start">
                    <div className="shrink-0">
                        <div onClick={() => inputRef.current?.click()}
                            className="w-44 h-44 rounded-[10px] border border-dashed border-border bg-background flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden relative"
                            style={preview ? { boxShadow: CAPTURA } : undefined}>
                            {preview
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={preview} alt="prueba" className="w-full h-full object-cover" />
                                : <div className="text-center text-muted-foreground"><Upload size={22} className="mx-auto mb-1.5" /><span className="text-[12px] font-semibold">Cargar foto</span></div>}
                        </div>
                        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && elegir(e.target.files[0])} />
                        <Button size="sm" onClick={reconocer} disabled={!file || cargando} className="w-44 mt-2 gap-2">
                            {cargando ? <><Loader2 size={14} className="animate-spin" /> Reconociendo…</> : "Reconocer"}
                        </Button>
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                        {!res && !error && !cargando && <div className="text-[13px] text-muted-foreground py-8 text-center border border-dashed border-border rounded-[10px]">El resultado aparece acá.</div>}
                        {error && <div className="text-[13px] py-6 flex items-center gap-2" style={{ color: "var(--mal-texto,#b91c1c)" }}><AlertTriangle size={15} />{error}</div>}
                        {res && res.caras.length === 0 && <div className="text-[13px] text-muted-foreground py-6 flex items-center gap-2"><AlertTriangle size={15} /> No se detectó ninguna cara en la foto.</div>}
                        {res && res.caras.map((c, i) => <ResultadoCara key={i} cara={c} idx={i} umbral={umbral} />)}
                    </div>
                </div>
            </div>
        </section>
    );
}

function ResultadoCara({ cara, idx, umbral }: { cara: any; idx: number; umbral: number }) {
    const best = cara.matches[0];
    if (!best) return <div className="text-[13px] text-muted-foreground py-3">Cara {idx + 1}: desconocido (sin match en el padrón)</div>;
    const pasa = best.similarity >= umbral;
    const col = pasa ? "var(--bien-texto,#15803d)" : "var(--aviso-texto,#b45309)";
    const url = getImagePath(cara.user?.cara);
    return (
        <div className="rounded-[10px] border border-border bg-background p-3 mb-3 flex items-center gap-4">
            <div className="w-16 h-16 shrink-0 rounded-[10px] overflow-hidden border border-border bg-muted flex items-center justify-center" style={url ? { boxShadow: CAPTURA } : undefined}>
                {url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={url} alt={best.subject} className="w-full h-full object-cover" />
                    : <UserX size={20} className="text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {pasa ? <CheckCircle2 size={16} style={{ color: col }} /> : <AlertTriangle size={16} style={{ color: col }} />}
                    <span className="text-[13px] font-semibold text-foreground truncate">{best.subject}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: col }}>{(best.similarity * 100).toFixed(1)}%</span>
                    <span className="text-[12px] font-semibold" style={{ color: col }}>{pasa ? "supera el umbral" : "por debajo → desconocido"}</span>
                </div>
                {cara.matches.length > 1 && (
                    <div className="mt-1 text-[11px] text-muted-foreground tabular-nums truncate">
                        otros: {cara.matches.slice(1).map((m: any) => `${m.subject} ${(m.similarity * 100).toFixed(0)}%`).join(" · ")}
                    </div>
                )}
            </div>
            <ArrowRight size={16} className="text-muted-foreground shrink-0 hidden sm:block" />
        </div>
    );
}

function Rotulo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
            <span className="text-[color:var(--accion)]">{icon}</span>{children}
        </span>
    );
}
