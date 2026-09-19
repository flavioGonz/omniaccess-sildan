"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, ShieldAlert, Clock, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getImagePath } from "@/lib/image-path";
import { hora } from "@/lib/fechas";

export default function SecurityFeed({ events, onEventClick }: { events: any[], onEventClick?: (event: any) => void }) {
    return (
        <div className="flex flex-col h-full bg-black/40 backdrop-blur-3xl border-l border-border p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
                <div>
                    <h3 className="text-xl font-bold text-foreground uppercase tracking-tighter">Eventos en Vivo</h3>
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">OmniAccess Biometric Feed</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-widest leading-none">Live</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2">
                <AnimatePresence mode="popLayout">
                    {events.map((event, idx) => (
                        <motion.div
                            key={event.id || idx}
                            layout
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            onClick={() => onEventClick?.(event)}
                            className={cn(
                                "group relative p-4 rounded-2xl border transition-all hover:bg-accent cursor-pointer active:scale-95",
                                event.user?.role === 'BLACKLISTED' || event.decision === 'DENY'
                                    ? "bg-red-950/20 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                                    : "bg-foreground/10 border-border"
                            )}
                        >
                            <div className="flex items-center gap-4">
                                {/* Thumbnail */}
                                <div className="w-16 h-16 rounded-xl overflow-hidden border border-border shrink-0 bg-card relative">
                                    <img
                                        src={getImagePath(event.snapshotPath) || "/placeholder-face.jpg"}
                                        alt=""
                                        className="w-full h-full object-cover grayscale brightness-110 group-hover:grayscale-0 transition-all duration-500"
                                    />
                                    {event.decision === 'GRANT' ? (
                                        <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5 border border-black shadow-lg">
                                            <CheckCircle2 size={10} className="text-foreground" />
                                        </div>
                                    ) : (
                                        <div className="absolute top-1 right-1 bg-red-600 rounded-full p-0.5 border border-black shadow-lg">
                                            <XCircle size={10} className="text-foreground" />
                                        </div>
                                    )}
                                </div>

                                {/* Data */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className={cn(
                                            "text-sm font-bold uppercase tracking-tight truncate",
                                            !event.user || event.decision === 'DENY' ? "text-red-500" : "text-foreground"
                                        )}>
                                            {event.user?.name || "DESCONOCIDO"}
                                        </h4>
                                        <span className="text-[10px] font-mono text-muted-foreground">
                                            {hora(new Date(event.timestamp))}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase truncate">
                                            {event.device?.name || "Neural Terminal"}
                                        </p>
                                        {(event.user?.role === 'BLACKLISTED' || event.decision === 'DENY') && (
                                            <Badge className="bg-red-600/20 border-red-600/40 text-red-500 text-[8px] font-bold h-4 px-1 leading-none uppercase tracking-widest rounded-none">
                                                CRITICAL
                                            </Badge>
                                        )}
                                    </div>
                                </div>

                                <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 3px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
            `}</style>
        </div>
    );
}
