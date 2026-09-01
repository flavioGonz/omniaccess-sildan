"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Camera, Upload, Image as ImageIcon, Trash2, ChevronDown, Ban, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFaceDevices, updateDevicePosition, deleteDevicePosition } from "@/app/actions/devices";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { sileo as toast } from "sileo";
import { getImagePath } from "@/lib/image-path";

interface CameraNode {
    id: string;
    name: string;
    x: number;
    y: number;
    floorPlanId?: string | null;
    direction?: 'ENTRY' | 'EXIT';
    lastActive?: boolean;
}

interface FloorPlan {
    id: string;
    name: string;
    imagePath: string;
}

export default function FaceDashboardMap({
    lastEventId,
    lastEvent,
    blacklistPopups = [],
    onClosePopup,
    currentFloorPlan,
    floorPlans = []
}: {
    lastEventId?: string,
    lastEvent?: any,
    blacklistPopups?: any[],
    onClosePopup?: (id: string) => void,
    currentFloorPlan: FloorPlan | null,
    floorPlans: FloorPlan[]
}) {
    const [cameras, setCameras] = useState<CameraNode[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const [allFaceDevices, setAllFaceDevices] = useState<any[]>([]);

    useEffect(() => {
        const loadInitial = async () => {
            const devices = await getFaceDevices();
            setAllFaceDevices(devices);

            const nodes: CameraNode[] = devices
                .filter(d => d.mapX !== null && d.mapY !== null)
                .map(d => ({
                    id: d.id,
                    name: d.name,
                    x: d.mapX as number,
                    y: d.mapY as number,
                    floorPlanId: d.floorPlanId,
                    direction: d.direction as any,
                }));
            setCameras(nodes);
        };
        loadInitial();
    }, []);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        if (!mapRef.current) return;
        const rect = mapRef.current.getBoundingClientRect();
        setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const placeCamera = async (camId: string) => {
        if (!contextMenu || !currentFloorPlan) return;
        const device = allFaceDevices.find(d => d.id === camId);
        if (!device) return;
        const newNode: CameraNode = {
            id: camId,
            name: device.name,
            x: contextMenu.x - 20,
            y: contextMenu.y - 20,
            floorPlanId: currentFloorPlan.id,
            direction: device.direction
        };
        setCameras(prev => [...prev.filter(c => c.id !== camId), newNode]);
        await updateDevicePosition(camId, newNode.x, newNode.y, currentFloorPlan.id);
        setContextMenu(null);
        toast.success({ title: `Cámara ubicada en ${currentFloorPlan.name}` });
    };

    const removeCamera = async (e: React.MouseEvent, camId: string) => {
        e.stopPropagation();
        setCameras(prev => prev.filter(c => c.id !== camId));
        await deleteDevicePosition(camId);
        toast.info({ title: "Cámara retirada del plano" });
    };

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    return (
        <div ref={mapRef} className="relative w-full h-full bg-[#050505] overflow-hidden rounded-2xl" onContextMenu={handleContextMenu}>
            <div className="absolute inset-0 w-full h-full">
                {contextMenu && (
                    <div className="absolute z-[100] bg-[#0A0A0A] border border-border rounded-xl shadow-lg py-2 min-w-[220px] backdrop-blur-xl" style={{ top: contextMenu.y, left: contextMenu.x }}>
                        <div className="px-4 py-2 border-b border-border mb-2"><p className="text-[8px] font-bold uppercase text-muted-foreground tracking-widest">UBICAR DISPOSITIVO</p></div>
                        {allFaceDevices.map(device => (
                            <button key={device.id} onClick={() => placeCamera(device.id)} className="w-full text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:bg-[#B20D30] hover:text-foreground transition-all flex items-center justify-between group">
                                {device.name} <Camera size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        ))}
                    </div>
                )}

                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#B20D30 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

                {currentFloorPlan ? (
                    <img src={currentFloorPlan.imagePath} className="absolute inset-0 w-full h-full object-cover opacity-40 grayscale sepia-[0.2] hue-rotate-[320deg]" alt="Floor Plan" />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20 gap-4">
                        <ImageIcon size={64} className="text-muted-foreground" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-muted-foreground">No Floor Plan Configured</p>
                    </div>
                )}

                {cameras
                    .filter(cam => cam.floorPlanId === currentFloorPlan?.id)
                    .map((cam) => {
                        const isEntry = cam.direction !== 'EXIT';
                        const isActive = cam.id === lastEventId;
                        const relevantBlacklist = blacklistPopups?.find(e => e.deviceId === cam.id);

                        return (
                            <motion.div
                                key={cam.id}
                                initial={{ x: cam.x, y: cam.y }}
                                animate={{ x: cam.x, y: cam.y }}
                                drag dragMomentum={false}
                                onDragEnd={(_, info) => {
                                    const newX = cam.x + info.offset.x;
                                    const newY = cam.y + info.offset.y;
                                    setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, x: newX, y: newY } : c));
                                    updateDevicePosition(cam.id, newX, newY, currentFloorPlan?.id);
                                }}
                                style={{ position: 'absolute', top: 0, left: 0 }}
                                className="z-20 cursor-move"
                            >
                                <div className="group relative flex flex-col items-center justify-center">
                                    {isActive && <div className="absolute inset-0 -m-4 rounded-full border-[3px] border-red-600 animate-ping opacity-70 pointer-events-none" />}

                                    {relevantBlacklist && <BlacklistPopup event={relevantBlacklist} onClose={() => onClosePopup?.(relevantBlacklist.id)} />}

                                    {isActive && !relevantBlacklist && lastEvent?.snapshotPath && (
                                        <motion.div initial={{ opacity: 0, scale: 0, y: 10 }} animate={{ opacity: 1, scale: 1, y: -45 }} className="absolute bottom-full mb-1 w-14 h-14 rounded-full border-2 border-red-600 overflow-hidden shadow-lg z-50 bg-black">
                                            <img src={getImagePath(lastEvent.snapshotPath) || ""} className="w-full h-full object-cover" alt="Detected" />
                                        </motion.div>
                                    )}

                                    <div className={cn(
                                        "w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center relative z-10",
                                        relevantBlacklist ? "bg-red-700 border-white shadow-[0_0_30px_#B20D30]" :
                                            (isActive ? "bg-red-600 border-white shadow-[0_0_20px_#dc2626] animate-pulse" :
                                                (isEntry ? "bg-emerald-500/80 border-emerald-400" : "bg-orange-500/80 border-orange-400"))
                                    )}>
                                        {relevantBlacklist ? (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Ban size={12} className="text-foreground" />
                                            </div>
                                        ) : (
                                            <Camera size={12} className="text-foreground" />
                                        )}
                                    </div>

                                    <div className="absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                        <div className="bg-black/90 border border-border px-3 py-1.5 rounded-lg text-center shadow-xl">
                                            <p className="text-[10px] font-bold text-foreground uppercase">{cam.name}</p>
                                            <p className={cn("text-[7px] font-bold uppercase mt-0.5", isEntry ? "text-emerald-500" : "text-orange-500")}>
                                                {isEntry ? "ENTRADA" : "SALIDA"}
                                            </p>
                                            <button onClick={(e) => removeCamera(e, cam.id)} className="mt-2 p-1 hover:bg-red-500/20 rounded text-red-500 pointer-events-auto transition-all">
                                                <Trash2 size={10} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
            </div>
        </div>
    );
}

function BlacklistPopup({ event, onClose }: { event: any, onClose: () => void }) {
    const [elapsed, setElapsed] = useState("");
    useEffect(() => {
        const update = () => {
            const diff = Math.floor((Date.now() - new Date(event.timestamp || event.createdAt).getTime()) / 1000);
            setElapsed(`${Math.floor(diff / 60)}:${(diff % 60).toString().padStart(2, '0')}`);
        };
        update();
        const itv = setInterval(update, 1000);
        return () => clearInterval(itv);
    }, [event]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: -55 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
            exit={{ opacity: 0, scale: 0, y: 10 }}
            className="absolute bottom-full mb-2 w-28 bg-black/95 backdrop-blur-md border border-red-600 rounded-xl shadow-[0_0_40px_rgba(220,38,38,0.4)] z-[60] p-1.5"
        >
            <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-card border border-border mb-1.5 group/pop">
                <img src={getImagePath(event.snapshotPath) || ""} className="w-full h-full object-cover" alt="Blacklist" />
                <div className="absolute inset-0 bg-gradient-to-t from-red-900/40 to-transparent opacity-0 group-hover/pop:opacity-100 transition-opacity" />

                {/* Smaller Close Button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    className="absolute top-1 right-1 h-5 w-5 bg-red-600 text-foreground rounded-full flex items-center justify-center hover:bg-red-700 shadow-xl pointer-events-auto transition-transform hover:scale-110"
                >
                    <X size={10} />
                </button>

                {/* Multi-capture hint icon */}
                <div className="absolute bottom-1 right-1 flex gap-0.5">
                    <div className="w-1 h-1 rounded-full bg-foreground/10" />
                    <div className="w-1 h-1 rounded-full bg-foreground/10" />
                    <div className="w-1 h-1 rounded-full bg-red-600 animate-pulse" />
                </div>
            </div>

            <div className="flex flex-col items-center">
                <div className="flex items-center gap-1.5">
                    <div className="w-1 h-1 bg-red-500 rounded-full animate-ping" />
                    <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest leading-none">ALERTA ROJA</span>
                </div>
                <div className="flex items-center gap-1 mt-1 opacity-40">
                    <Clock size={7} className="text-foreground" />
                    <span className="text-[7px] font-mono text-foreground tracking-widest">{elapsed}</span>
                </div>
            </div>

            {/* Tactical Tail */}
            <div className="absolute top-[99%] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-red-600" />
        </motion.div>
    );
}
