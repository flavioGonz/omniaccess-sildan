"use client";

import React, { useState, useEffect } from "react";
import {
    ClipboardList, Search, Clock, User as UserIcon, Camera, Play, Shield,
    Smartphone, ArrowLeft, MapPin, RefreshCw, FileText, AlertTriangle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { getBitacoraEntries } from "@/app/actions/bitacora";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getImagePath } from "@/lib/image-path";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { label: string; cls: string }> = {
    MANUAL: { label: "Manual", cls: "border-blue-500/50 text-blue-500" },
    RONDIN: { label: "Rondín", cls: "border-emerald-500/50 text-emerald-500" },
    PATROL: { label: "Rondín", cls: "border-emerald-500/50 text-emerald-500" },
    MERODEO: { label: "Merodeo", cls: "border-red-500/50 text-red-500" },
    PANIC: { label: "Pánico", cls: "border-red-500/50 text-red-500" },
    VISITA: { label: "Visita", cls: "border-violet-500/50 text-violet-500" },
    NOVEDAD: { label: "Novedad", cls: "border-amber-500/50 text-amber-500" },
};

function typeMeta(t?: string) {
    return TYPE_META[(t || "").toUpperCase()] || { label: t || "Registro", cls: "border-border text-muted-foreground" };
}

function thumb(path?: string | null) {
    const u = getImagePath(path) || "";
    return u ? (u.includes("?") ? `${u}&w=96` : `${u}?w=96`) : "";
}

