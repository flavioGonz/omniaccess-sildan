"use client";

import { ConfirmarEnCajon } from "@/components/ui/cajon-confirmar";

/**
 * Confirmar una eliminación. Uno solo para toda la aplicación.
 *
 * Tres cosas estaban mal, y las tres se notaban recién en el peor momento:
 *
 *   **Decía «este usuario» siempre.** El texto de advertencia estaba escrito fijo — «Si
 *   eliminas este usuario del dispositivo, dejará de tener acceso inmediatamente» — así que
 *   al borrar un vehículo, una unidad o un grupo el diálogo hablaba de un usuario que no
 *   existía. Peor: `description`, la prop pensada justamente para decir qué se pierde en
 *   cada caso, estaba declarada y **nunca se usaba**.
 *
 *   **Un borrado fallido se veía igual que uno exitoso.** `onDelete` devuelve
 *   `{ success, error }` en casi todas las acciones, y acá se ignoraba: el diálogo cerraba
 *   y avisaba éxito aunque la base hubiera rechazado la operación. El registro volvía a
 *   aparecer al recargar y nadie sabía por qué. Ahora, si falla, el diálogo queda abierto y
 *   muestra el motivo.
 *
 *   **El botón rojo usaba `text-foreground`**, que en tema claro es casi negro: texto
 *   oscuro sobre rojo. El blanco sobre rojo no depende del tema, y por eso va fijo.
 */

type Resultado = void | { success?: boolean; error?: string | null } | null | undefined;

/*
 * Se llama ConfirmarAccion y no DeleteConfirmDialog porque no todas las acciones que hay
 * que confirmar son borrados: cambiar la base de datos, volcar el padrón sobre un equipo o
 * resetear un plano no borran un registro y son igual de difíciles de deshacer. El nombre
 * viejo queda exportado al final del archivo para no tener que tocar los veinte lugares que
 * ya lo usan — cambiarlos todos de golpe sería churn sin ninguna ganancia.
 */

interface ConfirmarAccionProps {
    id: string;
    /** Qué se va a borrar, con su nombre. Es lo que el operador lee para confirmar. */
    title: string;
    /** Qué se pierde exactamente. Si no viene, se dice lo genérico y nada más. */
    description?: string;
    onDelete: (id: string) => Promise<Resultado>;
    onSuccess: () => void;
    /**
     * El disparador. Es OPCIONAL: sin él, el diálogo es puramente controlado.
     *
     * Hay dos maneras legítimas de pedir una confirmación. Una es envolver el botón que la
     * dispara — cómoda cuando el botón existe y está ahí. La otra es abrirla desde un
     * manejador que ya está corriendo, que es el caso de todo lo que antes usaba
     * `confirm()`: ahí no hay un botón que envolver, hay una función a mitad de camino.
     * Soportar las dos evita que aparezca un quinto mecanismo de confirmación para el
     * segundo caso.
     */
    /**
     * Si viene, hay que ESCRIBIR esta palabra para que el botón se habilite.
     *
     * Es para lo que no tiene vuelta atrás y afecta a muchos registros a la vez — purgar
     * una tabla entera, por ejemplo. Un botón de confirmar se aprieta por reflejo; nadie
     * escribe una palabra por reflejo. No es burocracia: es el único freno que obliga a
     * leer qué se está por hacer.
     */
    escribir?: string;
    /** Qué dice el botón. Por defecto "Eliminar". */
    etiquetaAccion?: string;
    children?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function ConfirmarAccion(props: ConfirmarAccionProps) {
    // 10/10, pedido de Nico: el diálogo centrado (ícono, título y un botón rojo a todo el ancho)
    // era la única ventana que no se parecía al resto. Ahora es el cajón de confirmar, con el
    // mismo contrato: los veinte lugares que lo usan pasan a cajón sin tocarlos.
    return <ConfirmarEnCajon {...props} description={props.description || `Se elimina «${props.title}».`} />;
}

/** El nombre anterior. Sigue siendo el mismo componente. */
export const DeleteConfirmDialog = ConfirmarAccion;
