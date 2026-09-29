"use client";

import { useRef, useState, useCallback } from "react";

/**
 * Visor de imagen con zoom táctil para tablets (WebView-friendly):
 *  - pellizcar con dos dedos para hacer zoom
 *  - arrastrar con un dedo para desplazar (cuando hay zoom)
 *  - doble toque para acercar / restablecer
 *  - rueda del mouse en escritorio
 * Autocontenido, sin dependencias.
 */
export function PinchZoom({ src, alt, className }: { src: string; alt?: string; className?: string }) {
    const [scale, setScale] = useState(1);
    const [tx, setTx] = useState(0);
    const [ty, setTy] = useState(0);
    const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinch = useRef<{ dist: number; scale: number } | null>(null);
    const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const lastTap = useRef(0);
    const [dragging, setDragging] = useState(false);

    const clamp = (s: number) => Math.min(6, Math.max(1, s));

    const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
            const p = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), scale };
            pan.current = null;
        } else if (pointers.current.size === 1) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
                if (scale > 1) reset(); else setScale(2.5);
                lastTap.current = 0;
            } else {
                lastTap.current = now;
                pan.current = { x: e.clientX, y: e.clientY, tx, ty };
                setDragging(true);
            }
        }
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinch.current) {
            const p = [...pointers.current.values()];
            const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            setScale(clamp(pinch.current.scale * (dist / pinch.current.dist)));
        } else if (pointers.current.size === 1 && pan.current && scale > 1) {
            setTx(pan.current.tx + (e.clientX - pan.current.x));
            setTy(pan.current.ty + (e.clientY - pan.current.y));
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) { pan.current = null; setDragging(false); if (scale <= 1) reset(); }
    };

    const onWheel = (e: React.WheelEvent) => {
        setScale((s) => clamp(s - Math.sign(e.deltaY) * 0.3));
    };

    return (
        <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className={className}
            style={{ touchAction: "none", overflow: "hidden", cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={alt || ""}
                draggable={false}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                    transformOrigin: "center center",
                    transition: pointers.current.size ? "none" : "transform 0.15s ease-out",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    willChange: "transform",
                }}
            />
        </div>
    );
}
