"use client";

import React, { useState } from "react";
import { 
    Calendar as CalendarIcon, 
    X, 
    Clock, 
    User, 
    Building2, 
    Camera, 
    Play, 
    Eye, 
    Shield,
    ArrowUpRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface BitacoraTableProps {
    entries: any[];
}

export default function BitacoraTable({ entries }: BitacoraTableProps) {
    const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
    const [selectedAudio, setSelectedAudio] = useState<string | null>(null);

    const formatTime = (date: Date | string) => {
        const d = new Date(date);
        return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date | string) => {
        const d = new Date(date);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    return (
        <>
            <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                    <tr className="bg-black/40 border-b border-neutral-800">
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Multimedia</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Matrícula</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Tipo</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Visitante</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Destino</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Fecha/Hora</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest">Registrado por</th>
                        <th className="px-6 py-5 text-[10px] font-black text-neutral-500 uppercase tracking-widest text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                    {entries.length > 0 ? (
                        entries.map((entry) => (
                            <tr key={entry.id} className="group hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex gap-2">
                                        {entry.photoPath ? (
                                            <button
                                                onClick={() => setSelectedPhoto(entry.photoPath)}
                                                className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 overflow-hidden flex items-center justify-center hover:shadow-lg transition-all"
                                            >
                                                <img src={entry.photoPath} className="w-full h-full object-cover" alt="Capture" />
                                            </button>
                                        ) : (
                                            <div className="w-10 h-10 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center text-neutral-800">
                                                <Camera size={16} />
                                            </div>
                                        )}
                                        {entry.audioPath && (
                                            <button
                                                onClick={() => setSelectedAudio(entry.audioPath)}
                                                className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"
                                            >
                                                <Play size={16} className="fill-current" />
                                            </button>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 font-black text-white tracking-widest uppercase text-sm">
                                    {entry.plate || '--- ---'}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={cn(
                                        "px-2 py-0.5 rounded-lg text-[9px] font-black border tracking-wider",
                                        entry.type === 'ENTRY'
                                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                            : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                    )}>
                                        {entry.type === 'ENTRY' ? 'ENTRADA' : 'SALIDA'}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-xs font-bold text-white">{entry.name || 'Invitado'}</p>
                                </td>
                                <td className="px-6 py-4 text-xs font-bold text-neutral-400">
                                    {entry.destination || '---'}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-black text-white">{formatTime(entry.timestamp)}</p>
                                        <p className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">{formatDate(entry.timestamp)}</p>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <Shield size={10} className="text-neutral-600" />
                                        <span className="text-[10px] font-bold text-neutral-300 uppercase">{entry.guardName || entry.guard?.name || 'Sistema'}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button
                                        onClick={() => {
                                            if (entry.photoPath) setSelectedPhoto(entry.photoPath);
                                            else if (entry.audioPath) setSelectedAudio(entry.audioPath);
                                        }}
                                        className="w-8 h-8 rounded-lg bg-neutral-800 text-neutral-500 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all ml-auto"
                                    >
                                        <ArrowUpRight size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={8} className="py-24 text-center">
                                <p className="text-[10px] font-black text-neutral-700 uppercase tracking-widest">Sin registros encontrados</p>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>

            {/* Lightbox Photo */}
            <AnimatePresence>
                {selectedPhoto && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-4 md:p-12"
                        onClick={() => setSelectedPhoto(null)}
                    >
                        <motion.button
                            className="absolute top-8 right-8 p-4 bg-white/10 hover:bg-white/20 backdrop-blur-2xl rounded-full text-white transition-all shadow-2xl"
                            onClick={() => setSelectedPhoto(null)}
                        >
                            <X size={24} />
                        </motion.button>
                        <motion.img
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            src={selectedPhoto}
                            alt="Full Size Capture"
                            className="max-w-full max-h-full object-contain rounded-3xl shadow-2xl border border-white/5"
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Audio Modal */}
            <AnimatePresence>
                {selectedAudio && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                        className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] w-full max-w-lg px-4"
                    >
                        <div className="bg-neutral-900/90 backdrop-blur-2xl border border-white/10 p-8 rounded-[3rem] shadow-2xl shadow-emerald-500/10 flex flex-col items-center text-center">
                            <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4">
                                <Play size={32} className="fill-current" />
                            </div>
                            <h4 className="text-lg font-black text-white uppercase tracking-widest mb-2">Nota de Audio</h4>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-6">Reproduciendo evidencia operativa</p>

                            <audio
                                autoPlay
                                controls
                                src={selectedAudio}
                                className="w-full h-12 brightness-90 saturate-150 contrast-125 rounded-full"
                            />

                            <button
                                onClick={() => setSelectedAudio(null)}
                                className="mt-8 px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white text-[10px] font-black uppercase tracking-widest rounded-full transition-colors"
                            >
                                Cerrar Reproductor
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
