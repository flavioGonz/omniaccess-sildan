"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
    Activity, Cloud, Download, HardDrive, RefreshCcw, Save, Upload, Database, ScanLine, ScanFace, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import {
    testS3Connection, getBucketLifecycle, updateBucketLifecycle, getBucketStats,
    getSetting, updateSetting, getStorageCapacity,
} from "@/app/actions/settings";
import { getEnabledModules } from "@/app/actions/modules";

type ModKey = "lpr" | "face" | "queue";

const MODS: { key: ModKey; moduleId: string; label: string; Icon: any; tone: string }[] = [
    { key: "lpr", moduleId: "MODULE_LPR", label: "Matriculas (LPR)", Icon: ScanLine, tone: "sky" },
    { key: "face", moduleId: "MODULE_FACE", label: "Facial", Icon: ScanFace, tone: "violet" },
    { key: "queue", moduleId: "MODULE_QUEUE", label: "Control de Filas", Icon: Users, tone: "amber" },
];

const TONES: Record<string, { text: string; bg: string; ring: string }> = {
    sky: { text: "text-sky-400", bg: "bg-sky-500/10", ring: "border-sky-500/25" },
    violet: { text: "text-violet-400", bg: "bg-violet-500/10", ring: "border-violet-500/25" },
    amber: { text: "text-amber-400", bg: "bg-amber-500/10", ring: "border-amber-500/25" },
};

const fmt = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024, u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), u.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)) + " " + u[i];
};

