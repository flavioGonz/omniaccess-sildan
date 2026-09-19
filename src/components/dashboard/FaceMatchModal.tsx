"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X, Shield, User, MapPin, Clock, Fingerprint,
    CheckCircle2, AlertTriangle, Activity, Zap,
    ShieldCheck, Building2, Phone, Mail, IdCard,
    History, MessageSquare, MoreVertical
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { getImagePath } from "@/lib/image-path";
import { getAccessEvents } from "@/app/actions/history";
import { resolveFaceEventAction } from "@/app/actions/face-resolve";
import { verifyFaceAction, purgeSubjectFacesAction } from "@/app/actions/face-verify";
import { sileo as toast } from "sileo";
import { RefreshCcw, Scan, Loader2, Trash2, UserPlus, Database } from "lucide-react";
import { registerFace, toggleBlacklist } from "@/app/actions/users";
import { syncFaceToAllDevicesAction } from "@/app/actions/face-sync";
import { hora } from "@/lib/fechas";

interface FaceMatchModalProps {
    event: any;
    verification: any;
    isOpen: boolean;
    onClose: () => void;
}

const formatSubjectName = (name: string) => {
    if (!name) return "Sujeto Desconocido";
    if (name.startsWith("visita_")) {
        const parts = name.split("_");
        if (parts.length >= 4) {
            const dateStr = parts[1]; // 16022026
            const timeStr = parts[2]; // 1341
            const loc = parts[3]; // nauticodentro

            const day = dateStr.substring(0, 2);
            const month = dateStr.substring(2, 4);
            const hh = timeStr.substring(0, 2);
            const mm = timeStr.substring(2, 4);

            return `Visita ${day}/${month} ${hh}:${mm} (${loc.toUpperCase()})`;
        }
        return name.replace("visita_", "Visita ");
    }
    return name;
};

