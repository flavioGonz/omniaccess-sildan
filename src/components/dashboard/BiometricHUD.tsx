"use client";

import React from "react";
import { motion } from "framer-motion";
import { Shield, Target, Scan, Activity, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImagePath } from "@/lib/image-path";

interface BiometricHUDProps {
    lastEvent?: any;
    verification?: {
        verified: boolean;
        similarity: number;
        loading: boolean;
        error?: string;
    };
}

export default function BiometricHUD({ lastEvent, verification }: BiometricHUDProps) {
    const isScanning = !lastEvent;

    return (
        <div className="relative w-full h-full flex items-center justify-center p-8">
            {/* Background HUD Rings */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                {[...Array(3)].map((_, i) => (
                    <motion.div
                        key={i}
                        animate={{
                            rotate: i % 2 === 0 ? 360 : -360,
                            scale: [1, 1.05, 1],
                            opacity: [0.1, 0.2, 0.1]
                        }}
                        transition={{
                            rotate: { duration: 20 + i * 10, repeat: Infinity, ease: "linear" },
                            scale: { duration: 5, repeat: Infinity, ease: "easeInOut" },
                            opacity: { duration: 3, repeat: Infinity, ease: "easeInOut" }
                        }}
                        className={cn(
                            "absolute border border-[#B20D30]/30 rounded-full",
                            i === 0 ? "w-[80%] aspect-square" : i === 1 ? "w-[60%] aspect-square border-dashed" : "w-[40%] aspect-square"
                        )}
                    />
                ))}
            </div>

            {/* Central Bio-Scanner Viewport */}
            <div className="relative w-[500px] aspect-square rounded-full border-2 border-[#B20D30]/20 bg-black/40 backdrop-blur-3xl overflow-hidden shadow-[0_0_100px_rgba(178,13,48,0.2)]">
                {/* Scanning Beam */}
                <motion.div
                    animate={{ top: ["-10%", "110%"] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#B20D30] to-transparent z-10 shadow-[0_0_20px_#B20D30]"
                />

                {/* Content: Either the face or a searching icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                    {lastEvent ? (
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="w-full h-full relative"
                        >
                            <img
                                src={getImagePath(lastEvent.snapshotPath) || "/placeholder-face.jpg"}
                                alt="Subject"
                                className={cn(
                                    "w-full h-full object-cover grayscale brightness-125 sepia-[0.2] hue-rotate-[320deg] transition-all duration-1000",
                                    verification?.verified ? "sepia-0 hue-rotate-0 brightness-100 grayscale-0" : ""
                                )}
                            />
                            <div className={cn(
                                "absolute inset-0 bg-gradient-to-t from-[#B20D30]/40 via-transparent to-transparent transition-colors duration-1000",
                                verification?.verified ? "from-emerald-500/30" : ""
                            )} />

                            {/* Face Grid Overlay */}
                            <div className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none"
                                style={{ backgroundImage: 'linear-gradient(#B20D30 1px, transparent 1px), linear-gradient(90deg, #B20D30 1px, transparent 1px)', backgroundSize: '20px 20px' }}
                            />

                            {/* Tracking Squares */}
                            <motion.div
                                animate={{ opacity: [0, 1, 0] }}
                                transition={{ duration: 0.5, repeat: Infinity }}
                                className={cn(
                                    "absolute border-2 border-[#B20D30] w-32 h-32 top-1/4 left-1/4 rounded-sm",
                                    verification?.verified ? "border-emerald-500" : ""
                                )}
                            />
                        </motion.div>
                    ) : (
                        <div className="flex flex-col items-center gap-6 opacity-40">
                            <motion.div
                                animate={{ scale: [1, 1.2, 1] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                <Scan size={80} className="text-[#B20D30]" />
                            </motion.div>
                            <p className="text-[#B20D30] text-xs font-bold uppercase tracking-[0.5em] animate-pulse">Scanning...</p>
                        </div>
                    )}
                </div>

                {/* Corner Accents */}
                <div className="absolute top-8 left-8 w-8 h-8 border-t-2 border-l-2 border-[#B20D30]" />
                <div className="absolute top-8 right-8 w-8 h-8 border-t-2 border-r-2 border-[#B20D30]" />
                <div className="absolute bottom-8 left-8 w-8 h-8 border-b-2 border-l-2 border-[#B20D30]" />
                <div className="absolute bottom-8 right-8 w-8 h-8 border-b-2 border-r-2 border-[#B20D30]" />
            </div>

            {/* Float Data Points */}
            <div className="absolute inset-0 pointer-events-none">
                <HUDDataPoint x="15%" y="20%" label="BIOMETRIC ID" value={lastEvent?.userId ? `USR-${lastEvent.userId.substring(0, 8)}` : "SENTINEL-X9"} />

                {verification?.loading ? (
                    <HUDDataPoint x="80%" y="15%" label="NEURAL VERIFICATION" value="PROCESSING..." color="text-amber-500" />
                ) : verification ? (
                    <HUDDataPoint
                        x="80%" y="15%"
                        label="NEURAL MATCH"
                        value={`${(verification.similarity * 100).toFixed(1)}%`}
                        color={verification.verified ? "text-emerald-500 shadow-[0_0_10px_#10b981]" : "text-red-500"}
                    />
                ) : (
                    <HUDDataPoint x="80%" y="15%" label="MATCH RATE" value="98.4%" />
                )}

                <HUDDataPoint x="10%" y="70%" label="DATABASE" value="MALL-SEC" />
                <HUDDataPoint
                    x="85%" y="75%"
                    label="STATUS"
                    value={verification ? (verification.verified ? "VERIFIED" : "MISMATCH") : "ARMED"}
                    color={verification ? (verification.verified ? "text-emerald-500 font-bold" : "text-red-600 font-bold") : "text-emerald-500"}
                />
            </div>
        </div>
    );
}

function HUDDataPoint({ x, y, label, value, color = "text-[#B20D30]" }: any) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute"
            style={{ top: y, left: x }}
        >
            <div className="bg-black/80 border-l-2 border-[#B20D30] px-4 py-2 backdrop-blur-md">
                <p className="text-[8px] text-muted-foreground font-bold tracking-widest leading-none mb-1">{label}</p>
                <p className={cn("text-xs font-bold tracking-tighter leading-none", color)}>{value}</p>
            </div>
            <motion.div
                animate={{ width: [0, 50, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="h-[1px] bg-gradient-to-r from-[#B20D30] to-transparent"
            />
        </motion.div>
    );
}
