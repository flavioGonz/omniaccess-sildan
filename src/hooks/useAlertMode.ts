"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { playTactileSound } from "./guard-utils";

interface UseAlertModeOptions {
    /** Socket instance (or ref.current) to emit alert_toggle */
    socket: any;
    /** Guard name for attribution */
    guardName: string;
    /** Hold duration in ms to activate panic (default 1500) */
    panicHoldMs?: number;
    /** Hold duration in ms to deactivate (default 2000) */
    deactivateHoldMs?: number;
    /** Callback when deactivation hold completes (e.g. show normalization modal) */
    onDeactivateComplete?: () => void;
}

interface UseAlertModeReturn {
    isAlertMode: boolean;
    setIsAlertMode: (v: boolean) => void;
    alertStartTime: Date | null;
    setAlertStartTime: (v: Date | null) => void;
    panicHoldProgress: number;
    deactivateHoldProgress: number;
    toggleAlertMode: (forcedState?: boolean, explanation?: string) => void;
    startPanicHold: () => void;
    cancelPanicHold: () => void;
    startDeactivateHold: () => void;
    cancelDeactivateHold: () => void;
    alarmAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useAlertMode({
    socket,
    guardName,
    panicHoldMs = 1500,
    deactivateHoldMs = 2000,
    onDeactivateComplete,
}: UseAlertModeOptions): UseAlertModeReturn {
    const [isAlertMode, setIsAlertMode] = useState(false);
    const [alertStartTime, setAlertStartTime] = useState<Date | null>(null);
    const [panicHoldProgress, setPanicHoldProgress] = useState(0);
    const [deactivateHoldProgress, setDeactivateHoldProgress] = useState(0);

    const panicHoldRef = useRef<any>(null);
    const deactivateHoldRef = useRef<any>(null);
    const alarmAudioRef = useRef<HTMLAudioElement | null>(null);

    // Alarm Audio Control
    useEffect(() => {
        if (isAlertMode) {
            if (!alarmAudioRef.current) {
                alarmAudioRef.current = new Audio(
                    "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"
                );
                alarmAudioRef.current.loop = true;
            }
        } else {
            if (alarmAudioRef.current) {
                alarmAudioRef.current.pause();
                alarmAudioRef.current.currentTime = 0;
            }
        }
    }, [isAlertMode]);

    // Vibration feedback while alert is active
    useEffect(() => {
        let interval: any;
        if (isAlertMode && "vibrate" in navigator) {
            interval = setInterval(() => {
                navigator.vibrate([500, 200, 500]);
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isAlertMode]);

    const toggleAlertMode = useCallback(
        (forcedState?: boolean, explanation?: string) => {
            if (!socket) return;
            const newState = forcedState !== undefined ? forcedState : !isAlertMode;
            socket.emit("alert_toggle", {
                active: newState,
                triggeredBy: guardName || "Invitado",
                explanation: explanation || "",
            });
        },
        [socket, isAlertMode, guardName]
    );

    const startPanicHold = useCallback(() => {
        if (isAlertMode) return;
        playTactileSound();
        const start = Date.now();
        panicHoldRef.current = setInterval(() => {
            const elapsed = Date.now() - start;
            const progress = Math.min((elapsed / panicHoldMs) * 100, 100);
            setPanicHoldProgress(progress);
            if (progress >= 100) {
                clearInterval(panicHoldRef.current);
                toggleAlertMode(true);
                setPanicHoldProgress(0);
                if ("vibrate" in navigator) navigator.vibrate([100, 50, 100, 50, 400]);
            }
        }, 50);
    }, [isAlertMode, panicHoldMs, toggleAlertMode]);

    const cancelPanicHold = useCallback(() => {
        if (panicHoldRef.current) {
            clearInterval(panicHoldRef.current);
            setPanicHoldProgress(0);
        }
    }, []);

    const startDeactivateHold = useCallback(() => {
        if (!isAlertMode) return;
        playTactileSound();
        const start = Date.now();
        deactivateHoldRef.current = setInterval(() => {
            const elapsed = Date.now() - start;
            const progress = Math.min((elapsed / deactivateHoldMs) * 100, 100);
            setDeactivateHoldProgress(progress);
            if (progress >= 100) {
                clearInterval(deactivateHoldRef.current);
                setDeactivateHoldProgress(0);
                if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
                onDeactivateComplete?.();
            }
        }, 50);
    }, [isAlertMode, deactivateHoldMs, onDeactivateComplete]);

    const cancelDeactivateHold = useCallback(() => {
        if (deactivateHoldRef.current) {
            clearInterval(deactivateHoldRef.current);
            setDeactivateHoldProgress(0);
        }
    }, []);

    return {
        isAlertMode,
        setIsAlertMode,
        alertStartTime,
        setAlertStartTime,
        panicHoldProgress,
        deactivateHoldProgress,
        toggleAlertMode,
        startPanicHold,
        cancelPanicHold,
        startDeactivateHold,
        cancelDeactivateHold,
        alarmAudioRef,
    };
}
