"use client";

import React, { useRef, useState, useEffect } from "react";
import {
    X, Camera, Loader2, RefreshCcw, ShieldAlert, UserCheck,
    UserX, Zap, History, CheckCircle2, ScanFace,
    FlipHorizontal
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import { createBitacoraEntry } from "@/app/actions/bitacora";
import { sileo as toast } from "sileo";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface FaceScannerOverlayProps {
    onClose: () => void;
    guardName: string;
    location?: { lat: number, lng: number } | null;
    recentEntries?: any[];
    cameraFacingMode?: "user" | "environment";
    toggleCameraFacingMode?: () => void;
}

export default function FaceScannerOverlay({ onClose, guardName, location, recentEntries = [], cameraFacingMode = "user", toggleCameraFacingMode }: FaceScannerOverlayProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [isActive, setIsActive] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isResolving, setIsResolving] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [internalFacingMode, setInternalFacingMode] = useState<"user" | "environment">("user");

    const facingMode = cameraFacingMode || internalFacingMode;
    const toggleFacingMode = toggleCameraFacingMode || (() => setInternalFacingMode(prev => prev === "user" ? "environment" : "user"));

    // Result form states
    const [formName, setFormName] = useState("");
    const [formDni, setFormDni] = useState("");
    const [formUnit, setFormUnit] = useState("");
    const [formNotes, setFormNotes] = useState("");

    const startCamera = async () => {
        try {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setIsActive(true);
        } catch (err) {
            console.error("Camera access error:", err);
            toast.error({ title: "No se pudo acceder a la cámara" });
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setIsActive(false);
    };

    useEffect(() => {
        startCamera();
        return () => stopCamera();
    }, [facingMode]);

    const captureAndAnalyze = async () => {
        if (!videoRef.current || !canvasRef.current) return;

        setIsAnalyzing(true);
        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Mirror if user mode
            if (facingMode === "user") {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }

            ctx.drawImage(video, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const searchResult = await searchByPhotoAction(buffer as any);

            if (searchResult.success) {
                setResult({
                    ...searchResult,
                    capturedImage: dataUrl
                });
                setFormName(searchResult.user?.name || searchResult.match?.subject || "");
                setFormDni(searchResult.user?.dni || "");
                setFormUnit(searchResult.user?.unit?.name || "");
                setFormNotes("");

                if (searchResult.user) {
                    toast.success({ title: `Identificado: ${searchResult.user.name}` });
                } else if (searchResult.match) {
                    toast.info({ title: `Match: ${searchResult.match.subject}` });
                }
            } else {
                toast.error({ title: searchResult.error || "Falla en el motor neural" });
            }
        } catch (err) {
            console.error("Analysis error:", err);
            toast.error({ title: "Error al procesar biometría" });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleQuickRegister = async () => {
        setIsResolving(true);
        try {
            const formData = new FormData();
            formData.append("type", "ENTRY");
            formData.append("name", formName || "Sujeto Desconocido");
            formData.append("dni", formDni || "---");
            formData.append("destination", formUnit || "");
            formData.append("notes", formNotes || "Validación Biométrica Live");
            formData.append("guardName", guardName || "Admin Sentinel");

            if (location) {
                formData.append("latitude", location.lat.toString());
                formData.append("longitude", location.lng.toString());
            }

            if (result?.capturedImage) {
                const res = await fetch(result.capturedImage);
                const blob = await res.blob();
                formData.append("photo", blob, "live_face.jpg");
            }

            const entry = await createBitacoraEntry(formData);
            if (entry) {
                toast.success({ title: "Registro completado con éxito" });
                onClose();
            }
        } catch (err) {
            console.error(err);
            toast.error({ title: "Error al guardar registro" });
        } finally {
            setIsResolving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col font-sans overflow-hidden">
            {/* MAIN VIEWPORT: ALWAYS SHOW CAMERA FOR LIVE FEED */}
            <div className="absolute inset-0 z-0">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={cn(
                        "w-full h-full object-cover transition-transform duration-500",
                        facingMode === 'user' ? "scale-x-[-1]" : ""
                    )}
                />

                {/* Tactical Scanning Overlay (Only if not showing result) */}
                <AnimatePresence>
                    {!result && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        >
                            <div className="w-64 h-64 md:w-80 md:h-80 rounded-full border-2 border-dashed border-border relative">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                    className="absolute -inset-2 border-2 border-t-red-600 border-r-transparent border-b-transparent border-l-transparent rounded-full opacity-30"
                                />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-center">
                                        <ScanFace className="w-12 h-12 text-muted-foreground mb-2 mx-auto" />
                                        <p className="text-[7px] font-bold uppercase tracking-[0.5em] text-muted-foreground">Biometric Scan Active</p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* HEADER: COMPACT & TACTICAL */}
            <header className="relative z-50 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#B20D30] flex items-center justify-center shadow-lg">
                        <ScanFace size={20} className="text-foreground" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-widest leading-none">Guard Scanner</h2>
                        <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-red-500 mt-0.5">Tactical Deployment</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={toggleFacingMode} className="w-10 h-10 rounded-xl bg-foreground/10 backdrop-blur-md border border-border flex items-center justify-center hover:bg-foreground/10 transition-all">
                        <RefreshCcw size={18} />
                    </button>
                    <button onClick={onClose} className="w-10 h-10 rounded-xl bg-red-600/80 backdrop-blur-md border border-red-500/30 flex items-center justify-center hover:bg-red-600 transition-all">
                        <X size={18} />
                    </button>
                </div>
            </header>

            {/* ACTION FOOTER & HISTORY */}
            <div className="mt-auto relative z-50 p-4 pb-8 space-y-4">
                <AnimatePresence>
                    {!result && (
                        <motion.div
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 50, opacity: 0 }}
                            className="flex flex-col gap-4"
                        >
                            {/* History Scroll (Horizontal) */}
                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar no-scrollbar">
                                {recentEntries.slice(0, 10).map((entry, idx) => (
                                    <div key={idx} className="shrink-0 flex items-center gap-3 p-2 px-4 bg-black/40 backdrop-blur-md border border-border rounded-2xl min-w-[160px]">
                                        <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center text-muted-foreground border border-border shrink-0">
                                            <UserCheck size={14} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-bold uppercase tracking-tight truncate">{entry.name || entry.bitacora?.name || "Desconocido"}</p>
                                            <p className="text-[7px] font-bold uppercase text-muted-foreground tracking-widest">{new Date(entry.timestamp || entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* MAIN CAPTURE BUTTON */}
                            <button
                                onClick={captureAndAnalyze}
                                disabled={isAnalyzing}
                                className="w-full h-24 bg-white hover:bg-muted flex items-center justify-between px-8 rounded-2xl shadow-lg active:scale-[0.98] transition-all group"
                            >
                                <div className="flex flex-col text-left">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#B20D30]">Ejecutar Analítica</span>
                                    <span className="text-3xl font-bold text-black tracking-tighter uppercase leading-none">Escanear Rostro</span>
                                </div>
                                <div className={cn(
                                    "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                                    isAnalyzing ? "bg-amber-500 animate-spin" : "bg-red-600 shadow-xl shadow-red-600/20 group-hover:scale-110"
                                )}>
                                    {isAnalyzing ? <Loader2 size={24} className="text-foreground" /> : <Zap size={24} className="text-foreground" />}
                                </div>
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* SPLASH SCREEN RESULT MODAL */}
            <AnimatePresence>
                {result && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
                    >
                        {/* Backdrop Blur */}
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" />

                        {/* Modal Content */}
                        <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_50px_100px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col items-center p-8 gap-6 border-4 border-border">
                            {/* Close X Button */}
                            <button
                                onClick={() => setResult(null)}
                                className="absolute top-6 right-6 w-12 h-12 bg-black/5 hover:bg-black/10 rounded-full flex items-center justify-center text-black transition-all"
                            >
                                <X size={24} />
                            </button>

                            {/* Result Photo */}
                            <div className="w-40 h-40 rounded-2xl overflow-hidden border-4 border-[#B20D30]/10 shadow-lg shrink-0">
                                <Image src={result.capturedImage} width={160} height={160} className="object-cover w-full h-full" alt="Captured" />
                            </div>

                            {/* Identify Badge */}
                            <div className={cn(
                                "px-6 py-2 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2",
                                result.user
                                    ? (result.user.role === 'BLACKLISTED' ? "bg-red-600 text-foreground" : "bg-emerald-600 text-foreground")
                                    : (result.match ? "bg-amber-500 text-foreground" : "bg-muted text-foreground/70")
                            )}>
                                {result.user ? <UserCheck size={14} /> : <UserX size={14} />}
                                {result.user ? "Identidad Verificada" : (result.match ? "Match Neural Externo" : "No Encontrado")}
                            </div>

                            {/* Name & Title */}
                            <div className="text-center -mt-2">
                                <h3 className="text-4xl font-bold text-black uppercase tracking-tighter leading-none mb-2">
                                    {formName || "Desconocido"}
                                </h3>
                                {result.user?.unit && (
                                    <p className="text-sm font-bold text-red-600 uppercase tracking-widest">
                                        Destino: {result.user.unit.name}
                                    </p>
                                )}
                            </div>

                            {/* Compact Form */}
                            <div className="w-full grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[8px] font-bold uppercase text-black/30 tracking-widest ml-1">Corrección Manual</label>
                                    <input
                                        value={formName}
                                        onChange={e => setFormName(e.target.value)}
                                        className="w-full h-12 bg-muted border-none rounded-2xl px-5 text-black font-bold text-xs uppercase"
                                        placeholder="Nombre..."
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[8px] font-bold uppercase text-black/30 tracking-widest ml-1">Documento / ID</label>
                                    <input
                                        value={formDni}
                                        onChange={e => setFormDni(e.target.value)}
                                        className="w-full h-12 bg-muted border-none rounded-2xl px-5 text-black font-bold text-xs"
                                        placeholder="DNI..."
                                    />
                                </div>
                                <div className="space-y-1 col-span-2">
                                    <label className="text-[8px] font-bold uppercase text-black/30 tracking-widest ml-1">Observaciones</label>
                                    <input
                                        value={formNotes}
                                        onChange={e => setFormNotes(e.target.value)}
                                        className="w-full h-12 bg-muted border-none rounded-2xl px-5 text-black font-bold text-xs"
                                        placeholder="Notas adicionales..."
                                    />
                                </div>
                            </div>

                            {/* Master Finish Button */}
                            <button
                                onClick={handleQuickRegister}
                                disabled={isResolving}
                                className="w-full h-20 bg-emerald-600 hover:bg-emerald-500 text-foreground rounded-2xl font-bold uppercase tracking-widest text-sm shadow-xl shadow-emerald-900/40 active:scale-95 transition-all flex items-center justify-center gap-3 mt-2"
                            >
                                {isResolving ? <Loader2 className="animate-spin" /> : <><CheckCircle2 /> Confirmar Ingreso</>}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <canvas ref={canvasRef} className="hidden" />

            <style jsx>{`
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
}
