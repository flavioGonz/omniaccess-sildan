"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, X, RefreshCw, Check } from "lucide-react";

interface Props {
    onCapture: (blob: Blob) => void;
    onClose: () => void;
    cameraFacingMode?: "user" | "environment";
    toggleCameraFacingMode?: () => void;
}

// Captura de foto SIMPLE (sin detección LPR/OCR). Solo saca una foto y la devuelve.
export default function SimplePhotoCapture({ onCapture, onClose, cameraFacingMode = "environment", toggleCameraFacingMode }: Props) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                if (typeof window !== "undefined" && window.isSecureContext === false) {
                    setError("La cámara necesita conexión segura (HTTPS).");
                    return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode }, audio: false });
                if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => { }); setReady(true); }
            } catch {
                setError("No se pudo abrir la cámara.");
            }
        })();
        return () => { alive = false; try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { } };
    }, [cameraFacingMode]);

    const stop = () => { try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { } };

    const shoot = () => {
        const v = videoRef.current;
        if (!v || !v.videoWidth) return;
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { if (blob) { stop(); onCapture(blob); } }, "image/jpeg", 0.9);
        try { (navigator as any).vibrate?.(80); } catch { }
    };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] bg-black flex flex-col">
            <div className="relative flex-1 overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                {/* Marco guía */}
                <div className="absolute inset-8 border-2 border-white/40 rounded-3xl pointer-events-none" />
                {/* Header */}
                <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                    <span className="px-3 py-1.5 rounded-full bg-black/50 backdrop-blur text-white text-[11px] font-bold uppercase tracking-widest">Foto</span>
                    <button onClick={() => { stop(); onClose(); }} className="w-11 h-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white active:scale-90"><X size={22} /></button>
                </div>
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
                        <Camera size={64} className="text-white/40" />
                        <p className="text-white/80 font-bold">{error}</p>
                        <button onClick={() => { stop(); onClose(); }} className="mt-2 px-6 py-3 rounded-2xl bg-white text-black font-bold uppercase text-sm">Cerrar</button>
                    </div>
                )}
            </div>
            {/* Controles */}
            {!error && (
                <div className="shrink-0 bg-black px-8 py-6 flex items-center justify-between">
                    {toggleCameraFacingMode ? (
                        <button onClick={toggleCameraFacingMode} className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-white active:scale-90"><RefreshCw size={24} /></button>
                    ) : <div className="w-14" />}
                    <button onClick={shoot} disabled={!ready} className="w-20 h-20 rounded-full bg-white border-4 border-white/40 flex items-center justify-center active:scale-90 disabled:opacity-40">
                        <span className="w-16 h-16 rounded-full bg-white ring-2 ring-black/10" />
                    </button>
                    <div className="w-14" />
                </div>
            )}
        </motion.div>
    );
}
