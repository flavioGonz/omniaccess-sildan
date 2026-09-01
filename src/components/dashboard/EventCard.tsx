"use client";

import Image from "next/image";
import { AccessEvent, User, Device, Unit } from "@prisma/client";
import { Car, User as UserIcon, ShieldCheck, ShieldAlert, ArrowRightCircle, ArrowLeftCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import { EventDetailsDialog } from "./EventDetailsDialog";
import { VehicleMetaChips } from "@/components/VehicleMeta";

type FullAccessEvent = AccessEvent & {
    user: (User & { unit: Unit | null, cara?: string | null }) | null;
    device: Device | null;
};

interface EventCardProps {
    event: FullAccessEvent;
}

export function EventCard({ event }: EventCardProps) {
    const isGrant = event.decision === "GRANT";
    const isEntry = event.device?.direction === "ENTRY";
    const userFaceUrl = event.user?.cara;
    const plateImageUrl = event.imagePath;

    return (
        <EventDetailsDialog event={event}>
            <div className={`
                bg-card/40 border rounded-xl overflow-hidden relative cursor-pointer group
                transition-all duration-500 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)] hover:-translate-y-1.5
                ${isGrant ? "border-emerald-500/20 hover:border-emerald-500/50" : "border-red-500/20 hover:border-red-500/50"}
                backdrop-blur-sm
            `}>
                {/* Images Section */}
                {/* Images Section */}
                <div className="flex h-20 relative">
                    {event.accessType === "FACE" && plateImageUrl ? (
                        <>
                            {/* Full Scene Background */}
                            <div className="absolute inset-0 bg-[#080808]">
                                <Image
                                    src={plateImageUrl}
                                    alt="Scene Capture"
                                    fill
                                    sizes="250px"
                                    className="object-cover group-hover:scale-110 transition-transform duration-700 opacity-80 group-hover:opacity-100"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                            </div>

                            {/* Overlay User Face */}
                            {userFaceUrl && (
                                <div className="absolute bottom-1 right-1 w-10 h-14 rounded border border-border bg-black overflow-hidden shadow-xl z-10 group-hover:scale-110 transition-transform origin-bottom-right">
                                    <Image
                                        src={userFaceUrl}
                                        alt="User Face"
                                        fill
                                        sizes="50px"
                                        className="object-cover"
                                    />
                                </div>
                            )}

                            {/* Quick Status Tag */}
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-blue-500/80 text-foreground text-[7px] font-bold uppercase tracking-widest backdrop-blur-md border border-border shadow-lg z-20">
                                FACE ID
                            </div>
                        </>
                    ) : (
                        <>
                            {/* User Face Image */}
                            <div className="w-1/2 bg-background relative flex items-center justify-center overflow-hidden">
                                {userFaceUrl ? (
                                    <Image src={userFaceUrl} alt="User Face" fill sizes="50vw" className="object-cover group-hover:scale-125 transition-transform duration-700 opacity-60 group-hover:opacity-100" />
                                ) : (
                                    <UserIcon size={24} className="text-muted-foreground" />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            {/* Plate Capture Image */}
                            <div className="w-1/2 bg-[#080808] relative flex items-center justify-center border-l border-border overflow-hidden">
                                {plateImageUrl ? (
                                    <Image src={plateImageUrl} alt="Plate Capture" fill sizes="50vw" className="object-cover group-hover:scale-125 transition-transform duration-700 opacity-60 group-hover:opacity-100" />
                                ) : (
                                    <Car size={24} className="text-muted-foreground" />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>

                            {/* Quick Status Tag */}
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[7px] font-bold uppercase tracking-widest backdrop-blur-md border border-border shadow-lg z-10">
                                Intel
                            </div>
                        </>
                    )}
                </div>

                {/* Info Section */}
                <div className="p-5 space-y-4">
                    {/* Plate & Decision */}
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <h3 className="text-xl font-bold tracking-widest text-foreground group-hover:text-blue-400 transition-colors uppercase font-mono leading-none">
                                {(event.plateDetected || event.accessType || "EVENT").replace(/_/g, " ")}
                            </h3>
                            <div className="flex items-center gap-1.5">
                                <div className={cn(
                                    "px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest border",
                                    isGrant ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                )}>
                                    {isGrant ? "AUTH" : "DENY"}
                                </div>
                                <div className={cn(
                                    "px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest border",
                                    isEntry ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                )}>
                                    {isEntry ? "IN" : "OUT"}
                                </div>
                            </div>
                            <VehicleMetaChips details={(event as any).details} size="sm" className="pt-1" />
                        </div>

                        <div className={cn(
                            "p-1.5 rounded-lg border transition-all duration-500",
                            isGrant ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 group-hover:rotate-12" : "bg-red-500/10 text-red-400 border-red-500/20 group-hover:rotate-[-12deg]"
                        )}>
                            {isGrant ? <ShieldCheck size={16} strokeWidth={2.5} /> : <ShieldAlert size={16} strokeWidth={2.5} />}
                        </div>
                    </div>

                    {/* Subject Info */}
                    <div className="flex items-center gap-2 p-2 bg-black/40 rounded-lg border border-border group-hover:border-blue-500/20 transition-colors">
                        <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center text-muted-foreground overflow-hidden relative">
                            {userFaceUrl ? (
                                <Image src={userFaceUrl} alt="Subject" fill sizes="24px" className="object-cover" />
                            ) : (
                                <UserIcon size={12} />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold text-foreground truncate leading-none mb-0.5">
                                {event.user?.name || "Desconocido"}
                            </p>
                            <p className="text-[7px] text-muted-foreground font-bold uppercase tracking-widest truncate">
                                {event.user?.unit?.name || "Externo"}
                            </p>
                        </div>
                    </div>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center text-[8px] font-bold text-muted-foreground uppercase tracking-widest pt-0">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-muted" />
                            {new Date(event.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <span className="truncate max-w-[80px]">{event.device?.name || "Root"}</span>
                    </div>
                </div>
            </div>
        </EventDetailsDialog>
    );
}
