"use client";
/* eslint-disable */

import { useRef, useState, useEffect } from "react";
import { Camera, X, Loader2, RefreshCcw, Image as ImageIcon, ScanLine } from "lucide-react";
import { sileo as toast } from "sileo";
import * as Tesseract from 'tesseract.js';
import { cn } from "@/lib/utils";

interface OCRScannerTFProps {
    onClose: () => void;
    onDetected: (plate: string | null, imageBlob: Blob) => void;
    cameraFacingMode?: "environment" | "user";
    toggleCameraFacingMode?: () => void;
    initialPhotoMode?: boolean;
}

export default function OCRScannerTF({ onClose, onDetected, cameraFacingMode, toggleCameraFacingMode, initialPhotoMode = false }: OCRScannerTFProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const isProcessingRef = useRef(false);
    const isScanningRef = useRef(false);

    const [isScanning, setIsScanning] = useState(false);
    const [worker, setWorker] = useState<Tesseract.Worker | null>(null);
    const [cocoModel, setCocoModel] = useState<any>(null);
    const [workerStatus, setWorkerStatus] = useState<string>("Iniciando...");
    const [workerProgress, setWorkerProgress] = useState<number>(0);
    const [lastDetected, setLastDetected] = useState<string>("");

    // Camera & Mode State
    // Camera & Mode State
    const [internalFacingMode, setInternalFacingMode] = useState<"environment" | "user">("environment");
    const facingMode = cameraFacingMode || internalFacingMode;
    const toggleFacingMode = toggleCameraFacingMode || (() => setInternalFacingMode(prev => prev === "environment" ? "user" : "environment"));

    const [isPhotoMode, setIsPhotoMode] = useState(initialPhotoMode);

    // Initialize TensorFlow.js and Tesseract
    useEffect(() => {
        initializeModels();
        return () => {
            if (worker) worker.terminate();
        };
    }, []);

    const initializeModels = async () => {
        try {
            // Load core TFJS first to set up backend
            setWorkerStatus("Iniciando motor IA...");
            const tf = await import('@tensorflow/tfjs');

            // Set backend to webgl for performance on mobile
            try {
                await tf.setBackend('webgl');
                await tf.ready();
            } catch (e) {
                console.warn("WebGL not available, falling back to CPU", e);
                await tf.setBackend('cpu');
            }

            // Load TensorFlow.js COCO-SSD for object detection
            setWorkerStatus("Cargando detector...");
            const cocoSsd = await import('@tensorflow-models/coco-ssd');
            const model = await cocoSsd.load({
                base: 'lite_mobilenet_v2' // Smaller model for mobile
            });
            setCocoModel(model);

            // Load Tesseract for OCR
            setWorkerStatus("Cargando OCR...");
            const { createWorker, PSM } = await import('tesseract.js');
            const w = await createWorker('eng', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setWorkerProgress(Math.floor(m.progress * 100));
                        setWorkerStatus(`OCR: ${Math.floor(m.progress * 100)}%`);
                    }
                },
                errorHandler: err => console.error("Tesseract Error:", err)
            });

            await w.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: PSM.SINGLE_LINE,
                preserve_interword_spaces: '0',
            });

            setWorker(w);
            setWorkerStatus("Listo");
        } catch (error) {
            console.error("Model Init Error:", error);
            setWorkerStatus("Error en IA");
            toast.error({ title: "Error al cargar TensorFlow.js o OCR" });
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
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
                setIsScanning(true);
                isScanningRef.current = true;
            }
        } catch (error) {
            console.error("Camera Error:", error);
            toast.error({ title: "No se pudo acceder a la cámara. Verifique los permisos." });
        }
    };

    // 1. Initialize models on mount
    useEffect(() => {
        initializeModels();
        return () => {
            if (worker) worker.terminate();
        };
    }, []);

    // 2. Start camera on mount and when facingMode changes
    useEffect(() => {
        startCamera();
        return () => {
            stopCamera();
        };
    }, [facingMode]);

    const validateMercosurPlate = (text: string): string | null => {
        // Mercosur format: ABC1234 or ABC1D23
        const mercosurPattern1 = /^[A-Z]{3}[0-9]{4}$/; // ABC1234
        const mercosurPattern2 = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/; // ABC1D23

        const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (mercosurPattern1.test(clean) || mercosurPattern2.test(clean)) {
            return clean;
        }

        // Try to extract 7 characters
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

    const preprocessImage = (canvas: HTMLCanvasElement, mode: 'contrast' | 'binary'): HTMLCanvasElement => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return canvas;

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Pass 1: Grayscale and high contrast
        const grayValues: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

            // Apply aggressive contrast enhancement
            const contrast = 1.6;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            const enhanced = Math.max(0, Math.min(255, factor * (gray - 128) + 128));

            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
            grayValues.push(enhanced);
        }

        if (mode === 'binary') {
            // Pass 2: Adaptive-style thresholding (simple mean)
            let sum = 0;
            for (const v of grayValues) sum += v;
            const threshold = sum / grayValues.length;

            for (let i = 0; i < data.length; i += 4) {
                const binary = data[i] > threshold ? 255 : 0;
                data[i] = binary;
                data[i + 1] = binary;
                data[i + 2] = binary;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    };

    const captureAndProcess = async () => {
        if (!videoRef.current || !canvasRef.current || !worker || !cocoModel) return;

        const video = videoRef.current;
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setWorkerStatus("Analizando...");

        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { isProcessingRef.current = false; return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            // 1. Detect region (Look for vehicles or default to guide area)
            const predictions = await cocoModel.detect(canvas);
            let plateRegion = null;

            for (const pred of predictions) {
                if (["car", "truck", "bus"].includes(pred.class) && pred.score > 0.4) {
                    const [x, y, w, h] = pred.bbox;
                    // Focus on lower half of vehicle where plate lives
                    plateRegion = { x, y: y + h * 0.4, width: w, height: h * 0.6 };
                    break;
                }
            }

            if (!plateRegion) {
                const guideW = canvas.width * 0.85;
                const guideH = canvas.height * 0.35;
                plateRegion = {
                    x: (canvas.width - guideW) / 2,
                    y: (canvas.height - guideH) / 2,
                    width: guideW,
                    height: guideH
                };
            }

            // Clamp and sanitize region
            plateRegion.x = Math.max(0, plateRegion.x);
            plateRegion.y = Math.max(0, plateRegion.y);
            plateRegion.width = Math.min(canvas.width - plateRegion.x, plateRegion.width);
            plateRegion.height = Math.min(canvas.height - plateRegion.y, plateRegion.height);

            // 2. Prepare cropped and upscaled canvas
            const scaleFactor = 2.0;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = plateRegion.width * scaleFactor;
            tempCanvas.height = plateRegion.height * scaleFactor;
            const tempCtx = tempCanvas.getContext("2d");
            if (!tempCtx) throw new Error("Context error");

            tempCtx.imageSmoothingEnabled = false; // Sharp edges for OCR
            tempCtx.drawImage(
                canvas,
                plateRegion.x, plateRegion.y, plateRegion.width, plateRegion.height,
                0, 0, tempCanvas.width, tempCanvas.height
            );

            // 3. Multi-Pass OCR Strategy
            const { PSM } = await import('tesseract.js');
            const preprocessingModes: ('contrast' | 'binary')[] = ['contrast', 'binary'];
            let bestResult = null;

            for (const mode of preprocessingModes) {
                setWorkerStatus(mode === 'contrast' ? "Normal..." : "Optimizando...");
                preprocessImage(tempCanvas, mode);

                await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_LINE,
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
                });

                const { data: { text, confidence } } = await worker.recognize(tempCanvas);
                const cleanText = text.replace(/[^A-Z0-9]/g, '').trim();


                const mercosurPlate = validateMercosurPlate(cleanText);
                const isValid = mercosurPlate !== null || (cleanText.length >= 5 && cleanText.length <= 8 && /[A-Z]{2,}/.test(cleanText));

                if (isValid && confidence > (bestResult?.confidence || 15)) {
                    bestResult = { text: mercosurPlate || cleanText, confidence };
                    if (confidence > 70) break; // High quality match found
                }
            }

            if (bestResult) {
                const finalPlate = bestResult.text.substring(0, 7);
                if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);

                canvas.toBlob((blob) => {
                    if (blob) {
                        onDetected(finalPlate, blob);
                        onClose();
                    }
                }, "image/jpeg", 0.9);

                toast.success({ title: `Matrícula detectada: ${finalPlate}` });
                stopCamera();
            } else {
                setLastDetected("¿?");
                toast.warning({ title: "Lectura incierta. Reintente más cerca." });
            }

        } catch (error) {
            console.error("OCR Error:", error);
            toast.error({ title: "Error al procesar la captura" });
        } finally {
            isProcessingRef.current = false;
            setWorkerStatus("Listo");
            setWorkerProgress(0);
        }
    };

    const capturePhotoOnly = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                if (blob) {
                    onDetected(null, blob);
                    onClose();
                    toast.success({ title: "Foto capturada" });
                }
            }, "image/jpeg", 0.9);
        }
    };



    const handleManualCapture = () => {
        if (isPhotoMode) {
            capturePhotoOnly();
        } else if (!isProcessingRef.current) {
            captureAndProcess();
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black">
            {/* Close button */}
            <button
                onClick={() => { stopCamera(); onClose(); }}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center ring-1 ring-white/10"
            >
                <X className="w-5 h-5 text-foreground" />
            </button>

            {/* Video feed */}
            <div className="relative w-full h-full flex items-center justify-center">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={cn(
                        "relative transition-all duration-300",
                        isPhotoMode
                            ? "w-[90%] h-[80%] border-4 border-border rounded-3xl"
                            : "w-[80%] max-w-md aspect-[3/1] border-4 border-border rounded-xl shadow-lg"
                    )}>
                        {!isPhotoMode && (
                            <>
                                <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
                                <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
                                <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
                                <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
                            </>
                        )}
                    </div>

                    {/* Detected plate display - Only in OCR Mode */}
                    {!isPhotoMode && lastDetected && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-[#B20D30] px-6 py-3 rounded-2xl shadow-lg animate-pulse">
                                <span className="text-foreground font-bold text-3xl tracking-[0.3em]">{lastDetected}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Top Controls */}
                <div className="absolute top-4 left-4 flex items-center gap-2">
                    {/* OCR Status - Only in OCR Mode */}
                    {!isPhotoMode && (
                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full ring-1 ring-white/10">
                            {isProcessingRef.current || workerStatus !== "Listo" ? (
                                <Loader2 className="w-3 h-3 text-foreground animate-spin" />
                            ) : (
                                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]" />
                            )}
                            <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
                                {workerStatus}
                            </span>
                        </div>
                    )}
                </div>

                {/* Bottom Controls */}
                <div className="absolute inset-x-0 bottom-8 px-6 flex items-center justify-between pointer-events-none">
                    {/* Camera Switch */}
                    <button
                        onClick={toggleFacingMode}
                        className="pointer-events-auto w-12 h-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white ring-1 ring-white/20 active:scale-95 transition-all"
                    >
                        <RefreshCcw size={20} />
                    </button>

                    {/* CAPTURE BUTTON */}
                    <button
                        onClick={handleManualCapture}
                        disabled={(!isPhotoMode && (isProcessingRef.current || !cocoModel || !worker))}
                        className="pointer-events-auto group flex flex-col items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                    >
                        <div className="w-20 h-20 rounded-full bg-white shadow-lg flex items-center justify-center ring-4 ring-border group-active:ring-8 transition-all">
                            {isPhotoMode ? (
                                <div className="w-16 h-16 rounded-full bg-slate-900" />
                            ) : (
                                <Camera className="w-10 h-10 text-black" />
                            )}
                        </div>
                        <span className="text-foreground text-xs font-bold tracking-wider">{isPhotoMode ? "CAPTURAR" : "SCANNER"}</span>
                    </button>

                    {/* Mode Toggle */}
                    <button
                        onClick={() => setIsPhotoMode(prev => !prev)}
                        className={cn(
                            "pointer-events-auto w-12 h-12 rounded-full backdrop-blur-md flex items-center justify-center text-foreground ring-1 ring-border active:scale-95 transition-all",
                            isPhotoMode ? "bg-white text-black" : "bg-black/40"
                        )}
                    >
                        {isPhotoMode ? <ImageIcon size={20} /> : <ScanLine size={20} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
