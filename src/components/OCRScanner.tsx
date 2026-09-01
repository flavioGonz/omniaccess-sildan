"use client";

import React, { useRef, useEffect, useState } from "react";
import { X, Camera, RefreshCcw, Loader2 } from "lucide-react";
import { sileo as toast } from "sileo";

interface OCRScannerProps {
    onDetected: (plate: string, imageBlob: Blob) => void;
    onClose: () => void;
}

export default function OCRScanner({ onDetected, onClose }: OCRScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isScanning, setIsScanning] = useState(false);
    const isScanningRef = useRef(false);
    const isProcessingRef = useRef(false);
    const streamRef = useRef<MediaStream | null>(null);
    const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Tesseract Worker State
    const [worker, setWorker] = useState<any>(null);
    const [workerStatus, setWorkerStatus] = useState("Iniciando motor neuronal...");
    const [workerProgress, setWorkerProgress] = useState(0);



    const initializeWorker = async () => {
        try {
            const { createWorker, PSM } = await import('tesseract.js');
            const w = await createWorker('eng', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setWorkerProgress(Math.floor(m.progress * 100));
                        setWorkerStatus(`Analizando: ${Math.floor(m.progress * 100)}%`);
                    } else {
                        setWorkerStatus(m.status === 'loading tesseract core' ? 'Cargando núcleo...' : 'Preparando IA...');
                    }
                },
                errorHandler: err => console.error(err)
            });

            // Optimized parameters for license plate recognition
            await w.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: PSM.SINGLE_LINE, // Single line of text (ideal for plates)
                preserve_interword_spaces: '0',
            });

            setWorker(w);
            setWorkerStatus("Listo");
        } catch (error) {
            console.error("OCR Worker Init Error:", error);
            toast.error({ title: "Error iniciando motor OCR local" });
        }
    };

    const stopCamera = () => {
        setIsScanning(false);
        isScanningRef.current = false;

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) { }
            });
            streamRef.current = null;
        }

        if (scanIntervalRef.current) {
            clearTimeout(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }
        isProcessingRef.current = false;
    };

    const startCamera = async () => {
        stopCamera();
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            streamRef.current = mediaStream;
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                setIsScanning(true);
                isScanningRef.current = true;
                // We don't auto-scan anymore, waiting for manual capture
            }
        } catch (err) {
            console.error("OCR Camera error:", err);
            toast.error({ title: "No se pudo iniciar la cámara." });
            onClose();
        }
    };

    const [lastDetected, setLastDetected] = useState<string>("");

    const preprocessImage = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return canvas;

        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // First pass: Convert to grayscale
        const grayValues: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            grayValues.push(gray);
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }

        // Calculate adaptive threshold (mean-based)
        let sum = 0;
        for (let i = 0; i < grayValues.length; i++) {
            sum += grayValues[i];
        }
        const threshold = sum / grayValues.length;

        // Second pass: Apply threshold and gentle contrast
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i];

            // Gentle contrast enhancement
            const contrast = 1.2;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            const enhanced = Math.max(0, Math.min(255, factor * (gray - 128) + 128));

            // Apply adaptive threshold
            const binary = enhanced > threshold ? 255 : 0;

            data[i] = binary;
            data[i + 1] = binary;
            data[i + 2] = binary;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    };

    const validateMercosurPlate = (text: string): string | null => {
        // Mercosur format: ABC1234 or ABC1D23
        const mercosurPattern1 = /^[A-Z]{3}[0-9]{4}$/; // ABC1234
        const mercosurPattern2 = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/; // ABC1D23

        const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Try exact match first
        if (mercosurPattern1.test(clean) || mercosurPattern2.test(clean)) {
            return clean;
        }

        // Try to extract 7 characters that match the pattern
        if (clean.length >= 7) {
            for (let i = 0; i <= clean.length - 7; i++) {
                const substr = clean.substring(i, i + 7);
                if (mercosurPattern1.test(substr) || mercosurPattern2.test(substr)) {
                    return substr;
                }
            }
        }

        return null;
    };

    const captureAndSend = async () => {
        if (!videoRef.current || !canvasRef.current || !worker) return;

        const video = videoRef.current;
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setWorkerStatus("Capturando...");

        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { isProcessingRef.current = false; return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            // Multi-attempt strategy with different PSM modes
            const { PSM } = await import('tesseract.js');
            const psmModes = [
                { mode: PSM.SINGLE_LINE, name: "Línea única" },
                { mode: PSM.SINGLE_BLOCK, name: "Bloque único" },
                { mode: PSM.AUTO, name: "Auto" }
            ];

            let bestResult: { text: string; confidence: number; validPlate: string | null } | null = null;

            for (let i = 0; i < psmModes.length; i++) {
                const { mode, name } = psmModes[i];
                setWorkerStatus(`Intento ${i + 1}/3: ${name}...`);

                try {
                    await worker.setParameters({
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                        tessedit_pageseg_mode: mode,
                        preserve_interword_spaces: '0',
                    });

                    const { data: { text, confidence } } = await worker.recognize(canvas);
                    const cleanText = text.replace(/[^A-Z0-9]/g, '').trim();


                    // Very relaxed validation: 5-8 chars starting with 2+ letters
                    const validPlate = cleanText.length >= 5 && cleanText.length <= 8 && /^[A-Z]{2,}/.test(cleanText)
                        ? cleanText.substring(0, 7).padEnd(7, '0')
                        : null;

                    if (validPlate && confidence > 25) {
                        if (!bestResult || confidence > bestResult.confidence) {
                            bestResult = { text: cleanText, confidence, validPlate };
                        }

                        // If we get good confidence, stop trying
                        if (confidence > 50) break;
                    }
                } catch (err) {
                    console.error(`Attempt ${i + 1} failed:`, err);
                }
            }

            // Use best result if we have one
            if (bestResult && bestResult.validPlate) {

                if ("vibrate" in navigator) navigator.vibrate(200);

                canvas.toBlob((blob) => {
                    if (blob) {
                        onDetected(bestResult!.validPlate!, blob);
                        onClose();
                    }
                }, "image/jpeg", 0.95);

                toast.success({ title: `Matrícula: ${bestResult.validPlate}` });
                stopCamera();
            } else {
                const lastText = bestResult?.text || "Sin texto";
                setLastDetected("¿" + lastText + "?");
                toast.warning({ title: "Intente de nuevo con mejor encuadre" });
            }

        } catch (error) {
            console.error("OCR Error:", error);
            toast.error({ title: "Error en OCR" });
        } finally {
            isProcessingRef.current = false;
            setWorkerStatus("Listo");
            setWorkerProgress(0);
        }
    };

    const handleManualClose = () => {
        stopCamera();
        onClose();
    };

    const handleManualCapture = () => {
        if (!isProcessingRef.current) {
            captureAndSend();
        }
    };
    useEffect(() => {
        startCamera();
        initializeWorker();

        return () => {
            stopCamera();
            if (worker) {
                worker.terminate();
            }
        };
    }, []);


    return (
        <div className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center p-4">
            <div className="relative w-full max-w-2xl bg-slate-900 rounded-3xl overflow-hidden shadow-lg border border-border">
                {/* Video Container */}
                <div className="relative aspect-video w-full bg-black flex items-center justify-center">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                    />

                    {/* Scanning Overlay - Simplified */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-[90%] h-[40%] border-4 border-border rounded-3xl relative">
                            {/* Corner accents */}
                            <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-[#B20D30] rounded-tl-2xl" />
                            <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-[#B20D30] rounded-tr-2xl" />
                            <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-[#B20D30] rounded-bl-2xl" />
                            <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-[#B20D30] rounded-br-2xl" />

                            {/* Detected plate display */}
                            {lastDetected && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="bg-[#B20D30] px-6 py-3 rounded-2xl shadow-lg animate-pulse">
                                        <span className="text-foreground font-bold text-3xl tracking-[0.3em]">{lastDetected}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Scanning indicator or Loader */}
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
                        {isProcessingRef.current || workerStatus !== "Listo" ? (
                            <Loader2 className="w-3 h-3 text-foreground animate-spin" />
                        ) : (
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]" />
                        )}
                        <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
                            {workerStatus}
                        </span>
                    </div>

                    {/* CAPTURE BUTTON - Prominent at bottom */}
                    <div className="absolute inset-x-0 bottom-8 flex justify-center px-4">
                        <button
                            onClick={handleManualCapture}
                            disabled={isProcessingRef.current}
                            className="group flex flex-col items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                        >
                            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-foreground/10 backdrop-blur-md border-[5px] border-white flex items-center justify-center shadow-lg group-hover:bg-foreground/10 group-active:scale-90 transition-all">
                                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white group-hover:bg-foreground/10 transition-all" />
                            </div>
                        </button>
                    </div>
                </div>

                {/* Hidden canvas for capture */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Footer Controls */}
                <div className="p-6 bg-slate-900 border-t border-border flex items-center justify-between gap-4">
                    <button
                        onClick={handleManualClose}
                        className="w-12 h-12 rounded-2xl bg-foreground/10 flex items-center justify-center text-foreground active:scale-95 transition-all hover:bg-accent"
                    >
                        <X size={24} />
                    </button>

                    <div className="flex-1 text-center">
                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest leading-tight">
                            LECTOR INTELIGENTE<br />
                            <span className="text-muted-foreground">CAPTURA MANUAL O AUTOMÁTICA</span>
                        </p>
                    </div>

                    <button
                        onClick={startCamera}
                        className="w-12 h-12 rounded-2xl bg-foreground/10 flex items-center justify-center text-foreground active:scale-95 transition-all hover:bg-accent"
                    >
                        <RefreshCcw size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
