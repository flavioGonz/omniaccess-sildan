import React, { useEffect, useState } from "react";
import { 
    Activity, 
    Car, 
    User as UserIcon, 
    CreditCard, 
    DoorOpen, 
    CheckCircle2, 
    XCircle, 
    Phone, 
    LogIn, 
    LogOut,
    Truck,
    Bus,
    Bike
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getCarLogo } from "@/lib/car-logos";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { getImagePath } from "@/lib/image-path";

export interface FullAccessEvent extends AccessEvent {
    user: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        dni: string | null;
        apartment: string | null;
        cara: string | null;
        unit: Unit | null;
        parkingSlotId: string | null;
    } | null;
    device: Device | null;
    hasDoorOpen?: boolean;
    hasDoorClose?: boolean;
}

export const TimeAgo = React.memo(({ timestamp }: { timestamp: string | Date }) => {
    const [label, setLabel] = useState("");

    useEffect(() => {
        const update = () => {
            const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
            if (diff < 0) {
                setLabel("Ahora");
                return;
            }
            if (diff < 60) setLabel(`Hace ${diff}s`);
            else if (diff < 3600) setLabel(`Hace ${Math.floor(diff / 60)}m`);
            else if (diff < 86400) setLabel(`Hace ${Math.floor(diff / 3600)}h`);
            else setLabel(`Hace ${Math.floor(diff / 86400)}d`);
        };
        update();
        const interval = setInterval(update, 5000); // 5s instead of 1s for performance
        return () => clearInterval(interval);
    }, [timestamp]);

    return <span>{label}</span>;
});

TimeAgo.displayName = "TimeAgo";

interface EventItemProps {
    event: FullAccessEvent;
    plateCountsToday: Record<string, number>;
    calculateDuration: (event: FullAccessEvent) => { label: string; value: string; color: string } | null;
}

