"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone, Image as ImageIcon, Video, Type, Palette, Save, Loader2, Upload, Layers } from "lucide-react";
import { getSplashConfig, saveSplashConfig, uploadBrandingFile } from "@/app/actions/settings";
import { toast } from "sonner";

const TARGETS = [
    { k: "global", l: "Global (por defecto)" },
    { k: "filas", l: "PWA Filas" },
    { k: "lpr", l: "PWA LPR" },
    { k: "face", l: "PWA Face" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block">{label}</label>
            {children}
        </div>
    );
}

export default function SplashDesigner() {
    const [target, setTarget] = useState("global");
    const [cfg, setCfg] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<string | null>(null);
    const imgRef = useRef<HTMLInputElement>(null);
    const vidRef = useRef<HTMLInputElement>(null);
    const logoRef = useRef<HTMLInputElement>(null);

    const load = async (t: string) => {
        setLoading(true);
        try { const c = await getSplashConfig(t); setCfg(c); } catch { setCfg({}); }
        setLoading(false);
    };
    useEffect(() => { load(target); }, [target]);

    const set = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));

    const upload = async (kind: "imageUrl" | "videoUrl" | "logoUrl", file: File) => {
        setUploading(kind);
        try {
            const fd = new FormData(); fd.append("file", file);
            const r: any = await uploadBrandingFile(fd);
            if (r?.url) { set(kind, r.url); toast.success("Archivo subido"); }
            else toast.error(r?.message || "No se pudo subir");
        } catch { toast.error("Error subiendo archivo"); }
        setUploading(null);
    };

    const save = async () => {
        setSaving(true);
        try {
            const r = await saveSplashConfig(target, cfg);
            if (r.success) toast.success("Splash guardado");
            else toast.error(r.error || "Error");
        } catch { toast.error("Error guardando"); }
        setSaving(false);
    };

    if (loading || !cfg) return <div className="p-8 text-sm text-muted-foreground animate-pulse">Cargando…</div>;

    const bg = cfg.bgType === "color"
        ? (cfg.gradient ? `linear-gradient(${cfg.angle ?? 160}deg, ${cfg.color1}, ${cfg.color2})` : cfg.color1)
        : cfg.color2 || "#0a0a0b";

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-violet-400" />
                    <h3 className="text-sm font-bold uppercase tracking-tight text-foreground">PWA Splash Screen</h3>
                </div>
                <div className="flex items-center gap-2">
                    <select value={target} onChange={e => setTarget(e.target.value)} className="rounded-lg bg-foreground/10 border border-border text-foreground text-xs px-3 h-9 font-semibold">
                        {TARGETS.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
                    </select>
                    <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
                {/* Controles */}
                <div className="space-y-5">
                    {/* Fondo */}
                    <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
                        <div className="flex items-center gap-2"><Palette size={14} className="text-violet-400" /><span className="text-xs font-bold uppercase tracking-wide text-foreground">Fondo</span></div>
                        <div className="flex gap-2">
                            {[["color", "Color/Gradiente", Palette], ["image", "Imagen", ImageIcon], ["video", "Video", Video]].map(([k, l, Ic]: any) => (
                                <button key={k} onClick={() => set("bgType", k)} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold border transition ${cfg.bgType === k ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-border text-muted-foreground hover:text-foreground"}`}><Ic size={13} /> {l}</button>
                            ))}
                        </div>
                        {cfg.bgType === "color" && (
                            <div className="space-y-3">
                                <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={!!cfg.gradient} onChange={e => set("gradient", e.target.checked)} /> Usar gradiente</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Color 1"><input type="color" value={cfg.color1} onChange={e => set("color1", e.target.value)} className="w-full h-9 rounded bg-transparent cursor-pointer" /></Field>
                                    {cfg.gradient && <Field label="Color 2"><input type="color" value={cfg.color2} onChange={e => set("color2", e.target.value)} className="w-full h-9 rounded bg-transparent cursor-pointer" /></Field>}
                                </div>
                                {cfg.gradient && <Field label={`Ángulo (${cfg.angle ?? 160}°)`}><input type="range" min={0} max={360} value={cfg.angle ?? 160} onChange={e => set("angle", Number(e.target.value))} className="w-full" /></Field>}
                            </div>
                        )}
                        {cfg.bgType === "image" && (
                            <div className="space-y-2">
                                <button onClick={() => imgRef.current?.click()} disabled={uploading === "imageUrl"} className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border text-xs font-bold text-foreground hover:bg-accent disabled:opacity-50">{uploading === "imageUrl" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir imagen</button>
                                <input ref={imgRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload("imageUrl", e.target.files[0])} />
                                {cfg.imageUrl && <p className="text-[10px] text-muted-foreground truncate">{cfg.imageUrl}</p>}
                            </div>
                        )}
                        {cfg.bgType === "video" && (
                            <div className="space-y-2">
                                <button onClick={() => vidRef.current?.click()} disabled={uploading === "videoUrl"} className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border text-xs font-bold text-foreground hover:bg-accent disabled:opacity-50">{uploading === "videoUrl" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir video (loop)</button>
                                <input ref={vidRef} type="file" accept="video/mp4,video/webm" hidden onChange={e => e.target.files?.[0] && upload("videoUrl", e.target.files[0])} />
                                {cfg.videoUrl && <p className="text-[10px] text-muted-foreground truncate">{cfg.videoUrl}</p>}
                            </div>
                        )}
                        <Field label={`Oscurecer fondo (${cfg.overlay || 0}%)`}><input type="range" min={0} max={85} value={cfg.overlay || 0} onChange={e => set("overlay", Number(e.target.value))} className="w-full" /></Field>
                    </div>

                    {/* Logo */}
                    <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2"><Layers size={14} className="text-violet-400" /><span className="text-xs font-bold uppercase tracking-wide text-foreground">Logo</span></div>
                            <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={!!cfg.showLogo} onChange={e => set("showLogo", e.target.checked)} /> Mostrar</label>
                        </div>
                        {cfg.showLogo && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <button onClick={() => logoRef.current?.click()} disabled={uploading === "logoUrl"} className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border text-xs font-bold text-foreground hover:bg-accent disabled:opacity-50">{uploading === "logoUrl" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir logo</button>
                                    <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload("logoUrl", e.target.files[0])} />
                                    {cfg.logoUrl && <img src={cfg.logoUrl} alt="" className="h-8 w-8 object-contain rounded" />}
                                </div>
                                <Field label={`Tamaño del logo (${cfg.logoSize || 96}px)`}><input type="range" min={48} max={200} value={cfg.logoSize || 96} onChange={e => set("logoSize", Number(e.target.value))} className="w-full" /></Field>
                            </div>
                        )}
                    </div>

                    {/* Textos */}
                    <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
                        <div className="flex items-center gap-2"><Type size={14} className="text-violet-400" /><span className="text-xs font-bold uppercase tracking-wide text-foreground">Textos</span></div>
                        <Field label="Título"><input value={cfg.title || ""} onChange={e => set("title", e.target.value)} className="w-full rounded-md bg-foreground/10 border border-border text-foreground text-sm px-3 h-9" placeholder="OmniAccess" /></Field>
                        <Field label="Subtítulo"><input value={cfg.subtitle || ""} onChange={e => set("subtitle", e.target.value)} className="w-full rounded-md bg-foreground/10 border border-border text-foreground text-sm px-3 h-9" placeholder="Control de Fila" /></Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Color título"><input type="color" value={cfg.titleColor || "#ffffff"} onChange={e => set("titleColor", e.target.value)} className="w-full h-9 rounded bg-transparent cursor-pointer" /></Field>
                            <Field label="Color subtítulo"><input type="color" value={(cfg.subtitleColor || "#ffffff").slice(0, 7)} onChange={e => set("subtitleColor", e.target.value)} className="w-full h-9 rounded bg-transparent cursor-pointer" /></Field>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={!!cfg.spinner} onChange={e => set("spinner", e.target.checked)} /> Spinner de carga</label>
                            <div className="flex items-center gap-2"><span className="text-[10px] text-muted-foreground uppercase font-bold">Duración</span><input type="number" min={600} max={6000} step={100} value={cfg.duration ?? 1700} onChange={e => set("duration", Number(e.target.value))} className="w-20 rounded bg-foreground/10 border border-border text-foreground text-xs px-2 h-8" /><span className="text-[10px] text-muted-foreground">ms</span></div>
                        </div>
                    </div>
                </div>

                {/* Preview teléfono */}
                <div className="lg:sticky lg:top-4 self-start">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 text-center">Vista previa</p>
                    <div className="mx-auto w-[260px] h-[540px] rounded-[2.2rem] border-[10px] border-zinc-800 bg-black overflow-hidden shadow-lg relative">
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center overflow-hidden" style={{ background: bg }}>
                            {cfg.bgType === "image" && cfg.imageUrl && <img src={cfg.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                            {cfg.bgType === "video" && cfg.videoUrl && <video src={cfg.videoUrl} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />}
                            {(cfg.overlay || 0) > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${(cfg.overlay || 0) / 100})` }} />}
                            <div className="relative flex flex-col items-center gap-3 px-6">
                                {cfg.showLogo && cfg.logoUrl && <img src={cfg.logoUrl} alt="" style={{ width: Math.min(140, cfg.logoSize || 96), height: Math.min(140, cfg.logoSize || 96), objectFit: "contain" }} className="drop-shadow-lg" />}
                                {cfg.title && <div className="text-2xl font-bold tracking-tight" style={{ color: cfg.titleColor || "#fff" }}>{cfg.title}</div>}
                                {cfg.subtitle && <div className="text-[10px] font-bold uppercase tracking-[0.25em]" style={{ color: cfg.subtitleColor || "#ffffffb3" }}>{cfg.subtitle}</div>}
                                {cfg.spinner && <div className="mt-2 w-6 h-6 rounded-full animate-spin" style={{ border: `2px solid ${(cfg.spinnerColor || "#fff") + "44"}`, borderTopColor: cfg.spinnerColor || "#fff" }} />}
                            </div>
                        </div>
                    </div>
                    {cfg._fallback && target !== "global" && <p className="text-[10px] text-amber-400 text-center mt-2">Usando el splash Global (este modo aún no tiene el suyo)</p>}
                </div>
            </div>
        </div>
    );
}