export function FaceMatchModal({ event, verification, isOpen, onClose }: FaceMatchModalProps) {
    const [history, setHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [comment, setComment] = useState("");
    const [isResolving, setIsResolving] = useState(false);
    const [verifState, setVerifState] = useState(verification);
    const [showFullScene, setShowFullScene] = useState(false);
    const [isPurging, setIsPurging] = useState(false);
    const [isAddingToBase, setIsAddingToBase] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);

    useEffect(() => {
        setVerifState(verification);
    }, [verification]);

    const handleReverify = async () => {
        setVerifState((prev: any) => ({ ...prev, loading: true }));
        try {
            const result = await verifyFaceAction(event.snapshotPath, event.userId || "", event.user?.name);
            setVerifState({ ...result, loading: false });
            if (result.success) {
                toast.success({
                    title: `STATUS: ANALISIS NEURAL REFRESCADO`,
                    description: `Nueva Coincidencia: ${((result.similarity || 0) * 100).toFixed(1)}%`
                });
            }
        } catch (err) {
            setVerifState((prev: any) => ({ ...prev, loading: false, error: true }));
            toast.error({ title: "Error en el motor de búsqueda neural" });
        }
    };

    useEffect(() => {
        if (isOpen) {
            const searchId = event?.userId;
            const searchName = event?.user?.name || verifState?.recognizedAs;

            if (searchId || searchName) {
                setLoadingHistory(true);
                // We pass name as search query which should ideally be the Face ID if we update getAccessEvents
                getAccessEvents({ userId: searchId, search: searchName, take: 5 })
                    .then(res => setHistory(res.events))
                    .catch(err => console.error("Error loading face history:", err))
                    .finally(() => setLoadingHistory(false));
            }
        }
    }, [isOpen, event?.userId, event?.user?.name, verifState?.recognizedAs]);

    if (!event) return null;

    const similarity = verifState?.similarity ? (verifState.similarity * 100).toFixed(1) : "0.0";
    const isVerified = verifState?.verified;
    const isBlacklisted = (event.user?.role === 'BLACKLISTED') || (verifState?.user?.role === 'BLACKLISTED');
    const isWhiteList = (event.user?.role === 'WHITELISTED') || (verifState?.user?.role === 'WHITELISTED');
    const isTempVisitor = event.user?.role === 'VISITOR' || event.user?.role === 'TEMPORARY_VISITOR';
    const isLoading = verifState?.loading;

    // Camera reported similarity
    const camMatchMatch = event.details?.match(/CamMatch: ([\d.]+)%/);
    const cameraMatchValue = camMatchMatch ? parseFloat(camMatchMatch[1]) : 0;
    const cameraMatch = camMatchMatch ? camMatchMatch[1] : null;
    const cameraParsedName = event.details?.match(/Persona: ([^,]+)/)?.[1];
    const cameraName = event.user?.name || (cameraParsedName !== 'N/A' ? cameraParsedName : null);

    // Alerta total para Blacklisted CONFIRMADO POR HARDWARE
    const isAlert = isBlacklisted && cameraMatchValue > 0;
    const isSuspicious = verifState?.isSuspicious || (isBlacklisted && cameraMatchValue === 0);
    const isConflict = verifState?.isConflict;
    const isSuccess = !isBlacklisted && !isWhiteList && !isConflict && !isSuspicious;
    const isSpecial = isWhiteList;

    const neuralName = verifState?.recognizedAs;
    const neuralSimilarity = verifState?.similarity ? (verifState.similarity * 100) : 0;

    // Discrepancy logic
    const isNeuralOnly = cameraMatchValue === 0 && neuralSimilarity > 0;
    const isDiscrepancy = cameraMatchValue > 0 && neuralSimilarity > 0 && cameraName !== neuralName;
    const isLowConfidence = verifState?.lowConfidence || (isNeuralOnly && neuralSimilarity < 95);

    const displayUser = verifState?.user || event.user;
    const rawName = neuralName || cameraName || "Sujeto Desconocido";
    const isIdentified = rawName !== "Sujeto Desconocido";
    const displayName = displayUser?.name || formatSubjectName(rawName);

    const titleColor = isAlert ? "text-red-600 drop-shadow-[0_0_20px_rgba(220,38,38,0.5)]" :
        (isBlacklisted && cameraMatchValue === 0) ? "text-amber-500 drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]" :
            isSpecial ? "text-[#2ecc71]" :
                "text-foreground";

    const handleResolve = async () => {
        if (isAlert && !comment) {
            toast.error({ title: "Por favor, ingrese un comentario para resolver la alerta" });
            return;
        }

        setIsResolving(true);
        try {
            const res = await resolveFaceEventAction(event.id, comment);
            if (res.success) {
                toast.success({ title: "Evento resuelto correctamente" });
                onClose();
            } else {
                toast.error({ title: res.error || "Error al resolver el evento" });
            }
        } catch (err) {
            toast.error({ title: "Error de conexión" });
        } finally {
            setIsResolving(false);
        }
    };

    const handleAddToBase = async (role: 'WHITELISTED' | 'BLACKLISTED') => {
        setIsAddingToBase(true);
        setSyncStatus(`CREANDO EN ${role}...`);
        try {
            // If the user already exists (identified by neural), we just toggle role
            let targetUserId = verifState?.user?.id || event.userId;
            let finalUser = verifState?.user;

            if (!targetUserId) {
                // Create user from scratch
                const formData = new FormData();
                formData.set("name", displayName);
                formData.set("dni", `AUTO-${Date.now()}`);
                formData.set("role", role);
                formData.set("isBlacklisted", role === 'BLACKLISTED' ? "true" : "false");
                formData.set("reason", comment || `Registro automático como ${role} desde Dashboard`);
                formData.set("creator", "Sistema");

                // Fetch the image to send it as a file
                const imgUrl = getImagePath(event.snapshotPath);
                if (!imgUrl) throw new Error("Snapshot image path not found");

                const resp = await fetch(imgUrl);
                const blob = await resp.blob();
                formData.set("photo", blob, "face.jpg");

                const res = await registerFace(formData);
                targetUserId = res.id;
                finalUser = res;
            } else {
                // Update existing user role
                if (role === 'BLACKLISTED') {
                    await toggleBlacklist(targetUserId, true, comment || "Actualizado a Blacklist desde Dashboard", "Sistema");
                } else {
                    // For whitelist we don't have a direct toggleWhiltelist yet, but toggleBlacklist(false) works if we update it
                    await toggleBlacklist(targetUserId, false, comment || "Promovido a Whitelist desde Dashboard", "Sistema");
                }
            }

            setSyncStatus("SINCRONIZANDO CAMARAS...");
            const syncRes = await syncFaceToAllDevicesAction(targetUserId);

            if (syncRes.success) {
                toast.success({
                    title: "ACCION COMPLETADA",
                    description: `${displayName} ahora es ${role} y cámaras actualizadas.`
                });
                onClose();
            } else {
                toast.show({
                    title: "REGISTRADO CON ERRORES DE SINCRONIZACION",
                    description: "El usuario se creó pero algunas cámaras no respondieron."
                });
            }
        } catch (err: any) {
            console.error("Error adding to base:", err);
            toast.error({ title: "Fallo al registrar en base de datos" });
        } finally {
            setIsAddingToBase(false);
            setSyncStatus(null);
        }
    };

    const handlePurge = async () => {
        if (!verifState?.recognizedAs || verifState?.recognizedAs === 'Desconocido') return;

        if (!confirm(`¿Está seguro de que desea limpiar el perfil de '${verifState.recognizedAs}'? Esto eliminará todas las fotos asociadas en el motor neural para corregir errores de reconocimiento.`)) {
            return;
        }

        setIsPurging(true);
        try {
            const res = await purgeSubjectFacesAction(verifState.recognizedAs, verifState.collection === 'Visitors');
            if (res.success) {
                toast.success({ title: "Perfil neural limpiado correctamente. Se requiere una nueva captura para re-entrenar." });
                handleReverify();
            } else {
                toast.error({ title: "Error al limpiar el perfil" });
            }
        } catch (err) {
            toast.error({ title: "Error de comunicación con el motor neural" });
        } finally {
            setIsPurging(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/90 backdrop-blur-md"
                    />

                    {/* Modal Container - Less Rounded, More Tactical */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{
                            opacity: 1,
                            scale: 1,
                            boxShadow: "0 0 100px rgba(0,0,0,1)"
                        }}
                        transition={{ duration: 0.3 }}
                        className={cn(
                            "relative w-full max-w-[1200px] aspect-video bg-card/95 backdrop-blur-2xl rounded-lg overflow-hidden border",
                            (isAlert || isBlacklisted || isSuspicious) ? "border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.2)]" : "border-border"
                        )}
                    >
                        {isAlert && (
                            <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
                                <motion.div
                                    animate={{ opacity: [0.1, 0.3, 0.1] }}
                                    transition={{ duration: 1.5, repeat: Infinity }}
                                    className="absolute inset-0 border-[4px] border-red-600/20"
                                />
                            </div>
                        )}
                        {/* Integrated Tactical View */}
                        <div className="flex-1 relative bg-card overflow-hidden h-full">
                            {/* Tactical Close Button */}
                            <div className="absolute top-6 right-6 z-50 flex items-center gap-3">
                                {/* Whitelist Button */}
                                {!isAlert && !isSpecial && (
                                    <button
                                        onClick={() => handleAddToBase('WHITELISTED')}
                                        disabled={isAddingToBase}
                                        className="w-10 h-10 rounded-full bg-emerald-600/20 hover:bg-emerald-600 text-emerald-500 hover:text-foreground flex items-center justify-center transition-all backdrop-blur-md border border-emerald-500/30 shadow-lg"
                                        title="Lista Blanca"
                                    >
                                        {isAddingToBase && syncStatus?.includes('WHITELISTED') ? (
                                            <Loader2 size={18} className="animate-spin" />
                                        ) : (
                                            <ShieldCheck size={18} />
                                        )}
                                    </button>
                                )}

                                {/* Blacklist Button */}
                                {!isAlert && !isSpecial && (
                                    <button
                                        onClick={() => handleAddToBase('BLACKLISTED')}
                                        disabled={isAddingToBase}
                                        className="w-10 h-10 rounded-full bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-foreground flex items-center justify-center transition-all backdrop-blur-md border border-red-500/30 shadow-lg"
                                        title="Lista Negra"
                                    >
                                        {isAddingToBase && syncStatus?.includes('BLACKLISTED') ? (
                                            <Loader2 size={18} className="animate-spin" />
                                        ) : (
                                            <UserPlus size={18} />
                                        )}
                                    </button>
                                )}

                                {/* Scene Toggle */}
                                <button
                                    onClick={() => setShowFullScene(!showFullScene)}
                                    className={cn(
                                        "w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-md border shadow-lg",
                                        showFullScene ? "bg-white text-black border-white" : "bg-black/40 text-white/60 border-border hover:text-white"
                                    )}
                                    title={showFullScene ? "Ver Detalle" : "Ver Escena Completa"}
                                >
                                    <Scan size={18} />
                                </button>

                                <button
                                    onClick={onClose}
                                    className="w-10 h-10 rounded-full bg-black/40 hover:bg-white/10 text-muted-foreground hover:text-white flex items-center justify-center transition-all backdrop-blur-md border border-border"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            {/* Full Scene Background */}
                            <Image
                                src={getImagePath(event.imagePath || event.snapshotPath) || "/placeholder.png"}
                                alt="Context"
                                fill
                                className={cn(
                                    "object-cover transition-all duration-700",
                                    showFullScene ? "opacity-100 grayscale-0" : "opacity-20 grayscale"
                                )}
                            />
                            <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-black/20" />

                            {/* Comparison HUD: Superimposed Vertically */}
                            <AnimatePresence>
                                {!showFullScene && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="absolute inset-y-0 left-10 flex flex-col justify-center gap-4 z-20"
                                    >
                                        {/* Captured Face Box */}
                                        <div className="group/cap relative">
                                            <div className={cn(
                                                "w-44 h-44 bg-black border-2 overflow-hidden relative",
                                                isAlert ? "border-red-600 shadow-[0_0_30px_rgba(220,38,38,0.3)]" :
                                                    isSpecial ? "border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]" :
                                                        "border-emerald-500"
                                            )}>
                                                <div className="absolute inset-0 bg-background animate-pulse" />
                                                <Image
                                                    src={getImagePath(event.snapshotPath) || "/placeholder.png"}
                                                    alt="Captured"
                                                    fill
                                                    className="object-cover"
                                                />
                                                {/* HUD Label */}
                                                <div className="absolute bottom-3 left-3 bg-black/40 backdrop-blur-md border border-border px-3 py-1.5 z-20">
                                                    <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/70">LIVE CAPTURE</span>
                                                </div>
                                                {/* Similarity Overlay */}
                                                <div className="absolute bottom-2 right-2 bg-black/80 border border-border px-2 py-1 z-20">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[7px] font-bold text-muted-foreground uppercase leading-none mb-0.5">
                                                            {isAlert ? "ALERTA" : "Cámara"}
                                                        </span>
                                                        <span className={cn("text-xs font-bold", isAlert ? "text-red-500" : "text-foreground")}>
                                                            {cameraMatch || similarity}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Link / Indicator Gap */}
                                        <div className="h-4 flex items-center justify-center relative">
                                            <div className="w-[1px] h-full bg-foreground/10" />
                                        </div>

                                        {/* Database Face Box */}
                                        <div className="group/db relative">
                                            <div className="w-44 h-44 bg-black border-2 border-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.3)] overflow-hidden relative">
                                                {displayUser?.cara ? (
                                                    <Image
                                                        src={getImagePath(displayUser.cara) || "/placeholder.png"}
                                                        alt="Database"
                                                        fill
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-background gap-2 border border-dashed border-border">
                                                        <User size={24} className="text-muted-foreground" />
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Rostro Base</span>
                                                            <span className="text-[10px] font-mono text-blue-400 font-bold uppercase">{verifState?.recognizedAs || "Sin ID"}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* HUD Label */}
                                                <div className="absolute bottom-3 left-3 bg-black/40 backdrop-blur-md border border-border px-3 py-1.5 z-20">
                                                    <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/70">ROSTRO EN BASE</span>
                                                </div>
                                                <div className="absolute bottom-2 right-2 bg-black/80 border border-border px-2 py-1 z-20">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[7px] font-bold text-muted-foreground uppercase leading-none mb-0.5">Neural</span>
                                                        <span className={cn("text-xs font-bold", isAlert ? "text-red-500" : "text-emerald-500")}>{similarity}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Tactical Info Layer: Floating borderless column */}
                            <AnimatePresence>
                                {!showFullScene && (
                                    <motion.div
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="absolute top-10 left-[480px] right-10 bottom-10 flex flex-col gap-6 z-30"
                                    >
                                        {/* Profile Heading */}
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 opacity-50 mb-2">
                                                <Fingerprint size={14} className="text-[#B20D30]" />
                                                <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Módulo de Identidad</span>
                                            </div>
                                            <h1 className={cn(
                                                "text-4xl font-bold uppercase tracking-tighter leading-none break-words max-w-sm",
                                                titleColor
                                            )}>
                                                {displayName}
                                            </h1>
                                            <div className="flex items-center gap-4 pt-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("w-3 h-3 rounded-full", isSpecial ? "bg-[#2ecc71]" : isConflict ? "bg-amber-600 animate-pulse" : isAlert ? "bg-red-600 animate-pulse" : isSuspicious ? "bg-amber-500" : isSuccess ? "bg-emerald-500" : "bg-muted")} />
                                                    <p className={cn(
                                                        "text-xs font-bold uppercase tracking-[0.2em]",
                                                        isConflict ? "text-amber-600 animate-pulse font-bold" :
                                                            isAlert ? "text-red-500 animate-pulse" :
                                                                isSuspicious ? "text-amber-500" :
                                                                    isSpecial ? "text-[#2ecc71]" :
                                                                        isNeuralOnly ? "text-blue-400" :
                                                                            "text-muted-foreground"
                                                    )}>
                                                        {isConflict ? "CONFLICTO DE IDENTIDAD - ERROR DE HARDWARE" :
                                                            isAlert ? "SOSPECHOSO - LISTA NEGRA (CONFIRMADO)" :
                                                                (isBlacklisted && cameraMatchValue === 0) ? "POSIBLE COINCIDENCIA LISTA NEGRA (SOLO NEURAL)" :
                                                                    isSuspicious ? "SOSPECHOSO - VERIFICACIÓN REQUERIDA" :
                                                                        isSpecial ? "Personal Autorizado (Lista Blanca)" :
                                                                            isNeuralOnly ? "Identificación Neural" :
                                                                                isTempVisitor ? "Visitante Temporal" :
                                                                                    "Identidad Confirmada"}
                                                    </p>
                                                </div>
                                                <div className="h-4 w-px bg-foreground/10" />
                                                <p className="text-xs font-mono font-bold text-blue-400/60 uppercase tracking-widest">
                                                    ID: {verifState?.recognizedAs || "Pending"}
                                                    {isNeuralOnly && <span className="ml-2 text-[8px] text-amber-500/50">(Solo Neural)</span>}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Recognition Analysis */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2">
                                                <Activity size={18} className="text-muted-foreground" />
                                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Estado de Comparación</span>
                                            </div>
                                            <div className="flex items-center gap-16">
                                                <div className="space-y-1">
                                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">Neural AI</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className={cn("text-3xl font-bold uppercase tracking-tighter", isSpecial ? "text-blue-500" : isSuccess ? "text-emerald-500" : "text-red-500")}>
                                                            {similarity}%
                                                        </span>
                                                        {neuralSimilarity > 0 && (
                                                            <button
                                                                onClick={handlePurge}
                                                                disabled={isPurging}
                                                                title="Limpiar perfil (Corregir error de match)"
                                                                className="p-1.5 rounded-full bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-foreground transition-all border border-red-500/20"
                                                            >
                                                                {isPurging ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">Cámara</span>
                                                    <span className="text-3xl font-bold text-foreground uppercase tracking-tighter">
                                                        {cameraMatch || "---"}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Field Grid */}
                                        <div className="grid grid-cols-2 gap-y-6 gap-x-12">
                                            <IdentityField icon={<IdCard size={16} />} label="Identificación" value={displayUser?.dni || "---"} />
                                            <IdentityField icon={<Building2 size={16} />} label="Unidad / Lote" value={displayUser?.unit?.name || "Visitante"} />
                                            <IdentityField icon={<MapPin size={16} />} label="Terminal" value={event.device?.name || "Access Point"} />
                                            <IdentityField icon={<MessageSquare size={16} />} label="Observaciones" value={displayUser?.observations || "Sin novedades."} />
                                        </div>

                                        {/* Integrated Case Resolution / Close Button requested by USER */}
                                        <div className="mt-auto flex flex-col gap-3">
                                            <div className="relative">
                                                <textarea
                                                    value={comment}
                                                    onChange={(e) => setComment(e.target.value)}
                                                    placeholder="Añadir observaciones sobre el sujeto..."
                                                    className={cn(
                                                        "w-full bg-black/40 border p-4 text-[11px] text-white outline-none transition-all rounded-lg placeholder:text-neutral-700 font-bold resize-none h-24",
                                                        isAlert ? "border-red-600/30 focus:border-red-600" : "border-border focus:border-border"
                                                    )}
                                                />
                                                <div className="absolute top-2 right-2 opacity-20">
                                                    <MessageSquare size={12} />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleResolve}
                                                    disabled={isResolving}
                                                    className={cn(
                                                        "w-full h-11 font-bold text-[9px] uppercase tracking-[0.2em] transition-all rounded-lg shadow-xl flex items-center justify-center gap-2",
                                                        isAlert ? "bg-red-600 text-foreground hover:bg-red-700" :
                                                            (isSpecial ? "bg-blue-600 text-foreground hover:bg-blue-700" : "bg-white text-black hover:bg-muted")
                                                    )}
                                                >
                                                    {isResolving ? <Loader2 className="animate-spin" size={12} /> : (
                                                        <>
                                                            <CheckCircle2 size={14} />
                                                            {isAlert ? "Cerrar" : "Guardar"}
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Recientes History */}
                            <AnimatePresence>
                                {!showFullScene && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 20 }}
                                        className="absolute top-20 left-[260px] right-[400px] bottom-10 flex flex-col gap-4 z-20"
                                    >
                                        <div className="space-y-4 flex-1 overflow-hidden">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <History size={16} />
                                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Historial</span>
                                                </div>
                                                <div className="h-[1px] flex-1 mx-4 bg-foreground/10" />
                                            </div>
                                            <div className="space-y-3 overflow-y-auto max-h-[140px] custom-scrollbar pr-4 relative before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-[px] before:bg-foreground/10">
                                                {loadingHistory ? (
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold pl-8 italic animate-pulse">Analizando...</div>
                                                ) : history.length > 0 ? history.map((h, i) => (
                                                    <div key={h.id} className="flex gap-4 items-start relative pl-0 opacity-60 hover:opacity-100 transition-opacity">
                                                        <div className={cn(
                                                            "w-3 h-3 rounded-full z-10 shrink-0 border-2 border-black",
                                                            h.decision === 'GRANT' ? "bg-emerald-500" : "bg-red-600"
                                                        )} />
                                                        <div className="min-w-0">
                                                            <p className="text-[9px] font-bold text-foreground/70 uppercase leading-none truncate">
                                                                {h.device?.name || "Terminal"}
                                                            </p>
                                                            <p className="text-[7px] font-bold text-muted-foreground mt-1 uppercase tracking-tighter">
                                                                {hora(new Date(h.timestamp))} • {h.decision === 'GRANT' ? 'PASO' : 'DENEGADO'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <div className="text-[10px] text-muted-foreground uppercase font-bold pl-8">Sin registros.</div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Stats Info Bottom Right */}
                            <AnimatePresence>
                                {!showFullScene && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute bottom-8 right-8 text-right space-y-1"
                                    >
                                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Terminal de Acceso / Origen</p>
                                        <h4 className="text-xl font-bold text-foreground uppercase tracking-tighter truncate max-w-[300px]">{event.device?.name || "Búsqueda Manual"}</h4>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </div >
            )
            }
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(178,13,48,0.4); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(178,13,48,0.8); }
            `}</style>
        </AnimatePresence >
    );
}

function IdentityField({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
    return (
        <div className="flex items-start gap-4 group">
            <div className="w-6 h-6 text-muted-foreground group-hover:text-[#B20D30] transition-colors mt-0.5 shrink-0">
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 leading-none">{label}</p>
                <p className="text-sm font-bold text-foreground uppercase leading-tight truncate">{value}</p>
            </div>
        </div>
    );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
    return (
        <span className={cn("px-2 py-0.5 rounded-none text-[8px] font-bold uppercase tracking-widest border", className)}>
            {children}
        </span>
    );
}
