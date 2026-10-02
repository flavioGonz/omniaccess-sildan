"use client";

import dynamic from "next/dynamic";

const PassMap = dynamic(() => import("./PassMap"), {
    ssr: false,
    loading: () => <div style={{ height: 180, background: "#e5e7eb", display: "grid", placeItems: "center", color: "#9ca3af", fontSize: 12 }}>Cargando mapa…</div>,
});

export default function PassMapLazy(props: { lat: number; lng: number; poly?: [number, number][] | null; label?: string }) {
    return <PassMap {...props} />;
}
