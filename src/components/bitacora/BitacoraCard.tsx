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
    Shield 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { fecha, hora } from "@/lib/fechas";

interface BitacoraCardProps {
    entry: any;
}

export default function BitacoraCard({ entry }: BitacoraCardProps) {
    const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
    const [selectedAudio, setSelectedAudio] = useState<string | null>(null);

    const formatTime = (date: Date | string) => {
        const d = new Date(date);
        return hora(d);
    };

    const formatDate = (date: Date | string) => {
        const d = new Date(date);
        return fecha(d);
    };

    return (
        <>
            <motion.div
                className="group bg-card border border-border rounded-2xl overflow-hidden hover:border-blue-500/40 transition-all shadow-xl hover:shadow-blue-500/5 h-full flex flex-col"
            >
                <div className="relative h-48 bg-black overflow-hidden">
                    {entry.photoPath ? (
                        <img
                            src={entry.photoPath}
                            alt="Capture"
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-70 group-hover:opacity-100"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Camera size={48} />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-transparent opacity-60" />

                    {/* Action Buttons */}
                    <div className="absolute inset-0 flex items-center justify-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/50 backdrop-blur-[2px]">
                        {entry.photoPath && (
                            <button
                                onClick={() => setSelectedPhoto(entry.photoPath)}
                                className="p-4 bg-card text-foreground rounded-lg hover:scale-110 transition-transform shadow-lg"
                            >
                                <Eye size={20} />
                            </button>
                        )}
                        {entry.audioPath && (
                            <button
                                onClick={() => setSelectedAudio(entry.audioPath)}
                                className="p-4 bg-emerald-500 text-foreground rounded-lg hover:scale-110 transition-transform shadow-lg shadow-emerald-500/20"
                            >
                                <Play size={20} className="fill-current" />
                            </button>
                        )}
                    </div>

                    {/* Type Badge */}
                    <div className={cn(
                        "absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border backdrop-blur-md",
                        entry.type === 'ENTRY'
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : "bg-amber-500/20 text-amber-500 border-amber-500/30"
                    )}>
                        {entry.type === 'ENTRY' ? 'ENTRADA' : 'SALIDA'}
                    </div>

                    {/* Time Badge */}
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-border flex items-center gap-2">
                        <Clock size={12} className="text-muted-foreground" />
                        <span className="text-[10px] font-bold text-foreground uppercase">{formatTime(entry.timestamp)}</span>
                    </div>
                </div>

                <div className="p-6 space-y-4 flex-1 flex flex-col">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <h3 className="text-2xl font-bold text-foreground tracking-widest uppercase">{entry.plate || 'S/M'}</h3>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <CalendarIcon size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">{formatDate(entry.timestamp)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border/50">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
                                <User size={14} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1">Visitante</p>
                                <p className="text-xs font-bold text-foreground truncate">{entry.name || 'Invitado Desconocido'}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0">
                                <Building2 size={14} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1">Destino</p>
                                <p className="text-xs font-bold text-foreground truncate">{entry.destination || '---'}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
                                <Shield size={14} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1">Registrado por</p>
                                <p className="text-xs font-bold text-foreground truncate">{entry.guardName || entry.guard?.name || 'Sistema'}</p>
                            </div>
                        </div>
                    </div>

                    {entry.notes && (
                        <div className="mt-auto pt-4">
                            <div className="p-4 bg-background/50 rounded-lg border border-border/50">
                                <p className="text-[10px] text-muted-foreground italic leading-relaxed line-clamp-2">
                                    &quot;{entry.notes}&quot;
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>

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
                            className="absolute top-8 right-8 p-4 bg-foreground/10 hover:bg-foreground/10 backdrop-blur-2xl rounded-full text-foreground transition-all shadow-lg"
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
                            className="max-w-full max-h-full object-contain rounded-xl shadow-lg border border-border"
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
                        <div className="bg-card/90 backdrop-blur-2xl border border-border p-8 rounded-2xl shadow-lg shadow-emerald-500/10 flex flex-col items-center text-center">
                            <div className="w-16 h-16 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 mb-4">
                                <Play size={32} className="fill-current" />
                            </div>
                            <h4 className="text-lg font-bold text-foreground uppercase tracking-widest mb-2">Nota de Audio</h4>
                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-6">Reproduciendo evidencia operativa</p>

                            <audio
                                autoPlay
                                controls
                                src={selectedAudio}
                                className="w-full h-12 brightness-90 saturate-150 contrast-125 rounded-full"
                            />

                            <button
                                onClick={() => setSelectedAudio(null)}
                                className="mt-8 px-8 py-3 bg-muted hover:bg-muted text-foreground text-[10px] font-bold uppercase tracking-widest rounded-full transition-colors"
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
