"use client";

// Panel de administración del motor de rostros (CompreFace) dentro de OmniAccess.
// Objetivo: manejar el motor sin entrar al contenedor — ver estado, administrar el
// padrón, limpiar el demo de famosos, probar reconocer y fijar el umbral.
// El backend proxea todo desde face-admin.ts (config única en lib/compareface.ts).

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
    ScanFace, RefreshCcw, Trash2, Upload, Loader2, CheckCircle2,
    XCircle, AlertTriangle, Users, SlidersHorizontal, Eraser
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sileo as toast } from "sileo";
import {
    testCompareFaceConnection, getCompareFaceSubjects, deleteCompareFaceSubject,
    clearAllVisitorFaces, recognizeTestAction, getFaceUmbral, setFaceUmbral
} from "@/app/actions/face-admin";

type Conn = { estado: "cargando" | "ok" | "error"; count?: number; error?: string };

export default function MotorRostrosSection() {
    const [conn, setConn] = useState<Conn>({ estado: "cargando" });
    const [subjects, setSubjects] = useState<string[] | null>(null);
    const [subjError, setSubjError] = useState<string | null>(null);
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
        setSubjError(null);
        setSubjects(null);
        const r = await getCompareFaceSubjects();
        if (r.success) setSubjects(r.subjects);
        else setSubjError(r.error || "No se pudo leer el padrón");
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
        if (r.success) {
            toast.success({ title: `Borrado: ${s}` });
            cargarPadron(); cargarEstado();
        } else toast.error({ title: "No se pudo borrar", description: r.error });
    };

    const vaciarPadron = async () => {
        if (!confirm("¿Vaciar el padrón completo del motor? Borra TODOS los rostros enrolados (incluidos los famosos del demo). No se puede deshacer.")) return;
        setVaciando(true);
        const r = await clearAllVisitorFaces();
        setVaciando(false);
        if (r.success) {
            toast.success({ title: `Padrón vaciado`, description: r.message });
            cargarPadron(); cargarEstado();
        } else toast.error({ title: "No se pudo vaciar", description: r.error });
    };

    const guardarUmbral = async () => {
        setUmbralGuardando(true);
        const r = await setFaceUmbral(umbral);
        setUmbralGuardando(false);
        if (r.success) { setUmbral(r.value); toast.success({ title: `Umbral: ${r.value}` }); }
    };

    return (
        <div className="space-y-6 max-w-4xl">
            <header className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-card border border-border flex items-center justify-center">
                    <ScanFace size={18} className="text-[color:var(--accion,#2563eb)]" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Motor de rostros</h2>
                    <p className="text-[13px] text-muted-foreground">CompreFace — el motor que reconoce caras en el modo face. Lo administrás acá, sin entrar al contenedor.</p>
                </div>
            </header>

            {/* Estado */}
            <Tarjeta>
                <div className="flex items-center justify-between">
                    <Rotulo icon={<ScanFace size={13} />}>Estado del motor</Rotulo>
                    <button onClick={cargarEstado} className="text-muted-foreground hover:text-foreground transition-colors" title="Actualizar">
                        <RefreshCcw size={14} className={conn.estado === "cargando" ? "animate-spin" : ""} />
                    </button>
                </div>
                <div className="mt-3 flex items-center gap-3">
                    {conn.estado === "cargando" && <span className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Consultando…</span>}
                    {conn.estado === "ok" && (
                        <span className="text-sm text-foreground flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-[color:var(--bien,#16a34a)]" />
                            Conectado · <span className="tabular-nums font-semibold">{conn.count}</span> {conn.count === 1 ? "sujeto" : "sujetos"} en el padrón
                        </span>
                    )}
                    {conn.estado === "error" && (
                        <div className="flex items-center gap-2 text-sm">
                            <span className="w-2 h-2 rounded-full bg-[color:var(--mal,#dc2626)]" />
                            <span className="text-[color:var(--mal,#dc2626)]">Sin conexión</span>
                            <span className="text-muted-foreground text-xs">{conn.error}</span>
                            <Button size="sm" variant="outline" onClick={cargarEstado} className="h-7 text-xs">Reintentar</Button>
                        </div>
                    )}
                </div>
            </Tarjeta>

            {/* Padrón */}
            <Tarjeta>
                <div className="flex items-center justify-between">
                    <Rotulo icon={<Users size={13} />}>Padrón enrolado</Rotulo>
                    {subjects && subjects.length > 0 && (
                        <Button size="sm" variant="outline" onClick={vaciarPadron} disabled={vaciando}
                            className="h-7 text-xs text-[color:var(--mal,#dc2626)] border-[color:var(--mal,#dc2626)]/30 hover:bg-[color:var(--mal,#dc2626)]/10">
                            {vaciando ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}
                            Vaciar padrón
                        </Button>
                    )}
                </div>
                <div className="mt-3">
                    {subjects === null && !subjError && (
                        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
                    )}
                    {subjError && (
                        <div className="flex items-center gap-2 text-sm">
                            <AlertTriangle size={14} className="text-[color:var(--mal,#dc2626)]" />
                            <span className="text-muted-foreground">{subjError}</span>
                            <Button size="sm" variant="outline" onClick={cargarPadron} className="h-7 text-xs">Reintentar</Button>
                        </div>
                    )}
                    {subjects && subjects.length === 0 && (
                        <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-[10px]">
                            El padrón está vacío. Enrolá rostros desde la ficha de un usuario o el registro de rostros.
                        </div>
                    )}
                    {subjects && subjects.length > 0 && (
                        <ul className="divide-y divide-border rounded-[10px] border border-border overflow-hidden">
                            {subjects.map((s) => (
                                <li key={s} className="flex items-center justify-between px-3 py-2 bg-card hover:bg-muted/40 transition-colors">
                                    <span className="text-sm text-foreground truncate">{s}</span>
                                    <button onClick={() => borrarSujeto(s)} disabled={borrando === s}
                                        className="text-muted-foreground hover:text-[color:var(--mal,#dc2626)] transition-colors p-1" title="Borrar del padrón">
                                        {borrando === s ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Tarjeta>

            {/* Umbral */}
            <Tarjeta>
                <Rotulo icon={<SlidersHorizontal size={13} />}>Umbral de identidad</Rotulo>
                <p className="text-[13px] text-muted-foreground mt-2">
                    Similitud mínima (0–1) para que un reconocimiento cuente como identidad. Medido en el lab:
                    {" "}<span className="tabular-nums">~0.89</span> deja separados a los impostores. Por debajo, el acceso queda “desconocido”.
                </p>
                <div className="mt-3 flex items-center gap-3">
                    <Input type="number" step="0.01" min="0.5" max="0.99" value={umbral}
                        onChange={(e) => setUmbral(parseFloat(e.target.value))}
                        className="w-28 tabular-nums" />
                    <Button size="sm" onClick={guardarUmbral} disabled={umbralGuardando}>
                        {umbralGuardando ? <Loader2 size={14} className="animate-spin" /> : "Guardar"}
                    </Button>
                </div>
            </Tarjeta>

            {/* Probar reconocer */}
            <ProbarReconocer umbral={umbral} />
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
        if (r.success) setRes({ caras: r.caras });
        else setError(r.error || "No se pudo reconocer");
    };

    return (
        <Tarjeta>
            <Rotulo icon={<ScanFace size={13} />}>Probar reconocer</Rotulo>
            <p className="text-[13px] text-muted-foreground mt-2">Subí una foto y mirá qué reconoce contra el padrón, con la similitud. No toca la base de usuarios.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-4">
                <div
                    onClick={() => inputRef.current?.click()}
                    className="w-40 h-40 shrink-0 rounded-[10px] border border-dashed border-border bg-card flex items-center justify-center cursor-pointer hover:bg-muted/40 transition-colors overflow-hidden relative">
                    {preview
                        ? <Image src={preview} alt="prueba" fill className="object-cover" />
                        : <div className="text-center text-muted-foreground"><Upload size={20} className="mx-auto mb-1" /><span className="text-xs">Cargar foto</span></div>}
                </div>
                <input ref={inputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => e.target.files?.[0] && elegir(e.target.files[0])} />

                <div className="flex-1 min-w-0">
                    <Button size="sm" onClick={reconocer} disabled={!file || cargando}>
                        {cargando ? <><Loader2 size={14} className="animate-spin" /> Reconociendo…</> : "Reconocer"}
                    </Button>

                    {error && <div className="mt-3 text-sm text-[color:var(--mal,#dc2626)] flex items-center gap-2"><XCircle size={14} />{error}</div>}

                    {res && res.caras.length === 0 && (
                        <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2"><AlertTriangle size={14} /> No se detectó ninguna cara en la foto.</div>
                    )}

                    {res && res.caras.map((c, i) => {
                        const best = c.matches[0];
                        const pasa = best && best.similarity >= umbral;
                        return (
                            <div key={i} className="mt-3 rounded-[10px] border border-border bg-card p-3">
                                {!best ? (
                                    <span className="text-sm text-muted-foreground">Cara {i + 1}: desconocido (sin match)</span>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 text-sm">
                                            {pasa
                                                ? <CheckCircle2 size={15} className="text-[color:var(--bien,#16a34a)]" />
                                                : <AlertTriangle size={15} className="text-[color:var(--aviso,#d97706)]" />}
                                            <span className="font-semibold text-foreground truncate">{best.subject}</span>
                                            <span className="tabular-nums text-muted-foreground">{(best.similarity * 100).toFixed(1)}%</span>
                                            <span className={`text-xs ${pasa ? "text-[color:var(--bien,#16a34a)]" : "text-[color:var(--aviso,#d97706)]"}`}>
                                                {pasa ? "supera el umbral" : "por debajo del umbral → desconocido"}
                                            </span>
                                        </div>
                                        {c.matches.length > 1 && (
                                            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                                                otros: {c.matches.slice(1).map((m: any) => `${m.subject} ${(m.similarity * 100).toFixed(0)}%`).join(" · ")}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </Tarjeta>
    );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
    return <div className="rounded-[10px] border border-border bg-background p-4">{children}</div>;
}

function Rotulo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
            <span className="text-[color:var(--accion,#2563eb)]">{icon}</span>{children}
        </span>
    );
}
