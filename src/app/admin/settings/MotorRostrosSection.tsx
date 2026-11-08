"use client";

// Panel de administración del motor de rostros (CompreFace) dentro de OmniAccess.
// Manejar el motor sin entrar al contenedor: estado, padrón CON LAS CARAS, limpiar el
// demo, probar reconocer (mostrando la cara enrolada del match) y fijar el umbral.
//
// Diseño (claude/DESIGN.md): la captura es el producto, así que las CARAS son el foco y
// son lo único que lleva sombra (--sombra-captura). Un solo azul de acción; los tonos
// (bien/aviso/mal) sólo dicen estado. Jerarquía por superficie + línea, no por sombra.

import { useEffect, useState, useCallback, useRef } from "react";
import {
    ScanFace, RefreshCcw, Trash2, Upload, Loader2, CheckCircle2,
    AlertTriangle, Users, SlidersHorizontal, Eraser, UserX, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sileo as toast } from "sileo";
import { getImagePath } from "@/lib/image-path";
import {
    testCompareFaceConnection, deleteCompareFaceSubject, clearAllVisitorFaces,
    recognizeTestAction, getFaceUmbral, setFaceUmbral, getPadronEnriquecido
} from "@/app/actions/face-admin";

type Conn = { estado: "cargando" | "ok" | "error"; count?: number; error?: string };
type ItemPadron = { subject: string; userId: string | null; cara: string | null; role: string | null; matched: boolean };

const CAPTURA = "var(--sombra-captura)";

function tonoRol(role: string | null): { label: string; texto: string; suave: string } | null {
    if (!role) return null;
    if (role === "BLACKLISTED") return { label: "Restringido", texto: "var(--mal-texto,#b91c1c)", suave: "var(--mal-suave,rgba(220,38,38,.12))" };
    if (role === "WHITELISTED") return { label: "Especial", texto: "var(--info-texto,#1d4ed8)", suave: "var(--info-suave,rgba(37,99,235,.12))" };
    return { label: "Estándar", texto: "var(--quieto-texto,#6d28d9)", suave: "var(--quieto-suave,rgba(124,58,237,.12))" };
}

