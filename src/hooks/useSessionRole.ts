"use client";

import { useEffect, useState } from "react";
import { getSession } from "@/app/actions/auth";
import { puedeAbrir, PERMISOS_OPERADOR } from "@/lib/permisos";

/**
 * Lee la sesión (rol legado, nombre, permisos del rol de aplicación) en el cliente.
 * `tiene(clave)` es lo que usa el menú; `puede(ruta)` lo que usa el layout para cortar una
 * pantalla. Una sesión vieja sin `perms` se trata como antes: ADMIN todo, OPERATOR lo de operar.
 */
export function useSessionRole() {
    const [role, setRole] = useState<string | null>(null);
    const [name, setName] = useState<string | null>(null);
    const [perms, setPerms] = useState<string[] | null>(null);
    const [rolApp, setRolApp] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        let vivo = true;
        getSession()
            .then((s: any) => {
                if (!vivo) return;
                setRole((s?.role as string) ?? null);
                setName((s?.name as string) ?? null);
                setPerms(Array.isArray(s?.perms) ? s.perms : null);
                setRolApp((s?.rolApp as string) ?? null);
                setLoaded(true);
            })
            .catch(() => { if (vivo) setLoaded(true); });
        return () => { vivo = false; };
    }, []);
    const isAdmin = role === "ADMIN";
    const tiene = (clave: string) => (perms ? perms.includes(clave) : isAdmin || PERMISOS_OPERADOR.includes(clave));
    const puede = (ruta: string) => (perms ? puedeAbrir(perms, ruta) : true);
    return { role, name, perms, rolApp, loaded, isAdmin, tiene, puede };
}
