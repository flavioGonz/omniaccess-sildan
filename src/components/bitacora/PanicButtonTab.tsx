"use client";

import React, { useState, useEffect, useRef } from "react";
import { Siren, Shield, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function PanicButtonTab() {
    const [isAlertMode, setIsAlertMode] = useState(false);
    const [panicHoldProgress, setPanicHoldProgress] = useState(0);
    const socketRef = useRef<any>(null);
    const panicHoldInterval = useRef<any>(null);

    useEffect(() => {
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl, { path: "/io/socket.io", transports: ["polling"], upgrade: false,  path: "/io/socket.io", transports: ["polling"], upgrade: false, });
        socketRef.current = socket;

        socket.on("alert_status", (data: { active: boolean }) => {
            setIsAlertMode(data.active);
        });

        return () => {
            socket.disconnect();
            if (panicHoldInterval.current) clearInterval(panicHoldInterval.current);
        };
    }, []);

    const toggleAlert = (active: boolean) => {
        if (socketRef.current) {
            socketRef.current.emit("alert_toggle", {
                active,
                triggeredBy: "Administrador"
            });
            toast(active ? "Alerta de Emergencia Activada" : "Sistema Normalizado");
        }
    };

    const startPanicHold = () => {
        if (isAlertMode) return;
        let start = Date.now();
        panicHoldInterval.current = setInterval(() => {
            let elapsed = Date.now() - start;
            let progress = Math.min((elapsed / 2000) * 100, 100);
            setPanicHoldProgress(progress);
            if (progress >= 100) {
                clearInterval(panicHoldInterval.current);
                toggleAlert(true);
                setPanicHoldProgress(0);
                if ("vibrate" in navigator) navigator.vibrate([100, 50, 100, 50, 400]);
            }
        }, 50);
    };

    const cancelPanicHold = () => {
        if (panicHoldInterval.current) {
            clearInterval(panicHoldInterval.current);
            panicHoldInterval.current = null;
        }
        setPanicHoldProgress(0);
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[500px] space-y-12">
            <div className="text-center space-y-4">
                <div className="flex items-center justify-center gap-4 mb-2">
                    <div className={cn(
                        "p-4 rounded-2xl border transition-all duration-500",
                        isAlertMode ? "bg-red-500/20 border-red-500/50 shadow-lg shadow-red-500/20" : "bg-card border-border"
                    )}>
                        <Shield className={cn(isAlertMode ? "text-red-500" : "text-muted-foreground")} size={48} />
                    </div>
                </div>
                <h2 className="text-2xl font-bold text-foreground uppercase tracking-tighter">Centro de Emergencias</h2>
                <p className="text-xs text-muted-foreground font-bold uppercase tracking-[0.3em]">Protocolo de seguridad omniaccess</p>
            </div>

            <div className="relative">
                <AnimatePresence mode="wait">
                    {isAlertMode ? (
                        <motion.div
                            key="active"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="flex flex-col items-center gap-8"
                        >
                            <button
                                onClick={() => toggleAlert(false)}
                                className="w-64 h-64 rounded-full bg-white border-8 border-red-600 flex flex-col items-center justify-center shadow-[0_0_80px_rgba(220,38,38,0.4)] hover:scale-105 transition-transform group"
                            >
                                <CheckCircle2 size={64} className="text-red-600 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold text-red-600 uppercase tracking-widest">Normalizar</span>
                            </button>
                            <p className="text-sm font-bold text-red-500 uppercase tracking-widest animate-pulse">SISTEMA EN MODO ALERTA</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="idle"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="flex flex-col items-center gap-8"
                        >
                            <div className="relative group">
                                {/* Pulse Effect */}
                                <div className="absolute inset-0 rounded-full bg-red-600/20 animate-ping" />
                                
                                <button
                                    onMouseDown={startPanicHold}
                                    onMouseUp={cancelPanicHold}
                                    onMouseLeave={cancelPanicHold}
                                    onTouchStart={startPanicHold}
                                    onTouchEnd={cancelPanicHold}
                                    className="relative w-64 h-64 rounded-full bg-red-600 border-8 border-red-800/50 flex flex-col items-center justify-center shadow-lg hover:bg-red-500 transition-colors active:scale-95 touch-none select-none"
                                >
                                    <Siren size={80} className="text-foreground mb-4 animate-bounce" />
                                    <span className="text-xs font-bold text-foreground uppercase tracking-[0.2em]">Pánico</span>
                                    
                                    {/* Progress Ring */}
                                    {panicHoldProgress > 0 && (
                                        <svg className="absolute inset-0 w-full h-full -rotate-90">
                                            <circle
                                                cx="128"
                                                cy="128"
                                                r="124"
                                                fill="transparent"
                                                stroke="white"
                                                strokeWidth="8"
                                                strokeDasharray="779"
                                                strokeDashoffset={779 - (779 * panicHoldProgress) / 100}
                                                className="transition-all duration-75"
                                            />
                                        </svg>
                                    )}
                                </button>
                            </div>
                            <div className="max-w-xs text-center">
                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
                                    PRESIONE Y MANTENGA DURANTE 2 SEGUNDOS PARA ACTIVAR LA ALERTA GLOBAL
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="grid grid-cols-3 gap-6 w-full max-w-2xl pt-8 border-t border-border/50">
                <div className="text-center py-4 px-6 rounded-2xl bg-card/40 border border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Estado</p>
                    <p className={cn("text-xs font-bold uppercase tracking-widest", isAlertMode ? "text-red-500" : "text-emerald-500")}>
                        {isAlertMode ? "Alerta Activa" : "Vigilancia Activa"}
                    </p>
                </div>
                <div className="text-center py-4 px-6 rounded-2xl bg-card/40 border border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Protocolo</p>
                    <p className="text-xs font-bold text-foreground uppercase tracking-widest">Nivel 4</p>
                </div>
                <div className="text-center py-4 px-6 rounded-2xl bg-card/40 border border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Conexión</p>
                    <div className="flex items-center justify-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <p className="text-xs font-bold text-foreground uppercase tracking-widest">Estable</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
