"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ShieldCheck, Trash2, Loader2, Star,
    ChevronLeft, Search, User,
    Calendar, History, MoreHorizontal, UserCheck,
    MessageSquare, Clock, MapPin, CheckCircle2,
    Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sileo as toast } from "sileo";
import { getWhitelist, toggleBlacklist } from "@/app/actions/users";
import { getImagePath } from "@/lib/image-path";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fecha, hora } from "@/lib/fechas";

export default function WhitelistPage() {
    const [whitelist, setWhitelist] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'history'>('grid');

    const fetchWhitelist = async () => {
        setLoading(true);
        try {
            const data = await getWhitelist();
            setWhitelist(data);
        } catch (e) {
            toast.error({ title: "Error al cargar lista blanca" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWhitelist();
    }, []);

    const handleRemove = async (userId: string) => {
        try {
            await toggleBlacklist(userId, false); // Removed from Whitelist/Role
            toast.success({ title: "Sujeto removido de lista especial" });
            fetchWhitelist();
        } catch (e) {
            toast.error({ title: "Error al remover" });
        }
    };

    const filteredList = whitelist.filter(u =>
        u.name.toLowerCase().includes(filter.toLowerCase()) ||
        (u.dni && u.dni.includes(filter))
    );

    // Collect all events for "History" view
    const allEvents = whitelist
        .flatMap(u => (u.accessEvents || []).map((e: any) => ({ ...e, user: u })))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return (
        <div className="min-h-screen bg-black text-white p-8 space-y-8 animate-in fade-in duration-700">
            {/* Elegant Top Bar */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-border relative">
                <div className="flex items-center gap-6">
                    <Link
                        href="/admin/dashboard-face"
                        className="w-12 h-12 rounded-2xl bg-foreground/10 border border-border flex items-center justify-center hover:bg-emerald-600 hover:border-emerald-600 transition-all group shadow-xl"
                    >
                        <ChevronLeft className="group-hover:-translate-x-1 transition-transform" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-4xl font-bold uppercase tracking-tight leading-none text-emerald-50">Lista Blanca</h1>
                            <Badge className="bg-emerald-600/20 text-emerald-500 border-emerald-600/30 font-bold">PREMIUM</Badge>
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground mt-2 flex items-center gap-2">
                            <Star size={12} className="text-emerald-600 fill-emerald-600" />
                            Gestión de Acceso Preferencial
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-emerald-500 transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o DNI..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full md:w-80 h-12 bg-foreground/10 border border-border rounded-2xl pl-12 pr-6 text-sm outline-none focus:border-emerald-600/50 transition-all font-bold placeholder:text-muted-foreground shadow-inner"
                        />
                    </div>
                    <div className="flex h-12 bg-foreground/10 rounded-2xl p-1 border border-border">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                "flex-1 px-4 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                                viewMode === 'grid' ? "bg-emerald-600 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Perfiles
                        </button>
                        <button
                            onClick={() => setViewMode('history')}
                            className={cn(
                                "flex-1 px-4 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                                viewMode === 'history' ? "bg-emerald-600 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Detecciones
                        </button>
                    </div>
                </div>
            </header>

            {/* Protocol Notice */}
            <AnimatePresence>
                {viewMode === 'grid' && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-gradient-to-r from-emerald-600/10 via-emerald-600/5 to-transparent border border-emerald-600/20 rounded-3xl p-6 flex items-start gap-6 backdrop-blur-md relative overflow-hidden group shadow-lg"
                    >
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-600/5 blur-[100px] -z-10 group-hover:bg-emerald-600/10 transition-all duration-1000" />
                        <div className="w-14 h-14 rounded-2xl bg-emerald-600/20 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-600/20 shadow-inner overflow-hidden">
                            <Zap size={24} className="fill-emerald-500/20" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold uppercase text-emerald-500 tracking-widest">Protocolo de Acceso V.I.P. (Identidad Digital)</h4>
                            <p className="text-xs text-emerald-200/40 mt-1 leading-relaxed max-w-3xl font-medium">
                                Los sujetos en esta lista cuentan con autorización de paso expedito a áreas restringidas.
                                El sistema omitirá notificaciones de denegación y registrará el ingreso como <strong>Evento de Categoría Especial</strong>.
                                Ideal para contratistas frecuentes, socios o residentes con servicios premium activos.
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-6 opacity-50">
                    <div className="relative">
                        <Loader2 className="animate-spin text-emerald-600" size={48} />
                        <div className="absolute inset-0 bg-emerald-600 blur-[20px] opacity-20" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-emerald-600 animate-pulse">Neural Sync In Progress</p>
                </div>
            ) : filteredList.length === 0 ? (
                <div className="text-center py-32 border border-dashed border-border rounded-2xl bg-foreground/[0.04] backdrop-blur-sm">
                    <div className="w-24 h-24 rounded-full bg-foreground/10 mx-auto flex items-center justify-center text-muted-foreground mb-8 border border-border shadow-inner">
                        <CheckCircle2 size={48} />
                    </div>
                    <p className="text-sm font-bold uppercase tracking-[0.3em] text-muted-foreground">No hay perfiles registrados en la lista especial</p>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredList.map((user, idx) => (
                        <WhitelistCard
                            key={user.id}
                            user={user}
                            idx={idx}
                            onRemove={() => handleRemove(user.id)}
                        />
                    ))}
                </div>
            ) : (
                <WhitelistEventTable events={allEvents} />
            )}
        </div>
    );
}

function WhitelistCard({ user, onRemove, idx }: { user: any, onRemove: () => void, idx: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group relative bg-[#0A0A0A] border border-border rounded-2xl overflow-hidden hover:border-emerald-600/30 transition-all duration-500 hover:shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
        >
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-600/5 blur-[50px] -z-10 group-hover:bg-emerald-600/10 transition-all duration-500" />

            <div className="p-8 space-y-8">
                {/* Header Identity */}
                <div className="flex gap-6 items-start">
                    <div className="w-24 h-24 rounded-3xl overflow-hidden relative border border-border group-hover:border-emerald-600/50 transition-all duration-700 shadow-lg shrink-0">
                        <Image
                            src={getImagePath(user.cara) || "/placeholder-face.jpg"}
                            alt={user.name}
                            fill
                            className="object-cover group-hover:scale-110 transition-all duration-1000"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex justify-between items-start">
                            <h3 className="text-xl font-bold uppercase tracking-tight truncate text-foreground leading-tight">
                                {user.name}
                            </h3>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mt-2" title="Acceso Habilitado" />
                        </div>
                        <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest truncate">{user.dni || "DNI No Registrado"}</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                            <Badge className="bg-emerald-600/10 text-emerald-500 border-emerald-600/20 text-[7px] font-bold uppercase tracking-widest px-2 py-0.5 whitespace-nowrap">WHITELISTED</Badge>
                            <Badge className="bg-foreground/10 text-muted-foreground border-border text-[7px] font-bold uppercase tracking-widest px-2 py-0.5 truncate">{user.unit?.name || "RECURRENTE"}</Badge>
                        </div>
                    </div>
                </div>

                {/* Metadata Details */}
                <div className="grid grid-cols-1 gap-4 py-6 border-t border-b border-border">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <Star size={14} className="group-hover:text-emerald-500 transition-colors" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Nivel de Acceso</p>
                                <p className="text-[10px] font-bold text-emerald-500/80 uppercase truncate">
                                    {user.blacklistReason || "Acceso Preferencial Ilimitado"}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <Calendar size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Creación del Perfil</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                                    {fecha(new Date(user.createdAt))}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <UserCheck size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Registrado por</p>
                                <p className="text-[10px] font-bold text-foreground hover:text-emerald-500 transition-colors uppercase">
                                    {user.createdBy || "Admin Console"}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Observations */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <MessageSquare size={10} className="text-muted-foreground" />
                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Instrucciones Especiales</span>
                    </div>
                    <div className="bg-foreground/[0.04] p-4 rounded-3xl border border-border min-h-[80px]">
                        <p className="text-[11px] text-muted-foreground font-medium italic leading-relaxed">
                            {user.observations ? `"${user.observations}"` : "Sin requerimientos especiales registrados."}
                        </p>
                    </div>
                </div>

                {/* Action Footer */}
                <div className="pt-4 flex gap-3">
                    <button
                        onClick={onRemove}
                        className="flex-1 h-14 rounded-xl bg-foreground/10 border border-border text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 hover:text-foreground hover:border-emerald-600 transition-all flex items-center justify-center gap-3 group/btn shadow-xl active:scale-95"
                    >
                        <Trash2 size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                        Quitar Nivel Especial
                    </button>
                    <button className="w-14 h-14 rounded-xl bg-foreground/10 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all shadow-xl active:scale-95">
                        <History size={18} />
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

function WhitelistEventTable({ events }: { events: any[] }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0A0A0A] border border-border rounded-2xl overflow-hidden shadow-lg"
        >
            <div className="p-8 border-b border-border flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Bitácora de Accesos Premium</h2>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Historial de validaciones faciales exitosas</p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-600/10 flex items-center justify-center text-emerald-600 border border-emerald-600/20 shadow-inner text-shadow-glow">
                    <Zap size={20} />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-foreground/[0.04]">
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Identidad / Perfil</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Temporalidad</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Ubicación de Acceso</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Status Biométrico</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {events.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-8 py-20 text-center text-muted-foreground text-xs font-bold uppercase tracking-widest font-mono italic">
                                    No se registran accesos recientes para esta categoría.
                                </td>
                            </tr>
                        ) : events.map((event, idx) => (
                            <tr key={event.id} className="hover:bg-foreground/[0.04] transition-colors group">
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-12 h-12 rounded-xl overflow-hidden relative border border-border group-hover:border-emerald-600/50 transition-all shadow-lg">
                                            <Image
                                                src={getImagePath(event.snapshotPath || event.user.cara) || "/placeholder-face.jpg"}
                                                alt="Event"
                                                fill
                                                className="object-cover transition-all duration-700"
                                            />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-foreground group-hover:text-emerald-500 transition-colors uppercase">{event.user.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{event.user.dni || "VERIFICADO"}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold uppercase text-foreground/70">{hora(new Date(event.timestamp))}</p>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{fecha(new Date(event.timestamp))}</p>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-foreground/10 flex items-center justify-center text-muted-foreground group-hover:text-emerald-500 transition-colors">
                                            <MapPin size={14} />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-muted-foreground uppercase">{event.device?.name || "Terminal 01"}</p>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase">{event.device?.location || "Punto de Control"}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-emerald-600/10 text-emerald-500 border-none text-[8px] font-bold tracking-widest">VALIDADO</Badge>
                                        <span className="text-[10px] font-bold text-emerald-500 opacity-60">98% Match</span>
                                    </div>
                                </td>
                                <td className="px-8 py-6 text-right">
                                    <button className="px-4 py-2 bg-foreground/10 hover:bg-accent border border-border rounded-xl text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all shadow-xl">
                                        Auditoría
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}
