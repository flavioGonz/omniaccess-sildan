"use client";

import { useState, useCallback } from "react";
import {
    Activity, Wifi, RefreshCw, ChevronDown, ChevronRight,
    Radio, Users, Eye, Layers, Zap, AlertCircle, CheckCircle2,
    Copy, Loader2, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface OnvifProfile {
    name: string;
    token: string | null;
    error?: string;
}

interface OnvifRule {
    topic: string;
    ruleName: string | null;
    count: number | null;
    operation: string | null;
}

interface OnvifDiscoveryResult {
    device: { id: string; name: string; ip: string };
    profiles: OnvifProfile[];
    rules: OnvifRule[];
    availableTopics: string[];
    currentCounts: { channelName: string; peopleCount: number; timestamp: string }[];
    pullPointError?: string;
}

interface OnvifDiscoveryPanelProps {
    deviceId: string;
    deviceName: string;
    deviceIp: string;
    compact?: boolean;
}

export function OnvifDiscoveryPanel({ deviceId, deviceName, deviceIp, compact = false }: OnvifDiscoveryPanelProps) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<OnvifDiscoveryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        profiles: true,
        rules: true,
        topics: false,
        counts: true,
    });

    const toggleSection = (key: string) => {
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const discover = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/queue/onvif-discover?deviceId=${deviceId}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            const data: OnvifDiscoveryResult = await res.json();
            setResult(data);
            toast.success(`Descubrimiento ONVIF completado — ${data.rules.length} reglas encontradas`);
        } catch (e: any) {
            setError(e.message);
            toast.error("Error en descubrimiento ONVIF: " + e.message);
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copiado al portapapeles");
    };

    // Topic icon mapping
    const getTopicIcon = (topic: string) => {
        if (topic.includes("Count")) return <Users size={12} className="text-blue-400" />;
        if (topic.includes("Occupancy")) return <Eye size={12} className="text-purple-400" />;
        if (topic.includes("Motion")) return <Zap size={12} className="text-amber-400" />;
        if (topic.includes("Analytics")) return <Activity size={12} className="text-cyan-400" />;
        return <Radio size={12} className="text-muted-foreground" />;
    };

    const getTopicColor = (topic: string) => {
        if (topic.includes("Count")) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
        if (topic.includes("Occupancy")) return "text-purple-400 bg-purple-500/10 border-purple-500/20";
        if (topic.includes("Motion")) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
        if (topic.includes("Analytics")) return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
        return "text-muted-foreground bg-foreground/10 border-border";
    };

    if (!result && !loading && !error) {
        return (
            <div className={cn("rounded-xl border border-border bg-foreground/[0.04]", compact ? "p-3" : "p-4")}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                            <Search size={14} className="text-cyan-400" />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-foreground/70">Analíticas ONVIF</p>
                            <p className="text-[10px] text-muted-foreground">{deviceName} · {deviceIp}</p>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        onClick={discover}
                        className="h-8 text-xs bg-cyan-600 hover:bg-cyan-500 text-foreground gap-1.5"
                    >
                        <Wifi size={12} /> Descubrir
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("rounded-xl border border-border bg-foreground/[0.04] space-y-3", compact ? "p-3" : "p-4")}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center",
                        loading ? "bg-cyan-500/10 animate-pulse" :
                            error ? "bg-red-500/10" : "bg-emerald-500/10"
                    )}>
                        {loading ? <Loader2 size={14} className="text-cyan-400 animate-spin" /> :
                            error ? <AlertCircle size={14} className="text-red-400" /> :
                                <CheckCircle2 size={14} className="text-emerald-400" />}
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-foreground/70">
                            {loading ? "Descubriendo analíticas..." : error ? "Error en descubrimiento" : "Analíticas ONVIF"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{deviceName} · {deviceIp}</p>
                    </div>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={discover}
                    disabled={loading}
                    className="h-7 text-xs border-border hover:bg-accent gap-1"
                >
                    <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {loading ? "..." : "Redescubrir"}
                </Button>
            </div>

            {error && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                    {error}
                </div>
            )}

            {result && !loading && (
                <div className="space-y-2">
                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400 bg-cyan-500/5">
                            <Layers size={10} className="mr-1" /> {result.profiles.length} perfil{result.profiles.length !== 1 ? "es" : ""}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">
                            <Activity size={10} className="mr-1" /> {result.rules.length} regla{result.rules.length !== 1 ? "s" : ""} activa{result.rules.length !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400 bg-purple-500/5">
                            <Radio size={10} className="mr-1" /> {result.availableTopics.length} topic{result.availableTopics.length !== 1 ? "s" : ""}
                        </Badge>
                    </div>

                    {/* Analytics Profiles */}
                    <CollapsibleSection
                        title="Perfiles de Video Analytics"
                        icon={<Layers size={12} className="text-cyan-400" />}
                        count={result.profiles.length}
                        expanded={expandedSections.profiles}
                        onToggle={() => toggleSection("profiles")}
                    >
                        {result.profiles.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground py-2">No se encontraron perfiles</p>
                        ) : (
                            <div className="space-y-1.5">
                                {result.profiles.map((p, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-foreground/[0.04] border border-border">
                                        <div className="flex items-center gap-2">
                                            <div className="w-5 h-5 rounded bg-cyan-500/10 flex items-center justify-center">
                                                <Layers size={10} className="text-cyan-400" />
                                            </div>
                                            <span className="text-xs text-foreground/70 font-medium">{p.name}</span>
                                        </div>
                                        {p.token && (
                                            <button
                                                onClick={() => copyToClipboard(p.token!)}
                                                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground/50 transition-colors"
                                            >
                                                <Copy size={9} /> {p.token.substring(0, 16)}...
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CollapsibleSection>

                    {/* Active Rules (current events) */}
                    <CollapsibleSection
                        title="Reglas Activas (Eventos en Vivo)"
                        icon={<Activity size={12} className="text-blue-400" />}
                        count={result.rules.length}
                        expanded={expandedSections.rules}
                        onToggle={() => toggleSection("rules")}
                    >
                        {result.rules.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground py-2">
                                No hay reglas activas — la cámara no está enviando eventos de conteo
                                {result.pullPointError && (
                                    <span className="block mt-1 text-amber-400/60">PullPoint: {result.pullPointError}</span>
                                )}
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                {result.rules.map((r, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-foreground/[0.04] border border-border group">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {getTopicIcon(r.topic)}
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium text-foreground/70 truncate">
                                                    {r.ruleName || "Sin nombre"}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground truncate">{r.topic}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {r.count !== null && (
                                                <span className="text-sm font-bold text-foreground/70 tabular-nums">{r.count}</span>
                                            )}
                                            {r.operation && (
                                                <Badge variant="outline" className={cn("text-[9px]", getTopicColor(r.topic))}>
                                                    {r.operation}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CollapsibleSection>

                    {/* DB Counts */}
                    <CollapsibleSection
                        title="Últimos Conteos en Base de Datos"
                        icon={<Users size={12} className="text-emerald-400" />}
                        count={result.currentCounts.length}
                        expanded={expandedSections.counts}
                        onToggle={() => toggleSection("counts")}
                    >
                        {result.currentCounts.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground py-2">Sin datos en base de datos aún</p>
                        ) : (
                            <div className="space-y-1.5">
                                {result.currentCounts.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-foreground/[0.04] border border-border">
                                        <div className="flex items-center gap-2">
                                            <Users size={10} className="text-emerald-400" />
                                            <span className="text-xs text-foreground/70">{c.channelName}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-bold text-foreground/70 tabular-nums">{c.peopleCount}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                                {new Date(c.timestamp).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CollapsibleSection>

                    {/* Available Topics */}
                    <CollapsibleSection
                        title="Topics ONVIF Disponibles"
                        icon={<Radio size={12} className="text-purple-400" />}
                        count={result.availableTopics.length}
                        expanded={expandedSections.topics}
                        onToggle={() => toggleSection("topics")}
                    >
                        {result.availableTopics.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground py-2">No se detectaron topics</p>
                        ) : (
                            <div className="flex flex-wrap gap-1">
                                {result.availableTopics.map((t, i) => (
                                    <button
                                        key={i}
                                        onClick={() => copyToClipboard(t)}
                                        className={cn(
                                            "px-2 py-1 rounded-md text-[10px] font-mono border transition-colors cursor-pointer",
                                            getTopicColor(t),
                                            "hover:opacity-80"
                                        )}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        )}
                    </CollapsibleSection>
                </div>
            )}
        </div>
    );
}

// --- Collapsible Section Sub-component ---
function CollapsibleSection({
    title, icon, count, expanded, onToggle, children
}: {
    title: string;
    icon: React.ReactNode;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-lg border border-border overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-3 py-2 bg-foreground/[0.04] hover:bg-foreground/[0.04] transition-colors"
            >
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-[11px] font-semibold text-foreground/70">{title}</span>
                    <Badge variant="outline" className="text-[9px] border-border text-muted-foreground h-4 px-1.5">
                        {count}
                    </Badge>
                </div>
                {expanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
            </button>
            {expanded && <div className="p-2">{children}</div>}
        </div>
    );
}
