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
    Loader2,
    Palette,
    Layers,
    Server,
    SlidersHorizontal,
    ChevronDown,
    Video
} from "lucide-react";
import nextDynamic from "next/dynamic";
const _SLoad = () => <div className="p-8 text-sm text-muted-foreground animate-pulse">Cargando…</div>;
const BrandingSection = nextDynamic(() => import("./BrandingSection"), { ssr: false, loading: _SLoad });
const SystemLiveStatus = nextDynamic(() => import("./SystemLiveStatus"), { ssr: false, loading: _SLoad });
const AuditPage = nextDynamic(() => import("@/app/admin/audit/page"), { ssr: false, loading: _SLoad });
const WebhookDebugPage = nextDynamic(() => import("@/app/admin/debug/page"), { ssr: false, loading: _SLoad });
import StorageBrowser from "@/components/settings/StorageBrowser";
import { Button } from "@/components/ui/button";
const SystemFlow = nextDynamic(() => import("@/components/dashboard/SystemFlow"), { ssr: false, loading: _SLoad });
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DriverDetailsDialog } from "@/components/DriverDetailsDialog";
import { DRIVER_MODELS, type DeviceBrand } from "@/lib/driver-models";
import { updateSetting, getSetting, testS3Connection, getBucketLifecycle, updateBucketLifecycle, testDbConnection, getBucketStats, getDbStats, downloadBackup, restoreBackup, populateDatabase, testWahaConnection, getWahaHistory, testExternalDbConnection, updateDatabaseUrl, runDatabaseMigrations, getLearnedPlates, clearLearnedPlates, testFaceEngineConnection } from "@/app/actions/settings";
import { clearAllVisitorFaces } from "@/app/actions/face-admin";
import { getAdminsList as getAdmins, saveAdmin as saveAdminAction, deleteAdmin as deleteAdminAction } from "@/app/actions/users";
import { useEffect, useTransition } from "react";
import { sileo as toast } from "sileo";
import { getEnabledModules, toggleModule, setExclusiveMode } from "@/app/actions/modules";
import { MODULE_DEFINITIONS, type ModuleId } from "@/lib/module-definitions";
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
        id: "branding",
        icon: Palette,
        label: "Branding",
        description: "Logo, fondo y nombre del login",
        color: "fuchsia"
    },
    {
        id: "system_status",
        icon: Activity,
        label: "Estado del Sistema",
        description: "Topología y Salud de Red",
        color: "indigo"
    },
    {
        id: "modo",
        icon: Layers,
        label: "Modo",
        description: "Activar y configurar LPR / Face / Cola",
        color: "violet"
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
        label: "Usuarios",
        description: "Control de acceso al sistema",
        color: "purple"
    },
    {
        id: "audit",
        icon: ShieldCheck,
        label: "Auditoría Hardware",
        description: "Auditoría de dispositivos",
        color: "emerald"
    },
    {
        id: "webhooks",
        icon: Activity,
        label: "Webhooks",
        description: "Debug de webhooks entrantes",
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
        label: "Chatbot (OpenWA)",
        description: "Notificaciones & IA WhatsApp",
        color: "emerald"
    },

];

const NAV_GROUPS = [
    { id: "sistema", label: "Sistema", icon: Server, items: [
        { sec: "system_status", btab: "", label: "Estado del Sistema", icon: Activity },
        { sec: "webhooks", btab: "", label: "Webhooks", icon: Activity },
        { sec: "storage", btab: "", label: "Almacenamiento", icon: Cloud },
        { sec: "database", btab: "", label: "Database", icon: Database },
        { sec: "users", btab: "", label: "Usuarios", icon: Users },
    ]},
    { id: "branding", label: "Branding", icon: Palette, items: [
        { sec: "branding", btab: "identidad", label: "Identidad Corporativa", icon: Palette },
        { sec: "branding", btab: "testimonios", label: "Testimonios Login", icon: MessageSquare },
        { sec: "branding", btab: "reportes", label: "Reportes Exportables", icon: FileText },
        { sec: "branding", btab: "pwa", label: "PWA e Iconos", icon: Smartphone },
        { sec: "branding", btab: "splash", label: "PWA SplashScreen", icon: Smartphone },
    ]},
    { id: "modos", label: "Modos", icon: Layers, items: [
        { sec: "modo", btab: "", label: "Modos (LPR / Face / Cola)", icon: Layers },
    ]},
    { id: "avanzado", label: "Avanzado", icon: SlidersHorizontal, items: [
        { sec: "drivers", btab: "", label: "Drivers & Protocolos", icon: Camera },
        { sec: "audit", btab: "", label: "Auditoría Hardware", icon: ShieldCheck },
        { sec: "whatsapp", btab: "", label: "Chatbot (OpenWA)", icon: MessageSquare },
        { sec: "prerec", btab: "", label: "Pre-grabación", icon: Video },
    ]},
];

