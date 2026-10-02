"use client";

import { useState, useEffect, useRef } from "react";
import {
    Activity, Bot, Car, Eye, FileText, Info, MessageSquare, RefreshCcw, Settings,
    ShieldCheck, ShieldAlert, Plus, X, Loader2, QrCode, Smartphone, CheckCircle2, LogOut,
    ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { testWahaConnection, getWahaHistory, getSetting, updateSetting } from "@/app/actions/settings";

type DrawerKey = null | "conn" | "cmds" | "allow" | "hist";

export default function WhatsAppSection() {
    const [config, setConfig] = useState({ url: "", apiKey: "" });
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
    const [history, setHistory] = useState<any[]>([]);
    const [allowEnabled, setAllowEnabled] = useState(false);
    const [allowList, setAllowList] = useState<string[]>([]);
    const [newAllow, setNewAllow] = useState("");
    const [savingAllow, setSavingAllow] = useState(false);
    const [chatbotEnabled, setChatbotEnabled] = useState(true);
    const [drawer, setDrawer] = useState<DrawerKey>(null);

    useEffect(() => { loadConfig(); }, []);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const [url, apiKey, cmdConfig, allowEn, allowLs, cbEn] = await Promise.all([
                getSetting("WAHA_URL"), getSetting("WAHA_API_KEY"), getSetting("WAHA_COMMANDS"),
                getSetting("WHATSAPP_ALLOWLIST_ENABLED"), getSetting("WHATSAPP_ALLOWLIST"), getSetting("CHATBOT_ENABLED"),
            ]);
            setAllowEnabled(allowEn?.value === "true");
            setChatbotEnabled(cbEn?.value !== "false");
            try { const a = JSON.parse(allowLs?.value || "[]"); if (Array.isArray(a)) setAllowList(a); } catch { }
            setConfig({ url: url?.value || "", apiKey: apiKey?.value || "" });
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
            await Promise.all([updateSetting("WAHA_URL", config.url), updateSetting("WAHA_API_KEY", config.apiKey), updateSetting("WAHA_COMMANDS", commandsConfig)]);
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
                    <ConfigTile icon={<ShieldCheck size={18} />} color={allowEnabled ? "emerald" : "amber"} title="Remitentes autorizados" value={allowEnabled ? `${allowList.length} autorizados` : "Abierto a todos"} onClick={() => setDrawer("allow")} />
                    <ConfigTile icon={<FileText size={18} />} color="sky" title="Historial de consultas" value={`${history.length} registros`} onClick={() => { loadHistory(); setDrawer("hist"); }} />
                </div>
            </div>

            {/* Webhook (nota, auto-config) */}
            <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4 flex items-start gap-3">
                <Info className="text-blue-400 shrink-0 mt-0.5" size={16} />
                <div className="min-w-0">
                    <h4 className="text-xs font-bold text-blue-100 uppercase mb-1">Webhook (automático)</h4>
                    <p className="text-[11px] text-blue-200/60 mb-1.5">Se configura solo al vincular. Apunta a:</p>
                    <code className="block bg-muted/50 rounded p-2 text-[10px] font-mono text-blue-300 break-all">http://172.16.2.71:10000/api/waha/webhook</code>
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
                                <span className="block text-xs font-mono font-bold text-foreground truncate">{cmd.cmd}</span>
                                <span className="block text-[10px] text-muted-foreground truncate">{cmd.desc}</span>
                            </div>
                            <Switch checked={cmd.active} onCheckedChange={() => toggleCommand(cmd.id)} />
                        </div>
                    ))}
                    <Button onClick={handleSave} disabled={saving} className="w-full h-10 mt-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">{saving ? "Guardando…" : "Guardar comandos"}</Button>
                </div>
            </SideDrawer>

            <SideDrawer open={drawer === "allow"} onClose={() => setDrawer(null)} icon={<ShieldCheck size={18} />} title="Remitentes autorizados"
                headerRight={<Switch checked={allowEnabled} onCheckedChange={setAllowEnabled} />}>
                <div className="space-y-4">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Con la lista blanca activada, el bot <b>solo</b> procesa mensajes de los números/grupos autorizados; al resto lo ignora en silencio. Evita fuga de datos a desconocidos.</p>
                    {!allowEnabled ? (
                        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                            <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-amber-300">Desactivada: cualquiera que escriba al bot puede consultar datos. Recomendado activarla.</span>
                        </div>
                    ) : (
                        <>
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
                    <Button onClick={saveAllowlist} disabled={savingAllow} className="w-full h-10 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">{savingAllow ? "Guardando…" : "Guardar seguridad"}</Button>
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
