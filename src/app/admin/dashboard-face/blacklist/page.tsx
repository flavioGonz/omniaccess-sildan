"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ShieldAlert, Trash2, Loader2, AlertTriangle,
    ShieldCheck, ChevronLeft, Search, User,
    Calendar, History, MoreHorizontal, UserCheck,
    MessageSquare, Clock, MapPin, AlertCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sileo as toast } from "sileo";
import { getBlacklist, toggleBlacklist } from "@/app/actions/users";
import { getImagePath } from "@/lib/image-path";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AddBlacklistModal } from "@/components/dashboard/AddBlacklistModal";
import { UserPlus, CloudSync, RefreshCw } from "lucide-react";
import { syncAllBlacklistAction } from "@/app/actions/face-sync";

export default function BlacklistPage() {
    const [blacklist, setBlacklist] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'history'>('grid');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedUserFilter, setSelectedUserFilter] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchBlacklist = async () => {
        setLoading(true);
        try {
            const data = await getBlacklist();
            setBlacklist(data);
        } catch (e) {
            toast.error({ title: "Error al cargar lista negra" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBlacklist();
    }, []);

    const handleRemove = async (userId: string) => {
        try {
            await toggleBlacklist(userId, false);
            toast.success({ title: "Sujeto removido de lista negra" });
            fetchBlacklist();
        } catch (e) {
            toast.error({ title: "Error al remover" });
        }
    };

    const filteredList = blacklist.filter(u =>
        u.name.toLowerCase().includes(filter.toLowerCase()) ||
        (u.dni && u.dni.includes(filter))
    );

    const handleSyncAll = async () => {
        setIsSyncing(true);
        const toastId = toast.show({ title: "Sincronizando Lista Negra con Cámaras y AI...", duration: null });
        try {
            const res = await syncAllBlacklistAction();
            if (res.success) {
                toast.success({ title: `Sincronización Completa: ${res.count} sujetos actualizados` });
                toast.dismiss(toastId);
            } else {
                toast.error({ title: "Fallo parcial en la sincronización" });
            }
        } catch (e) {
            toast.error({ title: "Error crítico de sincronización" });
        } finally {
            setIsSyncing(false);
            toast.dismiss(toastId);
        }
    };

    const handleViewUserHistory = (userName: string) => {
        setFilter(userName);
        setViewMode('history');
    };

    // Collect all events for "History" view
    const allEvents = blacklist
        .flatMap(u => (u.accessEvents || []).map((e: any) => ({ ...e, user: u })))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return (
        <div className="min-h-screen bg-black text-white p-8 space-y-8 animate-in fade-in duration-700">
            {/* Minimalist Top Bar */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-border relative">
                <div className="flex items-center gap-6">
                    <Link
                        href="/admin/dashboard-face"
                        className="w-12 h-12 rounded-2xl bg-foreground/10 border border-border flex items-center justify-center hover:bg-[#B20D30] hover:border-[#B20D30] transition-all group shadow-xl"
                    >
                        <ChevronLeft className="group-hover:-translate-x-1 transition-transform" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-4xl font-bold uppercase tracking-tight leading-none">Lista Negra</h1>
                            <Badge className="bg-red-600/20 text-red-500 border-red-600/30 font-bold animate-pulse">CRÍTICO</Badge>
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground mt-2 flex items-center gap-2">
                            <ShieldAlert size={12} className="text-red-600" />
                            Control de Sujetos Restringidos
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-red-500 transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o DNI..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="w-full md:w-80 h-12 bg-foreground/10 border border-border rounded-2xl pl-12 pr-6 text-sm outline-none focus:border-red-600/50 transition-all font-bold placeholder:text-muted-foreground shadow-inner"
                        />
                    </div>
                    <div className="flex h-12 bg-foreground/10 rounded-2xl p-1 border border-border">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                "flex-1 px-4 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                                viewMode === 'grid' ? "bg-red-600 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Perfiles
                        </button>
                        <button
                            onClick={() => setViewMode('history')}
                            className={cn(
                                "flex-1 px-4 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                                viewMode === 'history' ? "bg-red-600 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Detecciones
                        </button>
                    </div>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="h-12 px-6 bg-red-600 hover:bg-red-700 text-foreground rounded-2xl flex items-center gap-3 transition-all shadow-xl shadow-red-600/20 active:scale-95 group"
                    >
                        <UserPlus size={18} className="group-hover:rotate-12 transition-transform" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Agregar Sujeto</span>
                    </button>
                    <button
                        onClick={handleSyncAll}
                        disabled={isSyncing}
                        className="h-12 px-6 bg-foreground/10 border border-border hover:bg-accent text-foreground rounded-2xl flex items-center gap-3 transition-all active:scale-95 group disabled:opacity-50"
                        title="Sincronizar base de datos con hardware y motor neural"
                    >
                        {isSyncing ? <RefreshCw size={18} className="animate-spin" /> : <CloudSync size={18} className="group-hover:scale-110 transition-transform" />}
                        <span className="text-[10px] font-bold uppercase tracking-widest">Sincronizar Todo</span>
                    </button>
                </div>
            </header>

            <AddBlacklistModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={fetchBlacklist}
            />

            {/* Protocol Notice */}
            <AnimatePresence>
                {viewMode === 'grid' && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-gradient-to-r from-red-600/10 via-red-600/5 to-transparent border border-red-600/20 rounded-2xl p-6 flex items-start gap-6 backdrop-blur-md relative overflow-hidden group shadow-lg"
                    >
                        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 blur-[100px] -z-10 group-hover:bg-red-600/10 transition-all duration-1000" />
                        <div className="w-14 h-14 rounded-2xl bg-red-600/20 text-red-600 flex items-center justify-center shrink-0 border border-red-600/20 shadow-inner overflow-hidden">
                            <motion.div
                                animate={{ scale: [1, 1.2, 1] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                <AlertTriangle size={24} />
                            </motion.div>
                        </div>
                        <div>
                            <h4 className="text-sm font-bold uppercase text-red-500 tracking-widest">Protocolo de Identificación Rojav (AI Enabled)</h4>
                            <p className="text-xs text-red-200/40 mt-1 leading-relaxed max-w-3xl font-medium">
                                Los sujetos vinculados a esta base de datos activarán un despliegue de alerta táctica automático.
                                El sistema de visión artificial prioriza el reconocimiento de estos rostros con un motor de inspección dual.
                                <strong> No se requiere intervención manual para la detección inicial.</strong>
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40 gap-6 opacity-50">
                    <div className="relative">
                        <Loader2 className="animate-spin text-red-600" size={48} />
                        <div className="absolute inset-0 bg-red-600 blur-[20px] opacity-20" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-red-600 animate-pulse">Neural Sync In Progress</p>
                </div>
            ) : filteredList.length === 0 ? (
                <div className="text-center py-32 border border-dashed border-border rounded-2xl bg-foreground/[0.04] backdrop-blur-sm">
                    <div className="w-24 h-24 rounded-full bg-foreground/10 mx-auto flex items-center justify-center text-muted-foreground mb-8 border border-border shadow-inner">
                        <ShieldCheck size={48} />
                    </div>
                    <p className="text-sm font-bold uppercase tracking-[0.3em] text-muted-foreground">Perímetro Asegurado: Sin Sujetos Restringidos</p>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredList.map((user, idx) => (
                        <BlacklistCard
                            key={user.id}
                            user={user}
                            idx={idx}
                            onRemove={() => handleRemove(user.id)}
                            onViewHistory={() => handleViewUserHistory(user.name)}
                        />
                    ))}
                </div>
            ) : (
                <BlacklistEventTable events={allEvents} />
            )}
        </div>
    );
}

function BlacklistCard({ user, onRemove, idx, onViewHistory }: { user: any, onRemove: () => void, idx: number, onViewHistory: () => void }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group relative bg-[#0A0A0A] border border-border rounded-2xl overflow-hidden hover:border-red-600/30 transition-all duration-500 hover:shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
        >
            {/* Red Gradient Background */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/5 blur-[50px] -z-10 group-hover:bg-red-600/10 transition-all duration-500" />

            <div className="p-8 space-y-8">
                {/* Header Identity */}
                <div className="flex gap-6 items-start">
                    <div className="w-24 h-24 rounded-3xl overflow-hidden relative border border-border group-hover:border-red-600/50 transition-all duration-700 shadow-lg shrink-0">
                        <Image
                            src={getImagePath(user.cara) || "/placeholder-face.jpg"}
                            alt={user.name}
                            fill
                            className="object-cover grayscale group-hover:grayscale-0 scale-100 group-hover:scale-110 transition-all duration-1000"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex justify-between items-start">
                            <h3 className="text-xl font-bold uppercase tracking-tight truncate text-foreground leading-tight">
                                {user.name}
                            </h3>
                            <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse mt-2" title="Monitor Activo" />
                        </div>
                        <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest truncate">{user.dni || "DNI No Registrado"}</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                            <Badge className="bg-red-600/10 text-red-500 border-red-600/20 text-[7px] font-bold uppercase tracking-widest px-2 py-0.5">BLACKLIST</Badge>
                            <Badge className="bg-foreground/10 text-muted-foreground border-border text-[7px] font-bold uppercase tracking-widest px-2 py-0.5">{user.unit?.name || "EXTERNO"}</Badge>
                        </div>
                    </div>
                </div>

                {/* Metadata Details requested by user */}
                <div className="grid grid-cols-1 gap-4 py-6 border-t border-b border-border">
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <AlertCircle size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Motivo de Restricción</p>
                                <p className="text-[10px] font-bold text-red-500/80 uppercase truncate">
                                    {user.blacklistReason || "Restricción de Perímetro General"}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <Calendar size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Fecha de Inclusión</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">
                                    {new Date(user.createdAt).toLocaleDateString()} at {new Date(user.createdAt).toLocaleTimeString()}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-foreground/10 flex items-center justify-center text-muted-foreground">
                                <UserCheck size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Autorizado por</p>
                                <p className="text-[10px] font-bold text-foreground hover:text-red-500 transition-colors uppercase">
                                    {user.createdBy || "Sistema Automatizado"}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Observations */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <MessageSquare size={10} className="text-muted-foreground" />
                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Observaciones del Operador</span>
                    </div>
                    <div className="bg-foreground/[0.04] p-4 rounded-3xl border border-border min-h-[80px]">
                        <p className="text-[11px] text-muted-foreground font-medium italic leading-relaxed">
                            {user.observations ? `"${user.observations}"` : "Sin comentarios adicionales registrados en el expediente biométrico."}
                        </p>
                    </div>
                </div>

                {/* Action Footer */}
                <div className="pt-4 flex gap-3">
                    <button
                        onClick={onRemove}
                        className="flex-1 h-14 rounded-xl bg-foreground/10 border border-border text-[10px] font-bold uppercase tracking-widest hover:bg-red-600 hover:text-foreground hover:border-red-600 transition-all flex items-center justify-center gap-3 group/btn shadow-xl active:scale-95"
                    >
                        <Trash2 size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                        Retirar de Lista
                    </button>
                    <button
                        onClick={onViewHistory}
                        className="w-14 h-14 rounded-xl bg-foreground/10 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all shadow-xl active:scale-95"
                    >
                        <History size={18} />
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

function BlacklistEventTable({ events }: { events: any[] }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0A0A0A] border border-border rounded-2xl overflow-hidden shadow-lg"
        >
            <div className="p-8 border-b border-border flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Registro Histórico de Detecciones</h2>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Últimos eventos críticos en perímetro</p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-red-600/10 flex items-center justify-center text-red-600 border border-red-600/20 shadow-inner">
                    <History size={20} />
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-foreground/[0.04]">
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Sujeto / Foto</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Fecha y Hora</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Terminal / Ubicación</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Confianza</th>
                            <th className="px-8 py-6 text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {events.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-8 py-20 text-center text-muted-foreground text-xs font-bold uppercase tracking-widest font-mono italic">
                                    No se registran detecciones históricas para los perfiles actuales.
                                </td>
                            </tr>
                        ) : events.map((event, idx) => (
                            <tr key={event.id} className="hover:bg-foreground/[0.04] transition-colors group">
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-12 h-12 rounded-xl overflow-hidden relative border border-border group-hover:border-red-600/50 transition-all shadow-lg">
                                            <Image
                                                src={getImagePath(event.snapshotPath || event.user.cara) || "/placeholder-face.jpg"}
                                                alt="Event"
                                                fill
                                                className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                                            />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-foreground group-hover:text-red-500 transition-colors uppercase">{event.user.name}</p>
                                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{event.user.dni || "S/DNI"}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Clock size={12} className="text-muted-foreground" />
                                            <p className="text-xs font-bold uppercase text-foreground/70">{new Date(event.timestamp).toLocaleTimeString()}</p>
                                        </div>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{new Date(event.timestamp).toLocaleDateString()}</p>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-foreground/10 flex items-center justify-center text-muted-foreground group-hover:text-red-500 transition-colors">
                                            <MapPin size={14} />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-muted-foreground uppercase">{event.device?.name || "Terminal No Identificada"}</p>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase">{event.device?.location || "Punto de Acceso"}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-8 py-6">
                                    <div className="flex items-center gap-2">
                                        <div className="w-24 h-1.5 bg-foreground/10 rounded-full overflow-hidden border border-border shadow-inner">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: "92%" }}
                                                className="h-full bg-red-600"
                                            />
                                        </div>
                                        <span className="text-[10px] font-bold text-red-500">92%</span>
                                    </div>
                                </td>
                                <td className="px-8 py-6 text-right">
                                    <Link
                                        href={`/admin/dashboard-face?event=${event.id}`}
                                        className="px-4 py-2 bg-foreground/10 hover:bg-accent border border-border rounded-xl text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all shadow-xl"
                                    >
                                        Detalles
                                    </Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}