export const EventItem = React.memo(({ event, plateCountsToday, calculateDuration }: EventItemProps) => {
    const isCall = event.plateDetected === 'CALL_START';

    const typeConfig = {
        PLATE: { icon: Car, color: "blue", label: "LPR", bgClass: "bg-blue-500/10", textClass: "text-blue-400" },
        FACE: { icon: UserIcon, color: "purple", label: "FACE", bgClass: "bg-purple-500/10", textClass: "text-purple-400" },
        TAG: { icon: CreditCard, color: "amber", label: "RFID", bgClass: "bg-amber-500/10", textClass: "text-amber-400" },
        DOOR: { icon: DoorOpen, color: "emerald", label: "DOOR", bgClass: "bg-emerald-500/10", textClass: "text-emerald-400" },
        CALL: { icon: Phone, color: "orange", label: "CALL", bgClass: "bg-orange-500/10", textClass: "text-orange-400" }
    };

    const config = isCall ? typeConfig.CALL : (typeConfig[event.accessType as keyof typeof typeConfig] || typeConfig.TAG);
    const TypeIcon = config.icon;

    // Parse details into meta object
    const meta: any = {};
    if (event.details) {
        event.details.split(',').forEach(p => {
            const [k, v] = p.split(':').map(s => s.trim());
            if (k && v) meta[k] = v;
        });
    }

    if (meta.Marca) {
        let cleanBrand = meta.Marca.replace(/\s*UNKNOWN\s*/gi, '').trim();
        const brandCodeMatch = cleanBrand.match(/BRAND\s*(\d+)/i);
        if (brandCodeMatch) {
            cleanBrand = getVehicleBrandName(brandCodeMatch[1]);
        }
        meta.Marca = cleanBrand;
    }

    let callDest = "Central";
    if (isCall && event.details) {
        const match = event.details.match(/a:\s*(\S+)/);
        if (match) callDest = match[1];
        else if (event.details.includes('Central')) callDest = 'Central';
        else callDest = event.details;
    }

    const logoUrl = getCarLogo(meta.Marca);
    const plateKey = event.plateDetected && event.plateDetected !== 'unknown' && event.plateDetected !== 'NO_LEIDA' && !isCall ? event.plateDetected : (event.user?.id || 'sys');
    const plateCount = plateCountsToday[plateKey] || 0;

    const getImageUrl = (path: string | null | undefined): string => {
        return getImagePath(path) || "";
    };

    const timeStatus = calculateDuration(event);

    const isAnomalous = event.accessType === "PLATE" && (
        event.plateDetected === "NO_LEIDA" ||
        event.plateDetected === "unknown" ||
        event.plateDetected === "S/P" ||
        !event.plateDetected
    );

    const faceName = event.user?.name || meta.Rostro;

    return (
        <EventDetailsDialog event={event} timeStatus={timeStatus}>
            <div className={cn(
                "p-4 cursor-pointer transition-all group border-b border-white/5 last:border-0 border-l-[3px]",
                isAnomalous
                    ? "bg-yellow-500/10 border-l-yellow-500 hover:bg-yellow-500/20"
                    : isCall
                        ? "bg-blue-900/10 border-l-blue-500 hover:bg-blue-900/20"
                        : "hover:bg-white/5 border-l-transparent hover:border-l-indigo-500"
            )}>
                <div className="flex items-center gap-3">
                    <div className={cn("rounded-lg shrink-0 flex items-center justify-center p-0.5", "bg-neutral-900 border border-white/10 shadow-sm overflow-hidden", "w-14 h-11 relative")}>
                        {(() => {
                            const src = getImageUrl(event.snapshotPath || event.imagePath) || (event.accessType !== 'PLATE' ? getImageUrl(event.user?.cara) : "");

                            if (isCall) {
                                return (
                                    <div className="relative w-full h-full">
                                        {src ? (
                                            <Image src={src} alt="Snap" fill sizes="56px" className="object-cover opacity-80" />
                                        ) : (
                                            <div className={cn("w-full h-full flex items-center justify-center", config.bgClass)}>
                                                <TypeIcon size={18} className={config.textClass} />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-75" />
                                                <Phone size={14} className="text-white relative z-10 drop-shadow-md" fill="currentColor" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            if (src && (event.accessType === 'FACE' || event.accessType === 'PLATE')) {
                                return <Image src={src} alt="Snapshot" fill sizes="56px" className="object-cover scale-110" />;
                            }

                            if (event.accessType === 'TAG' && !event.plateDetected?.startsWith('DOOR')) {
                                return (
                                    <div className={cn("w-full h-full rounded flex items-center justify-center", "bg-amber-500/10")}>
                                        <CreditCard size={18} className="text-amber-400" />
                                    </div>
                                );
                            }

                            if (logoUrl) {
                                return (
                                    <div className="relative w-full h-full p-1 bg-white">
                                        <Image src={logoUrl} alt="Logo" fill sizes="44px" className="object-contain" />
                                    </div>
                                );
                            }

                            return (
                                <div className={cn("w-full h-full rounded flex items-center justify-center", config.bgClass)}>
                                    <TypeIcon size={18} className={config.textClass} />
                                </div>
                            );
                        })()}
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                {event.accessType === "PLATE" ? (
                                    <div className={cn("flex flex-col border border-neutral-800 rounded-sm overflow-hidden min-w-[80px] mt-0.5",
                                        event.plateDetected === "NO_LEIDA" ? "bg-red-600 border-red-500" : "bg-white")}>
                                        <div className="h-0.5 bg-blue-600 w-full" />
                                        <p className={cn("text-[12px] font-black tracking-widest uppercase px-2 py-0.5 text-center font-mono leading-none",
                                            event.plateDetected === "NO_LEIDA" ? "text-white text-[9px]" : "text-black")}>
                                            {event.plateDetected === "NO_LEIDA" ? "No Leída" : event.plateDetected}
                                        </p>
                                    </div>
                                ) : event.accessType === "TAG" && !isCall && event.plateDetected !== 'DOOR_OPEN' && event.plateDetected !== 'DOOR_CLOSE' ? (
                                    <div className="flex items-center gap-2">
                                        <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg px-2.5 py-1 flex items-center gap-2">
                                            <CreditCard size={14} className="text-amber-400" />
                                            <span className="text-sm font-black text-amber-400 uppercase tracking-wider font-mono">
                                                {event.plateDetected || 'TARJETA'}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className={cn("text-sm font-black truncate tracking-tight uppercase", isCall ? "text-blue-400" : "text-white")}>
                                        {isCall
                                            ? `LLAMADA DE ${event.device?.name?.replace('AKUVOX ', '') || 'PORTERO'}`
                                            : (event.plateDetected === 'DOOR_OPEN' || event.plateDetected === 'DOOR_CLOSE')
                                                ? "CONTROL DE PUERTA"
                                                : (event.accessType === 'FACE')
                                                    ? (faceName || "ROSTRO DETECTADO")
                                                    : (event.user?.name || event.plateDetected || "ID: " + event.id.slice(-4))}
                                    </p>
                                )}

                                <div className="flex items-center gap-1 ml-2">
                                    {event.hasDoorOpen && (
                                        <div title="Puerta Abierta" className="bg-emerald-500/20 text-emerald-400 p-0.5 rounded border border-emerald-500/30">
                                            <DoorOpen size={10} />
                                        </div>
                                    )}
                                    {event.hasDoorClose && (
                                        <div title="Puerta Cerrada" className="bg-indigo-500/20 text-indigo-400 p-0.5 rounded border border-indigo-500/30">
                                            <LogOut size={10} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate italic">
                                    {event.accessType === 'PLATE' ? (
                                        [meta.Marca, meta.Modelo, meta.Tipo]
                                            .filter(val => val && !['unknown', 'null', 'undefined'].includes(val.toLowerCase()))
                                            .join(' • ') || 'Vehículo Detectado'
                                    ) : isCall ? (
                                        `A: ${callDest}`
                                    ) : (event.plateDetected === 'DOOR_OPEN' || event.plateDetected === 'DOOR_CLOSE') ? (
                                        event.device?.name || 'ACCIONAMIENTO MANUAL'
                                    ) : (event.accessType === 'FACE') ? (
                                        (() => {
                                            const simVal = meta['Similitud']?.match(/(\d+)/)?.[1];
                                            return simVal ? `${simVal}% Similitud` : (faceName ? 'IDENTIFICADO POR CAMARA' : 'ROSTRO NO IDENTIFICADO');
                                        })()
                                    ) : (event.accessType === 'TAG') ? (
                                        event.device?.name || 'LECTOR RFID'
                                    ) : (
                                        `SIMILITUD: ${meta.Similitud || 'VERIFICADO'}`
                                    )}
                                </p>
                            </div>
                            {meta.Color && (
                                <div className="w-2 h-2 rounded-full border border-white/20" style={{ backgroundColor: meta.Color.toLowerCase() === 'blanco' ? '#fff' : meta.Color.toLowerCase() === 'negro' ? '#000' : meta.Color }} />
                            )}
                        </div>
                        {event.user?.name && event.accessType === "PLATE" && (
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">
                                {event.user.name}
                            </p>
                        )}
                        {event.user?.name && event.accessType === "TAG" && (
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">
                                {event.user.name}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-2">
                            {plateCount > 1 && event.plateDetected !== "NO_LEIDA" && event.plateDetected !== "unknown" && !isCall && (
                                <Badge className="bg-white/5 text-neutral-400 border-white/10 text-[9px] font-black px-1.5 h-5 flex items-center justify-center">
                                    {plateCount}x Hoy
                                </Badge>
                            )}
                            <div className={cn(
                                "px-2 py-1.5 rounded-lg font-black text-[10px] uppercase text-center tracking-tighter shadow-lg flex items-center justify-center gap-1.5 min-w-[80px]",
                                isCall
                                    ? "bg-blue-600 text-white shadow-blue-900/40 border border-blue-500/30 animate-pulse"
                                    : (event.plateDetected === 'DOOR_OPEN')
                                        ? "bg-emerald-600 text-white shadow-emerald-900/40 border border-emerald-500/30"
                                        : (event.plateDetected === 'DOOR_CLOSE')
                                            ? "bg-neutral-600 text-white shadow-neutral-900/40 border border-neutral-500/30"
                                            : event.decision === "GRANT"
                                                ? "bg-emerald-600 text-white shadow-emerald-900/40 border border-emerald-500/30"
                                                : "bg-red-600 text-white shadow-red-900/40 border border-red-500/30"
                            )}>
                                {isCall
                                    ? <><Phone size={12} fill="currentColor" /> LLAMANDO</>
                                    : (event.plateDetected === 'DOOR_OPEN')
                                        ? <><DoorOpen size={12} /> ABIERTA</>
                                        : (event.plateDetected === 'DOOR_CLOSE')
                                            ? <><LogOut size={12} /> CERRADA</>
                                            : event.decision === "GRANT"
                                                ? <><CheckCircle2 size={12} /> PERMITIDO</>
                                                : <><XCircle size={12} /> DENEGADO</>
                                }
                            </div>
                        </div>
                        <span className="text-[10px] font-mono text-neutral-500 font-bold">
                            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </div>
                </div>
            </div>
        </EventDetailsDialog >
    );
});

EventItem.displayName = "EventItem";
