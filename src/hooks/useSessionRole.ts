"use client";

import { useEffect, useState } from "react";
import { getSession } from "@/app/actions/auth";

// Lee el rol y nombre del usuario logueado (del JWT de sesión) en el cliente.
export function useSessionRole() {
    const [role, setRole] = useState<string | null>(null);
    const [name, setName] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        let vivo = true;
        getSession()
            .then((s: any) => {
                if (!vivo) return;
                setRole((s?.role as string) ?? null);
                setName((s?.name as string) ?? null);
                setLoaded(true);
            })
            .catch(() => { if (vivo) setLoaded(true); });
        return () => { vivo = false; };
    }, []);
    return { role, name, loaded, isAdmin: role === "ADMIN" };
}
