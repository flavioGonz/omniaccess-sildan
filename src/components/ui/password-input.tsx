"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Campo de contraseña enmascarado con botón de ojo para mostrar/ocultar.
// Mismas props que <Input>; reserva espacio a la derecha para el ojo.
type Props = React.ComponentProps<typeof Input> & { toggleClassName?: string };

export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
    ({ className, toggleClassName, ...props }, ref) => {
        const [show, setShow] = React.useState(false);
        return (
            <div className="relative w-full">
                <Input
                    ref={ref}
                    type={show ? "text" : "password"}
                    className={cn("pr-10", className)}
                    {...props}
                />
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className={cn(
                        "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors",
                        toggleClassName
                    )}
                >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
        );
    }
);
PasswordInput.displayName = "PasswordInput";
