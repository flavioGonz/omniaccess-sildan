"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
    Activity,
    Bot,
    Car,
    Eye,
    FileText,
    Info,
    MessageSquare,
    RefreshCcw,
    Settings,
    ShieldCheck,
    ShieldAlert,
    Plus,
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
import { testWahaConnection, getWahaHistory, getSetting, updateSetting } from "@/app/actions/settings";

export default function WhatsAppSection() {
    const [config, setConfig] = useState({ url: "", apiKey: "" });
    // Updated default commands to reflect reality
    const [commands, setCommands] = useState([
        { id: 'matricula', cmd: 'matricula [AAA1234]', desc: 'Gestión de matrículas (Consultar/Agregar)', icon: Car, active: true },
        { id: 'last_events', cmd: 'ultimas entradas/salidas', desc: 'Reporte de últimos accesos con filtro', icon: Activity, active: true },
        { id: 'logs', cmd: 'último evento', desc: 'Último acceso registrado (con foto)', icon: Eye, active: true },
        { id: 'aforo', cmd: 'aforo', desc: 'Aforo en vivo de las filas (Control de Filas)', icon: Activity, active: true },
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
    const [chatbotEnabled, setChatbotEnabled] = useState(true);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const [url, apiKey, cmdConfig, allowEn, allowLs, cbEn] = await Promise.all([
                getSetting("WAHA_URL"),
                getSetting("WAHA_API_KEY"),
                getSetting("WAHA_COMMANDS"),
                getSetting("WHATSAPP_ALLOWLIST_ENABLED"),
                getSetting("WHATSAPP_ALLOWLIST"),
                getSetting("CHATBOT_ENABLED")
            ]);
            setAllowEnabled(allowEn?.value === "true");
            setChatbotEnabled(cbEn?.value !== "false");
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
    const toggleChatbot = async (v: boolean) => {
        setChatbotEnabled(v);
        try {
            await updateSetting("CHATBOT_ENABLED", v ? "true" : "false");
            toast.success({ title: v ? "Chatbot activado" : "Chatbot desactivado globalmente" });
        } catch {
            setChatbotEnabled(!v);
            toast.error?.({ title: "No se pudo guardar el estado del chatbot" });
        }
    };

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
            toast.success({ title: "Configuración de OpenWA guardada" });
        } catch (err) {
            toast.error({ title: "Error al guardar la configuración" });
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!config.url) {
            toast.error({ title: "Por favor ingresa la URL de OpenWA" });
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
            toast.error({ title: "Error crítico al conectar con OpenWA" });
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
                        <h2 className="text-xl font-bold text-foreground tracking-tight">Chatbot WhatsApp (OpenWA)</h2>
                        <p className="text-xs text-muted-foreground">Asistente IA y Notificaciones</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={cn("flex items-center gap-2 h-8 px-3 rounded-md border text-xs font-bold transition-colors", chatbotEnabled ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400")} title="Activa o desactiva el chatbot globalmente (WhatsApp + chat de la app)">
                        <Bot size={14} />
                        <span>{chatbotEnabled ? "Chatbot activo" : "Chatbot apagado"}</span>
                        <Switch checked={chatbotEnabled} onCheckedChange={toggleChatbot} className="scale-90" />
                    </div>
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
                                    placeholder="http://192.168.99.22:2785"
                                    className="bg-background border-border h-10 font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">API Key</Label>
                                <Input
                                    value={config.apiKey}
                                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                    type="password"
                                    placeholder="••••••••"
                                    className="bg-background border-border h-10 font-mono text-xs"
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
                            <p className="text-[10px] text-blue-200/60 mb-2">Configura esta URL en OpenWA:</p>
                            <code className="block bg-muted/50 rounded p-2 text-[10px] font-mono text-blue-300">http://SERVER_IP:10000/api/webhooks/whatsapp</code>
                        </div>
                    </div>

                    {/* Seguridad: lista blanca */}
                    <div className="bg-card/50 backdrop-blur-xl border border-border rounded-lg p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="text-emerald-400" size={18} />
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Seguridad · Remitentes</h3>
                            </div>
                            <Switch checked={allowEnabled} onCheckedChange={setAllowEnabled} />
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            El bot responde con eventos, historiales y <b>fotos</b>. Con la lista blanca activada, <b>solo</b> procesa mensajes de los números y grupos autorizados; al resto lo ignora en silencio. Esto evita fuga de datos a desconocidos.
                        </p>

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
                                        placeholder="Número (098…) o JID de grupo (…@g.us)" className="bg-background border-border h-9 font-mono text-xs" />
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



