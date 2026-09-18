"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Send, Save, TestTube2, RefreshCw, Mail, Webhook, MessageCircle,
    AlertTriangle, Check, ChevronDown, Radio, Activity, ShieldCheck, Users, Calendar, FileText, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { toast } from "sonner";

interface DispatchChannel {
    key: string;
    label: string;
    icon: React.ReactNode;
    accent: string;     // hex for accent stripe / glow
    description: string;
    fields: { key: string; label: string; placeholder: string; secret?: boolean; span?: number }[];
}

const CHANNELS: DispatchChannel[] = [
    {
        key: "telegram",
        label: "Telegram",
        icon: <Send size={18} />,
        accent: "#0ea5e9",
        description: "Envía alertas con foto al instante vía bot de Telegram",
        fields: [
            { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", secret: true, span: 2 },
            { key: "TELEGRAM_CHAT_ID", label: "Chat ID", placeholder: "-100123456789" },
        ],
    },
    {
        key: "whatsapp",
        label: "WhatsApp (OpenWA)",
        icon: <MessageCircle size={18} />,
        accent: "#22c55e",
        description: "Envía alertas y reportes por WhatsApp vía OpenWA (autohospedado)",
        fields: [
            { key: "OPENWA_URL", label: "URL de OpenWA", placeholder: "http://192.168.99.22:2785", span: 2 },
            { key: "OPENWA_API_KEY", label: "API Key", placeholder: "owa_k1_...", secret: true, span: 2 },
            { key: "OPENWA_SESSION", label: "Sesión", placeholder: "omniaccess o el UUID" },
            { key: "OPENWA_DEFAULT_CHAT", label: "Destinatario por defecto", placeholder: "59899123456 o 59899123456@c.us" },
        ],
    },
    {
        key: "email",
        label: "Email SMTP",
        icon: <Mail size={18} />,
        accent: "#f59e0b",
        description: "Envía correos electrónicos cuando se supera el umbral",
        fields: [
            { key: "SMTP_HOST", label: "Servidor SMTP", placeholder: "smtp.gmail.com" },
            { key: "SMTP_PORT", label: "Puerto", placeholder: "587" },
            { key: "SMTP_USER", label: "Usuario", placeholder: "alertas@empresa.com" },
            { key: "SMTP_PASS", label: "Contraseña", placeholder: "••••••••", secret: true },
            { key: "SMTP_TO", label: "Destinatarios", placeholder: "admin@empresa.com, jefe@empresa.com", span: 2 },
        ],
    },
    {
        key: "webhook",
        label: "Webhook HTTP",
        icon: <Webhook size={18} />,
        accent: "#10b981",
        description: "POST JSON a cualquier endpoint externo (Slack, Teams, etc.)",
        fields: [
            { key: "DISPATCH_WEBHOOK_URL", label: "URL del Endpoint", placeholder: "https://hooks.slack.com/services/...", span: 2 },
            { key: "DISPATCH_WEBHOOK_SECRET", label: "Secret Header (opcional)", placeholder: "Bearer xxx", secret: true },
        ],
    },
    {
        key: "pwa",
        label: "PWA noti (Web Push)",
        icon: <Smartphone size={18} />,
        accent: "#6366f1",
        description: "Notificaciones push a la app instalada (navegador y móvil)",
        fields: [],
    },
];

import RulesManager from "./RulesManager";
import TemplatesManager from "./TemplatesManager";
import RecipientsManager from "./RecipientsManager";
import AnimatedAlertToggle from "./AnimatedAlertToggle";
import SchedulesManager from "./SchedulesManager";
import SubscribersManager from "./SubscribersManager";

const TABS = [
    { k: "canales", l: "Canales", icon: Radio },
    { k: "destinatarios", l: "Destinatarios", icon: Users },
    { k: "reglas", l: "Reglas", icon: Activity },
    { k: "horarios", l: "Horarios", icon: Calendar },
    { k: "plantillas", l: "Plantillas", icon: FileText },
    { k: "suscriptores", l: "Suscriptores", icon: Smartphone },
];

export default function NotificacionesPage() {
    const [values, setValues] = useState<Record<string, string>>({});
    const [enabled, setEnabled] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [testing, setTesting] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>("telegram");
    const [tab, setTab] = useState("canales");

    const loadData = useCallback(async () => {
        try {
            const allKeys = CHANNELS.flatMap(ch => [
                ...ch.fields.map(f => f.key),
                `DISPATCH_${ch.key.toUpperCase()}_ENABLED`,
            ]);
            const results: Record<string, string> = {};
            const enabledMap: Record<string, boolean> = {};
            for (const key of allKeys) {
                const s = await getSetting(key);
                if (s?.value) results[key] = s.value;
            }
            for (const ch of CHANNELS) {
                enabledMap[ch.key] = results[`DISPATCH_${ch.key.toUpperCase()}_ENABLED`] === "true";
            }
            setValues(results);
            setEnabled(enabledMap);
            setLoading(false);
        } catch (err) {
            console.error(err);
            toast.error("Error cargando configuración");
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const isConfigured = (ch: DispatchChannel) => ch.key === "pwa" ? true : ch.fields.some(f => (values[f.key] || "").trim().length > 0);

    const saveChannel = async (channelKey: string) => {
        setSaving(channelKey);
        try {
            const channel = CHANNELS.find(c => c.key === channelKey)!;
            for (const field of channel.fields) {
                await updateSetting(field.key, values[field.key] || "");
            }
            await updateSetting(`DISPATCH_${channelKey.toUpperCase()}_ENABLED`, enabled[channelKey] ? "true" : "false");
            toast.success(`${channel.label} guardado correctamente`);
        } catch {
            toast.error("Error al guardar");
        }
        setSaving(null);
    };

    const toggleChannel = async (channelKey: string) => {
        const next = !enabled[channelKey];
        setEnabled(prev => ({ ...prev, [channelKey]: next }));
        try {
            await updateSetting(`DISPATCH_${channelKey.toUpperCase()}_ENABLED`, next ? "true" : "false");
            toast.success(next ? "Canal habilitado" : "Canal deshabilitado");
        } catch {
            setEnabled(prev => ({ ...prev, [channelKey]: !next }));
            toast.error("No se pudo cambiar el estado");
        }
    };

    const testChannel = async (channelKey: string) => {
        setTesting(channelKey);
        try {
            if (channelKey === "pwa") {
                const r = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.sent) toast.success(`Prueba enviada a ${d.sent} suscriptor(es)`); else toast.error("Sin suscriptores activos o push no configurado");
                setTesting(null);
                return;
            }
            // La prueba va por la misma cola que las alertas de verdad: si algo
            // falla, falla en el mismo lugar donde fallaría en producción.
            await saveChannel(channelKey);
            const res = await fetch("/api/notifications/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel: channelKey }),
            });
            const data = await res.json().catch(() => ({} as any));
            if (res.ok && data.estado === "SENT") toast.success("Mensaje de prueba enviado");
            else if (res.ok) toast.info?.(data.aviso || "Encolado; mirá el resultado en Despachos");
            else toast.error(data.error || "Error enviando prueba");
        } catch {
            toast.error("Error de conexión");
        }
        setTesting(null);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Send className="w-8 h-8 text-violet-500 animate-pulse" />
            </div>
        );
    }

    const activeCount = CHANNELS.filter(c => enabled[c.key]).length;

    return (
        <div className="max-w-[1700px] mx-auto space-y-5 p-6">
            {/* Hero header */}
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-violet-600/10 via-fuchsia-600/5 to-transparent p-5">
                <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
                <div className="relative flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-900/30">
                            <Radio size={22} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                Centro de Notificaciones
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
                                </span>
                            </h1>
                            <p className="text-xs text-muted-foreground">Canales de notificación para las alertas de aforo</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="flex items-center gap-1.5 justify-end">
                                <Activity size={13} className={activeCount > 0 ? "text-emerald-400" : "text-muted-foreground"} />
                                <span className="text-2xl font-bold tabular-nums leading-none">{activeCount}<span className="text-sm font-medium text-muted-foreground">/{CHANNELS.length}</span></span>
                            </div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mt-0.5">canales activos</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={loadData} className="text-muted-foreground hover:text-foreground">
                            <RefreshCw size={15} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Channel cards (accordion) */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 border border-border w-fit flex-wrap">
                {TABS.map((t) => {
                    const Icon = t.icon; const active = tab === t.k;
                    return (
                        <button key={t.k} onClick={() => setTab(t.k)}
                            className={cn("flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition whitespace-nowrap", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            <Icon size={15} /> {t.l}
                        </button>
                    );
                })}
            </div>

            <div key={tab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
                {tab === "canales" && (
                    <div className="space-y-3">
                {CHANNELS.map((ch) => {
                    const isOn = enabled[ch.key] || false;
                    const isOpen = expanded === ch.key;
                    const configured = isConfigured(ch);
                    const isSaving = saving === ch.key;
                    const isTesting = testing === ch.key;
                    const status = isOn ? "Activo" : configured ? "Configurado" : "Sin configurar";
                    const statusColor = isOn ? "text-emerald-400" : configured ? "text-amber-400" : "text-muted-foreground";
                    const statusDot = isOn ? "bg-emerald-500" : configured ? "bg-amber-500" : "bg-muted-foreground/40";

                    return (
                        <div key={ch.key}
                            className={cn("rounded-2xl border bg-card overflow-hidden transition-all duration-300",
                                isOpen ? "border-border shadow-lg shadow-black/5" : "border-border hover:border-foreground/15")}>
                            {/* accent stripe */}
                            <div className="flex">
                                <div className="w-1 shrink-0" style={{ background: isOn ? ch.accent : "transparent" }} />
                                <div className="flex-1">
                                    {/* header row */}
                                    <button onClick={() => setExpanded(isOpen ? null : ch.key)}
                                        className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-foreground/[0.02] transition-colors">
                                        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                                            style={{ background: `${ch.accent}1a`, color: ch.accent }}>
                                            {ch.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-foreground">{ch.label}</span>
                                                <span className={cn("flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide", statusColor)}>
                                                    <span className={cn("w-1.5 h-1.5 rounded-full", statusDot)} /> {status}
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate mt-0.5">{ch.description}</p>
                                        </div>
                                        {/* toggle switch */}
                                        <span role="switch" aria-checked={isOn}
                                            onClick={(e) => { e.stopPropagation(); toggleChannel(ch.key); }}
                                            className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer",
                                                isOn ? "bg-emerald-500" : "bg-muted-foreground/25")}>
                                            <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                                                isOn && "translate-x-5")} />
                                        </span>
                                        <ChevronDown size={18} className={cn("text-muted-foreground transition-transform shrink-0", isOpen && "rotate-180")} />
                                    </button>

                                    {/* expandable body */}
                                    <div className={cn("grid transition-all duration-300", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                                        <div className="overflow-hidden">
                                            <div className="px-4 pb-4 pt-1 border-t border-border space-y-4">
                                                {ch.key === "pwa" && (
                                                    <p className="text-xs text-muted-foreground pt-3 leading-relaxed">Envía notificaciones push a los navegadores y móviles que instalaron la PWA de Filas y activaron las notificaciones. Identificá y gestioná los suscriptores en la pestaña <b className="text-foreground">Suscriptores</b>.</p>
                                                )}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                                                    {ch.fields.map((field) => (
                                                        <div key={field.key} className={field.span === 2 ? "md:col-span-2" : ""}>
                                                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5 block">{field.label}</label>
                                                            <Input
                                                                type={field.secret ? "password" : "text"}
                                                                value={values[field.key] || ""}
                                                                onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                                placeholder={field.placeholder}
                                                                className="bg-muted/50 border-border text-foreground text-sm h-10 font-mono"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                                    <div className="flex items-center gap-2">
                                                        <Button size="sm" onClick={() => saveChannel(ch.key)} disabled={isSaving}
                                                            className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5 h-9 px-5">
                                                            {isSaving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Guardar
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={() => testChannel(ch.key)} disabled={isTesting || !isOn}
                                                            className="border-border text-foreground/80 hover:text-foreground gap-1.5 h-9">
                                                            {isTesting ? <RefreshCw size={12} className="animate-spin" /> : <TestTube2 size={12} />} Enviar prueba
                                                        </Button>
                                                    </div>
                                                    {!isOn && (
                                                        <span className="text-[10px] text-amber-400/70 flex items-center gap-1">
                                                            <AlertTriangle size={10} /> Habilita el canal para enviar pruebas
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
                )}
                {tab === "destinatarios" && (<div className="space-y-5 max-w-3xl"><AnimatedAlertToggle /><RecipientsManager /></div>)}
                {tab === "reglas" && (<div className="max-w-4xl"><RulesManager /></div>)}
                {tab === "horarios" && (<div className="max-w-4xl"><SchedulesManager /></div>)}
                {tab === "plantillas" && (<div className="max-w-4xl"><TemplatesManager /></div>)}
                {tab === "suscriptores" && (<div className="max-w-3xl"><SubscribersManager /></div>)}
            </div>

            {/* Footer note */}
            <div className="flex items-center justify-center gap-2 pt-1">
                <ShieldCheck size={12} className="text-violet-400" />
                <span className="text-[10px] text-muted-foreground">Las credenciales se guardan cifradas en la configuración del sistema.</span>
            </div>
        </div>
    );
}