export default function StorageSection() {
    const [config, setConfig] = useState({ endpoint: "", accessKey: "", secretKey: "", lpr: "lpr-prod", face: "face", queue: "queue" });
    const [modules, setModules] = useState<Record<string, boolean>>({ MODULE_LPR: true, MODULE_FACE: false, MODULE_QUEUE: false });
    const [lifecycles, setLifecycles] = useState<Record<ModKey, number>>({ lpr: 0, face: 0, queue: 0 });
    const [stats, setStats] = useState<Record<ModKey, { size: number; count: number; loading: boolean }>>({
        lpr: { size: 0, count: 0, loading: true },
        face: { size: 0, count: 0, loading: true },
        queue: { size: 0, count: 0, loading: true },
    });
    const [cap, setCap] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [importingConfig, setImportingConfig] = useState(false);
    const configFileRef = useRef<HTMLInputElement>(null);

    const activos = MODS.filter((m) => modules[m.moduleId]);
    const bucketDe = (k: ModKey) => (config as any)[k] as string;

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const [mods, e, ak, sk, bl, bf, bq] = await Promise.all([
                getEnabledModules().catch(() => ({} as any)),
                getSetting("S3_ENDPOINT"), getSetting("S3_ACCESS_KEY"), getSetting("S3_SECRET_KEY"),
                getSetting("S3_BUCKET_LPR"), getSetting("S3_BUCKET_FACE"), getSetting("S3_BUCKET_QUEUE"),
            ]);
            setModules(mods as any);
            const cfg = {
                endpoint: e?.value || "",
                accessKey: ak?.value || "",
                secretKey: sk?.value || "",
                lpr: bl?.value || "lpr-prod",
                face: bf?.value || "face",
                queue: bq?.value || "queue",
            };
            setConfig(cfg);
            getStorageCapacity().then(setCap).catch(() => setCap(null));

            const vivos = MODS.filter((m) => (mods as any)[m.moduleId]);
            await Promise.all(vivos.map(async (m) => {
                const bucket = (cfg as any)[m.key];
                const [s, lc]: any[] = await Promise.all([
                    getBucketStats(bucket).catch(() => ({ success: false })),
                    getBucketLifecycle(bucket).catch(() => ({ success: false })),
                ]);
                setStats((p) => ({ ...p, [m.key]: { size: s?.totalSize ?? s?.size ?? 0, count: s?.fileCount ?? s?.count ?? 0, loading: false } }));
                setLifecycles((p) => ({ ...p, [m.key]: lc?.success ? (lc.days || 0) : 0 }));
            }));
        } catch (err) {
            console.error("Error cargando almacenamiento:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await Promise.all([
                updateSetting("S3_ENDPOINT", config.endpoint),
                updateSetting("S3_ACCESS_KEY", config.accessKey),
                updateSetting("S3_SECRET_KEY", config.secretKey),
                updateSetting("S3_BUCKET_LPR", config.lpr),
                updateSetting("S3_BUCKET_FACE", config.face),
                updateSetting("S3_BUCKET_QUEUE", config.queue),
            ]);
            toast.success({ title: "Configuracion de almacenamiento guardada" });
            cargar();
        } catch {
            toast.error({ title: "No se pudo guardar la configuracion" });
        } finally { setSaving(false); }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const res = await Promise.all(activos.map(async (m) => ({ m, r: await testS3Connection(m.key) as any })));
            const fallan = res.filter((x) => !x.r?.success);
            if (fallan.length === 0) toast.success({ title: "Conexion correcta - " + res.length + " bucket(s) accesible(s)" });
            else fallan.forEach((f) => toast.error({ title: f.m.label + ": " + (f.r?.message || "sin acceso") }));
        } catch {
            toast.error({ title: "No se pudo conectar con el servidor S3" });
        } finally { setTesting(false); }
    };

    const handleSaveLifecycle = async () => {
        setSavingLifecycle(true);
        try {
            const res = await Promise.all(activos.map((m) => updateBucketLifecycle(bucketDe(m.key), lifecycles[m.key])));
            if (res.every((r: any) => r?.success)) toast.success({ title: "Politicas de retencion actualizadas" });
            else toast.error({ title: "Algunas politicas no se pudieron aplicar" });
        } catch {
            toast.error({ title: "Error de comunicacion con S3" });
        } finally { setSavingLifecycle(false); }
    };

    const handleExportConfig = () => {
        const data = { version: "1.1", timestamp: new Date().toISOString(), type: "storage_config", config: { s3: config, lifecycle: lifecycles } };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "omniaccess-storage-" + new Date().toISOString().split("T")[0] + ".json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast.success({ title: "Configuracion exportada" });
    };

    const handleImportConfig = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        setImportingConfig(true);
        try {
            const json = JSON.parse(await file.text());
            if (json.type !== "storage_config" || !json.config) throw new Error("Archivo invalido");
            const s3 = json.config.s3 || {};
            await Promise.all([
                updateSetting("S3_ENDPOINT", s3.endpoint ?? ""),
                updateSetting("S3_ACCESS_KEY", s3.accessKey ?? ""),
                updateSetting("S3_SECRET_KEY", s3.secretKey ?? ""),
                updateSetting("S3_BUCKET_LPR", s3.lpr ?? s3.bucketLpr ?? "lpr-prod"),
                updateSetting("S3_BUCKET_FACE", s3.face ?? s3.bucketFace ?? "face"),
                updateSetting("S3_BUCKET_QUEUE", s3.queue ?? s3.bucketQueue ?? "queue"),
            ]);
            toast.success({ title: "Configuracion importada" });
            cargar();
        } catch (e: any) {
            toast.error({ title: "No se pudo importar: " + e.message });
        } finally {
            setImportingConfig(false);
            if (configFileRef.current) configFileRef.current.value = "";
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 bg-card/50 rounded-2xl border border-border">
                <RefreshCcw className="animate-spin text-sky-500" />
            </div>
        );
    }

    const usadoBuckets = activos.reduce((acc, m) => acc + (stats[m.key]?.size || 0), 0);
    const pct = cap?.percent ?? 0;
    const capBar = pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
    const capText = pct >= 90 ? "text-rose-400" : pct >= 75 ? "text-amber-400" : "text-emerald-400";

    return (
        <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-6 md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><HardDrive size={20} /></div>
                        <div>
                            <h2 className="text-xl font-bold text-foreground tracking-tight">Capacidad de almacenamiento</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {cap?.success ? "Disco de MinIO - " + cap.path : "No se pudo leer el disco de MinIO"}
                            </p>
                        </div>
                    </div>
                    <button onClick={cargar} className="h-9 px-3 rounded-lg border border-border bg-muted/50 hover:bg-accent text-xs font-semibold text-muted-foreground hover:text-foreground transition inline-flex items-center gap-2">
                        <RefreshCcw size={13} /> Actualizar
                    </button>
                </div>

                {cap?.success ? (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                            <div className="rounded-xl border border-border bg-background/40 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</div>
                                <div className="text-lg font-bold mt-1 text-foreground">{fmt(cap.total)}</div>
                            </div>
                            <div className="rounded-xl border border-border bg-background/40 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Usado</div>
                                <div className={cn("text-lg font-bold mt-1", capText)}>{fmt(cap.used)}</div>
                            </div>
                            <div className="rounded-xl border border-border bg-background/40 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Libre</div>
                                <div className="text-lg font-bold mt-1 text-emerald-400">{fmt(cap.free)}</div>
                            </div>
                            <div className="rounded-xl border border-border bg-background/40 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">En buckets</div>
                                <div className="text-lg font-bold mt-1 text-sky-400">{fmt(usadoBuckets)}</div>
                            </div>
                        </div>

                        <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", capBar)} style={{ width: Math.min(pct, 100) + "%" }} />
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs">
                            <span className={cn("font-bold", capText)}>{pct}% ocupado</span>
                            <span className="text-muted-foreground">
                                {pct >= 90 ? "Critico: liberar espacio o reducir la retencion" : pct >= 75 ? "Atencion: queda menos de un cuarto libre" : "Espacio suficiente"}
                            </span>
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">Sin datos del disco. Verifica que MinIO corra en este mismo servidor.</p>
                )}
            </div>

            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-6 md:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Almacenamiento (Lifecycle &amp; S3)</h2>
                        <p className="text-sm text-muted-foreground mt-1">Retencion de datos y conexion con MinIO - solo los modos activos</p>
                    </div>
                    <div className="flex bg-card border border-border rounded-lg p-1">
                        <Button onClick={handleExportConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent uppercase">
                            <Download size={14} className="mr-2" /> Exportar
                        </Button>
                        <div className="w-px bg-foreground/10 my-1 mx-1" />
                        <input type="file" ref={configFileRef} onChange={handleImportConfig} className="hidden" accept=".json" />
                        <Button onClick={() => configFileRef.current?.click()} disabled={importingConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent uppercase">
                            {importingConfig ? <RefreshCcw size={14} className="animate-spin mr-2" /> : <Upload size={14} className="mr-2" />} Importar
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-5 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Activity size={18} className="text-amber-400" />
                            <h3 className="text-lg font-bold text-foreground">Politicas de retencion</h3>
                        </div>

                        {activos.length === 0 && (
                            <p className="text-sm text-muted-foreground">No hay modos activos. Active uno en Configuracion - Modos.</p>
                        )}

                        {activos.map((m) => {
                            const t = TONES[m.tone];
                            const st = stats[m.key];
                            const dias = lifecycles[m.key];
                            const Icono = m.Icon;
                            return (
                                <div key={m.key} className={cn("rounded-xl border bg-background/40 p-5", t.ring)}>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2.5">
                                            <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", t.bg, t.text)}><Icono size={17} /></div>
                                            <div>
                                                <div className="text-sm font-bold text-foreground leading-tight">{m.label}</div>
                                                <div className="text-[11px] text-muted-foreground font-mono">{bucketDe(m.key)}</div>
                                            </div>
                                        </div>
                                        <div className={cn("px-2.5 py-1 rounded-md text-[10px] font-bold", t.bg, t.text)}>
                                            {dias === 0 ? "SIN BORRADO" : dias + " DIAS"}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 mb-4">
                                        <Input
                                            type="number" min={0} value={dias}
                                            onChange={(e) => setLifecycles({ ...lifecycles, [m.key]: parseInt(e.target.value) || 0 })}
                                            className={cn("bg-background border-border h-9 w-20 text-center font-bold text-sm", t.text)}
                                        />
                                        <span className="text-[11px] text-muted-foreground leading-tight">Dias que se guardan las capturas antes de borrarse. 0 = no se borran.</span>
                                    </div>

                                    <div className="pt-3 border-t border-border flex justify-between items-center text-[11px] text-muted-foreground font-mono">
                                        <span>{st.loading ? "..." : st.count.toLocaleString() + " archivos"}</span>
                                        <span className={cn(!st.loading && "text-foreground font-semibold")}>{st.loading ? "..." : fmt(st.size)}</span>
                                    </div>
                                </div>
                            );
                        })}

                        {activos.length > 0 && (
                            <Button onClick={handleSaveLifecycle} disabled={savingLifecycle}
                                className="w-full bg-amber-600/10 hover:bg-amber-600 text-amber-500 hover:text-white font-bold text-[10px] uppercase tracking-widest h-10 border border-amber-600/20">
                                {savingLifecycle ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Save className="mr-2" size={12} />}
                                Guardar politicas
                            </Button>
                        )}
                    </div>

                    <div className="lg:col-span-7 space-y-5">
                        <div className="flex items-center gap-2">
                            <Cloud size={18} className="text-sky-400" />
                            <h3 className="text-lg font-bold text-foreground">Conexion MinIO / S3</h3>
                        </div>

                        <div className="bg-background/30 rounded-xl p-6 border border-border space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Endpoint (API)</Label>
                                <Input placeholder="http://127.0.0.1:9000" value={config.endpoint}
                                    onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                                    className="bg-background border-border h-10 text-sm font-mono" />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Access Key</Label>
                                    <Input value={config.accessKey} onChange={(e) => setConfig({ ...config, accessKey: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Secret Key</Label>
                                    <Input type="password" placeholder="********" value={config.secretKey}
                                        onChange={(e) => setConfig({ ...config, secretKey: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono" />
                                </div>
                            </div>

                            <div className="pt-1">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1 flex items-center gap-1.5 mb-2">
                                    <Database size={12} /> Buckets de los modos activos
                                </Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {activos.map((m) => (
                                        <div key={m.key} className="space-y-1.5">
                                            <Label className={cn("text-[10px] font-bold uppercase ml-1", TONES[m.tone].text)}>{m.label}</Label>
                                            <Input value={bucketDe(m.key)}
                                                onChange={(e) => setConfig({ ...config, [m.key]: e.target.value } as any)}
                                                className="bg-background border-border h-10 text-sm font-mono" />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 flex flex-col sm:flex-row gap-3">
                                <Button variant="ghost" onClick={handleTest} disabled={testing || saving}
                                    className="flex-1 text-muted-foreground hover:text-foreground hover:bg-accent font-bold h-10 border border-border text-[10px] uppercase">
                                    {testing ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Activity className="mr-2" size={12} />} Probar conexion
                                </Button>
                                <Button onClick={handleSave} disabled={saving || testing}
                                    className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-bold h-10 text-[10px] uppercase shadow-lg shadow-sky-600/20">
                                    {saving ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Save className="mr-2" size={12} />} Guardar
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
