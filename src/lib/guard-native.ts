"use client";

// Puente con la APK nativa (window.AndroidGuard). Degradación elegante:
// si no existe el puente (PWA / navegador), cae a las APIs web disponibles.

export type NativeSensorData = {
    type: string;
    heading?: number;
    lux?: number;
    steps?: number;
    battery?: number;
    charging?: number;
    signal?: number;
    id?: string;   // nfc
    mag?: number;  // mandown
    version?: string;
};

function bridge(): any {
    if (typeof window === "undefined") return null;
    return (window as any).AndroidGuard || null;
}

export function isNativeApp(): boolean {
    return !!bridge();
}

function call(method: string, ...args: any[]): any {
    try {
        const b = bridge();
        if (b && typeof b[method] === "function") return b[method](...args);
    } catch { }
    return undefined;
}

export const native = {
    isNative: isNativeApp,
    version(): string | null { try { return bridge()?.getVersion?.() || null; } catch { return null; } },
    vibrate(ms: number) {
        if (isNativeApp()) call("vibrate", ms);
        else try { (navigator as any).vibrate?.(ms); } catch { }
    },
    torch(on: boolean) { call("torch", on); },
    speak(text: string) {
        if (isNativeApp()) call("speak", text);
        else try { const u = new SpeechSynthesisUtterance(text); u.lang = "es-ES"; window.speechSynthesis?.speak(u); } catch { }
    },
    alarm(on: boolean) { call("alarm", on); },
    startService() { call("startService"); },
    stopService() { call("stopService"); },
    keepAwake(on: boolean) { call("keepAwake", on); },
    enableNfc(on: boolean) { call("enableNfc", on); },
    openSettings() { call("openSettings"); },
    openAccessibility() { call("openAccessibility"); },
    getBattery(): number {
        const v = call("getBattery");
        if (typeof v === "number") return v;
        if (v != null) { const n = parseInt(String(v)); return isNaN(n) ? -1 : n; }
        return -1;
    },
    getSignal(): number {
        const v = call("getSignal");
        if (v == null) return -1;
        const n = parseInt(String(v));
        return isNaN(n) ? -1 : n;
    },
};

// Suscripción a eventos nativos (sensors, mandown, volumepanic, nfc, ready)
export function onNativeEvent(handler: (d: NativeSensorData) => void): () => void {
    if (typeof window === "undefined") return () => { };
    const fn = (e: any) => { try { handler(e.detail as NativeSensorData); } catch { } };
    window.addEventListener("guardnative", fn as any);
    return () => window.removeEventListener("guardnative", fn as any);
}