export default function BitacoraPage() {
    const [entries, setEntries] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterDate, setFilterDate] = useState("");
    const [selected, setSelected] = useState<any | null>(null);
    const router = useRouter();

    const load = async () => {
        try { setEntries(await getBitacoraEntries()); }
        catch (e) { console.error("Error loading bitacora:", e); }
        finally { setIsLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = entries.filter((e: any) => {
        const q = searchTerm.toLowerCase();
        const matchesSearch = !q ||
            (e.plate?.toLowerCase() || "").includes(q) ||
            (e.name?.toLowerCase() || "").includes(q) ||
            (e.destination?.toLowerCase() || "").includes(q) ||
            (e.notes?.toLowerCase() || "").includes(q) ||
            (e.guardName?.toLowerCase() || "").includes(q);
        const matchesDate = !filterDate || new Date(e.timestamp).toISOString().split("T")[0] === filterDate;
        return matchesSearch && matchesDate;
    });

    const fmtTime = (d: any) => new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const fmtDate = (d: any) => new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

    return (
        <div className="h-full flex flex-col bg-background text-foreground">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0 gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.back()} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <ArrowLeft size={18} />
                    </button>
                    <div className="p-2 rounded-xl bg-amber-500/10"><ClipboardList size={22} className="text-amber-500" /></div>
                    <div>
                        <h1 className="text-2xl font-bold">Bitácora</h1>
                        <p className="text-sm text-muted-foreground">Registros manuales y rondines de guardia</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={searchTerm} onChange={(e: any) => setSearchTerm(e.target.value)} placeholder="Buscar patente, guardia, novedad..."
                            className="h-9 pl-9 w-64 bg-card border-border text-sm" />
                    </div>
                    <input type="date" value={filterDate} onChange={(e: any) => setFilterDate(e.target.value)}
                        className="h-9 px-3 rounded-md bg-card border border-border text-sm text-foreground" />
                    <button onClick={() => { setIsLoading(true); load(); }} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
                        <tr>
                            <th className="px-5 py-3 text-left text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Fecha / Hora</th>
                            <th className="px-5 py-3 text-left text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Tipo</th>
                            <th className="px-5 py-3 text-left text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Novedad / Detalle</th>
                            <th className="px-5 py-3 text-left text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Guardia</th>
                            <th className="px-5 py-3 text-left text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Evidencia</th>
                            <th className="px-5 py-3 text-right text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Detalle</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {isLoading ? (
                            Array.from({ length: 8 }).map((_: any, i: number) => (
                                <tr key={i}><td colSpan={6} className="px-5 py-4"><div className="h-8 bg-muted/60 rounded animate-pulse" /></td></tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={6} className="px-5 py-16 text-center">
                                <FileText size={28} className="mx-auto mb-3 text-muted-foreground/40" />
                                <p className="text-sm text-muted-foreground">Sin registros</p>
                            </td></tr>
                        ) : filtered.map((e: any) => {
                            const tm = typeMeta(e.type);
                            const th = thumb(e.photoPath);
                            return (
                                <tr key={e.id} onClick={() => setSelected(e)} className="hover:bg-accent cursor-pointer transition-colors group">
                                    <td className="px-5 py-3">
                                        <p className="text-sm font-medium text-foreground">{fmtTime(e.timestamp)}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(e.timestamp)}</p>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", tm.cls)}>{tm.label}</span>
                                    </td>
                                    <td className="px-5 py-3 max-w-[360px]">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {e.plate ? <span className="font-mono tracking-wider mr-2">{e.plate}</span> : null}
                                            {e.name || e.destination || e.notes || "—"}
                                        </p>
                                        {(e.name || e.destination) && e.notes && (
                                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{e.notes}</p>
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                            <Shield size={12} className="text-muted-foreground/60" />{e.guardName || "—"}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2">
                                            {th ? <img src={th} alt="" className="w-10 h-8 rounded-md object-cover border border-border" /> : <span className="text-[11px] text-muted-foreground/50">—</span>}
                                            {e.audioPath && <Play size={13} className="text-blue-500" />}
                                            {(e.latitude && e.longitude) ? <MapPin size={13} className="text-emerald-500" /> : null}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <span className="text-[11px] font-semibold text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">Ver →</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Dialog open={!!selected} onOpenChange={(o: boolean) => { if (!o) setSelected(null); }}>
                <DialogContent className="max-w-2xl">
                    {selected && (() => {
                        const tm = typeMeta(selected.type);
                        const img = getImagePath(selected.photoPath) || "";
                        return (
                            <div>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-3">
                                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", tm.cls)}>{tm.label}</span>
                                        <span className="text-lg font-bold">{selected.plate ? <span className="font-mono tracking-wider">{selected.plate}</span> : (selected.name || "Registro")}</span>
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-xl overflow-hidden border border-border bg-muted aspect-video flex items-center justify-center">
                                        {img ? <img src={img.includes("?") ? `${img}&w=800` : `${img}?w=800`} alt="" className="w-full h-full object-cover" /> : <Camera size={32} className="text-muted-foreground/40" />}
                                    </div>
                                    <div className="space-y-3 text-sm">
                                        <Field icon={<Clock size={13} />} label="Fecha / Hora" value={`${fmtDate(selected.timestamp)} · ${fmtTime(selected.timestamp)}`} />
                                        <Field icon={<Shield size={13} />} label="Guardia" value={selected.guardName || "—"} />
                                        {selected.name && <Field icon={<UserIcon size={13} />} label="Nombre" value={selected.name} />}
                                        {selected.dni && <Field icon={<Smartphone size={13} />} label="Documento" value={selected.dni} />}
                                        {selected.company && <Field icon={<FileText size={13} />} label="Empresa" value={selected.company} />}
                                        {selected.destination && <Field icon={<MapPin size={13} />} label="Destino" value={selected.destination} />}
                                    </div>
                                </div>
                                {selected.notes && (
                                    <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-1.5"><AlertTriangle size={12} /> Novedad</p>
                                        <p className="text-sm text-foreground whitespace-pre-wrap">{selected.notes}</p>
                                    </div>
                                )}
                                <div className="mt-4 flex items-center gap-3">
                                    {selected.audioPath && (
                                        <audio controls src={getImagePath(selected.audioPath) || undefined} className="h-9" />
                                    )}
                                    {(selected.latitude && selected.longitude) && (
                                        <a href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`} target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:underline">
                                            <MapPin size={14} /> Ver ubicación
                                        </a>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">{icon}{label}</p>
            <p className="text-sm text-foreground font-medium mt-0.5">{value}</p>
        </div>
    );
}
