"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
    Activity,
    Cloud,
    Download,
    RefreshCcw,
    Save,
    Settings,
    Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { testS3Connection, getBucketLifecycle, updateBucketLifecycle, getBucketStats, getSetting, updateSetting } from "@/app/actions/settings";
import { getEnabledModules } from "@/app/actions/modules";

export default function StorageSection() {
    const [config, setConfig] = useState({
        endpoint: "",
        accessKey: "",
        secretKey: "",
        bucketLpr: "lpr",
        bucketFace: "face",
        bucketQueue: "lpr"
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [lifecycles, setLifecycles] = useState({
        lpr: 0,
        face: 0
    });
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [stats, setStats] = useState({
        lpr: { size: 0, count: 0, loading: true },
        face: { size: 0, count: 0, loading: true }
    });
    const [importingConfig, setImportingConfig] = useState(false);
    const [modules, setModules] = useState<any>({ MODULE_LPR: true, MODULE_FACE: false, MODULE_QUEUE: false });
    useEffect(() => { getEnabledModules().then(setModules).catch(() => {}); }, []);
    const configFileRef = useRef<HTMLInputElement>(null);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const [e, ak, sk, bl, bf] = await Promise.all([
                getSetting("S3_ENDPOINT"),
                getSetting("S3_ACCESS_KEY"),
                getSetting("S3_SECRET_KEY"),
                getSetting("S3_BUCKET_LPR"),
                getSetting("S3_BUCKET_FACE")
            ]);
            setConfig({
                endpoint: e?.value || "",
                accessKey: ak?.value || "",
                secretKey: sk?.value || "",
                bucketLpr: bl?.value || "lpr",
                bucketFace: bf?.value || "face",
                bucketQueue: ((await getSetting("S3_BUCKET_QUEUE"))?.value) || bl?.value || "lpr"
            });

            // Load stats
            const [statsLpr, statsFace] = await Promise.all([
                getBucketStats(bl?.value || "lpr"),
                getBucketStats(bf?.value || "face")
            ]);

            setStats({
                lpr: {
                    size: statsLpr.success ? (statsLpr.size ?? 0) : 0,
                    count: statsLpr.success ? (statsLpr.count ?? 0) : 0,
                    loading: false
                },
                face: {
                    size: statsFace.success ? (statsFace.size ?? 0) : 0,
                    count: statsFace.success ? (statsFace.count ?? 0) : 0,
                    loading: false
                }
            });
        } catch (err) {
            console.error("Error loading S3 settings:", err);
        } finally {
            setLoading(false);
        }
    };

    const loadLifecycles = async () => {
        try {
            const [lcLpr, lcFace] = await Promise.all([
                getBucketLifecycle(config.bucketLpr || "lpr"),
                getBucketLifecycle(config.bucketFace || "face")
            ]);

            setLifecycles({
                lpr: lcLpr.success ? lcLpr.days || 0 : 0,
                face: lcFace.success ? lcFace.days || 0 : 0
            });
        } catch (err) {
            console.error("Error loading S3 lifecycles:", err);
        }
    };

    useEffect(() => {
        loadConfig();
        loadLifecycles();
    }, []);

    const handleExportConfig = () => {
        const exportData = {
            version: "1.0",
            timestamp: new Date().toISOString(),
            type: "storage_config",
            config: {
                s3: config,
                lifecycle: lifecycles
            }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `omniaccess-storage-config-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success({ title: "Configuración exportada con éxito" });
    };

    const triggerImportConfig = () => {
        configFileRef.current?.click();
    };

    const handleImportConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImportingConfig(true);
        try {
            const text = await file.text();
            const json = JSON.parse(text);

            if (json.type !== "storage_config" || !json.config) {
                throw new Error("Archivo de configuración inválido");
            }

            const { s3, lifecycle } = json.config;

            // Update S3 Settings
            await Promise.all([
                updateSetting("S3_ENDPOINT", s3.endpoint),
                updateSetting("S3_ACCESS_KEY", s3.accessKey),
                updateSetting("S3_SECRET_KEY", s3.secretKey),
                updateSetting("S3_BUCKET_LPR", s3.bucketLpr),
                updateSetting("S3_BUCKET_FACE", s3.bucketFace),
                updateSetting("S3_BUCKET_QUEUE", s3.bucketQueue),
                updateBucketLifecycle(s3.bucketLpr, lifecycle.lpr),
                updateBucketLifecycle(s3.bucketFace, lifecycle.face)
            ]);

            toast.success({ title: "Configuración importada y aplicada correctamente" });
            // Reload local state
            loadConfig();
            loadLifecycles();

        } catch (error: any) {
            console.error(error);
            toast.error({ title: "Error al importar configuración: " + error.message });
        } finally {
            setImportingConfig(false);
            if (configFileRef.current) configFileRef.current.value = "";
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await Promise.all([
                updateSetting("S3_ENDPOINT", config.endpoint),
                updateSetting("S3_ACCESS_KEY", config.accessKey),
                updateSetting("S3_SECRET_KEY", config.secretKey),
                updateSetting("S3_BUCKET_LPR", config.bucketLpr),
                updateSetting("S3_BUCKET_FACE", config.bucketFace),
                updateSetting("S3_BUCKET_QUEUE", config.bucketQueue)
            ]);
            toast.success({ title: "Configuración de almacenamiento guardada" });
        } catch (err) {
            toast.error({ title: "Error al guardar la configuración" });
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            const resLpr = await testS3Connection("lpr");
            const resFace = await testS3Connection("face");

            if (resLpr.success && resFace.success) {
                toast.success({ title: "¡Prueba exitosa! Ambos buckets son accesibles." });
            } else {
                if (!resLpr.success) toast.error({ title: `LPR: ${resLpr.message}` });
                if (!resFace.success) toast.error({ title: `FACE: ${resFace.message}` });
            }
        } catch (err) {
            toast.error({ title: "Error crítico al intentar conectar con el servidor S3" });
        } finally {
            setTesting(false);
        }
    };

    const handleSaveLifecycle = async () => {
        setSavingLifecycle(true);
        try {
            const resLpr = await updateBucketLifecycle(config.bucketLpr, lifecycles.lpr);
            const resFace = await updateBucketLifecycle(config.bucketFace, lifecycles.face);

            if (resLpr.success && resFace.success) {
                toast.success({ title: "Políticas de retención actualizadas correctamente" });
            } else {
                toast.error({ title: "Error al actualizar algunas políticas" });
            }
        } catch (err) {
            toast.error({ title: "Error de comunicación S3" });
        } finally {
            setSavingLifecycle(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 bg-card/50 rounded-2xl border border-border">
                <RefreshCcw className="animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Almacenamiento (Lifecycle & S3)</h2>
                        <p className="text-sm text-muted-foreground mt-1">Gestión de retención de datos y conexión con Object Storage</p>
                    </div>
                    <div className="flex bg-card border border-border rounded-lg p-1">
                        <Button onClick={handleExportConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent uppercase">
                            <Download size={14} className="mr-2" />
                            Exportar Config
                        </Button>
                        <div className="w-px bg-foreground/10 my-1 mx-1"></div>
                        <input
                            type="file"
                            ref={configFileRef}
                            onChange={handleImportConfig}
                            className="hidden"
                            accept=".json"
                        />
                        <Button onClick={triggerImportConfig} disabled={importingConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent uppercase">
                            {importingConfig ? <RefreshCcw size={14} className="animate-spin mr-2" /> : <Upload size={14} className="mr-2" />}
                            Importar Config
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Column: Lifecycle Policies (First priority) */}
                    <div className="lg:col-span-5 space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Activity size={18} className="text-amber-400" />
                            <h3 className="text-lg font-bold text-foreground">Políticas de Retención</h3>
                        </div>

                        {/* LPR Retention */}
                        <div className="bg-background/40 border border-border rounded-xl p-5 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-xs font-bold text-foreground uppercase tracking-tight">Bucket LPR</Label>
                                <div className="px-2 py-0.5 bg-blue-500/10 rounded text-[10px] font-bold text-blue-400">
                                    {lifecycles.lpr === 0 ? "INFINITO" : `${lifecycles.lpr} DÍAS`}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 mb-4">
                                <Input
                                    type="number"
                                    value={lifecycles.lpr}
                                    onChange={e => setLifecycles({ ...lifecycles, lpr: parseInt(e.target.value) || 0 })}
                                    className="bg-background border-border h-9 w-20 text-center font-bold text-blue-400 text-sm"
                                />
                                <span className="text-[10px] text-muted-foreground leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-border flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                                <span>{stats.lpr.loading ? "..." : stats.lpr.count.toLocaleString()} archivos</span>
                                <span>{stats.lpr.loading ? "..." : formatSize(stats.lpr.size)}</span>
                            </div>
                        </div>

                        {modules.MODULE_FACE && (
                        {/* FACE Retention */}
                        <div className="bg-background/40 border border-border rounded-xl p-5 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-xs font-bold text-foreground uppercase tracking-tight">Bucket FACE</Label>
                                <div className="px-2 py-0.5 bg-purple-500/10 rounded text-[10px] font-bold text-purple-400">
                                    {lifecycles.face === 0 ? "INFINITO" : `${lifecycles.face} DÍAS`}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 mb-4">
                                <Input
                                    type="number"
                                    value={lifecycles.face}
                                    onChange={e => setLifecycles({ ...lifecycles, face: parseInt(e.target.value) || 0 })}
                                    className="bg-background border-border h-9 w-20 text-center font-bold text-purple-400 text-sm"
                                />
                                <span className="text-[10px] text-muted-foreground leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-border flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                                <span>{stats.face.loading ? "..." : stats.face.count.toLocaleString()} archivos</span>
                                <span>{stats.face.loading ? "..." : formatSize(stats.face.size)}</span>
                            </div>
                        </div>
                        )}

                        <Button
                            onClick={handleSaveLifecycle}
                            disabled={savingLifecycle || loading}
                            className="w-full bg-amber-600/10 hover:bg-amber-600 text-amber-500 hover:text-foreground font-bold text-[10px] uppercase tracking-widest h-10 border border-amber-600/20"
                        >
                            {savingLifecycle ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Save className="mr-2" size={12} />}
                            GUARDAR POLÍTICAS
                        </Button>
                    </div>

                    {/* Right Column: S3 Configuration */}
                    <div className="lg:col-span-7 space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Cloud size={18} className="text-blue-400" />
                            <h3 className="text-lg font-bold text-foreground">Configuración S3 / MinIO</h3>
                        </div>

                        <div className="bg-background/20 rounded-xl p-6 border border-border space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Endpoint (API)</Label>
                                <Input
                                    placeholder="http://192.168.99.108:9000"
                                    value={config.endpoint}
                                    onChange={e => setConfig({ ...config, endpoint: e.target.value })}
                                    className="bg-background border-border h-10 text-sm font-mono"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Access Key</Label>
                                    <Input
                                        placeholder="root"
                                        value={config.accessKey}
                                        onChange={e => setConfig({ ...config, accessKey: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Secret Key</Label>
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        value={config.secretKey}
                                        onChange={e => setConfig({ ...config, secretKey: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Bucket LPR</Label>
                                    <Input
                                        placeholder="lpr"
                                        value={config.bucketLpr}
                                        onChange={e => setConfig({ ...config, bucketLpr: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Bucket Face</Label>
                                    <Input
                                        placeholder="face"
                                        value={config.bucketFace}
                                        onChange={e => setConfig({ ...config, bucketFace: e.target.value })}
                                        className="bg-background border-border h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-amber-400/80 ml-1">Bucket Filas (modo cola)</Label>
                                    <Input
                                        placeholder="lpr-prod"
                                        value={config.bucketQueue}
                                        onChange={e => setConfig({ ...config, bucketQueue: e.target.value })}
                                        className="bg-background border-amber-500/20 h-10 text-sm font-mono"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <Button
                                    variant="ghost"
                                    onClick={handleTest}
                                    disabled={testing || saving}
                                    className="flex-1 text-muted-foreground hover:text-foreground hover:bg-accent font-bold h-10 border border-border text-[10px] uppercase"
                                >
                                    {testing ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Activity className="mr-2" size={12} />}
                                    PROBAR CONEXIÓN
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    disabled={saving || testing}
                                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-foreground font-bold h-10 text-[10px] uppercase shadow-lg shadow-blue-600/20"
                                >
                                    {saving ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Save className="mr-2" size={12} />}
                                    GUARDAR
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}