export default function MotorRostrosSection() {
    const [conn, setConn] = useState<Conn>({ estado: "cargando" });
    const [items, setItems] = useState<ItemPadron[] | null>(null);
    const [padronError, setPadronError] = useState<string | null>(null);
    const [borrando, setBorrando] = useState<string | null>(null);
    const [vaciando, setVaciando] = useState(false);

    const [umbral, setUmbral] = useState<number>(0.89);
    const [umbralGuardando, setUmbralGuardando] = useState(false);

    const cargarEstado = useCallback(async () => {
        setConn({ estado: "cargando" });
        const r = await testCompareFaceConnection();
        setConn(r.success ? { estado: "ok", count: r.subjectsCount } : { estado: "error", error: r.error });
    }, []);

    const cargarPadron = useCallback(async () => {
        setPadronError(null);
        setItems(null);
        const r = await getPadronEnriquecido();
        if (r.success) setItems(r.items as ItemPadron[]);
        else setPadronError(r.error || "No se pudo leer el padrón");
    }, []);

    useEffect(() => {
        cargarEstado();
        cargarPadron();
        getFaceUmbral().then(setUmbral).catch(() => {});
    }, [cargarEstado, cargarPadron]);

    const borrarSujeto = async (s: string) => {
        setBorrando(s);
        const r = await deleteCompareFaceSubject(s);
        setBorrando(null);
        if (r.success) { toast.success({ title: `Borrado: ${s}` }); cargarPadron(); cargarEstado(); }
        else toast.error({ title: "No se pudo borrar" });
    };

    const vaciarPadron = async () => {
        if (!confirm("¿Vaciar el padrón completo del motor? Borra TODOS los rostros enrolados (incluidos los famosos del demo). No se puede deshacer.")) return;
        setVaciando(true);
        const r = await clearAllVisitorFaces();
        setVaciando(false);
        if (r.success) { toast.success({ title: "Padrón vaciado", description: r.message }); cargarPadron(); cargarEstado(); }
        else toast.error({ title: "No se pudo vaciar" });
    };

    const guardarUmbral = async () => {
        setUmbralGuardando(true);
        const r = await setFaceUmbral(umbral);
        setUmbralGuardando(false);
        if (r.success) { setUmbral(r.value); toast.success({ title: `Umbral: ${r.value}` }); }
    };

    const demoCount = items?.filter(i => !i.matched).length || 0;

    return (
        <div className="space-y-8 max-w-5xl">
            {/* Encabezado + estado en una sola franja */}
            <header className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-[10px] bg-card border border-border flex items-center justify-center">
                        <ScanFace size={20} className="text-[color:var(--accion)]" />
                    </div>
                    <div>
                        <h2 className="text-[28px] font-bold tracking-[-0.02em] leading-[1.12] text-foreground">Motor de rostros</h2>
                        <p className="text-[13px] text-muted-foreground leading-[1.5]">CompreFace — reconocimiento facial del modo face. Administralo acá, sin entrar al contenedor.</p>
                    </div>
                </div>
                <EstadoMotor conn={conn} onRefresh={cargarEstado} />
            </header>

            {/* Padrón con caras */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <Rotulo icon={<Users size={13} />}>Padrón enrolado</Rotulo>
                    {items && items.length > 0 && (
                        <Button size="sm" variant="outline" onClick={vaciarPadron} disabled={vaciando}
                            className="h-8 text-[12px] gap-1.5 text-[color:var(--mal-texto,#b91c1c)] border-[color:var(--mal-texto,#b91c1c)]/25 hover:bg-[color:var(--mal-suave,rgba(220,38,38,.1))]">
                            {vaciando ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}
                            {demoCount > 0 ? `Vaciar padrón (${demoCount} del demo)` : "Vaciar padrón"}
                        </Button>
                    )}
                </div>

                {items === null && !padronError && (
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-8 justify-center">
                        <Loader2 size={15} className="animate-spin" /> Cargando padrón…
                    </div>
                )}
                {padronError && (
                    <div className="flex items-center gap-2 text-[13px] py-8 justify-center">
                        <AlertTriangle size={15} className="text-[color:var(--mal-texto,#b91c1c)]" />
                        <span className="text-muted-foreground">{padronError}</span>
                        <Button size="sm" variant="outline" onClick={cargarPadron} className="h-7 text-[12px]">Reintentar</Button>
                    </div>
                )}
                {items && items.length === 0 && (
                    <div className="text-[13px] text-muted-foreground py-12 text-center border border-dashed border-border rounded-[10px]">
                        El padrón está vacío.<br />Enrolá rostros desde la ficha de un usuario o el registro de rostros.
                    </div>
                )}
                {items && items.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-5">
                        {items.map((it) => (
                            <CaraCard key={it.subject} item={it} borrando={borrando === it.subject} onBorrar={() => borrarSujeto(it.subject)} />
                        ))}
                    </div>
                )}
            </section>

            {/* Umbral */}
            <section className="space-y-3">
                <Rotulo icon={<SlidersHorizontal size={13} />}>Umbral de identidad</Rotulo>
                <div className="rounded-[10px] border border-border bg-card p-4">
                    <p className="text-[13px] text-muted-foreground leading-[1.5]">
                        Similitud mínima (0–1) para que un reconocimiento cuente como identidad. Medido en el lab:
                        {" "}<span className="tabular-nums font-semibold text-foreground">~0.89</span> deja separados a los impostores.
                        Por debajo, el acceso queda “desconocido”.
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                        <Input type="number" step="0.01" min="0.5" max="0.99" value={umbral}
                            onChange={(e) => setUmbral(parseFloat(e.target.value))}
                            className="w-28 tabular-nums font-semibold" />
                        <Button size="sm" onClick={guardarUmbral} disabled={umbralGuardando}>
                            {umbralGuardando ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
                        </Button>
                    </div>
                </div>
            </section>

            {/* Probar reconocer */}
            <ProbarReconocer umbral={umbral} />
        </div>
    );
}

function EstadoMotor({ conn, onRefresh }: { conn: Conn; onRefresh: () => void }) {
    return (
        <div className="flex items-center gap-3 rounded-[10px] border border-border bg-card px-4 py-2.5">
            {conn.estado === "cargando" && <span className="text-[13px] text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Consultando…</span>}
            {conn.estado === "ok" && (
                <span className="text-[13px] text-foreground flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--bien,#16a34a)" }} />
                    Conectado · <span className="tabular-nums font-bold">{conn.count}</span> <span className="text-muted-foreground">{conn.count === 1 ? "sujeto" : "sujetos"}</span>
                </span>
            )}
            {conn.estado === "error" && (
                <span className="text-[13px] flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--mal,#dc2626)" }} />
                    <span style={{ color: "var(--mal-texto,#b91c1c)" }}>Sin conexión</span>
                </span>
            )}
            <button onClick={onRefresh} className="text-muted-foreground hover:text-foreground transition-colors" title="Actualizar">
                <RefreshCcw size={14} className={conn.estado === "cargando" ? "animate-spin" : ""} />
            </button>
        </div>
    );
}

