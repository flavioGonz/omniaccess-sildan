"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Dónde vive la app del celular (PWA). */
export const RUTA_ENTRENADOR = "/pwa/entrenador";

/**
 * «Desde el celular»: el QR que abre el Entrenador en el teléfono. Juntar fotos de un objeto es
 * caminar hasta él y sacarlas, y dibujar el recuadro con el dedo sobre la foto recién sacada es
 * más rápido que bajarla a la compu. El QR evita tipear la dirección en el teléfono.
 */
export function AlCelular() {
    const [qr, setQr] = useState<string | null>(null);
    const [url, setUrl] = useState("");
    useEffect(() => {
        const u = `${window.location.origin}${RUTA_ENTRENADOR}`;
        setUrl(u);
        QRCode.toDataURL(u, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
    }, []);
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold hover:bg-accent">
                    <Smartphone size={15} /> Desde el celular
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[300px] space-y-2.5">
                <div className="text-[13px] font-bold">Entrenador en el celular</div>
                <p className="text-[12px] text-muted-foreground leading-snug">
                    Escaneá con la cámara del teléfono. Sacás la foto del objeto, dibujás el recuadro con el dedo y queda en este mismo conjunto. También para etiquetar escenas. En el menú del navegador, «Agregar a la pantalla de inicio» la deja como una app.
                </p>
                {qr ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qr} alt={`QR para abrir ${url}`} className="w-full rounded-md bg-white p-2" />
                ) : <div className="aspect-square rounded-md bg-muted animate-pulse" />}
                <div className="text-[11.5px] text-muted-foreground break-all">{url}</div>
            </PopoverContent>
        </Popover>
    );
}
