"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, Folder, FileText, RefreshCw, Home, Search, ExternalLink, Image as ImageIcon, ChevronRight, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { listBuckets, listBucketObjects, getBucketStats, getSetting } from "@/app/actions/settings";
import { getEnabledModules } from "@/app/actions/modules";

const fmtSize = (n: number) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
const baseName = (key: string) => { const parts = key.replace(/\/$/, "").split("/"); return parts[parts.length - 1]; };
const isImg = (k: string) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(k);

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
    const [grid, setGrid] = useState(true);

    // Solo se muestran los buckets de los modos activos: si el barrio usa LPR,
    // no tiene sentido ver el bucket de facial ni el de filas.
    useEffect(() => {
        (async () => {
            const [r, mods, bl, bf, bq]: any[] = await Promise.all([
                listBuckets(),
                getEnabledModules().catch(() => ({})),
                getSetting("S3_BUCKET_LPR"), getSetting("S3_BUCKET_FACE"), getSetting("S3_BUCKET_QUEUE"),
            ]);
            if (!r?.success) return;
            const permitidos = [
                mods?.MODULE_LPR ? (bl?.value || "lpr-prod") : null,
                mods?.MODULE_FACE ? (bf?.value || "face") : null,
                mods?.MODULE_QUEUE ? (bq?.value || "queue") : null,
            ].filter(Boolean) as string[];
            const propios = permitidos.length
                ? r.buckets.filter((b: any) => permitidos.includes(b.name))
                : r.buckets;
            setBuckets(propios);
            if (propios[0]) setBucket(propios[0].name);
        })();
    }, []);

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
        <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center"><Database size={18} /></div>
                    <div>
                        <div className="text-sm font-bold text-foreground">Explorador de objetos · MinIO / S3</div>
                        <div className="text-[10px] text-muted-foreground">{buckets.length} bucket{buckets.length === 1 ? "" : "s"} del modo activo</div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="flex items-center bg-muted/60 border border-border rounded-lg p-0.5">
                        <button onClick={() => setGrid(true)} className={cn("p-1.5 rounded-md transition", grid ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")} title="Grilla"><LayoutGrid size={14} /></button>
                        <button onClick={() => setGrid(false)} className={cn("p-1.5 rounded-md transition", !grid ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")} title="Lista"><List size={14} /></button>
                    </div>
                    <button onClick={() => { load(bucket, prefix); getBucketStats(bucket).then(setStats).catch(() => {}); }} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground transition" title="Recargar">
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Buckets */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-wrap">
                {buckets.map((b) => (
                    <button key={b.name} onClick={() => setBucket(b.name)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition", bucket === b.name ? "bg-amber-600 border-amber-600 text-white" : "bg-muted/50 border-border text-muted-foreground hover:text-foreground")}>
                        {b.name}
                    </button>
                ))}
                {buckets.length === 0 && <span className="text-xs text-muted-foreground">Sin buckets o sin conexión a S3.</span>}
                {stats && (
                    <span className="ml-auto text-[11px] text-muted-foreground font-mono flex items-center gap-3">
                        <span>{stats.fileCount ?? stats.objectCount ?? "—"} objetos</span>
                        <span>{stats.totalSize != null ? fmtSize(stats.totalSize) : (stats.sizeReadable || "")}</span>
                    </span>
                )}
            </div>

            {/* Breadcrumb + search */}
            <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border flex-wrap">
                <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 flex-wrap">
                    <button onClick={() => goto("")} className="inline-flex items-center gap-1 hover:text-foreground transition"><Home size={12} /> {bucket || "raíz"}</button>
                    {crumbs.map((c, i) => {
                        const p = crumbs.slice(0, i + 1).join("/") + "/";
                        return <span key={i} className="inline-flex items-center gap-1"><ChevronRight size={11} className="opacity-50" /><button onClick={() => goto(p)} className="hover:text-foreground transition truncate max-w-[140px]">{c}</button></span>;
                    })}
                </div>
                <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" className="bg-muted/50 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground outline-none focus:border-amber-500 w-40" />
                </div>
            </div>

            {/* List / Grid */}
            {grid ? (
                <div className="max-h-[520px] overflow-y-auto p-3">
                    {loading && objects.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</div>
                    ) : (filteredFolders.length === 0 && filteredObjects.length === 0) ? (
                        <div className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2"><Folder size={22} className="opacity-40" /> Carpeta vacía.</div>
                    ) : (
                        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-12 gap-1.5">
                            {filteredFolders.map((fp) => (
                                <button key={fp} onClick={() => goto(fp)} className="aspect-square rounded-lg border border-border bg-muted/40 hover:bg-accent flex flex-col items-center justify-center gap-1 p-2 transition">
                                    <Folder size={16} className="text-amber-400" />
                                    <span className="text-[9px] text-foreground/80 truncate w-full text-center">{baseName(fp)}</span>
                                </button>
                            ))}
                            {filteredObjects.map((o) => {
                                const href = `/api/files/${bucket}/${encodeURIComponent(o.key)}`;
                                return (
                                    <a key={o.key} href={href} target="_blank" rel="noreferrer" title={`${baseName(o.key)} · ${fmtSize(o.size)}`} className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-black flex items-center justify-center">
                                        {isImg(o.key) ? <img src={href} alt="" loading="lazy" className="w-full h-full object-cover" /> : <FileText size={18} className="text-muted-foreground" />}
                                        <span className="absolute inset-x-0 bottom-0 px-1 pt-2 pb-0.5 bg-gradient-to-t from-black/85 to-transparent text-[7px] leading-tight text-white/90 truncate">{baseName(o.key)}</span>
                                        <span className="absolute top-0 right-0 px-1 py-0.5 bg-black/55 text-[7px] text-white/80 rounded-bl">{fmtSize(o.size)}</span>
                                    </a>
                                );
                            })}
                        </div>
                    )}
                    {nextToken && (
                        <button onClick={() => load(bucket, prefix, true, nextToken)} className="w-full mt-3 px-5 py-2.5 text-xs font-semibold text-amber-400 hover:text-foreground hover:bg-accent/40 rounded-lg transition">Cargar más…</button>
                    )}
                </div>
            ) : (
            <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
                {loading && objects.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</div>
                ) : (filteredFolders.length === 0 && filteredObjects.length === 0) ? (
                    <div className="px-5 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2"><Folder size={22} className="opacity-40" /> Carpeta vacía.</div>
                ) : (
                    <>
                        {filteredFolders.map((fp) => (
                            <button key={fp} onClick={() => goto(fp)} className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-accent/40 text-left transition">
                                <Folder size={16} className="text-amber-400 shrink-0" />
                                <span className="text-sm text-foreground truncate flex-1">{baseName(fp)}/</span>
                                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                            </button>
                        ))}
                        {filteredObjects.map((o) => {
                            const href = `/api/files/${bucket}/${encodeURIComponent(o.key)}`;
                            return (
                                <div key={o.key} className="flex items-center gap-3 px-5 py-2.5 group">
                                    <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden">
                                        {isImg(o.key) ? <img src={href} alt="" className="w-full h-full object-cover" loading="lazy" /> : <FileText size={15} className="text-muted-foreground" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm text-foreground truncate">{baseName(o.key)}</div>
                                        <div className="text-[10px] text-muted-foreground font-mono">{fmtSize(o.size)}{o.lastModified ? " · " + new Date(o.lastModified).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</div>
                                    </div>
                                    <a href={href} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition opacity-0 group-hover:opacity-100" title="Ver / descargar"><ExternalLink size={14} /></a>
                                </div>
                            );
                        })}
                        {nextToken && (
                            <button onClick={() => load(bucket, prefix, true, nextToken)} className="w-full px-5 py-3 text-xs font-semibold text-amber-400 hover:text-foreground hover:bg-accent/40 transition">
                                Cargar más…
                            </button>
                        )}
                    </>
                )}
            </div>
            )}
        </div>
    );
}
