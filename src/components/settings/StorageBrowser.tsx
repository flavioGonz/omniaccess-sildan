"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, Folder, FileText, RefreshCw, Home, Search, ExternalLink, ChevronRight, ShieldAlert, Camera, ScanFace, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { listBuckets, listBucketObjects, getBucketStats, getSetting } from "@/app/actions/settings";
import { getEnabledModules } from "@/app/actions/modules";

const fmtSize = (n: number) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
const baseName = (key: string) => { const parts = key.replace(/\/$/, "").split("/"); return parts[parts.length - 1]; };
const isImg = (k: string) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(k);

// Miniatura con skeleton por imagen (cada foto muestra su propio loader)
function PhotoThumb({ href, name, size }: { href: string; name: string; size: string }) {
    const [loaded, setLoaded] = useState(false);
    const [err, setErr] = useState(false);
    return (
        <a href={href} target="_blank" rel="noreferrer" title={`${name} · ${size}`}
            className="group relative aspect-square rounded-lg overflow-hidden ring-1 ring-white/[0.06] hover:ring-amber-500/50 bg-neutral-900 transition">
            {!loaded && !err && <div className="absolute inset-0 sb-sk" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {err
                ? <div className="absolute inset-0 grid place-items-center text-white/20"><FileText size={18} /></div>
                : <img src={`${href}?w=240`} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setErr(true)}
                    className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />}
            <span className="absolute inset-x-0 bottom-0 px-1.5 pt-3 pb-1 bg-gradient-to-t from-black/85 to-transparent text-[8px] leading-tight text-white/90 truncate">{name}</span>
            <span className="absolute top-1 right-1 px-1 py-0.5 bg-black/55 backdrop-blur-sm text-[7.5px] font-semibold text-white/80 rounded">{size}</span>
        </a>
    );
}

const BUCKET_META: Record<string, { Icon: any; tone: string; label: string }> = {
    intrusion: { Icon: ShieldAlert, tone: "text-red-400", label: "Intrusión" },
    lpr: { Icon: Camera, tone: "text-blue-400", label: "LPR" },
    face: { Icon: ScanFace, tone: "text-purple-400", label: "Rostros" },
    queue: { Icon: ListOrdered, tone: "text-amber-400", label: "Filas" },
};
function metaFor(name: string, names: { lpr?: string; face?: string; queue?: string; intrusion?: string }) {
    if (name === names.intrusion) return BUCKET_META.intrusion;
    if (name === names.lpr) return BUCKET_META.lpr;
    if (name === names.face) return BUCKET_META.face;
    if (name === names.queue) return BUCKET_META.queue;
    return { Icon: Database, tone: "text-muted-foreground", label: name };
}