const DRIVERS = [
    { brand: "Hikvision", tech: "ISAPI/Event", active: true, color: "red", logo: "/logos/hikvision.png" },
    { brand: "Akuvox", tech: "HTTP/Webhook", active: true, color: "blue", logo: "/logos/akuvox.png" },
    { brand: "Avicam", tech: "HTTP/Webhook", active: true, color: "rose", logo: "https://avicam.com.br/wp-content/uploads/2019/11/logo_avicam.png" },
    { brand: "Bosch", tech: "HTTP/Webhook", active: true, color: "blue" },
    { brand: "Dahua", tech: "CGI/HTTP", active: false, color: "red" },
    { brand: "ZKTeco", tech: "Push HTTP", active: false, color: "blue" },
    { brand: "Axis", tech: "Vapix API", active: false, color: "orange" },
    { brand: "Uniview", tech: "SDK Proxy", active: false, color: "blue" },
    { brand: "Intelbras", tech: "CGI/Event", active: false, color: "green" },
    { brand: "UniFi", tech: "Protect API", active: false, color: "blue" },
];

export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState("system_status");
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const [brandingTab, setBrandingTab] = useState("identidad");
    const [storageTab, setStorageTab] = useState("explorador");
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
    const [modelSearch, setModelSearch] = useState("");
    const [modeSubTab, setModeSubTab] = useState<string>("mode_lpr");
    const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});
    const [pendingMode, setPendingMode] = useState<{ moduleId: string; label: string } | null>(null);
    const [switchingTo, setSwitchingTo] = useState<string | null>(null);
    useEffect(() => { getEnabledModules().then((m: any) => { setEnabledModules(m); const act = m.MODULE_LPR ? "mode_lpr" : m.MODULE_FACE ? "mode_face" : m.MODULE_QUEUE ? "mode_queue" : "mode_lpr"; setModeSubTab(act); }).catch(() => {}); }, []);
    const confirmSwitch = async () => { if (!pendingMode) return; const { moduleId, label } = pendingMode; setPendingMode(null); setSwitchingTo(label); try { await setExclusiveMode(moduleId as ModuleId); } catch {} setTimeout(() => window.location.reload(), 1800); };

    return (
        <div className="h-full overflow-y-auto px-6 pb-6 pt-0 space-y-6 animate-in fade-in duration-700 custom-scrollbar">


            {/* Tabs Navigation (agrupado por familias) */}
            <div className="sticky top-0 z-50 bg-card/95 backdrop-blur-xl border-b border-border mb-6 -mx-6 px-4 py-3 shadow-md shadow-black/20">
                {openGroup && <div className="fixed inset-0 z-40" onClick={() => setOpenGroup(null)} />}
                <div className="relative z-50 flex items-center gap-1.5 flex-wrap">
                    {NAV_GROUPS.map((g) => {
                        const GIcon = g.icon;
                        const groupActive = g.items.some(it => it.sec === activeSection && (it.btab ? it.btab === brandingTab : true));
                        const isOpen = openGroup === g.id;
                        return (
                            <div key={g.id} className="relative">
                                <button
                                    onClick={() => setOpenGroup(isOpen ? null : g.id)}
                                    className={cn(
                                        "group flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-semibold transition-all rounded-lg border",
                                        groupActive ? "bg-accent text-foreground border-border shadow-sm" : "text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/50"
                                    )}
                                >
                                    <GIcon size={15} className={cn("shrink-0", groupActive ? "text-indigo-400" : "text-muted-foreground group-hover:text-foreground")} />
                                    {g.label}
                                    <ChevronDown size={13} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
                                </button>
                                {isOpen && (
                                    <div className="absolute left-0 top-full mt-1.5 min-w-[240px] rounded-xl border border-border bg-card shadow-xl shadow-black/30 p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                        {g.items.map((it, idx) => {
                                            const IIcon = it.icon;
                                            const itemActive = it.sec === activeSection && (it.btab ? it.btab === brandingTab : true);
                                            return (
                                                <button
                                                    key={idx}
                                                    onClick={() => { setActiveSection(it.sec); if (it.btab) setBrandingTab(it.btab); setOpenGroup(null); }}
                                                    className={cn(
                                                        "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors text-left",
                                                        itemActive ? "bg-indigo-500/15 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                                                    )}
                                                >
                                                    <IIcon size={15} className={cn("shrink-0", itemActive ? "text-indigo-400" : "")} />
                                                    {it.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Main Content */}
            <div className="w-full space-y-6">
                <div key={activeSection} className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out">
                    {/* Mode Face Section */}
                    {activeSection === "audit" && <AuditPage />}

                    {activeSection === "webhooks" && <WebhookDebugPage />}

                    {activeSection === "branding" && <BrandingSection activeTab={brandingTab} />}


                    {activeSection === "modo" && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
                            {/* Sub-tabs de modo */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {[
                                    { k: "mode_lpr", label: "Modo LPR", moduleId: "MODULE_LPR", Icon: ScanLine, color: "amber" },
                                    { k: "mode_face", label: "Modo Face", moduleId: "MODULE_FACE", Icon: ScanFace, color: "teal" },
                                    { k: "mode_queue", label: "Modo Cola", moduleId: "MODULE_QUEUE", Icon: Users, color: "violet" },
                                ].map((t) => {
                                    const sel = modeSubTab === t.k;
                                    const isOn = enabledModules[t.moduleId];
                                    const Ic = t.Icon;
                                    return (
                                        <button key={t.k} onClick={() => setModeSubTab(t.k)}
                                            className={cn("flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-semibold transition",
                                                sel ? "bg-accent border-border text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50")}>
                                            <Ic size={15} className={sel ? `text-${t.color}-400` : "text-muted-foreground"} />
                                            {t.label}
                                            {isOn && <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Activo</span>}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Banner activar */}
                            {(() => {
                                const meta = ({ mode_lpr: { moduleId: "MODULE_LPR", label: "Modo LPR" }, mode_face: { moduleId: "MODULE_FACE", label: "Modo Face" }, mode_queue: { moduleId: "MODULE_QUEUE", label: "Modo Cola" } } as any)[modeSubTab];
                                const isOn = enabledModules[meta.moduleId];
                                return (
                                    <div className={cn("flex items-center justify-between gap-3 rounded-xl border p-4", isOn ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-border bg-card")}>
                                        <div>
                                            <div className="text-sm font-bold text-foreground">{isOn ? "Este modo está activo" : "Activar este modo"}</div>
                                            <p className="text-xs text-muted-foreground mt-0.5">Cambiar de modo recarga la aplicación con la interfaz del nuevo modo.</p>
                                        </div>
                                        <button disabled={isOn} onClick={() => setPendingMode(meta)}
                                            className={cn("px-4 py-2 rounded-lg text-sm font-bold transition shrink-0", isOn ? "bg-muted text-muted-foreground cursor-default" : "bg-violet-600 hover:bg-violet-500 text-white")}>
                                            {isOn ? "Activo" : "Activar"}
                                        </button>
                                    </div>
                                );
                            })()}

                            {/* Configuración del modo seleccionado */}
                            {modeSubTab === "mode_face" && (
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
                            )}
                            {modeSubTab === "mode_lpr" && (
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
                            {modeSubTab === "mode_queue" && (
                                <ModeConfiguration
                                    title="Modo Filas"
                                    description="Define la lógica de control para el sistema de filas y turnos"
                                    settingKey="MODE_QUEUE"
                                    options={[
                                        { id: "COUNTER", label: "Contador", desc: "Cuenta personas en fila. Alerta cuando supera el umbral.", icon: Activity, color: "blue" },
                                        { id: "TICKET", label: "Turnos", desc: "Sistema de turnos con ticket virtual y notificación.", icon: Bell, color: "violet" },
                                        { id: "LEARNING", label: "Aprendizaje", desc: "Modo en desarrollo. Aprende patrones de flujo.", icon: Cpu, color: "amber", disabled: true }
                                    ]}
                                />
                            )}

                            {/* Modal de confirmación */}
                            {pendingMode && (
                                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPendingMode(null)}>
                                    <div className="bg-card border border-border rounded-2xl shadow-lg max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
                                        <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center mb-4"><Layers size={22} className="text-violet-400" /></div>
                                        <h3 className="text-lg font-bold text-foreground">¿Cambiar a {pendingMode.label}?</h3>
                                        <p className="text-sm text-muted-foreground mt-1.5">La aplicación se recargará en el nuevo modo. Las demás modalidades quedarán desactivadas.</p>
                                        <div className="flex items-center gap-2 mt-5">
                                            <button onClick={confirmSwitch} className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition">Sí, cambiar</button>
                                            <button onClick={() => setPendingMode(null)} className="flex-1 px-4 py-2.5 rounded-lg bg-muted hover:bg-accent text-foreground text-sm font-bold transition">Cancelar</button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Splashscreen */}
                            {switchingTo && (
                                <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-5 bg-background">
                                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-900/40 animate-pulse"><Layers size={30} className="text-white" /></div>
                                    <div className="text-center">
                                        <div className="text-xl font-bold text-foreground">Cambiando a {switchingTo}</div>
                                        <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Recargando la interfaz…</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Drivers Section */}
                    {activeSection === "drivers" && (
                        <div className="space-y-6">
                            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-foreground">Drivers & Protocolos</h2>
                                        <p className="text-sm text-muted-foreground mt-1">Gestiona los controladores de dispositivos compatibles</p>
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
                                                    ? "bg-background/50 border-border hover:border-blue-500/50 hover:bg-background cursor-pointer hover:scale-105"
                                                    : "bg-background/20 border-border opacity-40 cursor-not-allowed"
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
                                                    (driver as { logo?: string }).logo ? "bg-white p-1" : (driver.active ? "bg-blue-500/10" : "bg-muted/50")
                                                )}>
                                                    {(driver as { logo?: string }).logo ? (
                                                        <img src={(driver as { logo?: string }).logo} alt={driver.brand} className="w-full h-full object-contain" />
                                                    ) : (
                                                        <Camera size={24} className={driver.active ? "text-blue-400" : "text-muted-foreground"} />
                                                    )}
                                                </div>

                                                <div className="text-center">
                                                    <p className="font-bold text-sm text-foreground mb-1">{driver.brand}</p>
                                                    <div className="px-2 py-1 bg-card/80 rounded-md">
                                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{driver.tech}</p>
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

                    {activeSection === "database" && (
                        /* ... existing database code ... */
                        <DatabaseSection />
                    )}

                    {activeSection === "storage" && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 border border-border w-fit">
                                {[{ k: "explorador", l: "Explorador · MinIO/S3" }, { k: "config", l: "Configuración & Retención" }].map((t) => (
                                    <button key={t.k} onClick={() => setStorageTab(t.k)}
                                        className={cn("px-3.5 py-2 rounded-lg text-[13px] font-semibold transition whitespace-nowrap", storageTab === t.k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                        {t.l}
                                    </button>
                                ))}
                            </div>
                            {storageTab === "explorador" && <StorageBrowser />}
                            {storageTab === "config" && <StorageSection />}
                        </div>
                    )}

                    {activeSection === "prerec" && (
                        <div className="space-y-6 animate-in zoom-in-95 duration-500">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Pre-grabación</h2>
                                    <p className="text-sm text-muted-foreground mt-1">Buffer continuo de video por cámara de fila y flujos procesados en vivo</p>
                                </div>
                                <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                                    <Video className="text-emerald-400" size={24} />
                                </div>
                            </div>
                            <SystemLiveStatus />
                        </div>
                    )}

                    {activeSection === "system_status" && (
                        <div className="space-y-6 animate-in zoom-in-95 duration-500">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Topología de Red</h2>
                                    <p className="text-sm text-muted-foreground mt-1">Mapa interactivo de conexión entre cámaras, servidor y base de datos</p>
                                </div>
                                <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                                    <Activity className="text-indigo-400" size={24} />
                                </div>
                            </div>
                            <div className="h-[calc(100vh-150px)] -mx-6 overflow-hidden relative group">
                                <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />
                                <SystemFlow />
                            </div>
                        </div>
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
                                        className="bg-black/40 border-border h-10 font-mono text-xs"
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
                                        <div className="p-3 bg-black/40 rounded-lg border border-border">
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
                                    className="bg-black/60 border-border h-9 w-20 text-center font-bold text-blue-400 text-sm"
                                />
                                <span className="text-[10px] text-muted-foreground leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-border flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                                <span>{stats.lpr.loading ? "..." : stats.lpr.count.toLocaleString()} archivos</span>
                                <span>{stats.lpr.loading ? "..." : formatSize(stats.lpr.size)}</span>
                            </div>
                        </div>

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
                                    className="bg-black/60 border-border h-9 w-20 text-center font-bold text-purple-400 text-sm"
                                />
                                <span className="text-[10px] text-muted-foreground leading-tight">Días de retención antes de borrar. (0 = nunca)</span>
                            </div>

                            {/* Stats Mini */}
                            <div className="pt-3 border-t border-border flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                                <span>{stats.face.loading ? "..." : stats.face.count.toLocaleString()} archivos</span>
                                <span>{stats.face.loading ? "..." : formatSize(stats.face.size)}</span>
                            </div>
                        </div>

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
                                    className="bg-black/40 border-border h-10 text-sm font-mono"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Access Key</Label>
                                    <Input
                                        placeholder="root"
                                        value={config.accessKey}
                                        onChange={e => setConfig({ ...config, accessKey: e.target.value })}
                                        className="bg-black/40 border-border h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Secret Key</Label>
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        value={config.secretKey}
                                        onChange={e => setConfig({ ...config, secretKey: e.target.value })}
                                        className="bg-black/40 border-border h-10 text-sm font-mono"
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
                                        className="bg-black/40 border-border h-10 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Bucket Face</Label>
                                    <Input
                                        placeholder="face"
                                        value={config.bucketFace}
                                        onChange={e => setConfig({ ...config, bucketFace: e.target.value })}
                                        className="bg-black/40 border-border h-10 text-sm font-mono"
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
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8 space-y-8 animate-in slide-in-from-bottom-5 duration-500">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
                        <p className="text-sm text-muted-foreground mt-1">{description}</p>
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
                                                ? "bg-card/20 border-border opacity-50 cursor-not-allowed"
                                                : "bg-card/40 border-border hover:bg-card/60 hover:border-border"
                                    )}
                                >
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
                                        isSelected ? `bg-${option.color}-500/20 text-${option.color}-400` : "bg-foreground/10 text-muted-foreground group-hover:bg-accent group-hover:text-muted-foreground"
                                    )}>
                                        <Icon size={20} />
                                    </div>
                                    <div>
                                        <h3 className={cn(
                                            "font-bold text-sm",
                                            isSelected ? "text-foreground" : "text-muted-foreground"
                                        )}>
                                            {option.label}
                                        </h3>
                                        <p className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5">
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
                        <div className="bg-background/30 border border-border rounded-xl p-6 h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <Info size={16} className="text-muted-foreground" />
                                <h3 className="text-xs font-bold text-foreground uppercase tracking-widest">¿CÓMO FUNCIONA ESTE MODO?</h3>
                            </div>

                            <div className="space-y-4">
                                {loadModeExplanation(currentMode, isFaceMode).map((item, i) => (
                                    <div key={i} className={`flex items-start gap-4 p-4 rounded-lg bg-${item.color}-500/5 border border-${item.color}-500/10`}>
                                        <div className={`p-2 rounded bg-${item.color}-500/10 text-${item.color}-400 shrink-0`}>
                                            <item.icon size={16} />
                                        </div>
                                        <div>
                                            <h4 className={`text-xs font-bold text-${item.color}-400 mb-1 uppercase`}>{item.title}</h4>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">{item.text}</p>
                                        </div>
                                    </div>
                                ))}
                                {loadModeExplanation(currentMode, isFaceMode).length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">Selecciona un modo para ver los detalles.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Learned Plates Information */}
                {currentMode === 'LEARNING' && isLprMode && (
                    <div className="mt-8 pt-8 border-t border-border space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <Activity className="text-blue-400" size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-tight">Matrículas Aprendidas</h3>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Estas matrículas se han agregado automáticamente</p>
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

                        <div className="bg-black/40 border border-border rounded-xl overflow-hidden">
                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                <Table>
                                    <TableHeader className="bg-foreground/10">
                                        <TableRow className="border-border hover:bg-transparent">
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Matrícula</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase w-[100px]">Captura</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Fecha y Hora de Captura</TableHead>
                                            <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loadingLearned ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <RefreshCcw className="animate-spin text-blue-500" size={20} />
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Cargando datos...</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="h-24 text-center">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Info className="text-muted-foreground" size={20} />
                                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">No hay matrículas aprendidas en esta sesión</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : learnedPlates.map((item) => (
                                            <TableRow key={item.id} className="border-border hover:bg-accent group transition-colors">
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                                            <Car className="text-blue-400" size={14} />
                                                        </div>
                                                        <span className="font-mono font-bold text-foreground">{item.plate}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {item.snapshot ? (
                                                        <div className="w-16 h-10 rounded overflow-hidden border border-border bg-card group-hover:scale-110 transition-transform cursor-pointer">
                                                            <img
                                                                src={item.snapshot}
                                                                alt={item.plate}
                                                                className="w-full h-full object-cover"
                                                                onClick={() => window.open(item.snapshot!, '_blank')}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-16 h-10 rounded bg-card border border-border flex items-center justify-center">
                                                            <Eye size={12} className="text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Calendar size={12} className="text-muted-foreground" />
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
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-400 uppercase">
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
                        className="bg-card border border-border rounded-xl max-w-sm w-full mx-4 overflow-hidden shadow-lg animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
                                <ShieldAlert size={32} />
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-2">¿Confirmar Cambio?</h3>
                            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
                                Estás a punto de cambiar a
                                <span className={`font-bold text-${getPendingOption()?.color}-400 mx-1`}>
                                    {getPendingOption()?.label}
                                </span>.
                                Esta acción modificará inmediatamente como el sistema procesa los eventos.
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                                <Button onClick={() => setPendingMode(null)} variant="ghost" className="h-10 text-muted-foreground hover:bg-accent hover:text-foreground font-bold rounded-lg border border-border">
                                    Cancelar
                                </Button>
                                <Button onClick={confirmModeChange} className="h-10 bg-white text-black hover:bg-muted font-bold rounded-lg">
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
    const [config, setConfig] = useState({ url: "", apiKey: "" });
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
    const [allowEnabled, setAllowEnabled] = useState(false);
    const [allowList, setAllowList] = useState<string[]>([]);
    const [newAllow, setNewAllow] = useState("");
    const [savingAllow, setSavingAllow] = useState(false);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const [url, apiKey, cmdConfig, allowEn, allowLs] = await Promise.all([
                getSetting("WAHA_URL"),
                getSetting("WAHA_API_KEY"),
                getSetting("WAHA_COMMANDS"),
                getSetting("WHATSAPP_ALLOWLIST_ENABLED"),
                getSetting("WHATSAPP_ALLOWLIST")
            ]);
            setAllowEnabled(allowEn?.value === "true");
            try { const a = JSON.parse(allowLs?.value || "[]"); if (Array.isArray(a)) setAllowList(a); } catch {}

            setConfig({
                url: url?.value || "",
                apiKey: apiKey?.value || ""
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

    const addAllow = (val: string) => { const v = (val || "").trim(); if (!v) return; if (allowList.includes(v)) return; setAllowList([...allowList, v]); setNewAllow(""); };
    const removeAllow = (v: string) => setAllowList(allowList.filter(x => x !== v));
    const saveAllowlist = async () => {
        setSavingAllow(true);
        try {
            await Promise.all([
                updateSetting("WHATSAPP_ALLOWLIST_ENABLED", allowEnabled ? "true" : "false"),
                updateSetting("WHATSAPP_ALLOWLIST", JSON.stringify(allowList)),
            ]);
            toast.success({ title: "Seguridad del chatbot guardada" });
        } catch { toast.error({ title: "Error al guardar la lista blanca" }); }
        finally { setSavingAllow(false); }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const commandsConfig = JSON.stringify(commands.map(c => ({ id: c.id, active: c.active })));
            await Promise.all([
                updateSetting("WAHA_URL", config.url),
                updateSetting("WAHA_API_KEY", config.apiKey),
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
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
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
                        <h2 className="text-xl font-bold text-foreground tracking-tight">Chatbot WhatsApp (WAHA)</h2>
                        <p className="text-xs text-muted-foreground">Asistente IA y Notificaciones</p>
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
                    <div className="bg-card/50 backdrop-blur-xl border border-border rounded-lg p-6 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Settings className="text-emerald-400" size={18} />
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Conexión</h3>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                                <Activity size={12} />
                                <span>Sistema Activo</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">URL del Servidor</Label>
                                <Input
                                    value={config.url}
                                    onChange={(e) => setConfig({ ...config, url: e.target.value })}
                                    placeholder="http://localhost:3000"
                                    className="bg-black/40 border-border h-10 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">API Key</Label>
                                <Input
                                    value={config.apiKey}
                                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                    type="password"
                                    placeholder="••••••••"
                                    className="bg-black/40 border-border h-10 font-mono text-xs"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <Button onClick={handleTest} disabled={testing} variant="outline" className="flex-1 h-9 text-xs font-bold border-border hover:bg-accent">
                                {testing ? "Probando..." : "Probar Conexión"}
                            </Button>
                            <Button onClick={handleSave} disabled={saving} className="flex-1 h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-foreground shadow-lg shadow-emerald-900/20">
                                {saving ? "Guardando..." : "Guardar Cambios"}
                            </Button>
                        </div>
                    </div>

                    {/* Webhook Info */}
                    <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 flex items-start gap-4">
                        <Info className="text-blue-400 shrink-0 mt-1" size={16} />
                        <div>
                            <h4 className="text-xs font-bold text-blue-100 uppercase mb-1">Webhook URL</h4>
                            <p className="text-[10px] text-blue-200/60 mb-2">Configura esta URL en WAHA:</p>
                            <code className="block bg-black/20 rounded p-2 text-[10px] font-mono text-blue-300">http://SERVER_IP:10000/api/webhooks/whatsapp</code>
                        </div>
                    </div>

                    {/* Seguridad: lista blanca de remitentes */}
                    <div className="bg-card/50 backdrop-blur-xl border border-border rounded-lg p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="text-emerald-400" size={18} />
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Seguridad · Remitentes</h3>
                            </div>
                            <Switch checked={allowEnabled} onCheckedChange={setAllowEnabled} />
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            El bot responde con eventos, historiales y <b>fotos</b>. Con la lista blanca activada, <b>solo</b> procesa mensajes de los remitentes autorizados; al resto lo ignora en silencio. Evita fuga de datos a desconocidos.
                        </p>
                        <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5">
                            <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-blue-200/80">WhatsApp moderno puede ocultar el número y usar un ID anónimo. Forma segura de autorizar: que la persona <b>escriba al bot</b> y luego tocá su entrada en <b>"Remitentes recientes"</b> aquí abajo. (Escribir el número a mano solo funciona si WhatsApp lo expone.)</span>
                        </div>

                        {!allowEnabled && (
                            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                                <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-amber-300">Desactivada: cualquier persona que escriba al bot puede consultar datos. Recomendado activarla.</span>
                            </div>
                        )}

                        {allowEnabled && (
                            <>
                                <div className="flex gap-2">
                                    <Input value={newAllow} onChange={(e) => setNewAllow(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAllow(newAllow); } }}
                                        placeholder="Número (098…) o JID de grupo (…@g.us)" className="bg-black/40 border-border h-9 font-mono text-xs" />
                                    <Button onClick={() => addAllow(newAllow)} className="h-9 px-3 bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={15} /></Button>
                                </div>

                                {history.length > 0 && (
                                    <div>
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Remitentes recientes (tocar para autorizar)</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {Array.from(new Set(history.map((h: any) => h.user).filter(Boolean))).slice(0, 8).map((u: any) => (
                                                <button key={u} onClick={() => addAllow(u)} disabled={allowList.includes(u)} className="text-[10px] font-mono px-2 py-1 rounded-md border border-border bg-muted/50 hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-40 transition">+ {String(u).split("@")[0]}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Autorizados ({allowList.length})</p>
                                    {allowList.length === 0 ? (
                                        <p className="text-[10px] text-muted-foreground italic">Sin remitentes autorizados. Con la lista vacía y activada, el bot no responde a nadie.</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {allowList.map((v) => (
                                                <span key={v} className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                                                    {v.endsWith("@g.us") ? "👥 " : "📱 "}{String(v).split("@")[0]}
                                                    <button onClick={() => removeAllow(v)} className="hover:text-red-400"><X size={11} /></button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        <Button onClick={saveAllowlist} disabled={savingAllow} className="w-full h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                            {savingAllow ? "Guardando…" : "Guardar seguridad"}
                        </Button>
                    </div>
                </div>

                {/* Right Column: Commands & History */}
                <div className="space-y-6">
                    {/* Commands List */}
                    <div className="bg-card/50 backdrop-blur-xl border border-border rounded-lg p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <MessageSquare className="text-purple-400" size={18} />
                            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Comandos Disponibles</h3>
                        </div>
                        <div className="border border-border rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader className="bg-foreground/10">
                                    <TableRow className="border-border hover:bg-transparent">
                                        <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Comando</TableHead>
                                        <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-right">Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {commands.map((cmd) => (
                                        <TableRow key={cmd.id} className="border-border hover:bg-accent">
                                            <TableCell className="py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-1.5 rounded bg-muted text-muted-foreground`}>
                                                        <cmd.icon size={12} />
                                                    </div>
                                                    <div>
                                                        <span className="block text-xs font-mono font-bold text-muted-foreground">{cmd.cmd}</span>
                                                        <span className="block text-[10px] text-muted-foreground truncate max-w-[150px]">{cmd.desc}</span>
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
                    <div className="bg-card/50 backdrop-blur-xl border border-border rounded-lg p-6 max-h-[400px] overflow-hidden flex flex-col">
                        <div className="flex items-center gap-2 mb-4 shrink-0">
                            <FileText className="text-amber-400" size={18} />
                            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Historial de Consultas</h3>
                        </div>
                        <div className="border border-border rounded-lg overflow-y-auto custom-scrollbar grow">
                            <Table>
                                <TableHeader className="bg-foreground/10 sticky top-0 z-10 backdrop-blur-md">
                                    <TableRow className="border-border hover:bg-transparent">
                                        <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest w-24">Usuario</TableHead>
                                        <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Interacción</TableHead>
                                        <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-right w-24">Hora</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.length === 0 ? (
                                        <TableRow className="border-border hover:bg-transparent">
                                            <TableCell colSpan={3} className="py-8 text-center text-[10px] text-muted-foreground italic">
                                                Sin registros recientes.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        history.map((h) => (
                                            <TableRow key={h.id} className="border-border hover:bg-accent">
                                                <TableCell className="py-2 align-top">
                                                    <span className="text-[9px] font-bold text-foreground bg-foreground/10 px-1.5 py-0.5 rounded-full whitespace-nowrap overflow-hidden text-ellipsis max-w-full block" title={h.user}>
                                                        {h.user.split('@')[0]}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2 align-top">
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-mono text-emerald-400 break-words line-clamp-2" title={h.command}>&gt; {h.command}</p>
                                                        <p className="text-[9px] text-muted-foreground break-words line-clamp-2" title={h.response}>{h.response}</p>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right text-[9px] text-muted-foreground font-mono align-top whitespace-nowrap">
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
        role: "ADMIN",
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
            toast.error({ title: "Error al cargar usuarios" });
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
        data.append("role", formData.role);
        if (formData.photo) data.append("photo", formData.photo);
        data.append("currentPhoto", formData.currentPhoto);

        try {
            await saveAdminAction(data);
            toast.success({ title: editingAdmin ? "Usuario actualizado" : "Usuario creado" });
            setIsDialogOpen(false);
            loadAdmins();
            setEditingAdmin(null);
            setFormData({ name: "", email: "", password: "", role: "ADMIN", photo: null, currentPhoto: "" });
        } catch (error: any) {
            toast.error({ title: error.message || "Error al guardar administrador" });
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este administrador?")) {
            try {
                await deleteAdminAction(id);
                toast.success({ title: "Usuario eliminado" });
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
            role: admin.role || "ADMIN",
            photo: null,
            currentPhoto: admin.cara || ""
        });
        setIsDialogOpen(true);
    };

    const openNew = () => {
        setEditingAdmin(null);
        setFormData({ name: "", email: "", password: "", role: "ADMIN", photo: null, currentPhoto: "" });
        setIsDialogOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Usuarios del Sistema</h2>
                        <p className="text-sm text-muted-foreground mt-1">Gestión de usuarios con acceso al panel de control</p>
                    </div>
                    <Button
                        onClick={openNew}
                        className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold text-xs uppercase tracking-widest h-10 px-6"
                    >
                        <Plus size={16} className="mr-2" />
                        Nuevo Usuario
                    </Button>
                </div>

                <div className="bg-background/30 border border-border rounded-xl overflow-hidden">
                    <Table>
                        <TableHeader className="bg-foreground/10">
                            <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="w-[80px] text-[10px] font-bold text-muted-foreground uppercase">Foto</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Usuario / Nombre</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Email</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Rol</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="animate-spin mx-auto text-muted-foreground" />
                                    </TableCell>
                                </TableRow>
                            ) : admins.map((admin) => (
                                <TableRow key={admin.id} className="border-border hover:bg-accent transition-colors group">
                                    <TableCell>
                                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden relative border border-border">
                                            {admin.cara ? (
                                                <img
                                                    src={admin.cara.startsWith('/') ? admin.cara : `/api/files/${admin.cara}`}
                                                    alt={admin.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                    <UserIcon size={16} />
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-bold text-foreground uppercase text-xs">
                                        {admin.name}
                                        {admin.name === 'fgonzalez' && (
                                            <span className="ml-2 text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/30">Líder</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground font-mono text-xs">{admin.email || "-"}</TableCell>
                                    <TableCell>
                                        <div className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 w-fit">
                                            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">{admin.role}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => openEdit(admin)}
                                                className="w-8 h-8 rounded-lg bg-blue-500/10 hover:bg-blue-600 text-blue-500 hover:text-foreground flex items-center justify-center transition-all"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(admin.id)}
                                                className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-600 text-red-500 hover:text-foreground flex items-center justify-center transition-all"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!loading && admins.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-xs font-bold uppercase">
                                        No hay usuarios registrados
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-background border-border text-foreground sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold uppercase tracking-tight">
                            {editingAdmin ? "Editar Usuario" : "Nuevo Usuario"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-6 py-4">
                        <div className="flex items-center justify-center gap-4">
                            <div className="relative w-24 h-24 rounded-full bg-card border-2 border-border overflow-hidden group cursor-pointer transition-all hover:border-blue-500/50">
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
                                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1">
                                        <Camera size={20} />
                                        <span className="text-[9px] font-bold uppercase">Foto</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                    <Upload className="text-foreground w-6 h-6" />
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Usuario (Login)</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="bg-card border-border h-10"
                                    placeholder="ej: fgonzalez"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="email" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Email (Opcional)</Label>
                                <Input
                                    id="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="bg-card border-border h-10"
                                    placeholder="ej: usuario@empresa.com"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="password" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                    {editingAdmin ? "Nueva Contraseña (Dejar vacío para mantener)" : "Contraseña"}
                                </Label>
                                <PasswordInput
                                    id="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="bg-card border-border h-10 font-mono"
                                    placeholder="••••••"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="role" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rol</Label>
                                <select
                                    id="role"
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    className="bg-card border border-border h-10 rounded-md px-3 text-sm text-foreground"
                                >
                                    <option value="ADMIN">Administrador (acceso total)</option>
                                    <option value="OPERATOR">Solo lectura (opera, no edita)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDialogOpen(false)}
                            className="hover:bg-card text-muted-foreground"
                        >
                            CANCELAR
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold uppercase tracking-widest"
                        >
                            GUARDAR
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}


// ─── Modules Section ────────────────────────────────
function ModulesSection() {
    const [modules, setModules] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);

    useEffect(() => {
        getEnabledModules().then(m => {
            setModules(m);
            setLoading(false);
        });
    }, []);

    const handleToggle = async (moduleId: string) => {
        setToggling(moduleId);
        const newValue = !modules[moduleId];
        const result = await toggleModule(moduleId as ModuleId, newValue);
        if (result.success) {
            setModules(prev => ({ ...prev, [moduleId]: newValue }));
            toast.success({ title: `Módulo ${newValue ? 'activado' : 'desactivado'}` });
        }
        setToggling(null);
    };

    const iconMap: Record<string, any> = {
        Car: Car,
        ScanFace: ScanFace,
        Users: Users,
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <RefreshCcw className="animate-spin text-muted-foreground" size={24} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in zoom-in-95 duration-500">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Módulos del Sistema</h2>
                    <p className="text-sm text-muted-foreground mt-1">Activa o desactiva los módulos de OmniAccess. Los módulos desactivados no aparecen en el menú.</p>
                </div>
                <div className="p-2 bg-violet-500/10 rounded-xl border border-violet-500/20">
                    <Cpu className="text-violet-400" size={24} />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {MODULE_DEFINITIONS.map((mod) => {
                    const Icon = iconMap[mod.icon] || Cpu;
                    const enabled = modules[mod.id] ?? mod.defaultEnabled;
                    const isToggling = toggling === mod.id;

                    const modColorMap: Record<string, string> = { MODULE_LPR: 'amber', MODULE_FACE: 'teal', MODULE_QUEUE: 'violet', MODULE_GUARD: 'emerald' };
                    const modColor = modColorMap[mod.id] || 'violet';
                    const colorClasses: Record<string, { bg: string; border: string; text: string; glow: string }> = {
                        amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", glow: "shadow-amber-500/20" },
                        teal: { bg: "bg-teal-500/10", border: "border-teal-500/30", text: "text-teal-400", glow: "shadow-teal-500/20" },
                        violet: { bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-400", glow: "shadow-violet-500/20" },
                    };
                    const colors = colorClasses[modColor] || colorClasses.violet;

                    return (
                        <div
                            key={mod.id}
                            className={cn(
                                "relative rounded-2xl border p-6 transition-all duration-300",
                                enabled
                                    ? `${colors.bg} ${colors.border} shadow-lg ${colors.glow}`
                                    : "bg-card/50 border-border/50 opacity-60"
                            )}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className={cn(
                                    "p-3 rounded-xl",
                                    enabled ? colors.bg : "bg-muted"
                                )}>
                                    <Icon className={enabled ? colors.text : "text-muted-foreground"} size={24} />
                                </div>
                                <button
                                    onClick={() => handleToggle(mod.id)}
                                    disabled={isToggling}
                                    className={cn(
                                        "relative w-12 h-7 rounded-full transition-all duration-300 focus:outline-none",
                                        enabled ? "bg-emerald-500" : "bg-muted"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300",
                                        enabled ? "left-[22px]" : "left-0.5",
                                        isToggling && "animate-pulse"
                                    )} />
                                </button>
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-1">{mod.name}</h3>
                            <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
