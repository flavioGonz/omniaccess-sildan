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
    Car,
    Eye,
    X,
    Check,
    MessageSquare,
    Smartphone,
    QrCode,
    CheckCircle2,
    LogOut,
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
const TrackingSection = nextDynamic(() => import("./TrackingSection"), { ssr: false, loading: _SLoad });
const OmniLprToggle = nextDynamic(() => import("./OmniLprToggle"), { ssr: false });
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DriverDetailsDialog } from "@/components/DriverDetailsDialog";
import { DRIVER_MODELS, type DeviceBrand } from "@/lib/driver-models";
import { updateSetting, getSetting, testS3Connection, getBucketLifecycle, updateBucketLifecycle, testDbConnection, getBucketStats, getDbStats, downloadBackup, restoreBackup, populateDatabase, testWahaConnection, getWahaHistory, testExternalDbConnection, updateDatabaseUrl, runDatabaseMigrations, getLearnedPlates, clearLearnedPlates, testFaceEngineConnection } from "@/app/actions/settings";
import { getAvisosWhatsApp, setAvisoWhatsApp, agregarDestinatarioWhatsApp, quitarDestinatarioWhatsApp, getRemitentesDelBot, type TipoAviso } from "@/app/actions/whatsapp-avisos";
import { clearAllVisitorFaces } from "@/app/actions/face-admin";
import { getAdminsList as getAdmins, saveAdmin as saveAdminAction, deleteAdmin as deleteAdminAction } from "@/app/actions/users";
import { useEffect, useTransition } from "react";
import { sileo as toast } from "sileo";
import { getEnabledModules, toggleModule, setExclusiveMode } from "@/app/actions/modules";
import { OtpInput, type OtpStatus } from "@/components/ui/otp-input";
import axios from "axios";
import { MODULE_DEFINITIONS, type ModuleId } from "@/lib/module-definitions";
import ModosSection from "./ModosSection";
import AlmacenamientoSection from "./AlmacenamientoSection";
import { FUNCIONES, type FuncionId } from "@/lib/funciones";
import { getFunciones, toggleFuncion } from "@/app/actions/funciones";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { fecha, fechaHoraSeg } from "@/lib/fechas";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
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
    {
        id: "tracking",
        icon: Video,
        label: "Omni-LPR & Seguimiento",
        description: "Lector en contenedor y cámaras interiores",
        color: "teal"
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
        { sec: "tracking", btab: "", label: "Omni-LPR & Seguimiento", icon: Video },
        { sec: "prerec", btab: "", label: "Pre-grabación", icon: Video },
    ]},
];

