"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { formatDuration } from "./guard-utils";

interface UseMediaCaptureOptions {
    /** Default camera facing mode */
    defaultFacingMode?: "user" | "environment";
    /** Callback on error (for notification display) */
    onError?: (title: string, message: string) => void;
}

interface UseMediaCaptureReturn {
    // Camera
    isCameraActive: boolean;
    capturedPhoto: string | null;
    setCapturedPhoto: (v: string | null) => void;
    cameraFacingMode: "user" | "environment";
    videoRef: React.RefObject<HTMLVideoElement | null>;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    startCamera: () => Promise<void>;
    stopCamera: () => void;
    takePhoto: () => string | null;
    toggleCameraFacingMode: () => void;
    // Audio
    isRecording: boolean;
    recordingDuration: number;
    audioBlob: Blob | null;
    audioUrl: string | null;
    setAudioBlob: (v: Blob | null) => void;
    setAudioUrl: (v: string | null) => void;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    formatDuration: (seconds: number) => string;
}

export function useMediaCapture({
    defaultFacingMode = "environment",
    onError,
}: UseMediaCaptureOptions = {}): UseMediaCaptureReturn {
    // Camera state
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">(defaultFacingMode);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Audio state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<any>(null);

    // Recording timer
    useEffect(() => {
        if (isRecording) {
            setRecordingDuration(0);
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);
        } else {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        }
        return () => {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };
    }, [isRecording]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        setIsCameraActive(false);
    }, []);

    const startCamera = useCallback(async () => {
        stopCamera();
        setIsCameraActive(true);

        if (typeof window !== "undefined" && !window.isSecureContext) {
            onError?.("ERROR DE SEGURIDAD", "Se requiere HTTPS para la cámara.");
            setIsCameraActive(false);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: cameraFacingMode },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err: any) {
            const msg = err.name === "NotAllowedError"
                ? "Permiso de cámara denegado"
                : "Error al acceder a la cámara";
            onError?.("ERROR DE CÁMARA", msg);
            setIsCameraActive(false);
        }
    }, [cameraFacingMode, stopCamera, onError]);

    const takePhoto = useCallback((): string | null => {
        if (!videoRef.current || !canvasRef.current) return null;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setCapturedPhoto(dataUrl);
        stopCamera();
        return dataUrl;
    }, [stopCamera]);

    const toggleCameraFacingMode = useCallback(() => {
        setCameraFacingMode(prev => (prev === "user" ? "environment" : "user"));
    }, []);

    const startRecording = useCallback(async () => {
        if (typeof window !== "undefined" && !window.isSecureContext) {
            onError?.("ERROR DE AUDIO", "Se requiere HTTPS para el micrófono.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(t => t.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err: any) {
            const msg = err.name === "NotAllowedError"
                ? "Permiso de micrófono denegado"
                : "Error al acceder al micrófono";
            onError?.("ERROR DE MICRÓFONO", msg);
        }
    }, [onError]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    return {
        isCameraActive,
        capturedPhoto,
        setCapturedPhoto,
        cameraFacingMode,
        videoRef,
        canvasRef,
        startCamera,
        stopCamera,
        takePhoto,
        toggleCameraFacingMode,
        isRecording,
        recordingDuration,
        audioBlob,
        audioUrl,
        setAudioBlob,
        setAudioUrl,
        startRecording,
        stopRecording,
        formatDuration,
    };
}
