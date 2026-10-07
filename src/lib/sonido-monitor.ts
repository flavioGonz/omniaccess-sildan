"use client";

/**
 * El sonido de las vistas de pantalla.
 *
 * Dos tonos sintetizados con la Web Audio API, sin archivos: no hay nada que servir ni
 * cachear, y una PC de pared que arranca sola no tiene que esperar una descarga para sonar.
 * El navegador bloquea el audio hasta el primer gesto del usuario; acá eso no se esconde:
 * `bloqueado()` lo dice y la vista muestra el aviso "tocá la pantalla para habilitar el
 * sonido". `habilitar()` se llama en el primer pointerdown y reintenta.
 */

type Tono = "alarma" | "denegado" | "lista";

let ctx: AudioContext | null = null;
const Ctx = () => { if (typeof window === "undefined") return null; const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return null; if (!ctx) ctx = new C(); return ctx; };

export function bloqueado(): boolean { const c = Ctx(); return !c || c.state !== "running"; }
export async function habilitar(): Promise<boolean> { const c = Ctx(); if (!c) return false; try { if (c.state !== "running") await c.resume(); } catch { } return c.state === "running"; }

const SECUENCIAS: Record<Tono, { f: number; d: number }[]> = {
    alarma: [{ f: 988, d: 0.16 }, { f: 1319, d: 0.16 }, { f: 988, d: 0.16 }, { f: 1319, d: 0.16 }],
    denegado: [{ f: 440, d: 0.18 }, { f: 330, d: 0.22 }],
    lista: [{ f: 1175, d: 0.12 }, { f: 1175, d: 0.12 }, { f: 1568, d: 0.26 }],
};

export function sonar(tono: Tono): boolean {
    const c = Ctx(); if (!c || c.state !== "running") return false;
    try {
        let t = c.currentTime;
        for (const { f, d } of SECUENCIAS[tono]) {
            const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination);
            o.type = tono === "alarma" ? "square" : "triangle"; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d - 0.02);
            o.start(t); o.stop(t + d); t += d;
        }
        return true;
    } catch { return false; }
}
