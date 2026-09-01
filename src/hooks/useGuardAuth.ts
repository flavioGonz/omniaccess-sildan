"use client";
import { useState, useEffect, useCallback } from "react";
import { playTactileSound } from "./guard-utils";

const LS_KEY_NAME = "bitacora_guard_name";
const LS_KEY_PHOTO = "bitacora_guard_photo";

interface UseGuardAuthOptions {
    /** List of guard objects with name, username, password, cara fields */
    guards: any[];
    /** Callback on successful/failed login */
    onSuccess?: (msg: string) => void;
    onError?: (msg: string) => void;
}

interface UseGuardAuthReturn {
    guardName: string;
    guardPhoto: string | null;
    setGuardName: (name: string) => void;
    setGuardPhoto: (photo: string | null) => void;
    loginUser: string;
    setLoginUser: (v: string) => void;
    loginPass: string;
    setLoginPass: (v: string) => void;
    showIdentityOverlay: boolean;
    setShowIdentityOverlay: (v: boolean) => void;
    handleManualLogin: (e: React.FormEvent) => void;
    handleConfirmIdentity: (guard: any) => void;
    handleLogout: () => void;
    saveGuardName: (name: string) => void;
}

export function useGuardAuth({
    guards,
    onSuccess,
    onError,
}: UseGuardAuthOptions): UseGuardAuthReturn {
    const [guardName, setGuardName] = useState("");
    const [guardPhoto, setGuardPhoto] = useState<string | null>(null);
    const [loginUser, setLoginUser] = useState("");
    const [loginPass, setLoginPass] = useState("");
    const [showIdentityOverlay, setShowIdentityOverlay] = useState(true);

    // Restore session from localStorage
    useEffect(() => {
        if (typeof window === "undefined") return;
        const storedName = localStorage.getItem(LS_KEY_NAME);
        const storedPhoto = localStorage.getItem(LS_KEY_PHOTO);
        if (storedName) {
            setGuardName(storedName);
            if (storedPhoto) setGuardPhoto(storedPhoto);
            setShowIdentityOverlay(false);
        }
    }, []);

    const resolvePhotoUrl = (cara: string | null | undefined): string | null => {
        if (!cara) return null;
        return cara.startsWith("/") ? cara : `/api/files/${cara}`;
    };

    const persistSession = (name: string, photo: string | null) => {
        if (typeof window === "undefined") return;
        localStorage.setItem(LS_KEY_NAME, name);
        if (photo) localStorage.setItem(LS_KEY_PHOTO, photo);
    };

    const handleManualLogin = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            const guard = guards.find(
                (g) => (g.username || g.name).toLowerCase() === loginUser.toLowerCase()
            );

            if (guard && guard.password === loginPass) {
                const photoUrl = resolvePhotoUrl(guard.cara);
                setGuardName(guard.name);
                setGuardPhoto(photoUrl);
                persistSession(guard.name, photoUrl);
                setShowIdentityOverlay(false);
                playTactileSound();
                onSuccess?.(`Bienvenido, ${guard.name}`);
                setLoginUser("");
                setLoginPass("");
            } else {
                playTactileSound();
                onError?.("Credenciales incorrectas");
            }
        },
        [guards, loginUser, loginPass, onSuccess, onError]
    );

    const handleConfirmIdentity = useCallback(
        (guard: any) => {
            const pinCheck = prompt(`Ingrese PIN de seguridad para ${guard.name}:`);
            if (pinCheck && pinCheck === guard.password) {
                const photoUrl = resolvePhotoUrl(guard.cara);
                setGuardName(guard.name);
                setGuardPhoto(photoUrl);
                persistSession(guard.name, photoUrl);
                setShowIdentityOverlay(false);
                onSuccess?.(`Bienvenido, ${guard.name}`);
            } else if (pinCheck) {
                onError?.("PIN Incorrecto");
            }
        },
        [onSuccess, onError]
    );

    const handleLogout = useCallback(() => {
        setGuardName("");
        setGuardPhoto(null);
        if (typeof window !== "undefined") {
            localStorage.removeItem(LS_KEY_NAME);
            localStorage.removeItem(LS_KEY_PHOTO);
        }
        setShowIdentityOverlay(true);
    }, []);

    const saveGuardName = useCallback((name: string) => {
        setGuardName(name);
        if (typeof window !== "undefined") {
            localStorage.setItem(LS_KEY_NAME, name);
        }
    }, []);

    return {
        guardName,
        guardPhoto,
        setGuardName,
        setGuardPhoto,
        loginUser,
        setLoginUser,
        loginPass,
        setLoginPass,
        showIdentityOverlay,
        setShowIdentityOverlay,
        handleManualLogin,
        handleConfirmIdentity,
        handleLogout,
        saveGuardName,
    };
}
