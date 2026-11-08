import { prisma } from "@/lib/prisma";

// Fuente ÚNICA de configuración del motor de rostros (CompreFace).
//
// Por qué existe: el código de face estaba partido entre dos motores. `face-verify.ts`
// tenía la URL y las keys hardcodeadas al servidor viejo `compareface.infratec.com.uy`
// (caído), mientras que `face-admin.ts` leía los Settings (motor nuevo del lab). Mitad
// de la app le hablaba a un servidor muerto, así que nada funcionaba de punta a punta.
// Acá se centraliza: todo lee los Settings, un solo motor.
//
// CompreFace separa las operaciones por servicio y cada servicio tiene su propia key:
//   - reconocimiento  -> recoKey  (enrolar, /recognize, /faces, /subjects)
//   - detección       -> detKey   (/detection/detect). OJO: con la key de reconocimiento
//     el endpoint de detección devuelve 0 caras SIN error. Son keys distintas.
// En el lab se usa la app Demo que trae CompreFace (reco 000...002, det 000...003).

export interface CompreFaceConfig {
    url: string;
    recoKey: string;
    detKey: string;
}

let cache: { cfg: CompreFaceConfig; at: number } | null = null;
const TTL_MS = 15000; // los Settings cambian poco; evita una consulta por request

export async function getCompreFace(): Promise<CompreFaceConfig> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;

    const rows = await prisma.setting.findMany({
        where: { key: { in: ["COMPAREFACE_URL", "COMPAREFACE_KEY", "COMPAREFACE_DET_KEY"] } }
    });
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = r.value;

    const cfg: CompreFaceConfig = {
        url: (m.COMPAREFACE_URL || process.env.COMPARE_FACE_URL || "http://127.0.0.1:8001").replace(/\/$/, ""),
        recoKey: m.COMPAREFACE_KEY || process.env.COMPAREFACE_API_KEY || "",
        // Si no hay key de detección propia, se cae a la de reconocimiento (puede no detectar;
        // en el lab hay que setear COMPAREFACE_DET_KEY con la key del servicio de detección).
        detKey: m.COMPAREFACE_DET_KEY || m.COMPAREFACE_KEY || process.env.COMPAREFACE_DET_KEY || ""
    };
    cache = { cfg, at: Date.now() };
    return cfg;
}

// Para forzar relectura tras cambiar los Settings desde el panel de administración.
export function invalidarConfigRostros() {
    cache = null;
}
