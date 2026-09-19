import { cn } from "@/lib/utils";

/**
 * El hueco que ocupa algo que todavía no llegó.
 *
 * Existía y casi nadie lo usaba — un solo importador en toda la aplicación —, y el motivo
 * estaba adentro: el fondo era `bg-neutral-800/50`, un gris oscuro fijo. En tema claro eso
 * es una mancha oscura sobre blanco, así que cada pantalla que necesitó un esqueleto se
 * escribió el suyo. Ahora el fondo sale del tema y sirve en los dos.
 *
 * `superficie="oscura"` es para lo que vive sobre video o sobre una foto, donde el fondo no
 * lo pone la aplicación sino la cámara.
 *
 * `brillo` agrega el barrido de luz. No es adorno: un bloque que sólo late puede confundirse
 * con un elemento deshabilitado, y el barrido dice "esto está viniendo" sin texto.
 */
function Skeleton({ className, brillo, superficie = "tema", ...props }: React.HTMLAttributes<HTMLDivElement> & {
    brillo?: boolean;
    superficie?: "tema" | "oscura";
}) {
    return (
        <div
            className={cn(
                "rounded-md overflow-hidden relative",
                superficie === "oscura" ? "bg-white/[0.07]" : "bg-muted",
                brillo ? "esqueleto-brillo" : "animate-pulse",
                className,
            )}
            {...props}
        />
    );
}

export { Skeleton };
