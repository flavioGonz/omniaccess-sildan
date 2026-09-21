"use client";

import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import type { Franja } from "./useFranja";

/**
 * Los controles de la franja, para el costado.
 *
 * Están separados del dibujo porque viven en dos lugares distintos —la barra lateral del
 * calibrador y la ficha del equipo— mientras que el dibujo va siempre encima de la escena.
 *
 * ## El orden de los botones es el orden del trabajo
 *
 * Dibujar → decir cuántos entran → guardar → **enseñarle cómo se ve vacía** → medir. El
 * cuarto paso es el único que necesita una persona y el único que no se puede deducir:
 * desde el servidor no hay manera de saber si ese auto que se ve estaba o no estaba.
 * Mientras no esté aprendida, la franja no mide y lo dice — un motor que igual contesta
 * algo cuando no sabe es exactamente lo que esto vino a reemplazar.
 */
export function FranjaPanel({ franja, compacto = false, alTomar }: {
    franja: Franja;
    compacto?: boolean;
    /**
     * Quién toma el cuadro, cuando no es la franja.
     *
     * En el calibrador la escena la trae la pantalla, no la franja: si el botón llamara a
     * `franja.tomar()` gastaría un ffmpeg en una foto que nadie muestra, y el operador
     * vería un botón que no hace nada. Un control que no hace nada es indistinguible de
     * uno roto.
     */
    alTomar?: () => void;
}) {
    const {
        lugares, setLugares, activa, setActiva, existe, aprendida, estados,
        ocupado, aviso, hayRtsp, tomar, guardar, aprender, medir, quitar,
    } = franja;

    const ocupadas = estados ? estados.filter((c) => c.ocupado).length : null;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <Pista titulo="Cuántos autos entran"
                    texto="No se puede deducir de la imagen: no hay escala. Lo sabe quien mira la calle, y es el único número que hay que poner.">
                    <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="text-muted-foreground">Lugares</span>
                        <Button size="icon-sm" variant="outline" onClick={() => setLugares((n) => Math.max(1, n - 1))}>−</Button>
                        <span className="w-6 text-center tabular-nums font-semibold">{lugares}</span>
                        <Button size="icon-sm" variant="outline" onClick={() => setLugares((n) => Math.min(40, n + 1))}>+</Button>
                    </div>
                </Pista>

                <label className="flex items-center gap-1.5 text-[12px] shrink-0">
                    <input type="checkbox" checked={activa}
                        onChange={(e) => setActiva(e.target.checked)}
                        className="accent-[var(--accion)]" />
                    Activa
                </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={!hayRtsp || !!ocupado} onClick={alTomar ?? tomar}>
                    {ocupado === "tomando" ? "Tomando…" : "Tomar cuadro"}
                </Button>
                <Button size="sm" variant="outline" disabled={!hayRtsp || !existe || !!ocupado} onClick={medir}>
                    {ocupado === "midiendo" ? "Mirando…" : "Medir ahora"}
                </Button>
                <Pista titulo="Con la calle vacía"
                    texto="Apretalo SÓLO cuando no haya ningún auto en la franja. Es la referencia contra la que se compara todo lo demás, y una referencia aprendida con un auto encima deja ese lugar marcado para siempre.">
                    <Button size="sm" variant="outline" className="w-full"
                        disabled={!hayRtsp || !existe || !!ocupado} onClick={aprender}>
                        {ocupado === "aprendiendo" ? "Aprendiendo…" : "Está vacía ahora"}
                    </Button>
                </Pista>
                <Button size="sm" disabled={!!ocupado} onClick={guardar}>
                    {ocupado === "guardando" ? "Guardando…" : "Guardar franja"}
                </Button>
            </div>

            {/* El estado se dice siempre, incluso cuando es "no sé": una franja que no mide y
                no lo dice es indistinguible de una que mide y no encuentra a nadie. */}
            <div className="text-[12px] flex flex-wrap items-center gap-x-2 gap-y-1">
                {aprendida
                    ? <span className="chip-bien">Sabe cómo se ve vacía</span>
                    : <span className="chip-aviso">Falta enseñarle el vacío</span>}
                {ocupadas != null && (
                    <span className="text-muted-foreground tabular-nums">
                        {ocupadas} de {lugares} ocupados
                    </span>
                )}
            </div>

            {aviso && <p className="text-[12px] tono-aviso leading-relaxed">{aviso}</p>}

            {estados && !compacto && (
                <ul className="space-y-1 text-[12px]">
                    {estados.map((c) => (
                        <li key={c.lugar} className="flex items-baseline gap-2">
                            <span className="tabular-nums text-muted-foreground w-4">{c.lugar + 1}</span>
                            <span className={c.ocupado ? "font-semibold" : "text-muted-foreground"}>
                                {c.ocupado ? "ocupado" : "libre"}
                            </span>
                            <span className="text-muted-foreground truncate">— {c.motivo}</span>
                        </li>
                    ))}
                </ul>
            )}

            {existe && (
                <Button size="sm" variant="ghost" disabled={!!ocupado} onClick={quitar}
                    className="text-[12px] px-0">
                    Quitar la franja
                </Button>
            )}
        </div>
    );
}
