"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from 'next/dynamic';
import { MapPin, Shield, Users, Loader2, Maximize2 } from "lucide-react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";

// Dynamic import for Leaflet-based map to avoid SSR issues
const LiveGuardMap = dynamic(() => import('@/components/LiveGuardMap'), { 
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex flex-col items-center justify-center bg-card animate-pulse">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Cargando Mapa Táctico...</p>
        </div>
    )
});

export default function GuardMapTab() {
    const [guardLocations, setGuardLocations] = useState<any[]>([]);
    const [activeGuards, setActiveGuards] = useState(0);
    const socketRef = useRef<any>(null);

    useEffect(() => {
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl);
        socketRef.current = socket;

        socket.on("guard_locations", (locations: any[]) => {
            setGuardLocations(locations);
            setActiveGuards(locations.length);
        });

        // Request initial locations
        socket.emit("get_guard_locations");

        return () => {
            socket.disconnect();
        };
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in duration-1000">
            <div className="flex items-center justify-between px-2">
                <div>
                    <h2 className="text-2xl font-bold text-foreground uppercase tracking-tight">Mapa de Vigilancia</h2>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">Localización GPS de personal en tiempo real</p>
                </div>
                
                <div className="flex gap-4">
                    <div className="bg-card border border-border rounded-2xl px-6 py-3 flex items-center gap-3 shadow-lg">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none mb-1">Activos</span>
                            <span className="text-sm font-bold text-foreground uppercase tabular-nums">{activeGuards} Guardias</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="relative w-full aspect-video md:aspect-[21/9] bg-card rounded-2xl border border-border overflow-hidden shadow-lg">
                <LiveGuardMap guards={guardLocations} myLocation={null} socketId={null} />
                
                {/* Overlay UI */}
                <div className="absolute top-6 left-6 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md border border-border rounded-2xl p-4 shadow-lg">
                        <div className="flex items-center gap-3 text-foreground">
                            <MapPin className="text-blue-500" size={18} />
                            <span className="text-xs font-bold uppercase tracking-widest">Perímetro Operativo</span>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                    <div className="bg-black/60 backdrop-blur-md border border-border rounded-xl p-2 text-white/40 hover:text-white cursor-pointer transition-colors">
                        <Maximize2 size={20} />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                        <Shield size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Cobertura</p>
                        <p className="text-sm font-bold text-foreground uppercase tracking-tight">Área Total Protegida</p>
                    </div>
                </div>
                <div className="p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Sincronización</p>
                        <p className="text-sm font-bold text-foreground uppercase tracking-tight">Actualización &lt; 5s</p>
                    </div>
                </div>
                <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                        <MapPin size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Geolocalización</p>
                        <p className="text-sm font-bold text-foreground uppercase tracking-tight">Precisión GPS Alta</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
