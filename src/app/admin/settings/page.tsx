"use client";

import { useState, useRef } from "react";
import {
    Settings,
    Users,
    Bell,
    Database,
    Camera,
    ShieldCheck,
    Save,
    Cpu,
    Cloud,
    ChevronRight,
    Activity,
    Info,
    RefreshCcw,
    ShieldAlert,
    FileText,
    HardDrive,
    Download,
    Upload,
    Table as TableIcon,
    ScanFace,
    ScanLine,
    Car,
    Eye,
    X,
    Check,
    MessageSquare,
    Smartphone,
    Bot,
    ArrowRight,
    Trash2,
    Calendar,
    Plus,
    Pencil,
    User as UserIcon,
    Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DriverDetailsDialog } from "@/components/DriverDetailsDialog";
import { DRIVER_MODELS, type DeviceBrand } from "@/lib/driver-models";
import { updateSetting, getSetting, testS3Connection, getBucketLifecycle, updateBucketLifecycle, testDbConnection, getBucketStats, getDbStats, downloadBackup, restoreBackup, populateDatabase, testWahaConnection, getWahaHistory, testExternalDbConnection, updateDatabaseUrl, runDatabaseMigrations, getLearnedPlates, clearLearnedPlates, testFaceEngineConnection } from "@/app/actions/settings";
import { clearAllVisitorFaces } from "@/app/actions/face-admin";
import { getAdminsList as getAdmins, saveAdmin as saveAdminAction, deleteAdmin as deleteAdminAction } from "@/app/actions/users";
import { useEffect, useTransition } from "react";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

const SETTINGS_SECTIONS = [
    {
        id: "mode_face",
        icon: ScanFace,
        label: "Modo Face",
        description: "Comportamiento Rec. Facial",
        color: "teal"
    },
    {
        id: "mode_lpr",
        icon: ScanLine,
        label: "Modo LPR",
        description: "Lógica de Matrículas",
        color: "amber"
    },
    {
        id: "drivers",
        icon: Camera,
        label: "Drivers & Protocolos",
        description: "Gestiona los controladores de dispositivos",
        color: "blue"
    },
    {
        id: "users",
        icon: Users,
        label: "Administradores",
        description: "Control de acceso al sistema",
        color: "purple"
    },
    {
        id: "notifications",
        icon: Bell,
        label: "Notificaciones",
        description: "Alertas y eventos del sistema",
        color: "amber"
    },
    {
        id: "database",
        icon: Database,
        label: "Database",
        description: "Postgres & Gestión de Datos",
        color: "emerald"
    },
    {
        id: "storage",
        icon: Cloud,
        label: "Almacenamiento",
        description: "Configuración MinIO / S3",
        color: "blue"
    },
    {
        id: "whatsapp",
        icon: MessageSquare,
        label: "Chatbot (WAHA)",
        description: "Notificaciones & IA WhatsApp",
        color: "emerald"
    },

];

const DRIVERS = [
    { brand: "Hikvision", tech: "ISAPI/Event", active: true, color: "red", logo: "/logos/hikvision.png" },
    { brand: "Akuvox", tech: "HTTP/Webhook", active: true, color: "blue", logo: "/logos/akuvox.png" },
    { brand: "Avicam", tech: "HTTP/Webhook", active: true, color: "rose", logo: "https://avicam.com.br/wp-content/uploads/2019/11/logo_avicam.png" },
    { brand: "Dahua", tech: "CGI/HTTP", active: false, color: "red" },
    { brand: "ZKTeco", tech: "Push HTTP", active: false, color: "blue" },
    { brand: "Axis", tech: "Vapix API", active: false, color: "orange" },
    { brand: "Uniview", tech: "SDK Proxy", active: false, color: "blue" },
    { brand: "Intelbras", tech: "CGI/Event", active: false, color: "green" },
    { brand: "UniFi", tech: "Protect API", active: false, color: "blue" },
];

export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState("mode_face");
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
    const [modelSearch, setModelSearch] = useState("");

    return (
        <div className="h-full overflow-y-auto p-6 space-y-8 animate-in fade-in duration-700 custom-scrollbar">


            {/* Tabs Navigation */}
            <div className="sticky top-0 z-40 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 mb-8 -mx-6 px-6 pt-2">
                <div className="flex items-center justify-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                    {SETTINGS_SECTIONS.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSection === section.id;
                        return (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all relative whitespace-nowrap rounded-lg",
                                    isActive
                                        ? "text-white"
                                        : "text-neutral-500 hover:text-neutral-300 hover:bg-white/5"
                                )}
                            >
                                <Icon size={16} className={cn(
                                    "transition-colors",
                                    isActive ? `text-${section.color}-400` : "text-neutral-600 group-hover:text-neutral-400"
                                )} />
                                {section.label}

                                {/* Active Indicator line */}
                                {isActive && (
                                    <div className={cn(
                                        "absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full shadow-[0_-2px_10px_rgba(0,0,0,0.5)]",
                                        `bg-${section.color}-500 shadow-${section.color}-500/50`
                                    )} />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Main Content */}
            <div className="w-full space-y-6">
                <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out">
                    {/* Mode Face Section */}
                    {activeSection === "mode_face" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
                            <ModeConfiguration
                                title="Modo Face"
                                description="Define cómo se comporta el sistema ante eventos de reconocimiento facial"
                                settingKey="MODE_FACE"
                                options={[
                                    { id: "BLACKLIST", label: "Lista Negra", desc: "Las capturas identificadas serán DENEGADAS automáticamente.", icon: ShieldAlert, color: "red" },
                                    { id: "WHITELIST", label: "Lista Blanca", desc: "Las capturas identificadas serán PERMITIDAS automáticamente.", icon: ShieldCheck, color: "emerald" },
                                    { id: "LEARNING", label: "Aprendizaje", desc: "Modo en desarrollo. Captura rostros para entrenamiento.", icon: Cpu, color: "amber", disabled: true }
                                ]}
                            />


                        </div>
                    )}

                    {/* Mode LPR Section */}
                    {activeSection === "mode_lpr" && (
                        <ModeConfiguration
                            title="Modo LPR"
                            description="Define la lógica de control para matrículas detectadas"
                            settingKey="MODE_LPR"
                            options={[
                                { id: "BLACKLIST", label: "Lista Negra", desc: "Las matrículas identificadas en lista serán DENEGADAS.", icon: ShieldAlert, color: "red" },
                                { id: "WHITELIST", label: "Lista Blanca", desc: "Las matrículas identificadas en lista serán PERMITIDAS.", icon: ShieldCheck, color: "emerald" },
                                { id: "LEARNING", label: "Aprendizaje", desc: "Agrega matrículas desconocidas a la base de datos.", icon: Activity, color: "blue" }
                            ]}
                        />
                    )}

                    {/* Drivers Section */}
                    {activeSection === "drivers" && (
                        <div className="space-y-6">
                            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-black text-white">Drivers & Protocolos</h2>
                                        <p className="text-sm text-neutral-500 mt-1">Gestiona los controladores de dispositivos compatibles</p>
                                    </div>
                                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-xs font-bold text-emerald-400">SISTEMA ACTIVO</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {DRIVERS.map((driver, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => driver.active && setSelectedBrand(driver.brand)}
                                            disabled={!driver.active}
                                            className={cn(
                                                "relative p-6 rounded-xl border transition-all group",
                                                driver.active
                                                    ? "bg-neutral-950/50 border-white/10 hover:border-blue-500/50 hover:bg-neutral-950 cursor-pointer hover:scale-105"
                                                    : "bg-neutral-950/20 border-white/5 opacity-40 cursor-not-allowed"
                                            )}
                                        >
                                            {driver.active && (
                                                <div className="absolute top-3 right-3">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                                                </div>
                                            )}

                                            <div className="flex flex-col items-center gap-3">
                                                <div className={cn(
                                                    "w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden transition-all",
                                                    (driver as { logo?: string }).logo ? "bg-white p-1" : (driver.active ? "bg-blue-500/10" : "bg-neutral-800/50")
                                                )}>
                                                    {(driver as { logo?: string }).logo ? (
                                                        <img src={(driver as { logo?: string }).logo} alt={driver.brand} className="w-full h-full object-contain" />
                                                    ) : (
                                                        <Camera size={24} className={driver.active ? "text-blue-400" : "text-neutral-600"} />
                                                    )}
                                                </div>

                                                <div className="text-center">
                                                    <p className="font-black text-sm text-white mb-1">{driver.brand}</p>
                                                    <div className="px-2 py-1 bg-neutral-900/80 rounded-md">
                                                        <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">{driver.tech}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {!driver.active && (
                                                <div className="absolute inset-x-0 bottom-3 text-center">
                                                    <span className="text-[8px] font-bold text-amber-500/70 bg-amber-500/10 px-2 py-1 rounded-full uppercase">
                                                        En desarrollo
                                                    </span>
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Users Section */}
                    {activeSection === "users" && (
                        <AdminsSection />
                    )}

                    {/* Notifications Section */}
                    {activeSection === "notifications" && (
                        <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                            <h2 className="text-2xl font-black text-white mb-4">Notificaciones & Alertas</h2>
                            <p className="text-neutral-500">Configuración de notificaciones próximamente...</p>
                        </div>
                    )}
                    {activeSection === "database" && (
                        /* ... existing database code ... */
                        <DatabaseSection />
                    )}

                    {activeSection === "storage" && (
                        <StorageSection />
                    )}




                    {activeSection === "whatsapp" && (
                        <WhatsAppSection />
                    )}
                </div>
            </div>


            {/* Driver Details Dialog */}
            <DriverDetailsDialog
                brand={selectedBrand}
                isOpen={selectedBrand !== null}
                onClose={() => setSelectedBrand(null)}
            />
        </div>
    );
}