const DRIVERS = [
    { brand: "Hikvision", tech: "ISAPI/Event", active: true, color: "red", logo: "/logos/hikvision.png" },
    { brand: "Akuvox", tech: "HTTP/Webhook", active: true, color: "blue", logo: "/logos/akuvox.png" },
    { brand: "Avicam", tech: "HTTP/Webhook", active: true, color: "rose", logo: "https://avicam.com.br/wp-content/uploads/2019/11/logo_avicam.png" },
    { brand: "Bosch", tech: "HTTP/Webhook", active: true, color: "blue" },
    { brand: "Dahua", tech: "CGI/HTTP · RTSP", active: true, color: "red" },
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
    const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});
    const [pendingMode, setPendingMode] = useState<{ moduleId: string; label: string } | null>(null);
    const [switchingTo, setSwitchingTo] = useState<string | null>(null);
    /* Ya no hay que elegir una sub-pestaña: la configuración es la del modo que está
       puesto, y eso sale de `enabledModules` directamente. La línea que estaba acá
       adivinaba la pestaña inicial con un encadenado de ternarios que terminaba en
       "mode_lpr" — o sea que sin ningún modo prendido mostraba igual la configuración de
       matrículas, como si estuviera activa. */
    useEffect(() => { getEnabledModules().then(setEnabledModules).catch(() => { }); }, []);
    const [pinEstado, setPinEstado] = useState<OtpStatus>("idle");
    const [verificando, setVerificando] = useState(false);
    const confirmSwitch = async () => { if (!pendingMode) return; const { moduleId, label } = pendingMode; setPendingMode(null); setPinEstado("idle"); setSwitchingTo(label); try { await setExclusiveMode(moduleId as ModuleId); } catch {} setTimeout(() => window.location.reload(), 1800); };
    // Cambiar de modalidad apaga las otras: pedimos la clave de operacion antes.
    const verificarPin = async (codigo: string) => {
        if (verificando) return;
        setVerificando(true);
        try {
            await axios.post("/api/modes/pin", { codigo });
            setPinEstado("success");
            setTimeout(confirmSwitch, 450);
        } catch {
            setPinEstado("error");
        } finally {
            setVerificando(false);
        }
    };
    const cerrarPin = () => { setPendingMode(null); setPinEstado("idle"); };

    return (
        /* Sin animación de entrada.
              *
              * Había tres encadenadas: la pantalla entera se desvanecía durante 700 ms, el
              * contenido subía 500 ms más, y cada sección volvía a hacerlo al cambiar de
              * pestaña. Es configuración: se entra a cambiar UNA cosa y salir, y esperar a
              * que media pantalla termine de acomodarse antes de poder apuntarle a un
              * interruptor es peaje puro. Una animación se gana explicando un cambio de
              * estado; ésta no explicaba ninguno. */
        <div className="h-full overflow-y-auto px-6 pb-6 pt-0 space-y-6 custom-scrollbar">


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
                <div key={activeSection}>
                    {/* Mode Face Section */}
                    {activeSection === "audit" && <AuditPage />}

                    {activeSection === "webhooks" && <WebhookDebugPage />}

                    {activeSection === "branding" && <BrandingSection activeTab={brandingTab} />}


                    {activeSection === "modo" && (
                        <div className="space-y-8">
                            {/* Los módulos y sus funciones.
                              *
                              * Estaban escritos y NO SE RENDERIZABAN. `ModulesSection` existía
                              * en este mismo archivo, con sus cuatro tarjetas y los interruptores
                              * de funciones, y no había una sola línea que la dibujara: el
                              * operador no tenía forma de prender ni apagar un módulo, ni de
                              * apagar las estadías, por más que el mecanismo entero —la acción,
                              * el Setting, el caché— estuviera terminado y andando.
                              *
                              * Es la misma clase de defecto que el resto de la auditoría, sólo
                              * que al revés: acá no es una pantalla que dice algo falso, es una
                              * función que existe y no tiene puerta. */}
                            <ModosSection onActivar={(moduleId, label) => setPendingMode({ moduleId, label })} />

                            {/*
                              * La configuración del modo QUE ESTÁ PUESTO. Sin sub-pestañas.
                              *
                              * Había una fila de tres pestañas (Modo LPR / Face / Cola) y abajo
                              * un cartel con un botón «Activar». Entre las dos cosas y las
                              * tarjetas de arriba, la misma pantalla tenía TRES lugares que
                              * hablaban de los mismos tres módulos, y dos de ellos permitían
                              * activarlos por caminos distintos — uno con clave y excluyente, el
                              * otro sin clave y suelto.
                              *
                              * Lo que queda es lo único que hacía falta: elegir el modo arriba,
                              * configurarlo acá. Mirar la configuración de un modo apagado era
                              * posible y se pierde a propósito; no compensa una segunda fila de
                              * controles con los mismos nombres.
                              */}
                            {(() => {
                                const activo = MODULE_DEFINITIONS.find((m) => m.exclusive && enabledModules[m.id]);

                                /* Ningún modo puesto es un estado posible —alcanza con apagar el
                                   que había— y hay que decirlo. Una pantalla en blanco acá se lee
                                   como "todavía está cargando". */
                                if (!activo) {
                                    return (
                                        <div className="rounded-[var(--radius)] border border-border bg-card p-6">
                                            <div className="text-[13px] font-semibold text-foreground">Esta instalación no tiene ningún modo puesto</div>
                                            <p className="mt-1 max-w-xl text-[11px] leading-[1.45] text-muted-foreground">
                                                Sin un modo activo no hay nada que configurar acá, y el sistema no
                                                está leyendo matrículas ni rostros. Elegí uno arriba.
                                            </p>
                                        </div>
                                    );
                                }

                                if (activo.id === "MODULE_FACE") return (
                                    <ModeConfiguration
                                        title="Comportamiento del modo Rostro"
                                        description="Qué hace el sistema cuando reconoce una cara"
                                        settingKey="MODE_FACE"
                                        options={[
                                            { id: "BLACKLIST", label: "Lista Negra", desc: "Las capturas identificadas serán DENEGADAS automáticamente.", icon: ShieldAlert, color: "red" },
                                            { id: "WHITELIST", label: "Lista Blanca", desc: "Las capturas identificadas serán PERMITIDAS automáticamente.", icon: ShieldCheck, color: "emerald" },
                                            { id: "LEARNING", label: "Aprendizaje", desc: "Modo en desarrollo. Captura rostros para entrenamiento.", icon: Cpu, color: "amber", disabled: true }
                                        ]}
                                    />
                                );

                                if (activo.id === "MODULE_LPR") return (
                                    <>
                                        <ModeConfiguration
                                            title="Comportamiento del modo Matrículas"
                                            description="Qué hace el sistema cuando lee una chapa"
                                            settingKey="MODE_LPR"
                                            options={[
                                                { id: "BLACKLIST", label: "Lista Negra", desc: "Las matrículas identificadas en lista serán DENEGADAS.", icon: ShieldAlert, color: "red" },
                                                { id: "WHITELIST", label: "Lista Blanca", desc: "Las matrículas identificadas en lista serán PERMITIDAS.", icon: ShieldCheck, color: "emerald" },
                                                { id: "LEARNING", label: "Aprendizaje", desc: "Agrega matrículas desconocidas a la base de datos.", icon: Activity, color: "blue" }
                                            ]}
                                        />
                                        <OmniLprToggle />
                                    </>
                                );

                                return (
                                    <ModeConfiguration
                                        title="Comportamiento del modo Filas"
                                        description="Qué hace el sistema con la gente que espera"
                                        settingKey="MODE_QUEUE"
                                        options={[
                                            { id: "COUNTER", label: "Contador", desc: "Cuenta personas en fila. Alerta cuando supera el umbral.", icon: Activity, color: "blue" },
                                            { id: "TICKET", label: "Turnos", desc: "Sistema de turnos con ticket virtual y notificación.", icon: Bell, color: "violet" },
                                            { id: "LEARNING", label: "Aprendizaje", desc: "Modo en desarrollo. Aprende patrones de flujo.", icon: Cpu, color: "amber", disabled: true }
                                        ]}
                                    />
                                );
                            })()}

                            {/* Modal de confirmación */}
                            {pendingMode && (
                                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={cerrarPin}>
                                    <div className="bg-card border border-border rounded-2xl shadow-lg max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
                                        <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center mb-4"><Layers size={22} className="text-violet-400" /></div>
                                        <h3 className="text-lg font-bold text-foreground">¿Cambiar a {pendingMode.label}?</h3>
                                        <p className="text-sm text-muted-foreground mt-1.5">La aplicación se recargará en el nuevo modo y las demás modalidades quedarán desactivadas. Ingresá la clave de operación para confirmar.</p>
                                        <div className="mt-5 flex justify-center">
                                            <OtpInput
                                                length={6}
                                                size="md"
                                                type="numbers"
                                                mask
                                                autoFocus
                                                disabled={verificando || pinEstado === "success"}
                                                status={pinEstado}
                                                onChange={() => { if (pinEstado === "error") setPinEstado("idle"); }}
                                                onComplete={verificarPin}
                                            />
                                        </div>
                                        <div className="h-5 mt-2 text-center text-xs font-semibold">
                                            {pinEstado === "error" && <span className="text-red-500">Clave incorrecta</span>}
                                            {pinEstado === "success" && <span className="text-emerald-500">Clave correcta, cambiando…</span>}
                                        </div>
                                        <button onClick={cerrarPin} className="w-full mt-2 px-4 py-2.5 rounded-lg bg-muted hover:bg-accent text-foreground text-sm font-bold transition">Cancelar</button>
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
                            {storageTab === "config" && <AlmacenamientoSection />}
                        </div>
                    )}

                    {activeSection === "prerec" && (
                        <div className="space-y-6">
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
                        <div className="space-y-6">
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

                    {activeSection === "tracking" && <TrackingSection />}
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

    /**
     * Cambiar la base de datos apuntando a otra: lo más grande que se puede hacer desde
     * acá. La aplicación se reinicia y todo el barrio pasa a leer y escribir en otro lado
     * — residentes, credenciales, historial. Si la base nueva está vacía, el sistema
     * arranca como si el barrio no existiera. Un `confirm()` del navegador, con dos botones
     * iguales, es poco freno para eso: ahora pide escribir la palabra.
     */
    const [cambiandoBase, setCambiandoBase] = useState(false);

    const handleApplyExternal = async () => {
        if (!externalStatus?.success) return;
        setCambiandoBase(true);
    };

    const aplicarCambioDeBase = async () => {
        const res = await updateDatabaseUrl(newDbUrl);
        if (res.success) {
            toast.success({ title: "Configuración actualizada. Reiniciando…" });
            setTimeout(() => window.location.reload(), 3000);
            return;
        }
        toast.error({ title: "Error al actualizar: " + res.message });
        return { success: false, error: res.message };
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
    /* La palabra que hay que escribir para reemplazar la base. Se limpia al cerrar el
       diálogo: si quedara escrita, el próximo reemplazo volvería a ser de un clic. */
    const [palabraReemplazo, setPalabraReemplazo] = useState("");
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

    /* Reemplazar la base entera pide escribir la palabra, igual que cambiar de base en
       esta misma pantalla. Antes era UN CLIC en un botón rojo — y es la única acción de
       toda la aplicación que borra usuarios, credenciales y el historial de accesos de
       golpe. Fusionar no la pide: agrega, no destruye. */
    const PALABRA_REEMPLAZO = "REEMPLAZAR";

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
                    /*
                     * El mensaje sale de la acción, que contó la base DESPUÉS de restaurar.
                     *
                     * Acá había un texto fijo —"Base de datos restaurada correctamente"—
                     * que se mostraba pasara lo que pasara. Ahora la acción devuelve los
                     * números reales y, si algo quedó con menos filas que antes, lo dice.
                     */
                    const perdio = (res as any).perdidas?.length > 0;
                    if (perdio) toast.warning({ title: "Restaurado con pérdidas", description: res.message });
                    else toast.success({ title: "Base de datos restaurada", description: res.message });
                    loadStats();
                } else {
                    toast.error({ title: "No se restauró", description: res.message });
                }
                setPalabraReemplazo("");
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
                                    {!mergeMode && (
                                        <div className="mt-4">
                                            <label className="block text-[11px] text-muted-foreground mb-1.5">
                                                Escribí <b className="font-semibold text-foreground">{PALABRA_REEMPLAZO}</b> para habilitar el botón.
                                            </label>
                                            <Input
                                                value={palabraReemplazo}
                                                onChange={(e) => setPalabraReemplazo(e.target.value)}
                                                placeholder={PALABRA_REEMPLAZO}
                                                autoComplete="off"
                                                className="h-9 text-center text-[13px] font-semibold tracking-[0.1em]"
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Esta acción borrará los datos actuales y poblará la base de datos con información inicial/de prueba. ¿Estás seguro?
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Button onClick={() => { setPendingAction(null); setPalabraReemplazo(""); }} variant="ghost" className="h-10 text-muted-foreground hover:bg-accent hover:text-foreground font-bold rounded-lg border border-border">
                                Cancelar
                            </Button>
                            <Button
                                onClick={confirmAction}
                                disabled={pendingAction.type === 'IMPORT' && !mergeMode && palabraReemplazo.trim().toUpperCase() !== PALABRA_REEMPLAZO}
                                className={cn("h-10 text-foreground font-bold rounded-lg disabled:opacity-40", mergeMode ? "bg-blue-600 hover:bg-blue-500" : "bg-red-600 hover:bg-red-500")}>
                                {pendingAction.type === 'IMPORT' ? (mergeMode ? 'Confirmar Fusión' : 'Confirmar Reemplazo') : 'Sí, Inicializar'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmarAccion
                open={cambiandoBase}
                onOpenChange={setCambiandoBase}
                id="__base__"
                title="Cambiar la base de datos"
                description="La aplicación pasa a leer y escribir en otra base: residentes, credenciales, historial, todo. Se reinicia sola al aplicar. Si la base nueva está vacía, el sistema arranca como si el barrio no existiera."
                escribir="CAMBIAR"
                etiquetaAccion="Cambiar la base"
                onDelete={aplicarCambioDeBase}
                onSuccess={() => { }}
            />        </div>
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

    /**
     * Borrar todo el aprendizaje. No es el borrado de un registro: es el de la lista
     * entera, que el lector fue juntando con el uso. Rehacerla no es volver a cargar unos
     * datos, es esperar a que vuelvan a pasar los mismos autos.
     */
    const [limpiandoAprendidas, setLimpiandoAprendidas] = useState(false);

    const handleClearLearned = async () => {
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
            {/* Sin `backdrop-blur-xl`, sin `rounded-2xl` y sin la animación de entrada.
              *
              * El vidrio esmerilado es para lo que se apoya sobre una FOTO o un mapa, donde
              * el fondo no es nuestro y un hairline desaparece. Esto se apoya sobre la
              * página, así que alcanza con la superficie y una línea. Y 16px de radio no
              * está en la gramática (0 / 6 / 10 / 14): un panel es 10. */}
            <div className="rounded-[var(--radius)] border border-border bg-card p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
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
                                    /* Elegida = azul de acción. Antes cada opción traía su
                                       propio color (rojo para lista negra, verde para blanca,
                                       ámbar y violeta para aprendizaje), y esos colores decían
                                       DOS cosas contradictorias: rojo por "denegar" y rojo por
                                       "ésta es la que está puesta". Cuál de las dos, dependía de
                                       si estaba seleccionada. El significado del color no puede
                                       depender del estado del control que lo lleva.
                                       Ahora el color del ícono dice qué HACE la opción, y el
                                       marco azul dice cuál está elegida. */
                                    className={cn(
                                        "group relative flex w-full items-center gap-3.5 rounded-[var(--radius-sm)] border p-3.5 text-left transition-colors",
                                        isSelected
                                            ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]"
                                            : isDisabled
                                                ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
                                                : "border-border bg-card hover:bg-accent"
                                    )}
                                >
                                    <div className={cn(
                                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
                                        isSelected ? `bg-${option.color}-500/15 text-${option.color}-400` : "bg-muted text-muted-foreground"
                                    )}>
                                        <Icon size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-foreground">
                                            {option.label}
                                        </h3>
                                        {/* 11px y peso 400: el peso 500 está proscripto y a 10px
                                            esto no se leía de pie frente al puesto. */}
                                        <p className="mt-0.5 text-[11px] leading-[1.45] text-muted-foreground">
                                            {option.desc}
                                        </p>
                                    </div>
                                    {/* Una tilde, no un punto que late. El latido dice "está
                                        pasando algo ahora mismo"; acá el dato es quieto — esta
                                        es la opción puesta. Y sin el resplandor, que era una
                                        tercera sombra fuera del sistema. */}
                                    {isSelected && <Check size={16} className="ml-auto shrink-0 text-[var(--accion)]" />}
                                </button>
                            );
                        })}
                    </div>

                    {/* Right: Explanation */}
                    <div className="lg:col-span-7">
                        <div className="bg-background/30 border border-border rounded-xl p-6 h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <Info size={16} className="text-muted-foreground" />
                                <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">Cómo funciona este modo</h3>
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
                                    onClick={() => setLimpiandoAprendidas(true)}
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
                                                        <span className="text-xs">{fechaHoraSeg(item.timestamp)}</span>
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

            <ConfirmarAccion
                open={limpiandoAprendidas}
                onOpenChange={setLimpiandoAprendidas}
                id="__aprendidas__"
                title="Borrar todo el aprendizaje"
                description="Se borra la lista entera de matrículas aprendidas. No es un dato que se pueda volver a cargar: el lector la fue juntando con el uso, así que rehacerla es esperar a que vuelvan a pasar los mismos autos."
                escribir="BORRAR"
                etiquetaAccion="Borrar todo"
                onDelete={handleClearLearned}
                onSuccess={() => { }}
            />        </>
    );
}

type DrawerKey = null | "conn" | "cmds" | "allow" | "hist" | "avisos";

function WhatsAppSection() {
    const [config, setConfig] = useState({ url: "", apiKey: "" });
    // Los ids son los que lee waha-handler.js (cmdActivo): un interruptor acá apaga el
    // comando de verdad. Antes esta lista era decorativa — mostraba "aforo" (que el bot no
    // tiene), "estado" como "Próximamente" (que sí funciona) y no mencionaba el flujo de
    // invitación del residente, que es el que más usa el barrio.
    const [commands, setCommands] = useState([
        { id: 'invitar', cmd: 'invitar · visita · pase', desc: 'Residentes: crea un pase de visita paso a paso (nombre, patente, cuándo) y devuelve el QR al residente', icon: Users, active: true, quien: 'Residentes' },
        { id: 'matricula', cmd: 'ABC1234  ·  ABC1234.', desc: 'Busca el vehículo; con punto al final, fotos e historial', icon: Car, active: true, quien: 'Personal' },
        { id: 'agregar_matricula', cmd: 'agregar matrícula', desc: 'Alta de un vehículo guiada (matrícula, nombre)', icon: Plus, active: true, quien: 'Personal' },
        { id: 'eventos', cmd: 'ultimo · entradas · salidas · eventos', desc: 'Último movimiento con foto, o los últimos 20 con filtro', icon: Eye, active: true, quien: 'Personal' },
        { id: 'estado', cmd: 'estado', desc: 'Cámaras y grabadores: online/offline y último visto', icon: Activity, active: true, quien: 'Personal' },
        { id: 'notificaciones', cmd: 'configurar alerta', desc: 'Recibir en este chat las alertas de acceso en tiempo real', icon: Bot, active: true, quien: 'Personal' },
    ]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [allowEnabled, setAllowEnabled] = useState(false);
    const [allowList, setAllowList] = useState<string[]>([]);
    const [newAllow, setNewAllow] = useState("");
    const [savingAllow, setSavingAllow] = useState(false);
    const [chatbotEnabled, setChatbotEnabled] = useState(true);
    const [webhook, setWebhook] = useState("");
    const [drawer, setDrawer] = useState<DrawerKey>(null);

    // Avisos salientes (intrusión / LPR por WhatsApp): cada interruptor es una regla del
    // motor de notificaciones, ver actions/whatsapp-avisos.ts.
    const [avisos, setAvisos] = useState<{ intrusion: { enabled: boolean; eventos: string }; lpr: { enabled: boolean; eventos: string }; destinatarios: { id: string; name: string; address: string }[] }>({ intrusion: { enabled: false, eventos: "" }, lpr: { enabled: false, eventos: "DENY,UNKNOWN" }, destinatarios: [] });
    const [nuevoDestino, setNuevoDestino] = useState({ numero: "", nombre: "" });
    const cargarAvisos = async () => { try { setAvisos(await getAvisosWhatsApp() as any); } catch (e) { console.error(e); } };
    // Quién le escribe al bot de verdad: residentes y personal por el teléfono de su ficha
    // (sólo lectura acá; se editan en Usuarios) + los números cargados a mano.
    const [remitentes, setRemitentes] = useState<{ residentes: { id: string; name: string; phone: string; unidad: string | null }[]; personal: { id: string; name: string; phone: string; rol: string }[] }>({ residentes: [], personal: [] });
    const cargarRemitentes = async () => { try { setRemitentes(await getRemitentesDelBot()); } catch (e) { console.error(e); } };
    const alternarAviso = async (tipo: TipoAviso, on: boolean) => {
        const r = await setAvisoWhatsApp(tipo, on);
        if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
        toast.success({ title: on ? "Avisos activados" : "Avisos desactivados" });
        cargarAvisos();
    };
    const alternarEventoLpr = async (ev: string) => {
        const puestos = new Set(String(avisos.lpr.eventos || "").split(",").filter(Boolean));
        puestos.has(ev) ? puestos.delete(ev) : puestos.add(ev);
        const r = await setAvisoWhatsApp("LPR", avisos.lpr.enabled, Array.from(puestos).join(","));
        if (!r.ok) toast.error({ title: "No se pudo guardar", description: r.error });
        cargarAvisos();
    };
    const agregarDestino = async () => {
        const r: any = await agregarDestinatarioWhatsApp(nuevoDestino.numero, nuevoDestino.nombre);
        if (!r.ok) { toast.error({ title: r.error || "No se pudo agregar" }); return; }
        setNuevoDestino({ numero: "", nombre: "" }); cargarAvisos();
    };

    useEffect(() => { loadConfig(); cargarAvisos(); }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            // Fuente única: en San Nicolás la config vive en OPENWA_* (lo que prioriza
            // getWhatsAppConfig()); se mantiene el respaldo a WAHA_* para no romper Olivos.
            const [url, apiKey, cmdConfig, allowEn, allowLs, cbEn, wUrl, wKey, hook, wHook] = await Promise.all([
                getSetting("OPENWA_URL"), getSetting("OPENWA_API_KEY"), getSetting("WAHA_COMMANDS"),
                getSetting("WHATSAPP_ALLOWLIST_ENABLED"), getSetting("WHATSAPP_ALLOWLIST"), getSetting("CHATBOT_ENABLED"),
                getSetting("WAHA_URL"), getSetting("WAHA_API_KEY"),
                getSetting("OPENWA_WEBHOOK_URL"), getSetting("WAHA_WEBHOOK_URL"),
            ]);
            setAllowEnabled(allowEn?.value === "true");
            setChatbotEnabled(cbEn?.value !== "false");
            try { const a = JSON.parse(allowLs?.value || "[]"); if (Array.isArray(a)) setAllowList(a); } catch { }
            setConfig({ url: url?.value || wUrl?.value || "", apiKey: apiKey?.value || wKey?.value || "" });
            setWebhook(hook?.value || wHook?.value || "");
            if (cmdConfig?.value) {
                try {
                    const savedCommands = JSON.parse(cmdConfig.value);
                    setCommands(prev => prev.map(c => { const saved = savedCommands.find((s: any) => s.id === c.id); return saved ? { ...c, active: saved.active } : c; }));
                } catch (e) { console.error("Error parsing commands config", e); }
            }
            await loadHistory();
        } catch (err) { console.error("Error loading WAHA config:", err); }
        finally { setLoading(false); }
    };

    const loadHistory = async () => { try { setHistory(await getWahaHistory()); } catch (e) { console.error(e); } };
    const addAllow = (val: string) => { const v = (val || "").trim(); if (!v) return; if (allowList.includes(v)) return; setAllowList([...allowList, v]); setNewAllow(""); };
    const removeAllow = (v: string) => setAllowList(allowList.filter(x => x !== v));
    const toggleChatbot = async (v: boolean) => {
        setChatbotEnabled(v);
        try { await updateSetting("CHATBOT_ENABLED", v ? "true" : "false"); toast.success({ title: v ? "Chatbot activado" : "Chatbot desactivado globalmente" }); }
        catch { setChatbotEnabled(!v); toast.error?.({ title: "No se pudo guardar el estado del chatbot" }); }
    };
    const saveAllowlist = async () => {
        setSavingAllow(true);
        try { await Promise.all([updateSetting("WHATSAPP_ALLOWLIST_ENABLED", allowEnabled ? "true" : "false"), updateSetting("WHATSAPP_ALLOWLIST", JSON.stringify(allowList))]); toast.success({ title: "Seguridad del chatbot guardada" }); }
        catch { toast.error({ title: "Error al guardar la lista blanca" }); } finally { setSavingAllow(false); }
    };
    const handleSave = async () => {
        setSaving(true);
        try {
            const commandsConfig = JSON.stringify(commands.map(c => ({ id: c.id, active: c.active })));
            // Guardar en las claves canónicas OPENWA_* (lo que usa getWhatsAppConfig y el despacho).
            await Promise.all([updateSetting("OPENWA_URL", config.url), updateSetting("OPENWA_API_KEY", config.apiKey), updateSetting("WAHA_COMMANDS", commandsConfig)]);
            toast.success({ title: "Configuración de WhatsApp guardada" });
        } catch (err) { toast.error({ title: "Error al guardar la configuración" }); } finally { setSaving(false); }
    };
    const handleTest = async () => {
        if (!config.url) { toast.error({ title: "Por favor ingresa la URL de WAHA" }); return; }
        setTesting(true);
        try { const result = await testWahaConnection(config.url, config.apiKey); if (result.success) toast.success({ title: result.message }); else toast.error({ title: result.message }); }
        catch (err) { toast.error({ title: "Error crítico al conectar con WAHA" }); } finally { setTesting(false); }
    };
    const toggleCommand = (id: string) => setCommands(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c));

    if (loading) {
        return (
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                <div className="flex items-center justify-center py-12"><RefreshCcw className="animate-spin text-emerald-500" size={32} /></div>
            </div>
        );
    }

    const host = (() => { try { return new URL(config.url).host; } catch { return config.url || "sin configurar"; } })();
    const cmdsActive = commands.filter(c => c.active).length;

    return (
        <div className="space-y-5 animate-in fade-in duration-200">
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-600/10 to-teal-600/10 border border-emerald-500/10 rounded-xl p-5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-emerald-500/20 rounded-xl text-emerald-400 shrink-0"><Bot size={22} /></div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-foreground tracking-tight truncate">WhatsApp del barrio</h2>
                        <p className="text-xs text-muted-foreground">Invitaciones por WhatsApp · avisos a residentes · chatbot</p>
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className={cn("flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-bold transition-colors", chatbotEnabled ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400")} title="Activa o desactiva el chatbot globalmente">
                        <Bot size={14} /><span className="hidden sm:inline">{chatbotEnabled ? "Chatbot activo" : "Apagado"}</span>
                        <Switch checked={chatbotEnabled} onCheckedChange={toggleChatbot} className="scale-90" />
                    </div>
                </div>
            </div>

            {/* Hero: vinculación (principal) + accesos a config en drawers */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3"><WhatsAppLink /></div>
                <div className="lg:col-span-2 space-y-3">
                    <ConfigTile icon={<Settings size={18} />} color="emerald" title="Conexión" value={host} onClick={() => setDrawer("conn")} />
                    <ConfigTile icon={<MessageSquare size={18} />} color="violet" title="Comandos del bot" value={`${cmdsActive} activos`} onClick={() => setDrawer("cmds")} />
                    <ConfigTile icon={<ShieldCheck size={18} />} color="emerald" title="Remitentes autorizados" value={`${remitentes.residentes.length} residentes · ${remitentes.personal.length + allowList.length} personal`} onClick={() => { cargarRemitentes(); setDrawer("allow"); }} />
                    <ConfigTile icon={<Bell size={18} />} color={(avisos.intrusion.enabled || avisos.lpr.enabled) ? "emerald" : "amber"} title="Avisos por WhatsApp"
                        value={[avisos.intrusion.enabled ? "Intrusión" : null, avisos.lpr.enabled ? "LPR" : null].filter(Boolean).join(" · ") || "Apagados"}
                        onClick={() => { cargarAvisos(); setDrawer("avisos"); }} />
                    <ConfigTile icon={<FileText size={18} />} color="sky" title="Historial de consultas" value={`${history.length} registros`} onClick={() => { loadHistory(); setDrawer("hist"); }} />
                </div>
            </div>

            {/* Webhook (nota, auto-config) */}
            <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4 flex items-start gap-3">
                <Info className="text-blue-400 shrink-0 mt-0.5" size={16} />
                <div className="min-w-0">
                    <h4 className="text-xs font-bold text-blue-100 uppercase mb-1">Webhook (automático)</h4>
                    <p className="text-[11px] text-blue-200/60 mb-1.5">Se configura al crear la sesión. Apunta a:</p>
                    {/* Sale de Settings (OPENWA_WEBHOOK_URL). Antes era un IP fijo de otro barrio. */}
                    <code className="block bg-muted/50 rounded p-2 text-[10px] font-mono text-blue-300 break-all">{webhook || "sin configurar — cargá OPENWA_WEBHOOK_URL en Ajustes"}</code>
                </div>
            </div>

            {/* ── Drawers ── */}
            <SideDrawer open={drawer === "conn"} onClose={() => setDrawer(null)} icon={<Settings size={18} />} title="Conexión a WAHA">
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">URL del Servidor</Label>
                        <Input value={config.url} onChange={(e) => setConfig({ ...config, url: e.target.value })} placeholder="http://127.0.0.1:3000" className="bg-background border-border h-10 font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">API Key</Label>
                        <Input value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} type="password" placeholder="••••••••" className="bg-background border-border h-10 font-mono text-xs" />
                    </div>
                    <div className="flex gap-3 pt-1">
                        <Button onClick={handleTest} disabled={testing} variant="outline" className="flex-1 h-10 text-xs font-bold border-border hover:bg-accent">{testing ? "Probando..." : "Probar conexión"}</Button>
                        <Button onClick={handleSave} disabled={saving} className="flex-1 h-10 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">{saving ? "Guardando..." : "Guardar"}</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">El QR, el estado y el webhook se manejan solos desde la tarjeta <b>Vinculación</b>. Esto es solo por si cambia la URL o la API key del contenedor.</p>
                </div>
            </SideDrawer>

            <SideDrawer open={drawer === "cmds"} onClose={() => setDrawer(null)} icon={<MessageSquare size={18} />} title="Comandos del bot">
                <div className="space-y-2">
                    {commands.map((cmd) => (
                        <div key={cmd.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/40">
                            <div className="p-2 rounded-lg bg-muted text-muted-foreground shrink-0"><cmd.icon size={14} /></div>
                            <div className="min-w-0 flex-1">
                                <span className="block text-xs font-bold text-foreground truncate tabular-nums">{cmd.cmd} <span className="ml-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">{cmd.quien}</span></span>
                                <span className="block text-[10px] text-muted-foreground leading-snug">{cmd.desc}</span>
                            </div>
                            <Switch checked={cmd.active} onCheckedChange={() => toggleCommand(cmd.id)} />
                        </div>
                    ))}
                    <Button onClick={handleSave} disabled={saving} className="w-full h-10 mt-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">{saving ? "Guardando…" : "Guardar comandos"}</Button>
                </div>
            </SideDrawer>

            <SideDrawer open={drawer === "allow"} onClose={() => setDrawer(null)} icon={<ShieldCheck size={18} />} title="Remitentes autorizados">
                <div className="space-y-5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Al bot le escriben <b>los residentes</b> por el celular de su ficha (sólo pases de visita) y <b>el personal</b> por el suyo (consultas y gestión). A cualquier otro número lo ignora en silencio. Las fichas se editan en <b>Usuarios</b>; acá sólo se agregan números de personal sin usuario, como el teléfono de la garita.</p>

                    <div className="space-y-1.5">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Residentes con celular ({remitentes.residentes.length})</p>
                        {remitentes.residentes.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic">Ningún residente tiene celular cargado: nadie puede pedir pases por WhatsApp todavía.</p>
                        ) : (
                            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                                {remitentes.residentes.map((r) => (
                                    <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                                        <span className="text-xs text-foreground truncate flex-1">{r.name}{r.unidad ? <span className="text-muted-foreground"> · {r.unidad}</span> : null}</span>
                                        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{r.phone}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Personal con celular ({remitentes.personal.length})</p>
                        {remitentes.personal.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic">Ningún usuario de personal tiene celular cargado.</p>
                        ) : (
                            <div className="rounded-lg border border-border divide-y divide-border">
                                {remitentes.personal.map((r) => (
                                    <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                                        <span className="text-xs text-foreground truncate flex-1">{r.name} <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{r.rol}</span></span>
                                        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{r.phone}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Agregados a mano ({allowList.length})</p>
                        <div className="flex gap-2">
                            <Input value={newAllow} onChange={(e) => setNewAllow(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAllow(newAllow); } }} placeholder="Número (098…) o grupo (…@g.us)" className="bg-background border-border h-10 font-mono text-xs" />
                            <Button onClick={() => addAllow(newAllow)} className="h-10 px-3 bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={15} /></Button>
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
                        {allowList.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic">Sin números agregados a mano.</p>
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
                        <Button onClick={saveAllowlist} disabled={savingAllow} className="w-full h-10 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">{savingAllow ? "Guardando…" : "Guardar"}</Button>
                    </div>
                </div>
            </SideDrawer>

            <SideDrawer open={drawer === "avisos"} onClose={() => setDrawer(null)} icon={<Bell size={18} />} title="Avisos por WhatsApp">
                <div className="space-y-5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Lo que el sistema manda por su cuenta a los números de abajo. Cada interruptor es una regla de <b>Notificaciones</b>, donde se afina horario, cámara y antirrebote.</p>

                    <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/40">
                        <div className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-foreground">Alertas de intrusión</span>
                            <span className="block text-[10px] text-muted-foreground">Cruce de línea, intrusión en zona, entrada y salida de zona, con la captura y la clase (persona/vehículo).</span>
                        </div>
                        <Switch checked={avisos.intrusion.enabled} onCheckedChange={(v) => alternarAviso("INTRUSION", v)} />
                    </div>

                    <div className="p-3 rounded-xl border border-border bg-card/40 space-y-2.5">
                        <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                                <span className="block text-xs font-bold text-foreground">Eventos LPR</span>
                                <span className="block text-[10px] text-muted-foreground">Lecturas de las cámaras de barrera, con la foto.</span>
                            </div>
                            <Switch checked={avisos.lpr.enabled} onCheckedChange={(v) => alternarAviso("LPR", v)} />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {[{ v: "DENY", l: "Denegados" }, { v: "UNKNOWN", l: "No reconocidos" }, { v: "WATCHLIST", l: "En seguimiento" }, { v: "ALLOW", l: "Permitidos" }].map((ev) => {
                                const on = String(avisos.lpr.eventos || "").split(",").includes(ev.v);
                                return (
                                    <button key={ev.v} type="button" onClick={() => alternarEventoLpr(ev.v)}
                                        className={cn("px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                                            on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-muted/40 border-border text-muted-foreground hover:text-foreground")}>
                                        {ev.l}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[10px] text-muted-foreground">"Permitidos" es un mensaje por cada auto del barrio: conviene dejarlo apagado.</p>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Quién recibe los avisos</Label>
                        {avisos.destinatarios.length === 0 && (
                            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                                <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-amber-300">Sin destinatarios: los avisos se encolan y no llegan a nadie.</span>
                            </div>
                        )}
                        {avisos.destinatarios.map((d) => (
                            <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card/40">
                                <span className="text-xs font-semibold text-foreground truncate flex-1">{d.name}</span>
                                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">+{d.address}</span>
                                <button onClick={async () => { await quitarDestinatarioWhatsApp(d.id); cargarAvisos(); }} className="p-1 rounded text-muted-foreground hover:text-red-400" title="Quitar"><Trash2 size={13} /></button>
                            </div>
                        ))}
                        <div className="flex gap-2">
                            <Input value={nuevoDestino.nombre} onChange={(e) => setNuevoDestino({ ...nuevoDestino, nombre: e.target.value })} placeholder="Nombre (garita, jefe de seguridad…)" className="bg-background border-border h-10 text-xs" />
                            <Input value={nuevoDestino.numero} onChange={(e) => setNuevoDestino({ ...nuevoDestino, numero: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarDestino(); } }} placeholder="099 123 456" className="bg-background border-border h-10 font-mono text-xs w-40" />
                            <Button onClick={agregarDestino} className="h-10 px-3 bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={15} /></Button>
                        </div>
                    </div>
                </div>
            </SideDrawer>

            <SideDrawer open={drawer === "hist"} onClose={() => setDrawer(null)} icon={<FileText size={18} />} title="Historial de consultas"
                headerRight={<button onClick={loadHistory} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground" title="Actualizar"><RefreshCcw size={15} /></button>}>
                <div className="border border-border rounded-xl overflow-hidden">
                    <Table>
                        <TableHeader className="bg-foreground/10">
                            <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest w-24">Usuario</TableHead>
                                <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Interacción</TableHead>
                                <TableHead className="h-8 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-right w-20">Hora</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.length === 0 ? (
                                <TableRow className="border-border hover:bg-transparent"><TableCell colSpan={3} className="py-10 text-center text-[11px] text-muted-foreground italic">Sin registros recientes.</TableCell></TableRow>
                            ) : history.map((h) => (
                                <TableRow key={h.id} className="border-border hover:bg-accent">
                                    <TableCell className="py-2 align-top"><span className="text-[9px] font-bold text-foreground bg-foreground/10 px-1.5 py-0.5 rounded-full block truncate" title={h.user}>{h.user.split('@')[0]}</span></TableCell>
                                    <TableCell className="py-2 align-top">
                                        <p className="text-[10px] font-mono text-emerald-400 break-words line-clamp-2" title={h.command}>&gt; {h.command}</p>
                                        <p className="text-[9px] text-muted-foreground break-words line-clamp-2" title={h.response}>{h.response}</p>
                                    </TableCell>
                                    <TableCell className="py-2 text-right text-[9px] text-muted-foreground font-mono align-top whitespace-nowrap">{h.time}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </SideDrawer>
        </div>
    );
}

// ── Tile que abre un drawer ──
function ConfigTile({ icon, title, value, color, onClick }: { icon: React.ReactNode; title: string; value: string; color: "emerald" | "violet" | "amber" | "sky"; onClick: () => void }) {
    const c: Record<string, string> = { emerald: "text-emerald-400 bg-emerald-500/10", violet: "text-violet-400 bg-violet-500/10", amber: "text-amber-400 bg-amber-500/10", sky: "text-sky-400 bg-sky-500/10" };
    return (
        <button onClick={onClick} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card/50 hover:bg-accent hover:border-foreground/20 transition-colors text-left group">
            <div className={cn("w-10 h-10 rounded-xl grid place-items-center shrink-0", c[color])}>{icon}</div>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">{title}</div>
                <div className="text-xs text-muted-foreground truncate font-mono">{value}</div>
            </div>
            <ChevronRight size={18} className="text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
        </button>
    );
}

// ── Drawer lateral (cierra tocando afuera o con Escape) ──
function SideDrawer({ open, onClose, title, icon, headerRight, children }: { open: boolean; onClose: () => void; title: string; icon: React.ReactNode; headerRight?: React.ReactNode; children: React.ReactNode }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120]">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
            <div className="absolute inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border shrink-0">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 grid place-items-center">{icon}</div>
                    <h3 className="font-bold text-foreground">{title}</h3>
                    <div className="ml-auto flex items-center gap-1.5">
                        {headerRight}
                        <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
                    </div>
                </div>
                <div className="p-5 overflow-y-auto grow custom-scrollbar">{children}</div>
            </div>
        </div>
    );
}

// ── Vinculación de WhatsApp: estado en vivo + QR auto-refrescable (sin entrar a WAHA) ──
function WhatsAppLink() {
    const [st, setSt] = useState<{ ok: boolean; status: string; me?: { id: string; pushName: string | null } | null; engine?: string | null } | null>(null);
    const [qrNonce, setQrNonce] = useState(Date.now());
    const [busy, setBusy] = useState<string | null>(null);
    const pollRef = useRef<any>(null);

    const poll = async () => { try { const r = await fetch("/api/wa/status", { cache: "no-store" }); setSt(await r.json()); } catch { setSt({ ok: false, status: "UNREACHABLE" }); } };
    useEffect(() => { poll(); pollRef.current = setInterval(poll, 4000); return () => clearInterval(pollRef.current); }, []);
    useEffect(() => { if (st?.status !== "SCAN_QR_CODE") return; const iv = setInterval(() => setQrNonce(Date.now()), 15000); return () => clearInterval(iv); }, [st?.status]);

    const act = async (action: "restart" | "logout") => { setBusy(action); try { await fetch(`/api/wa/session?action=${action}`, { method: "POST" }); } finally { setTimeout(() => { setQrNonce(Date.now()); poll(); setBusy(null); }, 1500); } };

    const status = st?.status || "…";
    const working = status === "WORKING";
    const scanning = status === "SCAN_QR_CODE";
    const problem = ["UNREACHABLE", "BADKEY", "ERROR", "FAILED"].includes(status);
    const LABEL: Record<string, string> = { WORKING: "Conectado", SCAN_QR_CODE: "Escaneá el QR", STARTING: "Iniciando…", STOPPED: "Detenido", FAILED: "Falló", UNREACHABLE: "WAHA no responde", BADKEY: "API key incorrecta", ERROR: "Error" };

    return (
        <div className={cn("rounded-2xl border p-6 h-full flex flex-col transition-colors",
            working ? "bg-emerald-500/5 border-emerald-500/30" : problem ? "bg-red-500/5 border-red-500/30" : "bg-card/50 border-border")}>
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <Smartphone className={cn(working ? "text-emerald-400" : "text-muted-foreground")} size={18} />
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Vinculación</h3>
                </div>
                <div className={cn("flex items-center gap-1.5 text-[10px] uppercase font-bold px-2.5 py-1 rounded-full",
                    working ? "text-emerald-400 bg-emerald-500/15" : problem ? "text-red-400 bg-red-500/15" : "text-amber-400 bg-amber-500/15")}>
                    {working ? <CheckCircle2 size={12} /> : problem ? <ShieldAlert size={12} /> : <Loader2 size={12} className="animate-spin" />}
                    <span>{LABEL[status] || status}</span>
                </div>
            </div>

            {working ? (
                <div className="flex-1 grid place-items-center text-center py-6">
                    <div>
                        <div className="w-20 h-20 rounded-full bg-emerald-500/15 text-emerald-400 grid place-items-center mx-auto mb-3"><CheckCircle2 size={40} /></div>
                        <p className="text-base font-extrabold text-foreground">WhatsApp activo{st?.me ? `: +${st.me.id}` : ""}</p>
                        {st?.me?.pushName && <p className="text-sm text-muted-foreground">{st.me.pushName}</p>}
                        <p className="text-[11px] text-muted-foreground mt-1.5">Los residentes ya pueden escribir <b>“invitar”</b> y los avisos salen solos.</p>
                        <Button onClick={() => { if (confirm("¿Desvincular el WhatsApp? Vas a tener que escanear el QR de nuevo.")) act("logout"); }} disabled={busy === "logout"} variant="outline" className="mt-4 h-9 text-xs font-bold border-red-500/30 text-red-400 hover:bg-red-500/10">
                            {busy === "logout" ? <Loader2 size={14} className="animate-spin mr-1" /> : <LogOut size={14} className="mr-1" />} Desvincular
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                    {scanning ? (
                        <>
                            <p className="text-xs text-muted-foreground mb-3 max-w-[260px]">WhatsApp → Dispositivos vinculados → <b>Vincular un dispositivo</b> → apuntá acá</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/wa/qr?t=${qrNonce}`} alt="QR de WhatsApp" width={260} height={260} className="rounded-2xl bg-white p-3 shadow-lg ring-1 ring-border" onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.15"; }} />
                            <p className="text-[10px] text-muted-foreground mt-2.5">Se renueva solo cada 15 s · no hace falta entrar a WAHA</p>
                        </>
                    ) : (
                        <div className="py-8 grid place-items-center text-muted-foreground"><QrCode size={40} className="opacity-30 mb-3" /><p className="text-xs font-semibold">{problem ? "No se puede mostrar el QR ahora." : "Preparando la sesión…"}</p></div>
                    )}
                    <Button onClick={() => act("restart")} disabled={!!busy} className="mt-4 h-10 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">
                        {busy === "restart" ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <RefreshCcw size={14} className="mr-1.5" />} Generar nuevo QR
                    </Button>
                </div>
            )}
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

    /** El administrador a borrar, o nada. El diálogo es el mismo de toda la aplicación. */
    const [adminABorrar, setAdminABorrar] = useState<any | null>(null);

    const handleDelete = async (id: string) => {
        await deleteAdminAction(id);
        toast.success({ title: "Administrador eliminado" });
        loadAdmins();
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
                                                onClick={() => setAdminABorrar(admin)}
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

            {adminABorrar && (
                <ConfirmarAccion
                    open
                    onOpenChange={(o) => { if (!o) setAdminABorrar(null); }}
                    id={adminABorrar.id}
                    title={adminABorrar.name || "Administrador"}
                    description="Deja de poder entrar al panel. No se borran los eventos ni la bitácora que haya registrado: esos quedan con su nombre."
                    onDelete={handleDelete}
                    onSuccess={() => setAdminABorrar(null)}
                />
            )}        </div>
    );
}