export default function StorageBrowser() {
    const [buckets, setBuckets] = useState<any[]>([]);
    const [bucket, setBucket] = useState("");
    const [prefix, setPrefix] = useState("");
    const [folders, setFolders] = useState<string[]>([]);
    const [objects, setObjects] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState("");
    const [nextToken, setNextToken] = useState<string | null>(null);
    const [allowed, setAllowed] = useState<Set<string> | null>(null);
    const [names, setNames] = useState<{ lpr?: string; face?: string; queue?: string; intrusion?: string }>({});

    // Buckets visibles según el modo activo (lpr-prod sólo en LPR, face en Face, queue en Filas; intrusión SIEMPRE)
    useEffect(() => { (async () => {
        try {
            const [mods, bl, bf, bq, bi] = await Promise.all([
                getEnabledModules(), getSetting("S3_BUCKET_LPR"), getSetting("S3_BUCKET_FACE"), getSetting("S3_BUCKET_QUEUE"), getSetting("S3_BUCKET_INTRUSION"),
            ]);
            const nm = { lpr: bl?.value || "lpr-prod", face: bf?.value || "face", queue: bq?.value || undefined, intrusion: bi?.value || "intrusion" };
            setNames(nm);
            const set = new Set<string>();
            set.add(nm.intrusion); // intrusión compartida en todos los modos
            if ((mods as any)?.MODULE_LPR) set.add(nm.lpr);
            if ((mods as any)?.MODULE_FACE) set.add(nm.face);
            if ((mods as any)?.MODULE_QUEUE && nm.queue) set.add(nm.queue);
            setAllowed(set);
        } catch { setAllowed(null); }
    })(); }, []);

    useEffect(() => { (async () => { const r: any = await listBuckets(); if (r.success) setBuckets(r.buckets); })(); }, []);

    const visibleBuckets = allowed ? buckets.filter((b) => allowed.has(b.name)) : buckets;

    // elegir bucket por defecto entre los visibles (prioriza intrusión)
    useEffect(() => {
        if (!visibleBuckets.length) return;
        if (bucket && visibleBuckets.some((b) => b.name === bucket)) return;
        const pref = visibleBuckets.find((b) => b.name === names.intrusion) || visibleBuckets[0];
        setBucket(pref.name);
    }, [visibleBuckets, bucket, names.intrusion]);

    const load = useCallback(async (b: string, p: string, append = false, token: string | null = null) => {
        if (!b) return;
        setLoading(true);
        try {
            const r: any = await listBucketObjects(b, p, token || undefined);
            if (r.success) { setFolders(r.folders); setObjects((prev) => append ? [...prev, ...r.objects] : r.objects); setNextToken(r.nextToken); }
        } catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { if (bucket) { setPrefix(""); setQ(""); load(bucket, ""); getBucketStats(bucket).then(setStats).catch(() => setStats(null)); } }, [bucket, load]);

    const goto = (p: string) => { setPrefix(p); load(bucket, p); };
    const crumbs = prefix ? prefix.replace(/\/$/, "").split("/") : [];
    const filteredFolders = q ? folders.filter((f) => baseName(f).toLowerCase().includes(q.toLowerCase())) : folders;
    const filteredObjects = q ? objects.filter((o) => baseName(o.key).toLowerCase().includes(q.toLowerCase())) : objects;

    return (
        <div className="flex flex-col h-[calc(100vh-190px)] rounded-2xl border border-border bg-card overflow-hidden">
            <style jsx global>{`
                .sb-sk { background: #171717; position: relative; overflow: hidden; }
                .sb-sk::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent); animation: sbsheen 1.4s infinite; }
                @keyframes sbsheen { 100% { transform: translateX(100%); } }
            `}</style>

            {/* Toolbar único: tabs de buckets · buscar · stats · recargar */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-border">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 grid place-items-center shrink-0"><Database size={16} /></div>
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {visibleBuckets.map((b) => {
                        const m = metaFor(b.name, names);
                        const on = bucket === b.name;
                        return (
                            <button key={b.name} onClick={() => setBucket(b.name)}
                                className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition", on ? "bg-amber-600 border-amber-600 text-white shadow" : "bg-muted/50 border-border text-muted-foreground hover:text-foreground")}>
                                <m.Icon size={13} className={on ? "text-white" : m.tone} /> {m.label}
                            </button>
                        );
                    })}
                    {visibleBuckets.length === 0 && <span className="text-xs text-muted-foreground">Sin buckets o sin conexión a S3.</span>}
                </div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                    {stats && <span className="hidden md:inline text-[11px] text-muted-foreground font-mono">{stats.fileCount ?? stats.objectCount ?? "—"} obj · {stats.totalSize != null ? fmtSize(stats.totalSize) : (stats.sizeReadable || "")}</span>}
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" className="bg-muted/50 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground outline-none focus:border-amber-500 w-36" />
                    </div>
                    <button onClick={() => { load(bucket, prefix); getBucketStats(bucket).then(setStats).catch(() => {}); }} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground transition" title="Recargar">
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Breadcrumb compacto */}
            <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border text-xs text-muted-foreground flex-wrap">
                <button onClick={() => goto("")} className="inline-flex items-center gap-1 hover:text-foreground transition"><Home size={12} /> {bucket || "raíz"}</button>
                {crumbs.map((c, i) => {
                    const p = crumbs.slice(0, i + 1).join("/") + "/";
                    return <span key={i} className="inline-flex items-center gap-1"><ChevronRight size={11} className="opacity-50" /><button onClick={() => goto(p)} className="hover:text-foreground transition truncate max-w-[160px]">{c}</button></span>;
                })}
            </div>

            {/* Grilla a casi pantalla completa */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5">
                {loading && objects.length === 0 ? (
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-1.5">
                        {Array.from({ length: 48 }).map((_, i) => <div key={i} className="aspect-square rounded-lg sb-sk" />)}
                    </div>
                ) : (filteredFolders.length === 0 && filteredObjects.length === 0) ? (
                    <div className="h-full grid place-items-center text-sm text-muted-foreground">
                        <div className="flex flex-col items-center gap-2"><Folder size={26} className="opacity-40" /> Carpeta vacía.</div>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-1.5">
                            {filteredFolders.map((fp) => (
                                <button key={fp} onClick={() => goto(fp)} className="aspect-square rounded-lg ring-1 ring-white/[0.06] bg-muted/40 hover:bg-accent flex flex-col items-center justify-center gap-1 p-2 transition">
                                    <Folder size={18} className="text-amber-400" />
                                    <span className="text-[9px] text-foreground/80 truncate w-full text-center">{baseName(fp)}</span>
                                </button>
                            ))}
                            {filteredObjects.map((o) => {
                                const href = `/api/files/${bucket}/${encodeURIComponent(o.key)}`;
                                return isImg(o.key)
                                    ? <PhotoThumb key={o.key} href={href} name={baseName(o.key)} size={fmtSize(o.size)} />
                                    : (
                                        <a key={o.key} href={href} target="_blank" rel="noreferrer" title={baseName(o.key)} className="group relative aspect-square rounded-lg overflow-hidden ring-1 ring-white/[0.06] bg-neutral-900 grid place-items-center">
                                            <FileText size={18} className="text-muted-foreground" />
                                            <span className="absolute inset-x-0 bottom-0 px-1.5 pt-3 pb-1 bg-gradient-to-t from-black/85 to-transparent text-[8px] leading-tight text-white/90 truncate">{baseName(o.key)}</span>
                                        </a>
                                    );
                            })}
                        </div>
                        {nextToken && (
                            <button onClick={() => load(bucket, prefix, true, nextToken)} className="w-full mt-3 px-5 py-2.5 text-xs font-bold text-amber-400 hover:text-foreground hover:bg-accent/40 rounded-lg transition">Cargar más…</button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