function CaraCard({ item, borrando, onBorrar }: { item: ItemPadron; borrando: boolean; onBorrar: () => void }) {
    const url = getImagePath(item.cara);
    const rol = tonoRol(item.role);
    return (
        <div className="group">
            <div className="relative aspect-square rounded-[10px] overflow-hidden border border-border bg-muted"
                style={url ? { boxShadow: CAPTURA } : undefined}>
                {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={item.subject} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1">
                        <UserX size={22} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em]">sin foto</span>
                    </div>
                )}
                <button onClick={onBorrar} disabled={borrando}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-[6px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "var(--vidrio-oscuro,rgba(10,13,18,.8))", backdropFilter: "blur(4px)" }}
                    title="Borrar del padrón">
                    {borrando ? <Loader2 size={13} className="animate-spin text-white" /> : <Trash2 size={13} className="text-white" />}
                </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-1">
                <span className="text-[13px] font-semibold text-foreground truncate" title={item.subject}>{item.subject}</span>
            </div>
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

    const elegir = (f: File) => {
        setFile(f); setRes(null); setError(null);
        const r = new FileReader(); r.onloadend = () => setPreview(r.result as string); r.readAsDataURL(f);
    };
    const reconocer = async () => {
        if (!file) return;
        setCargando(true); setError(null); setRes(null);
        const fd = new FormData(); fd.append("photo", file);
        const r = await recognizeTestAction(fd);
        setCargando(false);
        if (r.success) setRes({ caras: r.caras }); else setError(r.error || "No se pudo reconocer");
    };

    return (
        <section className="space-y-3">
            <Rotulo icon={<ScanFace size={13} />}>Probar reconocer</Rotulo>
            <div className="rounded-[10px] border border-border bg-card p-4">
                <p className="text-[13px] text-muted-foreground leading-[1.5]">Subí una foto y mirá qué reconoce contra el padrón. No toca la base de usuarios.</p>
                <div className="mt-3 flex flex-col sm:flex-row gap-5 items-start">
                    {/* foto subida */}
                    <div className="shrink-0">
                        <div onClick={() => inputRef.current?.click()}
                            className="w-44 h-44 rounded-[10px] border border-dashed border-border bg-background flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden relative"
                            style={preview ? { boxShadow: CAPTURA } : undefined}>
                            {preview
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={preview} alt="prueba" className="w-full h-full object-cover" />
                                : <div className="text-center text-muted-foreground"><Upload size={22} className="mx-auto mb-1.5" /><span className="text-[12px] font-semibold">Cargar foto</span></div>}
                        </div>
                        <input ref={inputRef} type="file" accept="image/*" className="hidden"
                            onChange={(e) => e.target.files?.[0] && elegir(e.target.files[0])} />
                        <Button size="sm" onClick={reconocer} disabled={!file || cargando} className="w-44 mt-2 gap-2">
                            {cargando ? <><Loader2 size={14} className="animate-spin" /> Reconociendo…</> : "Reconocer"}
                        </Button>
                    </div>

                    {/* resultado */}
                    <div className="flex-1 min-w-0 w-full">
                        {!res && !error && !cargando && (
                            <div className="text-[13px] text-muted-foreground py-8 text-center border border-dashed border-border rounded-[10px]">El resultado aparece acá.</div>
                        )}
                        {error && <div className="text-[13px] py-6 flex items-center gap-2" style={{ color: "var(--mal-texto,#b91c1c)" }}><AlertTriangle size={15} />{error}</div>}
                        {res && res.caras.length === 0 && (
                            <div className="text-[13px] text-muted-foreground py-6 flex items-center gap-2"><AlertTriangle size={15} /> No se detectó ninguna cara en la foto.</div>
                        )}
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
            <div className="w-16 h-16 shrink-0 rounded-[10px] overflow-hidden border border-border bg-muted flex items-center justify-center"
                style={url ? { boxShadow: CAPTURA } : undefined}>
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
