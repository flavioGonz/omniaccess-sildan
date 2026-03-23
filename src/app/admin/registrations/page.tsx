"use client";

import React, { useEffect, useState } from "react";
import { 
    CheckCircle2, 
    XCircle, 
    Home, 
    User, 
    Clock, 
    ShieldCheck,
    Building2,
    FileText,
    Smartphone,
    Search,
    Loader2,
    MapPin,
    AlertCircle
} from "lucide-react";
import { getPendingRegistrations, updateRegistrationStatus } from "@/app/actions/registrations";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export default function AdminRegistrationsPage() {
    const [registrations, setRegistrations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        fetchRegistrations();
    }, []);

    const fetchRegistrations = async () => {
        setLoading(true);
        const data = await getPendingRegistrations();
        setRegistrations(data);
        setLoading(false);
    };

    const handleAction = async (id: string, status: "APPROVED" | "REJECTED") => {
        setProcessingId(id);
        const res = await updateRegistrationStatus(id, status);
        setProcessingId(null);
        if (res.success) {
            toast.success(status === "APPROVED" ? "Registro aprobado correctamente" : "Registro rechazado");
            fetchRegistrations();
        } else {
            toast.error("Error al procesar el registro");
        }
    };

    return (
        <div className="p-4 md:p-8 space-y-8 bg-[#0a0a0a] min-h-screen text-white">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-800 pb-8">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
                        <CheckCircle2 className="text-[#8b5cf6]" size={32} />
                        Solicitudes PWA
                    </h1>
                    <p className="text-neutral-500 text-xs font-bold uppercase tracking-widest mt-1">
                        Autorización de registros sugeridos por guardias
                    </p>
                </div>
                <Button 
                    onClick={fetchRegistrations} 
                    variant="outline" 
                    className="bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-400 font-bold uppercase text-[10px] tracking-widest"
                >
                    <Clock className="mr-2" size={14} /> Refrescar
                </Button>
            </header>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <Loader2 className="text-[#8b5cf6] animate-spin" size={48} />
                    <p className="text-neutral-500 font-black uppercase tracking-widest text-[10px]">Cargando solicitudes...</p>
                </div>
            ) : registrations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4 bg-neutral-900/40 rounded-[2.5rem] border border-dashed border-neutral-800">
                    <ShieldCheck className="text-neutral-800" size={64} />
                    <p className="text-neutral-500 font-black uppercase tracking-widest text-xs">No hay solicitudes pendientes</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {registrations.map((reg) => (
                            <motion.div
                                key={reg.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="bg-neutral-900 border border-neutral-800 rounded-[2rem] overflow-hidden flex flex-col shadow-2xl shadow-black/50 group"
                            >
                                <div className={cn(
                                    "p-6 flex items-center justify-between border-b border-white/5",
                                    reg.type === "HOUSE" ? "bg-indigo-600/10" : "bg-emerald-600/10"
                                )}>
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg",
                                            reg.type === "HOUSE" ? "bg-indigo-600 text-white" : "bg-emerald-600 text-white"
                                        )}>
                                            {reg.type === "HOUSE" ? <Home size={20} /> : <User size={20} />}
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase text-neutral-500 tracking-widest leading-none mb-1">
                                                {reg.type === "HOUSE" ? "SUGERENCIA CASA" : "SUGERENCIA PERSONA"}
                                            </p>
                                            <p className="text-sm font-black text-white">
                                                {reg.data.name || reg.data.houseNumber || "Sin nombre"}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className="bg-amber-600/20 text-amber-500 border-amber-600/20 text-[8px] font-black uppercase tracking-tighter">
                                        PENDIENTE
                                    </Badge>
                                </div>

                                <div className="p-6 flex-1 space-y-4 bg-black/20">
                                    {reg.type === "HOUSE" ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-neutral-400">
                                                <Building2 size={14} />
                                                <span className="text-xs font-bold">Nro: <span className="text-white">{reg.data.houseNumber}</span></span>
                                            </div>
                                            <div className="flex items-center gap-2 text-neutral-400">
                                                <MapPin size={14} />
                                                <span className="text-xs font-bold">Dirección: <span className="text-white">{reg.data.address || "---"}</span></span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-neutral-400">
                                                <FileText size={14} />
                                                <span className="text-xs font-bold">DNI: <span className="text-white">{reg.data.dni || "---"}</span></span>
                                            </div>
                                            <div className="flex items-center gap-2 text-neutral-400">
                                                <Smartphone size={14} />
                                                <span className="text-xs font-bold">Tel: <span className="text-white">{reg.data.phone || "---"}</span></span>
                                            </div>
                                            <div className="flex items-center gap-2 text-neutral-400">
                                                <Home size={14} />
                                                <span className="text-xs font-bold">Unidad: <span className="text-white">{reg.data.unitId || "No asignada"}</span></span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-4 mt-4 border-t border-neutral-800">
                                        <div className="flex items-center gap-2 text-neutral-500">
                                            <AlertCircle size={12} />
                                            <span className="text-[10px] font-bold uppercase">Sugerido por: <span className="text-[#8b5cf6]">{reg.guardName}</span></span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-neutral-900 grid grid-cols-2 gap-3 border-t border-neutral-800">
                                    <Button
                                        disabled={processingId === reg.id}
                                        onClick={() => handleAction(reg.id, "REJECTED")}
                                        variant="outline"
                                        className="border-red-600/20 text-red-600 hover:bg-red-600 hover:text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all h-10"
                                    >
                                        <XCircle className="mr-2" size={14} /> Rechazar
                                    </Button>
                                    <Button
                                        disabled={processingId === reg.id}
                                        onClick={() => handleAction(reg.id, "APPROVED")}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all h-10 shadow-lg shadow-emerald-900/20"
                                    >
                                        {processingId === reg.id ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 className="mr-2" size={14} />}
                                        Autorizar
                                    </Button>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
