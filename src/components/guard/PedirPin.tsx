"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Pedir el PIN de un guardia para confirmar que es quien dice ser.
 *
 * Esto era un `prompt()` del navegador, y un PIN no se pide con un prompt: lo escribe a la
 * vista de cualquiera que esté parado al lado —y en una garita siempre hay alguien parado
 * al lado—, el navegador puede ofrecerlo autocompletado, y el cuadro sale con la cara del
 * navegador y no con la de la aplicación, que en una tablet de guardia se parece bastante
 * a un cartel de engaño.
 *
 * Acá el PIN va enmascarado, el teclado del dispositivo abre en numérico, y el diálogo se
 * cierra solo si lo cancelan. La verificación sigue pasando por el servidor: el PIN no se
 * compara nunca de este lado.
 *
 * `verificar` devuelve si el PIN era bueno. Mientras corre, el botón queda ocupado: sin
 * eso, en una pantalla táctil se toca dos veces y se manda el pedido dos veces.
 */
export function PedirPin({ abierto, nombre, alCerrar, verificar, alEntrar }: {
    abierto: boolean;
    /** De quién se está pidiendo el PIN. Va en el título para que nadie confirme a otro. */
    nombre: string;
    alCerrar: () => void;
    verificar: (pin: string) => Promise<boolean>;
    alEntrar: () => void;
}) {
    const [pin, setPin] = useState("");
    const [probando, setProbando] = useState(false);
    const [malo, setMalo] = useState(false);

    useEffect(() => {
        if (abierto) { setPin(""); setProbando(false); setMalo(false); }
    }, [abierto, nombre]);

    const probar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pin.trim() || probando) return;
        setProbando(true);
        setMalo(false);
        try {
            if (await verificar(pin)) { alEntrar(); return; }
            /* El campo se vacía al fallar. No es cosmético: dejar el PIN equivocado escrito
               invita a corregirle un dígito, y si el error fue de persona y no de dedo, lo
               que queda a la vista es el PIN de otro. */
            setMalo(true);
            setPin("");
        } catch {
            setMalo(true);
        } finally {
            setProbando(false);
        }
    };

    return (
        <Dialog open={abierto} onOpenChange={(v) => { if (!v) alCerrar(); }}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[17px]">
                        <ShieldCheck size={18} className="text-[var(--accion)]" /> {nombre}
                    </DialogTitle>
                    <DialogDescription className="text-[12.5px]">
                        Escribí tu PIN para confirmar que sos vos.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={probar} className="space-y-3">
                    <PasswordInput
                        value={pin}
                        onChange={(e) => { setPin(e.target.value); setMalo(false); }}
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus
                        placeholder="PIN"
                        className="h-12 text-center text-lg tracking-[0.35em] tabular-nums"
                    />
                    {malo && (
                        <p className="text-[12.5px] text-[var(--mal-texto)]">
                            Ese PIN no es el de {nombre}. Probá de nuevo.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button type="button" variant="ghost" className="flex-1" onClick={alCerrar}>
                            Cancelar
                        </Button>
                        <Button type="submit" className="flex-1" disabled={!pin.trim() || probando}>
                            {probando && <Loader2 size={15} className="animate-spin" />}
                            {probando ? "Comprobando…" : "Entrar"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
