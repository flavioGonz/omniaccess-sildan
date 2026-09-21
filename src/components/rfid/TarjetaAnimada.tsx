"use client";

/**
 * La tarjeta RFID, dibujada y viva.
 *
 * ## Por qué un dibujo y no un ícono
 *
 * El cajón de una tarjeta es la única pantalla donde el objeto del que se habla es una cosa
 * física que la persona tiene en la mano. Un ícono de 16 px arriba de un título no dice
 * nada que el título no diga; un dibujo del tamaño de la tarjeta ancla la pantalla en el
 * objeto y ahorra la frase "esto es una tarjeta de proximidad".
 *
 * ## Qué anima, y qué no
 *
 * Sólo las ondas, y sólo cuando la tarjeta **está cargada en algún lector**. Ahí la
 * animación no decora: dice que esa tarjeta abre. Una tarjeta que todavía no llegó a
 * ningún equipo se dibuja quieta y apagada, y la diferencia se ve de lejos sin leer nada.
 *
 * Es la misma regla que el resto del sistema: el movimiento es estado, no adorno.
 *
 * `prefers-reduced-motion` las deja quietas. No se pierde información: el color de las
 * ondas ya distingue los dos casos, así que la animación es refuerzo y no el único canal.
 */

export function TarjetaAnimada({ viva, className }: { viva: boolean; className?: string }) {
    return (
        <svg viewBox="0 0 220 132" className={className} role="img"
            aria-label={viva ? "Tarjeta cargada en los lectores" : "Tarjeta todavía sin cargar"}>
            <defs>
                <linearGradient id="tarjeta-cuerpo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--card)" />
                    <stop offset="100%" stopColor="var(--muted)" />
                </linearGradient>
            </defs>

            {/* El cuerpo. Radio 10, como un panel del sistema. */}
            <rect x="8" y="18" width="150" height="96" rx="10"
                fill="url(#tarjeta-cuerpo)" stroke="var(--border)" strokeWidth="1.5" />

            {/* La antena: la espiral que toda tarjeta de proximidad tiene adentro. */}
            <g fill="none" stroke="var(--border)" strokeWidth="1.25" opacity="0.75">
                <rect x="22" y="32" width="122" height="68" rx="7" />
                <rect x="30" y="40" width="106" height="52" rx="5" />
                <rect x="38" y="48" width="90" height="36" rx="4" />
            </g>

            {/* El chip. */}
            <rect x="26" y="74" width="26" height="20" rx="3"
                fill="var(--muted)" stroke="var(--border)" strokeWidth="1.25" />
            <path d="M26 84h26M39 74v20" stroke="var(--border)" strokeWidth="1.25" />

            {/* Las ondas. El color dice el estado; la animación lo refuerza. */}
            <g fill="none" strokeWidth="3.5" strokeLinecap="round"
                stroke={viva ? "var(--bien)" : "var(--border)"}
                className={viva ? "omni-rfid-ondas" : undefined}>
                <path d="M166 56a24 24 0 0 1 0 20" />
                <path d="M180 46a42 42 0 0 1 0 40" />
                <path d="M194 36a60 60 0 0 1 0 60" />
            </g>
        </svg>
    );
}