function DatabaseSection() {
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
            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tight">PostgreSQL Database</h2>
                        <p className="text-sm text-neutral-500 mt-1">Gestión avanzada y salud del motor de datos</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            onClick={() => setShowSwitchDb(!showSwitchDb)}
                            variant="outline"
                            className="bg-neutral-950 border-white/5 text-neutral-400 hover:text-white hover:bg-white/5"
                        >
                            <Settings size={16} className="mr-2" />
                            {showSwitchDb ? "Cerrar Config" : "Cambiar Base de Datos"}
                        </Button>
                        <div className="flex flex-col items-end">
                            <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg mb-1">
                                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Peso Total DB</span>
                            </div>
                            <span className="text-xl font-mono font-black text-white">
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
                                <h3 className="text-sm font-black text-white uppercase tracking-tight">Configurar Nueva Conexión</h3>
                                <p className="text-[10px] text-neutral-500 uppercase font-bold">Cambia la base de datos sin afectar la actual</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-3">
                                    <Label className="text-[10px] uppercase font-black text-neutral-500 mb-2 block">String de Conexión (DATABASE_URL)</Label>
                                    <Input
                                        value={newDbUrl}
                                        onChange={(e) => setNewDbUrl(e.target.value)}
                                        placeholder="postgresql://user:pass@host:5432/dbname?schema=public"
                                        className="bg-black/40 border-white/10 h-10 font-mono text-xs"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button
                                        onClick={handleTestExternal}
                                        disabled={testingExternal || !newDbUrl}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black h-10 text-[10px] uppercase tracking-widest"
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
                                            <p className="text-[10px] text-neutral-500">{externalStatus.message}</p>
                                        </div>
                                    </div>

                                    {externalStatus.success && (
                                        <div className="flex gap-2">
                                            {externalStatus.isVirgin && (
                                                <Button
                                                    onClick={handleRunMigrations}
                                                    disabled={migrating}
                                                    className="bg-amber-600 hover:bg-amber-500 text-white font-black h-8 text-[9px] uppercase tracking-widest"
                                                >
                                                    {migrating ? <RefreshCcw className="animate-spin mr-2" size={10} /> : <FileText className="mr-2" size={10} />}
                                                    Poblar Tablas (Prisma)
                                                </Button>
                                            )}
                                            <Button
                                                onClick={handleApplyExternal}
                                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black h-8 text-[9px] uppercase tracking-widest"
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
                        <div className="bg-neutral-950/50 border border-white/5 rounded-xl p-6 h-full flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-blue-500/10 rounded-lg">
                                        <Activity className="text-blue-400" size={20} />
                                    </div>
                                    <h3 className="font-bold text-white text-sm uppercase tracking-tight">Estado de Red</h3>
                                </div>
                                <div className="space-y-3 mb-6">
                                    <p className="text-xs text-neutral-500 leading-relaxed">
                                        Asegura que el microservicio Prisma pueda comunicarse con la instancia de Postgres.
                                    </p>
                                    {!loadingStats && stats?.host && (
                                        <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                                            <p className="text-[9px] font-black text-neutral-600 uppercase mb-1">Endpoint Actual</p>
                                            <p className="text-xs font-mono font-black text-blue-400">{stats.host}:{stats.port}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <Button
                                onClick={handleTestDb}
                                disabled={testing}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black h-11 text-[10px] uppercase tracking-widest transition-all"
                            >
                                {testing ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Activity className="mr-2" size={14} />}
                                TESTEAR CONEXIÓN
                            </Button>
                        </div>
                    </div>

                    {/* Tables Stats */}
                    <div className="lg:col-span-2">
                        <div className="bg-neutral-950/50 border border-white/5 rounded-xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-purple-500/10 rounded-lg">
                                        <TableIcon className="text-purple-400" size={20} />
                                    </div>
                                    <h3 className="font-bold text-white text-sm uppercase tracking-tight">Esquema & Tablas</h3>
                                </div>
                                <button onClick={loadStats} className="text-neutral-500 hover:text-white transition-colors">
                                    <RefreshCcw size={14} className={loadingStats ? "animate-spin" : ""} />
                                </button>
                            </div>

                            <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                {loadingStats ? (
                                    <p className="text-[10px] text-neutral-600 animate-pulse font-black uppercase">Obteniendo esquema...</p>
                                ) : stats?.tables.map((table, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/5 transition-all group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-neutral-700 group-hover:bg-purple-500 transition-colors" />
                                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-tight">{table.table_name}</span>
                                        </div>
                                        <div className="flex items-center gap-4 font-mono text-[10px]">
                                            <span className="text-neutral-600">{table.row_count} rows</span>
                                            <span className="text-neutral-400 font-bold">{table.total_size}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Backup & Import Section */}
                <div className="mt-8 pt-8 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-neutral-900 border border-white/5 p-6 rounded-xl flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
                                <Download size={24} />
                            </div>
                            <div>
                                <p className="text-white font-black uppercase tracking-tight text-xs">Respaldo Integral</p>
                                <p className="text-[10px] text-neutral-500 font-medium">Exportar toda la configuración y registros a JSON</p>
                            </div>
                        </div>
                        <Button
                            onClick={handleBackup}
                            disabled={backingUp}
                            className="bg-neutral-800 hover:bg-amber-600 text-neutral-300 hover:text-white font-black text-[9px] uppercase tracking-widest px-4 h-9 transition-all"
                        >
                            {backingUp ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Download size={12} className="mr-2" />}
                            EXPORTAR
                        </Button>
                    </div>

                    {/* Database Actions Grid */}
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Backup */}
                        <div className="bg-neutral-900 border border-white/5 p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 mb-3 border border-amber-500/10">
                                    <Download size={20} />
                                </div>
                                <h3 className="text-white font-black uppercase text-xs mb-1">Respaldo</h3>
                                <p className="text-[10px] text-neutral-500">Descargar copia completa JSON</p>
                            </div>
                            <Button
                                onClick={handleBackup}
                                disabled={backingUp}
                                className="w-full bg-neutral-800 hover:bg-amber-600 text-neutral-300 hover:text-white font-black text-[9px] uppercase tracking-widest h-8"
                            >
                                {backingUp ? "Exportando..." : "Exportar"}
                            </Button>
                        </div>

                        {/* Import */}
                        <div className="bg-neutral-900 border border-white/5 p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 mb-3 border border-blue-500/10">
                                    <Upload size={20} />
                                </div>
                                <h3 className="text-white font-black uppercase text-xs mb-1">Restaurar</h3>
                                <p className="text-[10px] text-neutral-500">Importar backup existente</p>
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
                                    className="w-full bg-neutral-800 hover:bg-blue-600 text-neutral-400 hover:text-white font-black text-[9px] uppercase tracking-widest h-8 border border-white/5"
                                >
                                    {importing ? "Restaurando..." : "Seleccionar Archivo"}
                                </Button>
                            </div>
                        </div>

                        {/* Populate / Init */}
                        <div className="bg-neutral-900 border border-white/5 p-5 rounded-xl flex flex-col justify-between group h-full">
                            <div className="mb-4">
                                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 mb-3 border border-purple-500/10">
                                    <Database size={20} />
                                </div>
                                <h3 className="text-white font-black uppercase text-xs mb-1">Inicializar</h3>
                                <p className="text-[10px] text-neutral-500">Poblar nueva DB o Resetear</p>
                            </div>
                            <Button
                                onClick={() => setPendingAction({ type: 'POPULATE' })}
                                disabled={populating}
                                className="w-full bg-neutral-800 hover:bg-purple-600 text-neutral-400 hover:text-white font-black text-[9px] uppercase tracking-widest h-8 border border-white/5"
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
                    <div className="bg-neutral-900 border border-white/10 rounded-xl max-w-lg w-full mx-4 overflow-hidden shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                                <ShieldAlert size={32} />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">
                                {pendingAction.type === 'IMPORT' ? 'Análisis de Restauración' : '¿Reiniciar Base de Datos?'}
                            </h3>

                            {pendingAction.type === 'IMPORT' && pendingAction.analysis ? (
                                <div className="text-left mt-4 mb-6">
                                    <div className="flex items-center justify-center gap-4 mb-6 bg-neutral-950 p-3 rounded-lg border border-white/5">
                                        <span className={cn("text-xs font-bold", !mergeMode ? "text-red-400" : "text-neutral-500")}>REEMPLAZAR TODO</span>
                                        <Switch checked={mergeMode} onCheckedChange={setMergeMode} />
                                        <span className={cn("text-xs font-bold", mergeMode ? "text-blue-400" : "text-neutral-500")}>FUSIONAR (MERGE)</span>
                                    </div>

                                    <div className="bg-neutral-950 rounded-lg border border-white/5 overflow-hidden">
                                        <table className="w-full text-[10px]">
                                            <thead className="bg-white/5 text-neutral-400 font-bold uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-3 py-2 text-left">Tabla</th>
                                                    <th className="px-3 py-2 text-center">Datos Nuevos</th>
                                                    <th className="px-3 py-2 text-center text-white">Acción</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5 text-neutral-300">
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
                                                                "px-2 py-0.5 rounded font-black uppercase text-[9px]",
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
                                    <p className="text-[10px] text-neutral-500 mt-4 text-center">
                                        {mergeMode
                                            ? "Se agregarán los registros nuevos. Los existentes se mantendrán."
                                            : "ADVERTENCIA: Se BORRARÁN todos los datos actuales antes de importar."}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-xs text-neutral-400 leading-relaxed">
                                    Esta acción borrará los datos actuales y poblará la base de datos con información inicial/de prueba. ¿Estás seguro?
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Button onClick={() => setPendingAction(null)} variant="ghost" className="h-10 text-neutral-400 hover:bg-white/5 hover:text-white font-bold rounded-lg border border-white/5">
                                Cancelar
                            </Button>
                            <Button onClick={confirmAction} className={cn("h-10 text-white font-black rounded-lg", mergeMode ? "bg-blue-600 hover:bg-blue-500" : "bg-red-600 hover:bg-red-500")}>
                                {pendingAction.type === 'IMPORT' ? (mergeMode ? 'Confirmar Fusión' : 'Confirmar Reemplazo') : 'Sí, Inicializar'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StorageSection() {
    const [config, setConfig] = useState({
        endpoint: "",
        accessKey: "",
        secretKey: "",
        bucketLpr: "lpr",
        bucketFace: "face"
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
                bucketFace: bf?.value || "face"
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
                updateSetting("S3_BUCKET_FACE", config.bucketFace)
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
            <div className="flex items-center justify-center h-64 bg-neutral-900/50 rounded-2xl border border-white/5">
                <RefreshCcw className="animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tight">Almacenamiento (Lifecycle & S3)</h2>
                        <p className="text-sm text-neutral-500 mt-1">Gestión de retención de datos y conexión con Object Storage</p>
                    </div>
                    <div className="flex bg-neutral-900 border border-white/10 rounded-lg p-1">
                        <Button onClick={handleExportConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-neutral-400 hover:text-white hover:bg-white/5 uppercase">
                            <Download size={14} className="mr-2" />
                            Exportar Config
                        </Button>
                        <div className="w-px bg-white/10 my-1 mx-1"></div>
                        <input
                            type="file"
                            ref={configFileRef}
                            onChange={handleImportConfig}
                            className="hidden"
                            accept=".json"
                        />
                        <Button onClick={triggerImportConfig} disabled={importingConfig} variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-neutral-400 hover:text-white hover:bg-white/5 uppercase">
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
                            <h3 className="text-lg font-bold text-white">Políticas de Retención</h3>
                        </div>

                        {/* LPR Retention */}
                        <div className="bg-neutral-950/40 border border-white/5 rounded-xl p-5 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-xs font-black text-white uppercase tracking-tight">Bucket LPR</Label>
                                <div className="px-2 py-0.5 bg-blue-500/10 rounded text-[10px] font-bold text-blue-400">
                                    {lifecycles.lpr === 0 ? "INFINITO" : `${lifecycles.lpr} DÍAS`}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 mb-4">
                                <Input
                                    type="number"
                                    value={lifecycles.lpr}
                                    onChange={e => setLifecycles({ ...lifecycles, lpr: parseInt(e.target.value) || 0 })}
                                    className="bg-black/60 border-white/10 h-9 w-20 text-center font-bold text-blue-400 text-sm"
                                />
                                <span className="text-[10px] text-neutral-400 leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-white/5 flex justify-between items-center text-[10px] text-neutral-500 font-mono">
                                <span>{stats.lpr.loading ? "..." : stats.lpr.count.toLocaleString()} archivos</span>
                                <span>{stats.lpr.loading ? "..." : formatSize(stats.lpr.size)}</span>
                            </div>
                        </div>

                        {/* FACE Retention */}
                        <div className="bg-neutral-950/40 border border-white/5 rounded-xl p-5 relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-xs font-black text-white uppercase tracking-tight">Bucket FACE</Label>
                                <div className="px-2 py-0.5 bg-purple-500/10 rounded text-[10px] font-bold text-purple-400">
                                    {lifecycles.face === 0 ? "INFINITO" : `${lifecycles.face} DÍAS`}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 mb-4">
                                <Input
                                    type="number"
                                    value={lifecycles.face}
                                    onChange={e => setLifecycles({ ...lifecycles, face: parseInt(e.target.value) || 0 })}
                                    className="bg-black/60 border-white/10 h-9 w-20 text-center font-bold text-purple-400 text-sm"
                                />
                                <span className="text-[10px] text-neutral-400 leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-white/5 flex justify-between items-center text-[10px] text-neutral-500 font-mono">
                                <span>{stats.face.loading ? "..." : stats.face.count.toLocaleString()} archivos</span>
                                <span>{stats.face.loading ? "..." : formatSize(stats.face.size)}</span>
                            </div>
                        </div>

                        <Button
                            onClick={handleSaveLifecycle}
                            disabled={savingLifecycle || loading}
                            className="w-full bg-amber-600/10 hover:bg-amber-600 text-amber-500 hover:text-white font-black text-[10px] uppercase tracking-widest h-10 border border-amber-600/20"
                        >
                            {savingLifecycle ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Save className="mr-2" size={12} />}
                            GUARDAR POLÍTICAS
                        </Button>
                    </div>

                    {/* Right Column: S3 Configuration */}
                    <div className="lg:col-span-7 space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Cloud size={18} className="text-blue-400" />
                            <h3 className="text-lg font-bold text-white">Configuración S3 / MinIO</h3>
                        </div>

                        <div className="bg-neutral-950/20 rounded-xl p-6 border border-white/5 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase text-neutral-500 ml-1">Endpoint (API)</Label>
                                <Input
                                    placeholder="http://192.168.99.108:9000"
                                    value={config.endpoint}
                                    onChange={e => setConfig({ ...config, endpoint: e.target.value })}
                                    className="bg-black/40 border-white/5 h-10 text-sm font-mono"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-neutral-500 ml-1">Access Key</Label>
                                    <Input
                                        placeholder="root"
                                        value={config.accessKey}
                                        onChange={e => setConfig({ ...config, accessKey: e.target.value })}
                                        className="bg-black/40 border-white/5 h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-neutral-500 ml-1">Secret Key</Label>
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        value={config.secretKey}
                                        onChange={e => setConfig({ ...config, secretKey: e.target.value })}
                                        className="bg-black/40 border-white/5 h-10 text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-neutral-500 ml-1">Bucket LPR</Label>
                                    <Input
                                        placeholder="lpr"
                                        value={config.bucketLpr}
                                        onChange={e => setConfig({ ...config, bucketLpr: e.target.value })}
                                        className="bg-black/40 border-white/5 h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase text-neutral-500 ml-1">Bucket Face</Label>
                                    <Input
                                        placeholder="face"
                                        value={config.bucketFace}
                                        onChange={e => setConfig({ ...config, bucketFace: e.target.value })}
                                        className="bg-black/40 border-white/5 h-10 text-sm font-mono"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <Button
                                    variant="ghost"
                                    onClick={handleTest}
                                    disabled={testing || saving}
                                    className="flex-1 text-neutral-400 hover:text-white hover:bg-white/5 font-bold h-10 border border-white/5 text-[10px] uppercase"
                                >
                                    {testing ? <RefreshCcw className="animate-spin mr-2" size={12} /> : <Activity className="mr-2" size={12} />}
                                    PROBAR CONEXIÓN
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    disabled={saving || testing}
                                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black h-10 text-[10px] uppercase shadow-lg shadow-blue-600/20"
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



function ModeConfiguration({ title, description, settingKey, options }: {
    title: string,
    description: string,
    settingKey: string,
    options: { id: string, label: string, desc: string, icon: any, color: string, disabled?: boolean }[]
}) {
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [pendingMode, setPendingMode] = useState<string | null>(null);

    const [learnedPlates, setLearnedPlates] = useState<{ id: string, plate: string, timestamp: Date, snapshot: string | null }[]>([]);
    const [loadingLearned, setLoadingLearned] = useState(false);
    const [isPending, startTransition] = useTransition();

    const isFaceMode = settingKey === 'MODE_FACE';
    const isLprMode = settingKey === 'MODE_LPR';

    useEffect(() => {
        loadSetting();
    }, [settingKey]);

    useEffect(() => {
        if (currentMode === 'LEARNING' && isLprMode) {
            fetchLearnedPlates();
        }
    }, [currentMode, isLprMode]);

    const fetchLearnedPlates = async () => {
        setLoadingLearned(true);
        try {
            const res = await getLearnedPlates();
            setLearnedPlates(res);
        } catch (err) {
            console.error("Error fetching learned plates:", err);
        } finally {
            setLoadingLearned(false);
        }
    };

    const handleClearLearned = async () => {
        if (!confirm("¿Estás seguro de que deseas borrar todas las matrículas aprendidas?")) return;
        try {
            const res = await clearLearnedPlates();
            if (res.success) {
                toast.success({ title: "Lista de aprendizaje limpiada" });
                setLearnedPlates([]);
            } else {
                toast.error({ title: res.message });
            }
        } catch (err) {
            toast.error({ title: "Error al limpiar la lista" });
        }
    };

    const loadSetting = async () => {
        setLoading(true);
        try {
            const res = await getSetting(settingKey);
            setCurrentMode(res?.value || null);
        } catch (err) {
            console.error("Error loading setting:", err);
            toast.error({ title: "Error al cargar la configuración" });
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = (modeId: string) => {
        if (modeId === currentMode) return;
        setPendingMode(modeId);
    };

    const confirmModeChange = async () => {
        if (!pendingMode) return;

        setSaving(true);
        const prev = currentMode;
        setCurrentMode(pendingMode);
        setPendingMode(null);

        try {
            await updateSetting(settingKey, pendingMode);
            toast.success({ title: "Modo actualizado exitosamente" });
        } catch (err) {
            setCurrentMode(prev);
            toast.error({ title: "Error al guardar el modo" });
        } finally {
            setSaving(false);
        }
    };

    const getModeWarnings = (modeId: string) => {
        if (isFaceMode) {
            if (modeId === 'BLACKLIST') {
                return [
                    { icon: ShieldAlert, text: "Todos los rostros identificados serán DENEGADOS", color: "red" },
                    { icon: Users, text: "Ãštil para bloquear personas específicas", color: "amber" },
                    { icon: Camera, text: "La cámara aÃºn controla la apertura física", color: "blue" }
                ];
            } else if (modeId === 'WHITELIST') {
                return [
                    { icon: ShieldCheck, text: "Solo los rostros registrados serán PERMITIDOS", color: "emerald" },
                    { icon: Users, text: "Rostros desconocidos serán ignorados", color: "amber" },
                    { icon: Camera, text: "La cámara controla la apertura física", color: "blue" }
                ];
            }
        } else {
            if (modeId === 'BLACKLIST') {
                return [
                    { icon: ShieldAlert, text: "Matrículas en la lista serán DENEGADAS", color: "red" },
                    { icon: Car, text: "Matrículas desconocidas dependen de la cámara", color: "amber" },
                    { icon: Camera, text: "Apertura física controlada por la cámara", color: "blue" }
                ];
            } else if (modeId === 'WHITELIST') {
                return [
                    { icon: ShieldCheck, text: "Solo matrículas registradas serán PERMITIDAS", color: "emerald" },
                    { icon: Car, text: "Matrículas desconocidas serán DENEGADAS", color: "amber" },
                    { icon: Camera, text: "Apertura física controlada por la cámara", color: "blue" }
                ];
            } else if (modeId === 'LEARNING') {
                return [
                    { icon: Activity, text: "Nuevas matrículas se agregarán automáticamente", color: "blue" },
                    { icon: Database, text: "La base de datos crecerá con cada detección nueva", color: "purple" },
                    { icon: Camera, text: "No afecta la decisión de apertura física", color: "amber" }
                ];
            }
        }
        return [];
    };

    const getPendingOption = () => options.find(o => o.id === pendingMode);

    function loadModeExplanation(mode: string | null, isFace: boolean) {
        if (!mode) return [];
        if (isFace) {
            if (mode === 'BLACKLIST') return [
                { icon: ShieldAlert, title: "Bloqueo Activo", text: "El sistema denegará automáticamente el acceso a cualquier rostro identificado en la base de datos.", color: "red" },
                { icon: Users, title: "Gestión de Personal", text: "Ideal para bloquear ex-empleados o personas no gratas.", color: "amber" }
            ];
            if (mode === 'WHITELIST') return [
                { icon: ShieldCheck, title: "Acceso Restringido", text: "Solo los rostros registrados explícitamente tendrán acceso. El resto es ignorado.", color: "emerald" },
                { icon: Users, title: "Alta Seguridad", text: "Garantiza que nadie desconocido pueda ingresar.", color: "blue" }
            ];
        } else {
            if (mode === 'BLACKLIST') return [
                { icon: ShieldAlert, title: "Bloqueo de Vehículos", text: "Las matrículas en la lista negra activarán alertas y bloqueo de barrera.", color: "red" },
            ];
            if (mode === 'WHITELIST') return [
                { icon: ShieldCheck, title: "Acceso Residencial", text: "Solo los vehículos de residentes registrados abren la barrera.", color: "emerald" },
            ];
            if (mode === 'LEARNING') return [
                { icon: Database, title: "Auto-Aprendizaje", text: "Cada vehículo nuevo se registra automáticamente en el sistema.", color: "purple" }
            ];
        }
        return [];
    }

    return (
        <>
            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8 space-y-8 animate-in slide-in-from-bottom-5 duration-500">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-black text-white">{title}</h2>
                        <p className="text-sm text-neutral-500 mt-1">{description}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left: Options Stack */}
                    <div className="lg:col-span-5 space-y-4">
                        {options.map((option) => {
                            const Icon = option.icon;
                            const isSelected = currentMode === option.id;
                            const isDisabled = option.disabled || loading || saving;

                            return (
                                <button
                                    key={option.id}
                                    onClick={() => !isDisabled && handleSelect(option.id)}
                                    disabled={isDisabled}
                                    className={cn(
                                        "w-full relative p-4 rounded-xl border text-left transition-all duration-300 group flex items-center gap-4",
                                        isSelected
                                            ? `bg-${option.color}-500/10 border-${option.color}-500/50 shadow-lg shadow-${option.color}-900/10`
                                            : isDisabled
                                                ? "bg-neutral-900/20 border-white/5 opacity-50 cursor-not-allowed"
                                                : "bg-neutral-900/40 border-white/5 hover:bg-neutral-900/60 hover:border-white/10"
                                    )}
                                >
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
                                        isSelected ? `bg-${option.color}-500/20 text-${option.color}-400` : "bg-white/5 text-neutral-500 group-hover:bg-white/10 group-hover:text-neutral-300"
                                    )}>
                                        <Icon size={20} />
                                    </div>
                                    <div>
                                        <h3 className={cn(
                                            "font-black text-sm",
                                            isSelected ? "text-white" : "text-neutral-300"
                                        )}>
                                            {option.label}
                                        </h3>
                                        <p className="text-[10px] text-neutral-500 font-medium leading-tight mt-0.5">
                                            {option.desc}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <div className={`ml-auto w-2 h-2 rounded-full bg-${option.color}-500 shadow-[0_0_8px_currentColor] animate-pulse`} />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: Explanation */}
                    <div className="lg:col-span-7">
                        <div className="bg-neutral-950/30 border border-white/5 rounded-xl p-6 h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <Info size={16} className="text-neutral-400" />
                                <h3 className="text-xs font-black text-white uppercase tracking-widest">¿CÓMO FUNCIONA ESTE MODO?</h3>
                            </div>

                            <div className="space-y-4">
                                {loadModeExplanation(currentMode, isFaceMode).map((item, i) => (
                                    <div key={i} className={`flex items-start gap-4 p-4 rounded-lg bg-${item.color}-500/5 border border-${item.color}-500/10`}>
                                        <div className={`p-2 rounded bg-${item.color}-500/10 text-${item.color}-400 shrink-0`}>
                                            <item.icon size={16} />
                                        </div>
                                        <div>
                                            <h4 className={`text-xs font-black text-${item.color}-400 mb-1 uppercase`}>{item.title}</h4>
                                            <p className="text-[11px] text-neutral-400 leading-relaxed">{item.text}</p>
                                        </div>
                                    </div>
                                ))}
                                {loadModeExplanation(currentMode, isFaceMode).length === 0 && (
                                    <p className="text-xs text-neutral-500 italic">Selecciona un modo para ver los detalles.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Learned Plates Information */}
                {currentMode === 'LEARNING' && isLprMode && (
                    <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <Activity className="text-blue-400" size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Matrículas Aprendidas</h3>
                                    <p className="text-[10px] text-neutral-500 uppercase font-bold">Estas matrículas se han agregado automáticamente</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={fetchLearnedPlates}
                                    disabled={loadingLearned}
                                    className="h-8 group"
                                >
                                    <RefreshCcw size={14} className={cn("mr-2 group-hover:rotate-180 transition-transform duration-500", loadingLearned && "animate-spin")} />
                                    Actualizar
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearLearned}
                                    className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                    <Trash2 size={14} className="mr-2" />
                                    Limpiar Lista
                                </Button>
                            </div>
                        </div>

                        <div className="bg-black/40 border border-white/5 rounded-xl overflow-hidden">
                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                <Table>
                                    <TableHeader className="bg-white/5">
                                        <TableRow className="border-white/5 hover:bg-transparent">
                                            <TableHead className="text-[10px] font-black text-neutral-500 uppercase">Matrícula</TableHead>
                                            <TableHead className="text-[10px] font-black text-neutral-500 uppercase w-[100px]">Captura</TableHead>
                                            <TableHead className="text-[10px] font-black text-neutral-500 uppercase">Fecha y Hora de Captura</TableHead>
                                            <TableHead className="text-[10px] font-black text-neutral-500 uppercase text-right">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loadingLearned ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <RefreshCcw className="animate-spin text-blue-500" size={20} />
                                                        <p className="text-[10px] font-bold text-neutral-500 uppercase">Cargando datos...</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Info className="text-neutral-700" size={20} />
                                                        <p className="text-[10px] font-bold text-neutral-500 uppercase">No hay matrículas aprendidas en esta sesión</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.map((item) => (
                                            <TableRow key={item.id} className="border-white/5 hover:bg-white/5 group transition-colors">
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                            <Car className="text-blue-400" size={14} />
                                                        </div>
                                                        <span className="font-mono font-black text-white">{item.plate}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {item.snapshot ? (
                                                        <div className="w-16 h-10 rounded overflow-hidden border border-white/10 bg-neutral-900 group-hover:scale-110 transition-transform cursor-pointer">
                                                            <img
                                                                src={item.snapshot}
                                                                alt={item.plate}
                                                                className="w-full h-full object-cover"
                                                                onClick={() => window.open(item.snapshot!, '_blank')}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-16 h-10 rounded bg-neutral-900 border border-white/5 flex items-center justify-center">
                                                            <Eye size={12} className="text-neutral-700" />
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-neutral-400">
                                                        <Calendar size={12} className="text-neutral-600" />
                                                        <span className="text-xs">{new Date(item.timestamp).toLocaleString('es-UY', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            second: '2-digit'
                                                        })}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-400 uppercase">
                                                        Registrada
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            {pendingMode && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setPendingMode(null)}>
                    <div
                        className="bg-[#0f0f10] border border-white/10 rounded-xl max-w-sm w-full mx-4 overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
                                <ShieldAlert size={32} />
                            </div>
                            <h3 className="text-lg font-black text-white mb-2">¿Confirmar Cambio?</h3>
                            <p className="text-xs text-neutral-400 leading-relaxed mb-6">
                                Estás a punto de cambiar a
                                <span className={`font-black text-${getPendingOption()?.color}-400 mx-1`}>
                                    {getPendingOption()?.label}
                                </span>.
                                Esta acción modificará inmediatamente como el sistema procesa los eventos.
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                                <Button onClick={() => setPendingMode(null)} variant="ghost" className="h-10 text-neutral-400 hover:bg-white/5 hover:text-white font-bold rounded-lg border border-white/5">
                                    Cancelar
                                </Button>
                                <Button onClick={confirmModeChange} className="h-10 bg-white text-black hover:bg-neutral-200 font-black rounded-lg">
                                    {saving ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Check size={14} className="mr-2" />}
                                    Confirmar
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}




// Add getWahaHistory to imports first (done separately? No, I must modify the whole file or assume imports are updated. I'll invoke this tool to update the import line first, or I can try to do it all if safe. The imports are at top of file. I will just update the component logic here and assume imports need update if function not found, but I can't edit 2 places easily. I will update component and then imports).

function WhatsAppSection() {
    const [config, setConfig] = useState({ url: "", apiKey: "", notificationNumber: "" });
    // Updated default commands to reflect reality
    const [commands, setCommands] = useState([
        { id: 'matricula', cmd: 'matricula [AAA1234]', desc: 'Gestión de matrículas (Consultar/Agregar)', icon: Car, active: true },
        { id: 'last_events', cmd: 'ultimas entradas/salidas', desc: 'Reporte de últimos accesos con filtro', icon: Activity, active: true },
        { id: 'logs', cmd: 'último evento', desc: 'Último acceso registrado (con foto)', icon: Eye, active: true },
        { id: 'status', cmd: 'estado', desc: 'Estado del sistema (Próximamente)', icon: Bot, active: false },
    ]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [sessions, setSessions] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const [url, apiKey, notificationNumber, cmdConfig] = await Promise.all([
                getSetting("WAHA_URL"),
                getSetting("WAHA_API_KEY"),
                getSetting("WAHA_NOTIFICATION_NUMBER"),
                getSetting("WAHA_COMMANDS")
            ]);

            setConfig({
                url: url?.value || "",
                apiKey: apiKey?.value || "",
                notificationNumber: notificationNumber?.value || ""
            });

            if (cmdConfig?.value) {
                try {
                    const savedCommands = JSON.parse(cmdConfig.value);
                    setCommands(prev => prev.map(c => {
                        const saved = savedCommands.find((s: any) => s.id === c.id);
                        return saved ? { ...c, active: saved.active } : c;
                    }));
                } catch (e) {
                    console.error("Error parsing commands config", e);
                }
            }

            // Load real history
            await loadHistory();

        } catch (err) {
            console.error("Error loading WAHA config:", err);
        } finally {
            setLoading(false);
        }
    };

    const loadHistory = async () => {
        try {
            const logs = await getWahaHistory();
            setHistory(logs);
        } catch (e) {
            console.error(e);
        }
    }

    const handleSave = async () => {
        setSaving(true);
        try {
            const commandsConfig = JSON.stringify(commands.map(c => ({ id: c.id, active: c.active })));
            await Promise.all([
                updateSetting("WAHA_URL", config.url),
                updateSetting("WAHA_API_KEY", config.apiKey),
                updateSetting("WAHA_NOTIFICATION_NUMBER", config.notificationNumber),
                updateSetting("WAHA_COMMANDS", commandsConfig)
            ]);
            toast.success({ title: "Configuración de WAHA guardada" });
        } catch (err) {
            toast.error({ title: "Error al guardar la configuración" });
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!config.url) {
            toast.error({ title: "Por favor ingresa la URL de WAHA" });
            return;
        }

        setTesting(true);
        try {
            const result = await testWahaConnection(config.url, config.apiKey);
            if (result.success) {
                toast.success({ title: result.message });
                setSessions(result.sessions || []);
            } else {
                toast.error({ title: result.message });
            }
        } catch (err) {
            toast.error({ title: "Error crítico al conectar con WAHA" });
        } finally {
            setTesting(false);
        }
    };

    const toggleCommand = (id: string) => {
        setCommands(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));
    };

    if (loading) {
        return (
            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                <div className="flex items-center justify-center py-12">
                    <RefreshCcw className="animate-spin text-emerald-500" size={32} />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in zoom-in-95 duration-500">
            {/* Header Compacto */}
            <div className="bg-gradient-to-br from-emerald-600/10 to-teal-600/10 border border-emerald-500/10 rounded-lg p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-emerald-500/20 rounded-lg text-emerald-400">
                        <Bot size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white tracking-tight">Chatbot WhatsApp (WAHA)</h2>
                        <p className="text-xs text-neutral-400">Asistente IA y Notificaciones</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={loadHistory} variant="ghost" size="sm" className="h-8 text-xs font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20">
                        <RefreshCcw size={14} className="mr-2" />
                        Refrescar Logs
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
                {/* Left Column: Config */}
                <div className="space-y-6">
                    {/* Connection Card */}
                    <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-lg p-6 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Settings className="text-emerald-400" size={18} />
                                <h3 className="text-sm font-black text-white uppercase tracking-wider">Conexión</h3>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                                <Activity size={12} />
                                <span>Sistema Activo</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">URL del Servidor</Label>
                                <Input
                                    value={config.url}
                                    onChange={(e) => setConfig({ ...config, url: e.target.value })}
                                    placeholder="http://localhost:3000"
                                    className="bg-black/40 border-white/10 h-10 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">API Key</Label>
                                <Input
                                    value={config.apiKey}
                                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                    type="password"
                                    placeholder="••••••••"
                                    className="bg-black/40 border-white/10 h-10 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Número de Notificación (Alertas)</Label>
                                <Input
                                    value={config.notificationNumber}
                                    onChange={(e) => setConfig({ ...config, notificationNumber: e.target.value })}
                                    placeholder="59891234567@c.us"
                                    className="bg-black/40 border-white/10 h-10 font-mono text-xs"
                                />
                                <p className="text-[8px] text-neutral-600 font-bold uppercase tracking-tight italic">Incluir @c.us para chat o @g.us para grupos</p>
                            </div>
                        </div>


                        <div className="flex gap-3 pt-2">
                            <Button onClick={handleTest} disabled={testing} variant="outline" className="flex-1 h-9 text-xs font-bold border-white/10 hover:bg-white/5">
                                {testing ? "Probando..." : "Probar Conexión"}
                            </Button>
                            <Button onClick={handleSave} disabled={saving} className="flex-1 h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20">
                                {saving ? "Guardando..." : "Guardar Cambios"}
                            </Button>
                        </div>
                    </div>

                    {/* Webhook Info */}
                    <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 flex items-start gap-4">
                        <Info className="text-blue-400 shrink-0 mt-1" size={16} />
                        <div>
                            <h4 className="text-xs font-black text-blue-100 uppercase mb-1">Webhook URL</h4>
                            <p className="text-[10px] text-blue-200/60 mb-2">Configura esta URL en WAHA:</p>
                            <code className="block bg-black/20 rounded p-2 text-[10px] font-mono text-blue-300">http://SERVER_IP:10000/api/webhooks/whatsapp</code>
                        </div>
                    </div>
                </div>

                {/* Right Column: Commands & History */}
                <div className="space-y-6">
                    {/* Commands List */}
                    <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-lg p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <MessageSquare className="text-purple-400" size={18} />
                            <h3 className="text-sm font-black text-white uppercase tracking-wider">Comandos Disponibles</h3>
                        </div>
                        <div className="border border-white/5 rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader className="bg-white/5">
                                    <TableRow className="border-white/5 hover:bg-transparent">
                                        <TableHead className="h-8 text-[9px] font-black text-neutral-400 uppercase tracking-widest">Comando</TableHead>
                                        <TableHead className="h-8 text-[9px] font-black text-neutral-400 uppercase tracking-widest text-right">Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {commands.map((cmd) => (
                                        <TableRow key={cmd.id} className="border-white/5 hover:bg-white/5">
                                            <TableCell className="py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-1.5 rounded bg-neutral-800 text-neutral-400`}>
                                                        <cmd.icon size={12} />
                                                    </div>
                                                    <div>
                                                        <span className="block text-xs font-mono font-bold text-neutral-300">{cmd.cmd}</span>
                                                        <span className="block text-[10px] text-neutral-500 truncate max-w-[150px]">{cmd.desc}</span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-2 text-right">
                                                <Switch checked={cmd.active} onCheckedChange={() => toggleCommand(cmd.id)} className="scale-75 origin-right" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* History */}
                    <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-lg p-6 max-h-[400px] overflow-hidden flex flex-col">
                        <div className="flex items-center gap-2 mb-4 shrink-0">
                            <FileText className="text-amber-400" size={18} />
                            <h3 className="text-sm font-black text-white uppercase tracking-wider">Historial de Consultas</h3>
                        </div>
                        <div className="border border-white/5 rounded-lg overflow-y-auto custom-scrollbar grow">
                            <Table>
                                <TableHeader className="bg-white/5 sticky top-0 z-10 backdrop-blur-md">
                                    <TableRow className="border-white/5 hover:bg-transparent">
                                        <TableHead className="h-8 text-[9px] font-black text-neutral-400 uppercase tracking-widest w-24">Usuario</TableHead>
                                        <TableHead className="h-8 text-[9px] font-black text-neutral-400 uppercase tracking-widest">Interacción</TableHead>
                                        <TableHead className="h-8 text-[9px] font-black text-neutral-400 uppercase tracking-widest text-right w-24">Hora</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.length === 0 ? (
                                        <TableRow className="border-white/5 hover:bg-transparent">
                                            <TableCell colSpan={3} className="py-8 text-center text-[10px] text-neutral-500 italic">
                                                Sin registros recientes.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        history.map((h) => (
                                            <TableRow key={h.id} className="border-white/5 hover:bg-white/5">
                                                <TableCell className="py-2 align-top">
                                                    <span className="text-[9px] font-bold text-white bg-white/5 px-1.5 py-0.5 rounded-full whitespace-nowrap overflow-hidden text-ellipsis max-w-full block" title={h.user}>
                                                        {h.user.split('@')[0]}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2 align-top">
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-mono text-emerald-400 break-words line-clamp-2" title={h.command}>&gt; {h.command}</p>
                                                        <p className="text-[9px] text-neutral-400 break-words line-clamp-2" title={h.response}>{h.response}</p>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right text-[9px] text-neutral-500 font-mono align-top whitespace-nowrap">
                                                    {h.time}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}



function AdminsSection() {
    const [admins, setAdmins] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingAdmin, setEditingAdmin] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        photo: null as File | null,
        currentPhoto: ""
    });

    useEffect(() => {
        loadAdmins();
    }, []);

    const loadAdmins = async () => {
        setLoading(true);
        try {
            const list = await getAdmins();
            setAdmins(list);
        } catch (error) {
            toast.error({ title: "Error al cargar administradores" });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.name) return toast.error({ title: "El nombre de usuario es requerido" });

        const data = new FormData();
        if (editingAdmin) data.append("id", editingAdmin.id);
        data.append("name", formData.name);
        data.append("email", formData.email);
        data.append("password", formData.password); // Plain text mainly as per request
        if (formData.photo) data.append("photo", formData.photo);
        data.append("currentPhoto", formData.currentPhoto);

        try {
            await saveAdminAction(data);
            toast.success({ title: editingAdmin ? "Administrador actualizado" : "Administrador creado" });
            setIsDialogOpen(false);
            loadAdmins();
            setEditingAdmin(null);
            setFormData({ name: "", email: "", password: "", photo: null, currentPhoto: "" });
        } catch (error: any) {
            toast.error({ title: error.message || "Error al guardar administrador" });
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este administrador?")) {
            try {
                await deleteAdminAction(id);
                toast.success({ title: "Administrador eliminado" });
                loadAdmins();
            } catch (error) {
                toast.error({ title: "Error al eliminar" });
            }
        }
    };

    const openEdit = (admin: any) => {
        setEditingAdmin(admin);
        setFormData({
            name: admin.name,
            email: admin.email || "",
            password: admin.password || "", // This might be empty if we don't return passwords for security, but user requested 'pin' style display so we might have it
            photo: null,
            currentPhoto: admin.cara || ""
        });
        setIsDialogOpen(true);
    };

    const openNew = () => {
        setEditingAdmin(null);
        setFormData({ name: "", email: "", password: "", photo: null, currentPhoto: "" });
        setIsDialogOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tight">Administradores del Sistema</h2>
                        <p className="text-sm text-neutral-500 mt-1">Gestión de usuarios con acceso al panel de control</p>
                    </div>
                    <Button
                        onClick={openNew}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest h-10 px-6"
                    >
                        <Plus size={16} className="mr-2" />
                        Nuevo Admin
                    </Button>
                </div>

                <div className="bg-neutral-950/30 border border-white/5 rounded-xl overflow-hidden">
                    <Table>
                        <TableHeader className="bg-white/5">
                            <TableRow className="border-white/5 hover:bg-transparent">
                                <TableHead className="w-[80px] text-[10px] font-black text-neutral-500 uppercase">Foto</TableHead>
                                <TableHead className="text-[10px] font-black text-neutral-500 uppercase">Usuario / Nombre</TableHead>
                                <TableHead className="text-[10px] font-black text-neutral-500 uppercase">Email</TableHead>
                                <TableHead className="text-[10px] font-black text-neutral-500 uppercase">Rol</TableHead>
                                <TableHead className="text-[10px] font-black text-neutral-500 uppercase text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="animate-spin mx-auto text-neutral-500" />
                                    </TableCell>
                                </TableRow>
                            ) : admins.map((admin) => (
                                <TableRow key={admin.id} className="border-white/5 hover:bg-white/5 transition-colors group">
                                    <TableCell>
                                        <div className="w-10 h-10 rounded-full bg-neutral-800 overflow-hidden relative border border-white/10">
                                            {admin.cara ? (
                                                <img
                                                    src={admin.cara.startsWith('/') ? admin.cara : `/api/files/${admin.cara}`}
                                                    alt={admin.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-neutral-600">
                                                    <UserIcon size={16} />
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-bold text-white uppercase text-xs">
                                        {admin.name}
                                        {admin.name === 'fgonzalez' && (
                                            <span className="ml-2 text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/30">Líder</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-neutral-400 font-mono text-xs">{admin.email || "-"}</TableCell>
                                    <TableCell>
                                        <div className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 w-fit">
                                            <span className="text-[9px] font-black text-purple-400 uppercase tracking-wider">{admin.role}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => openEdit(admin)}
                                                className="w-8 h-8 rounded-lg bg-blue-500/10 hover:bg-blue-600 text-blue-500 hover:text-white flex items-center justify-center transition-all"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(admin.id)}
                                                className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-600 text-red-500 hover:text-white flex items-center justify-center transition-all"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!loading && admins.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-neutral-500 text-xs font-bold uppercase">
                                        No hay administradores registrados
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-neutral-950 border-neutral-800 text-white sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight">
                            {editingAdmin ? "Editar Administrador" : "Nuevo Administrador"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-6 py-4">
                        <div className="flex items-center justify-center gap-4">
                            <div className="relative w-24 h-24 rounded-full bg-neutral-900 border-2 border-neutral-800 overflow-hidden group cursor-pointer transition-all hover:border-blue-500/50">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 opacity-0 z-20 cursor-pointer"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) setFormData({ ...formData, photo: file });
                                    }}
                                />
                                {formData.photo ? (
                                    <img src={URL.createObjectURL(formData.photo)} className="w-full h-full object-cover" />
                                ) : formData.currentPhoto ? (
                                    <img src={formData.currentPhoto.startsWith('/') ? formData.currentPhoto : `/api/files/${formData.currentPhoto}`} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-neutral-600 gap-1">
                                        <Camera size={20} />
                                        <span className="text-[9px] font-bold uppercase">Foto</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                    <Upload className="text-white w-6 h-6" />
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name" className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Usuario (Login)</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="bg-neutral-900 border-neutral-800 h-10"
                                    placeholder="ej: fgonzalez"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="email" className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Email (Opcional)</Label>
                                <Input
                                    id="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="bg-neutral-900 border-neutral-800 h-10"
                                    placeholder="ej: usuario@empresa.com"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="password" className="text-xs font-bold text-neutral-500 uppercase tracking-widest">
                                    {editingAdmin ? "Nueva Contraseña (Dejar vacío para mantener)" : "Contraseña"}
                                </Label>
                                <Input
                                    id="password"
                                    type="text"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="bg-neutral-900 border-neutral-800 h-10 font-mono"
                                    placeholder="••••••"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDialogOpen(false)}
                            className="hover:bg-neutral-900 text-neutral-400"
                        >
                            CANCELAR
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest"
                        >
                            GUARDAR
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

