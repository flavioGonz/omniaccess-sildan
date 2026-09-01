"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
    Activity,
    Check,
    Database,
    Download,
    FileText,
    RefreshCcw,
    Settings,
    ShieldAlert,
    Table as TableIcon,
    Upload,
    X
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
import { testDbConnection, getDbStats, downloadBackup, restoreBackup, populateDatabase, testExternalDbConnection, updateDatabaseUrl, runDatabaseMigrations } from "@/app/actions/settings";

export default function DatabaseSection() {
    const [testing, setTesting] = useState(false);
    const [stats, setStats] = useState<{
        totalSize: string,
        tables: { table_name: string, row_count: number, total_size: string }[],
        host?: string,
        port?: string
    } | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);
    const [backingUp, setBackingUp] = useState(false);

    // New state for switching DB
    const [showSwitchDb, setShowSwitchDb] = useState(false);
    const [newDbUrl, setNewDbUrl] = useState("");
    const [testingExternal, setTestingExternal] = useState(false);
    const [externalStatus, setExternalStatus] = useState<{ success: boolean, message: string, isVirgin?: boolean } | null>(null);
    const [migrating, setMigrating] = useState(false);

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        setLoadingStats(true);
        try {
            const res = await getDbStats();
            if (res.success) {
                setStats({
                    totalSize: res.totalSize || "0 B",
                    tables: res.tables || [],
                    host: res.host,
                    port: res.port
                });
            }
        } catch (err) {
            console.error("Error loading DB stats:", err);
        } finally {
            setLoadingStats(false);
        }
    };

    const handleTestDb = async () => {
        setTesting(true);
        try {
            const res = await testDbConnection();
            if (res.success) {
                toast.success({ title: "¡Conexión Exitosa con PostgreSQL!" });
                loadStats();
            } else {
                toast.error({ title: `Error de conexión: ${res.message}` });
            }
        } catch (err) {
            toast.error({ title: "Error crítico al intentar conectar con la base de datos" });
        } finally {
            setTesting(false);
        }
    };

    const handleTestExternal = async () => {
        if (!newDbUrl) return toast.error({ title: "Por favor ingresa una URL de conexión" });
        setTestingExternal(true);
        setExternalStatus(null);
        try {
            const res = await testExternalDbConnection(newDbUrl);
            setExternalStatus(res);
            if (res.success) {
                toast.success({ title: res.isVirgin ? "Conexión exitosa. Base de datos virgen detectada." : "Conexión exitosa con base de datos existente." });
            } else {
                toast.error({ title: "Error de conexión externa: " + res.message });
            }
        } catch (err) {
            toast.error({ title: "Error al testear base de datos externa" });
        } finally {
            setTestingExternal(false);
        }
    };

    const handleApplyExternal = async () => {
        if (!externalStatus?.success) return;

        if (confirm("¿Estás seguro de cambiar la base de datos? La aplicación se reiniciará.")) {
            const res = await updateDatabaseUrl(newDbUrl);
            if (res.success) {
                toast.success({ title: "Configuración actualizada. Reiniciando..." });
                setTimeout(() => window.location.reload(), 3000);
            } else {
                toast.error({ title: "Error al actualizar: " + res.message });
            }
        }
    };

    const handleRunMigrations = async () => {
        setMigrating(true);
        try {
            const res = await runDatabaseMigrations();
            if (res.success) {
                toast.success({ title: "Migraciones completadas correctamente" });
                loadStats();
                setExternalStatus(prev => prev ? { ...prev, isVirgin: false } : null);
            } else {
                toast.error({ title: "Error en migraciones: " + res.message });
            }
        } catch (err) {
            toast.error({ title: "Error crítico en migraciones" });
        } finally {
            setMigrating(false);
        }
    };

    const handleBackup = async () => {
        setBackingUp(true);
        try {
            const res = await downloadBackup();
            if (res.success) {
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `omniaccess-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.success({ title: "Respaldo generado y descargado con éxito" });
            } else {
                toast.error({ title: "Error al generar el respaldo: " + res.message });
            }
        } catch (err) {
            toast.error({ title: "Error durante el proceso de respaldo" });
        } finally {
            setBackingUp(false);
        }
    };

    const [importing, setImporting] = useState(false);
    const [populating, setPopulating] = useState(false);
    const [pendingAction, setPendingAction] = useState<{
        type: 'IMPORT' | 'POPULATE',
        file?: File,
        analysis?: {
            users: number,
            vehicles: number,
            devices: number,
            events: number,
            units: number
        }
    } | null>(null);
    const [mergeMode, setMergeMode] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const triggerImport = () => {
        fileInputRef.current?.click();
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                const analysis = {
                    users: json.data?.users?.length || 0,
                    vehicles: json.data?.vehicles?.length || 0,
                    devices: json.data?.devices?.length || 0,
                    events: json.data?.events?.length || 0,
                    units: json.data?.units?.length || 0
                };
                setMergeMode(false); // Reset to default (Replace)
                setPendingAction({ type: 'IMPORT', file, analysis });
            } catch (err) {
                toast.error({ title: "Archivo de respaldo inválido" });
            }
        }
    };

    const confirmAction = async () => {
        if (!pendingAction) return;

        if (pendingAction.type === 'IMPORT') {
            setImporting(true);
            try {
                if (!pendingAction.file) return;
                const text = await pendingAction.file.text();
                const json = JSON.parse(text);

                const res = await restoreBackup(json, mergeMode);
                if (res.success) {
                    toast.success({ title: `Base de datos restaurada correctamente` });
                    loadStats();
                } else {
                    toast.error({ title: "Error al restaurar: " + res.message });
                }
            } catch (error) {
                console.error(error);
                toast.error({ title: "Error al procesar el archivo de respaldo" });
            } finally {
                setImporting(false);
            }
        } else if (pendingAction.type === 'POPULATE') {
            setPopulating(true);
            try {
                const res = await populateDatabase();
                if (res.success) {
                    toast.success({ title: res.message || "Base de datos inicializada con datos de prueba" });
                    loadStats();
                } else {
                    toast.error({ title: "Error al poblar: " + res.message });
                }
            } catch (error) {
                toast.error({ title: "Error al poblar la base de datos" });
            } finally {
                setPopulating(false);
            }
        }
        setPendingAction(null);
    };

    return (
        <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">PostgreSQL Database</h2>
                        <p className="text-sm text-muted-foreground mt-1">Gestión avanzada y salud del motor de datos</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            onClick={() => setShowSwitchDb(!showSwitchDb)}
                            variant="outline"
                            className="bg-background border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                        >
                            <Settings size={16} className="mr-2" />
                            {showSwitchDb ? "Cerrar Config" : "Cambiar Base de Datos"}
                        </Button>
                        <div className="flex flex-col items-end">
                            <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg mb-1">
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Peso Total DB</span>
                            </div>
                            <span className="text-xl font-mono font-bold text-foreground">
                                {loadingStats ? "..." : stats?.totalSize || "N/A"}
                            </span>
                        </div>
                    </div>
                </div>

                {showSwitchDb && (
                    <div className="mb-8 p-6 bg-blue-500/5 border border-blue-500/10 rounded-xl animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-blue-500/20 rounded-lg">
                                <Database className="text-blue-400" size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-tight">Configurar Nueva Conexión</h3>
                                <p className="text-[10px] text-muted-foreground uppercase font-bold">Cambia la base de datos sin afectar la actual</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-3">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground mb-2 block">String de Conexión (DATABASE_URL)</Label>
                                    <Input
                                        value={newDbUrl}
                                        onChange={(e) => setNewDbUrl(e.target.value)}
                                        placeholder="postgresql://user:pass@host:5432/dbname?schema=public"
                                        className="bg-background border-border h-10 font-mono text-xs"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button
                                        onClick={handleTestExternal}
                                        disabled={testingExternal || !newDbUrl}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-foreground font-bold h-10 text-[10px] uppercase tracking-widest"
                                    >
                                        {testingExternal ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Activity className="mr-2" size={12} />}
                                        Testear
                                    </Button>
                                </div>
                            </div>

                            {externalStatus && (
                                <div className={cn(
                                    "p-4 rounded-lg flex items-center justify-between animate-in zoom-in-95",
                                    externalStatus.success ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"
                                )}>
                                    <div className="flex items-center gap-3">
                                        {externalStatus.success ? <Check className="text-emerald-400" size={18} /> : <X className="text-red-400" size={18} />}
                                        <div>
                                            <p className={cn("text-xs font-bold", externalStatus.success ? "text-emerald-400" : "text-red-400")}>
                                                {externalStatus.success ? "Conexión Exitosa" : "Error de Conexión"}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">{externalStatus.message}</p>
                                        </div>
                                    </div>

                                    {externalStatus.success && (
                                        <div className="flex gap-2">
                                            {externalStatus.isVirgin && (
                                                <Button
                                                    onClick={handleRunMigrations}
                                                    disabled={migrating}
                                                    className="bg-amber-600 hover:bg-amber-500 text-foreground font-bold h-8 text-[9px] uppercase tracking-widest"
                                                >
                                                    {migrating ? <RefreshCcw className="animate-spin mr-2" size={10} /> : <FileText className="mr-2" size={10} />}
                                                    Poblar Tablas (Prisma)
                                                </Button>
                                            )}
                                            <Button
                                                onClick={handleApplyExternal}
                                                className="bg-emerald-600 hover:bg-emerald-500 text-foreground font-bold h-8 text-[9px] uppercase tracking-widest"
                                            >
                                                Aplicar Cambio
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Connection Health */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-background/50 border border-border rounded-xl p-6 h-full flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-blue-500/10 rounded-lg">
                                        <Activity className="text-blue-400" size={20} />
                                    </div>
                                    <h3 className="font-bold text-foreground text-sm uppercase tracking-tight">Estado de Red</h3>
                                </div>
                                <div className="space-y-3 mb-6">
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        Asegura que el microservicio Prisma pueda comunicarse con la instancia de Postgres.
                                    </p>
                                    {!loadingStats && stats?.host && (
                                        <div className="p-3 bg-background rounded-lg border border-border">
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1">Endpoint Actual</p>
                                            <p className="text-xs font-mono font-bold text-blue-400">{stats.host}:{stats.port}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <Button
                                onClick={handleTestDb}
                                disabled={testing}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-foreground font-bold h-11 text-[10px] uppercase tracking-widest transition-all"
                            >
                                {testing ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Activity className="mr-2" size={14} />}
                                TESTEAR CONEXIÓN
                            </Button>
                        </div>
                    </div>

                    {/* Tables Stats */}
                    <div className="lg:col-span-2">
                        <div className="bg-background/50 border border-border rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-purple-500/10 rounded-lg">
                                        <TableIcon className="text-purple-400" size={20} />
                                    </div>
                                    <h3 className="font-bold text-foreground text-sm uppercase tracking-tight">Esquema & Tablas</h3>
                                </div>
                                <button onClick={loadStats} className="text-muted-foreground hover:text-foreground transition-colors">
                                    <RefreshCcw size={14} className={loadingStats ? "animate-spin" : ""} />
                                </button>
                            </div>

                            <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                {loadingStats ? (
                                    <p className="text-[10px] text-muted-foreground animate-pulse font-bold uppercase">Obteniendo esquema...</p>
                                ) : stats?.tables.map((table, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-foreground/[0.04] border border-border rounded-lg hover:bg-accent transition-all group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-muted group-hover:bg-purple-500 transition-colors" />
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">{table.table_name}</span>
                                        </div>
                                        <div className="flex items-center gap-4 font-mono text-[10px]">
                                            <span className="text-muted-foreground">{table.row_count} rows</span>
                                            <span className="text-muted-foreground font-bold">{table.total_size}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Backup & Import Section */}
                <div className="mt-8 pt-8 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-card border border-border p-6 rounded-xl flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
                                <Download size={24} />
                            </div>
                            <div>
                                <p className="text-foreground font-bold uppercase tracking-tight text-xs">Respaldo Integral</p>
                                <p className="text-[10px] text-muted-foreground font-medium">Exportar toda la configuración y registros a JSON</p>
                            </div>
                        </div>
                        <Button
                            onClick={handleBackup}
                            disabled={backingUp}
                            className="bg-muted hover:bg-amber-600 text-muted-foreground hover:text-foreground font-bold text-[9px] uppercase tracking-widest px-4 h-9 transition-all"
                        >
                            {backingUp ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Download size={12} className="mr-2" />}
                            EXPORTAR
                        </Button>
                    </div>

                    {/* Database Actions Grid */}
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Backup */}
                        <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 mb-3 border border-amber-500/10">
                                    <Download size={20} />
                                </div>
                                <h3 className="text-foreground font-bold uppercase text-xs mb-1">Respaldo</h3>
                                <p className="text-[10px] text-muted-foreground">Descargar copia completa JSON</p>
                            </div>
                            <Button
                                onClick={handleBackup}
                                disabled={backingUp}
                                className="w-full bg-muted hover:bg-amber-600 text-muted-foreground hover:text-foreground font-bold text-[9px] uppercase tracking-widest h-8"
                            >
                                {backingUp ? "Exportando..." : "Exportar"}
                            </Button>
                        </div>

                        {/* Import */}
                        <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 mb-3 border border-blue-500/10">
                                    <Upload size={20} />
                                </div>
                                <h3 className="text-foreground font-bold uppercase text-xs mb-1">Restaurar</h3>
                                <p className="text-[10px] text-muted-foreground">Importar backup existente</p>
                            </div>
                            <div className="relative">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={onFileSelected}
                                    className="hidden"
                                    accept=".json"
                                />
                                <Button
                                    onClick={triggerImport}
                                    disabled={importing}
                                    className="w-full bg-muted hover:bg-blue-600 text-muted-foreground hover:text-foreground font-bold text-[9px] uppercase tracking-widest h-8 border border-border"
                                >
                                    {importing ? "Restaurando..." : "Seleccionar Archivo"}
                                </Button>
                            </div>
                        </div>

                        {/* Populate / Init */}
                        <div className="bg-card border border-border p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 mb-3 border border-purple-500/10">
                                    <Database size={20} />
                                </div>
                                <h3 className="text-foreground font-bold uppercase text-xs mb-1">Inicializar</h3>
                                <p className="text-[10px] text-muted-foreground">Poblar nueva DB o Resetear</p>
                            </div>
                            <Button
                                onClick={() => setPendingAction({ type: 'POPULATE' })}
                                disabled={populating}
                                className="w-full bg-muted hover:bg-purple-600 text-muted-foreground hover:text-foreground font-bold text-[9px] uppercase tracking-widest h-8 border border-border"
                            >
                                {populating ? "Poblando..." : "Poblar Datos"}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Confirmation Modal for Database Actions */}
            {/* Confirmation Modal for Database Actions */}
            {pendingAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setPendingAction(null)}>
                    <div className="bg-card border border-border rounded-xl max-w-lg w-full mx-4 overflow-hidden shadow-lg p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                                <ShieldAlert size={32} />
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-2">
                                {pendingAction.type === 'IMPORT' ? 'Análisis de Restauración' : '¿Reiniciar Base de Datos?'}
                            </h3>

                            {pendingAction.type === 'IMPORT' && pendingAction.analysis ? (
                                <div className="text-left mt-4 mb-6">
                                    <div className="flex items-center justify-center gap-4 mb-6 bg-background p-3 rounded-lg border border-border">
                                        <span className={cn("text-xs font-bold", !mergeMode ? "text-red-400" : "text-muted-foreground")}>REEMPLAZAR TODO</span>
                                        <Switch checked={mergeMode} onCheckedChange={setMergeMode} />
                                        <span className={cn("text-xs font-bold", mergeMode ? "text-blue-400" : "text-muted-foreground")}>FUSIONAR (MERGE)</span>
                                    </div>

                                    <div className="bg-background rounded-lg border border-border overflow-hidden">
                                        <table className="w-full text-[10px]">
                                            <thead className="bg-foreground/10 text-muted-foreground font-bold uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-3 py-2 text-left">Tabla</th>
                                                    <th className="px-3 py-2 text-center">Datos Nuevos</th>
                                                    <th className="px-3 py-2 text-center text-foreground">Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5 text-muted-foreground">
                                                {[
                                                    { label: "Usuarios", count: pendingAction.analysis.users },
                                                    { label: "Vehículos", count: pendingAction.analysis.vehicles },
                                                    { label: "Unidades", count: pendingAction.analysis.units },
                                                    { label: "Eventos", count: pendingAction.analysis.events },
                                                ].map((row, i) => (
                                                    <tr key={i}>
                                                        <td className="px-3 py-2 font-bold">{row.label}</td>
                                                        <td className="px-3 py-2 text-center font-mono">{row.count}</td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className={cn(
                                                                "px-2 py-0.5 rounded font-bold uppercase text-[9px]",
                                                                mergeMode ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"
                                                            )}>
                                                                {mergeMode ? "+ AGREGAR" : "SOBREESCRIBIR"}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-4 text-center">
                                        {mergeMode
                                            ? "Se agregarán los registros nuevos. Los existentes se mantendrán."
                                            : "ADVERTENCIA: Se BORRARÁN todos los datos actuales antes de importar."}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Esta acción borrará los datos actuales y poblará la base de datos con información inicial/de prueba. ¿Estás seguro?
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Button onClick={() => setPendingAction(null)} variant="ghost" className="h-10 text-muted-foreground hover:bg-accent hover:text-foreground font-bold rounded-lg border border-border">
                                Cancelar
                            </Button>
                            <Button onClick={confirmAction} className={cn("h-10 text-foreground font-bold rounded-lg", mergeMode ? "bg-blue-600 hover:bg-blue-500" : "bg-red-600 hover:bg-red-500")}>
                                {pendingAction.type === 'IMPORT' ? (mergeMode ? 'Confirmar Fusión' : 'Confirmar Reemplazo') : 'Sí, Inicializar'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

