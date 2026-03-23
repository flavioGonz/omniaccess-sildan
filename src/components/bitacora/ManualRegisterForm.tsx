"use client";

import React, { useState, useRef, useEffect } from "react";
import { 
    LogIn, 
    LogOut, 
    Camera, 
    Mic, 
    Square, 
    Play, 
    Loader2, 
    Shield, 
    User, 
    MapPin, 
    Building2, 
    FileText 
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createBitacoraEntry } from "@/app/actions/bitacora";
import { toast } from "sonner";

export default function ManualRegisterForm() {
    const [type, setType] = useState<"ENTRY" | "EXIT">("ENTRY");
    const [plate, setPlate] = useState("");
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [destination, setDestination] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Media States
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            mediaStreamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
            setIsCameraActive(true);
        } catch (err) {
            toast.error("No se pudo acceder a la cámara");
        }
    };

    const stopCamera = () => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
        setIsCameraActive(false);
    };

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")?.drawImage(video, 0, 0);
            setCapturedPhoto(canvas.toDataURL("image/jpeg"));
            stopCamera();
        }
    };

    const handleRegister = async () => {
        if (!plate.trim()) {
            toast.error("La matrícula es obligatoria");
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("type", type);
            formData.append("plate", plate.toUpperCase());
            formData.append("name", name);
            formData.append("dni", dni);
            formData.append("destination", destination);
            formData.append("notes", notes);
            formData.append("guardName", "Administrador");

            if (capturedPhoto) {
                const res = await fetch(capturedPhoto);
                const blob = await res.blob();
                formData.append("photo", blob, "photo.jpg");
            }

            if (audioBlob) {
                formData.append("audio", audioBlob, "audio.webm");
            }

            const result = await createBitacoraEntry(formData);
            if (result) {
                toast.success("Acceso registrado correctamente");
                setPlate("");
                setName("");
                setDni("");
                setDestination("");
                setNotes("");
                setCapturedPhoto(null);
                setAudioBlob(null);
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al registrar el acceso");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto bg-neutral-900 border border-neutral-800 rounded-[2.5rem] p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-5 duration-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                {/* Form Side */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                            <Shield className="text-blue-500" size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tight">Registro Manual</h2>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Ingreso directo a bitácora</p>
                        </div>
                    </div>

                    <div className="p-1 bg-black/40 rounded-2xl flex gap-1">
                        <button
                            onClick={() => setType("ENTRY")}
                            className={cn(
                                "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase transition-all",
                                type === "ENTRY" ? "bg-blue-600 text-white shadow-lg" : "text-neutral-500 hover:text-white"
                            )}
                        >
                            <LogIn size={16} /> Ingreso
                        </button>
                        <button
                            onClick={() => setType("EXIT")}
                            className={cn(
                                "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase transition-all",
                                type === "EXIT" ? "bg-amber-600 text-white shadow-lg" : "text-neutral-500 hover:text-white"
                            )}
                        >
                            <LogOut size={16} /> Salida
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-black text-neutral-500 tracking-widest ml-1">Matrícula</Label>
                            <Input
                                value={plate}
                                onChange={(e) => setPlate(e.target.value)}
                                placeholder="--- ---"
                                className="bg-neutral-950 border-neutral-800 h-14 text-2xl font-black text-white tracking-widest text-center uppercase focus:border-blue-500/50"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase font-black text-neutral-500 tracking-widest ml-1">Visitante</Label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Nombre..."
                                    className="bg-neutral-950 border-neutral-800 h-12 text-sm font-bold text-white focus:border-blue-500/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase font-black text-neutral-500 tracking-widest ml-1">DNI / Documento</Label>
                                <Input
                                    value={dni}
                                    onChange={(e) => setDni(e.target.value)}
                                    placeholder="Número..."
                                    className="bg-neutral-950 border-neutral-800 h-12 text-sm font-bold text-white focus:border-blue-500/50"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-black text-neutral-500 tracking-widest ml-1">Destino (Unidad/Lote)</Label>
                            <Input
                                value={destination}
                                onChange={(e) => setDestination(e.target.value)}
                                placeholder="Ej: Lote 45..."
                                className="bg-neutral-950 border-neutral-800 h-12 text-sm font-bold text-white focus:border-blue-500/50"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-black text-neutral-500 tracking-widest ml-1">Observaciones</Label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Notas adicionales..."
                                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm font-medium text-white placeholder:text-neutral-700 min-h-[100px] focus:outline-none focus:border-blue-500/50 transition-all"
                            />
                        </div>
                    </div>
                </div>

                {/* Multimedia Side */}
                <div className="space-y-6">
                    <div className="relative aspect-video bg-black rounded-3xl border border-neutral-800 overflow-hidden group">
                        {isCameraActive ? (
                            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
                        ) : capturedPhoto ? (
                            <img src={capturedPhoto} className="w-full h-full object-cover" alt="Captured" />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-neutral-800 gap-4">
                                <Camera size={64} />
                                <p className="text-xs font-black uppercase tracking-widest text-neutral-700">Evidencia Fotográfica</p>
                            </div>
                        )}

                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
                            {isCameraActive ? (
                                <button onClick={takePhoto} className="bg-white text-black rounded-full w-14 h-14 shadow-2xl hover:scale-110 transition-transform flex items-center justify-center">
                                    <div className="w-10 h-10 border-4 border-black rounded-full" />
                                </button>
                            ) : (
                                <button onClick={startCamera} className="bg-blue-600 hover:bg-blue-500 text-white rounded-full px-6 h-12 font-black uppercase tracking-widest text-[10px] shadow-xl shadow-blue-500/20 flex items-center justify-center">
                                    <Camera className="mr-2" size={16} /> Abrir Cámara
                                </button>
                            )}
                            {capturedPhoto && !isCameraActive && (
                                <button onClick={() => setCapturedPhoto(null)} className="bg-red-600 hover:bg-red-500 text-white rounded-full w-12 h-12 p-0 flex items-center justify-center">
                                    <Square size={20} />
                                </button>
                            )}
                        </div>
                        <canvas ref={canvasRef} className="hidden" />
                    </div>

                    <div className="p-6 bg-black/40 border border-neutral-800 rounded-3xl flex items-center justify-between gap-6">
                        <div className="flex-1">
                            <h4 className="text-xs font-black text-white uppercase tracking-widest mb-1">Evidencia Digital</h4>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-tight">
                                {capturedPhoto ? "Imagen capturada correctamente" : "La cámara se activará automáticamente"}
                            </p>
                        </div>
                        
                        <div className="w-14 h-14 rounded-2xl bg-neutral-800 flex items-center justify-center text-neutral-600">
                             {capturedPhoto ? <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" /> : <Camera size={24} />}
                        </div>
                    </div>

                    <Button
                        disabled={isSubmitting || !plate}
                        onClick={handleRegister}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl h-16 text-lg font-black uppercase tracking-widest shadow-2xl shadow-emerald-500/20 disabled:bg-neutral-800 disabled:text-neutral-600 transition-all active:scale-95"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : "Confirmar Registro"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
