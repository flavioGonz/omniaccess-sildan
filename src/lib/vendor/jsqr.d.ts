// Tipos mínimos de jsQR 1.4.0 (lo que usa src/lib/leer-qr.ts).
declare const jsQR: (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;
export default jsQR;
