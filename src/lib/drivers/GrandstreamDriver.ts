import { IDeviceDriver, IRfidDriver, ILogDriver, IFaceDriver } from "./IDeviceDriver";
import { Device, Credential } from "@prisma/client";
import axios from "axios";
import * as https from "https";
import * as crypto from "crypto";

/**
 * Driver de los porteros IP Grandstream GDS (GDS3710 / GDS37xx).
 *
 * Qué está PROBADO contra el equipo real (172.26.20.69, read-only, sin abrir la puerta):
 *   · Es un Grandstream: el servidor web es `GDSWebs`.
 *   · La API va por HTTPS (el puerto 80 redirige a 443) con certificado propio.
 *   · La autenticación challenge/response de la GDS HTTP API responde: a
 *     `GET /goform/login?cmd=login&user=admin&type=0` devuelve
 *     `<Configuration><ResCode>0</ResCode><ChallengeCode>…</ChallengeCode></Configuration>`.
 *
 * Qué está ESCRITO según la GDS37xx HTTP API pero PENDIENTE de probar con credenciales:
 *   · Login completo (authcode), lectura de usuarios/tarjetas (`/goform/config type=user_list`),
 *     alta/baja de tarjetas y PIN.
 *
 * Qué NO se hace todavía (a propósito, para no mentir — ver drivers/catalogo.ts):
 *   · Abrir la puerta: la GDS exige habilitar «HTTP API Remote Open Door» (P15424) en el equipo
 *     y el endpoint de apertura de un disparo no está en la doc pública. `triggerRelay` lanza un
 *     error claro en vez de simular que abrió. Se cablea tras una prueba controlada con Nico.
 *   · Base de rostros nativa del equipo: la GDS guarda las caras ligadas a sus usuarios, pero el
 *     endpoint de carga de foto de cara no está en la doc pública. Hoy el reconocimiento facial
 *     del Portero lo hace OmniVision+CompreFace sobre su stream (ver modo-face). La comparación
 *     NATIVA del equipo + doble verificación se cablea cuando se confirme su push de eventos.
 *
 * La contraseña del `device` llega ya descifrada por la capa de la app (lib-cifrado-datos),
 * como en todos los drivers; este archivo no maneja texto plano de credenciales por su cuenta.
 */

// Sal del hash por modelo (GDS37xx HTTP API). Por defecto la de la GDS3710.
const SAL_POR_MODELO: Record<string, string> = {
    GDS3710: "GDS3710lZpRsFzCbM",
    GDS3705: "GDS3705lWB29xKhBc",
    GDS3712: "GDS3712lZpRsFzCbM",
};
function salDe(device: Device): string {
    const m = (device.deviceModel || "").toUpperCase();
    for (const k of Object.keys(SAL_POR_MODELO)) if (m.includes(k)) return SAL_POR_MODELO[k];
    return SAL_POR_MODELO.GDS3710;
}

const agente = new https.Agent({ rejectUnauthorized: false });

/** No se pudo/por ahora no se sabe hacer: se DICE, no se simula (ver catalogo.ts). */
export class GrandstreamPendiente extends Error {
    constructor(que: string) { super(`Grandstream: ${que} — pendiente de verificar contra el equipo (credenciales / prueba controlada).`); }
}

export class GrandstreamDriver implements IDeviceDriver, IRfidDriver, ILogDriver, IFaceDriver {

    private base(device: Device): string {
        // La GDS sirve la API por HTTPS; el 80 redirige al 443.
        return `https://${device.ip}`;
    }

    /** Login challenge/response. Devuelve la cookie de sesión para los pedidos siguientes. */
    private async login(device: Device): Promise<string> {
        const user = device.username || "admin";
        const base = this.base(device);
        const r1 = await axios.get(`${base}/goform/login`, {
            params: { cmd: "login", user, type: 0 }, httpsAgent: agente, timeout: 10000, responseType: "text",
        });
        const challenge = /<ChallengeCode>([^<]+)<\/ChallengeCode>/.exec(String(r1.data))?.[1];
        if (!challenge) throw new Error("no se obtuvo ChallengeCode (¿no es una GDS, o el usuario no existe?)");
        const authcode = crypto.createHash("md5")
            .update(`${challenge}:${salDe(device)}:${device.password || ""}`)
            .digest("hex");
        const r2 = await axios.get(`${base}/goform/login`, {
            params: { cmd: "login", user, authcode, type: 0 }, httpsAgent: agente, timeout: 10000, responseType: "text",
        });
        const res = /<ResCode>(-?\d+)<\/ResCode>/.exec(String(r2.data))?.[1];
        if (res !== "0") throw new Error(`login rechazado (ResCode ${res ?? "?"}): credenciales o usuario inválidos`);
        const cookie = (r2.headers["set-cookie"] || []).map((c: string) => c.split(";")[0]).join("; ");
        if (!cookie) throw new Error("login sin cookie de sesión");
        return cookie;
    }

    /** GET a /goform con la sesión ya iniciada. Devuelve el XML crudo. */
    private async goform(device: Device, ruta: string, params: Record<string, any>, cookie: string): Promise<string> {
        const r = await axios.get(`${this.base(device)}${ruta}`, {
            params, httpsAgent: agente, timeout: 15000, responseType: "text",
            headers: cookie ? { Cookie: cookie } : {},
        });
        return String(r.data);
    }

    private resCode(xml: string): number {
        const m = /<ResCode>(-?\d+)<\/ResCode>/.exec(xml);
        return m ? Number(m[1]) : NaN;
    }

    /** Prueba de conexión: hace el handshake completo y lee info del equipo. Verificable. */
    async probarConexion(device: Device): Promise<{ ok: boolean; modelo?: string; version?: string; error?: string }> {
        try {
            const cookie = await this.login(device);
            const xml = await this.goform(device, "/goform/config", { cmd: "get", type: "info" }, cookie);
            const modelo = /<(?:Device|Product)Model>([^<]+)</i.exec(xml)?.[1];
            const version = /<(?:Firmware|SW)Version>([^<]+)</i.exec(xml)?.[1];
            return { ok: true, modelo, version };
        } catch (e: any) {
            return { ok: false, error: e?.message || "no se pudo conectar" };
        }
    }

    async getDeviceInfo(device: Device): Promise<Record<string, string>> {
        const cookie = await this.login(device);
        const xml = await this.goform(device, "/goform/config", { cmd: "get", type: "info" }, cookie);
        const info: Record<string, string> = {};
        for (const m of xml.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) info[m[1]] = m[2];
        return info;
    }

    getSnapshotURL(device: Device): string {
        // La GDS expone el JPEG actual acá (se pide con la sesión / auth del equipo).
        return `${this.base(device)}/jpeg/view.html`;
    }

    // ── Tarjetas / usuarios del equipo (GDS37xx HTTP API: /goform/config type=user_list) ──

    /** Lee las tarjetas/usuarios cargados en el equipo. */
    async listarTarjetas(device: Device): Promise<{ id: string; nombre?: string }[]> {
        const cookie = await this.login(device);
        const xml = await this.goform(device, "/goform/config", { cmd: "get", type: "user_list" }, cookie);
        const out: { id: string; nombre?: string }[] = [];
        for (const item of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
            const id = /<ID>([^<]+)<\/ID>/.exec(item[1])?.[1];
            const nombre = /<(?:UserName|Name)>([^<]*)</.exec(item[1])?.[1];
            if (id) out.push({ id, nombre });
        }
        return out;
    }

    /** Alta/alta-modificación de una tarjeta RFID en el equipo. */
    async upsertCredential(credential: Credential, device: Device): Promise<void> {
        if (credential.type !== "TAG") return; // este driver sólo carga tarjetas al equipo
        const cookie = await this.login(device);
        const xml = await this.goform(device, "/goform/config", {
            cmd: "add", ID: credential.value, room_num: 1, sip_num: 1,
            username: credential.notes || credential.value,
        }, cookie);
        const rc = this.resCode(xml);
        if (rc !== 0) throw new Error(`alta de tarjeta rechazada (ResCode ${rc})`);
    }

    async syncRfKey(credential: Credential, device: Device): Promise<void> {
        return this.upsertCredential(credential, device);
    }

    async deleteCredential(credentialValue: string, device: Device): Promise<void> {
        const cookie = await this.login(device);
        const xml = await this.goform(device, "/goform/config", { cmd: "del", ID: credentialValue }, cookie);
        const rc = this.resCode(xml);
        if (rc !== 0) throw new Error(`baja de tarjeta rechazada (ResCode ${rc})`);
    }

    async deleteRfKey(credential: Credential, device: Device): Promise<void> {
        return this.deleteCredential(credential.value, device);
    }

    // ── Puerta: todavía no (honesto) ──

    async triggerRelay(_device: Device): Promise<void> {
        // La GDS exige habilitar «HTTP API Remote Open Door» (P15424) y el endpoint de apertura
        // de un disparo no está en la doc pública. No se adivina ni se simula: se cablea tras una
        // prueba controlada con Nico (abrir una puerta es una acción física).
        throw new GrandstreamPendiente("abrir la puerta");
    }

    // ── Rostros: hoy por OmniVision+CompreFace sobre el stream; nativo del equipo, pendiente ──

    async getFacesFromCamera(_device: Device): Promise<any[]> {
        // El reconocimiento facial del Portero lo hace OmniVision+CompreFace (modo-face). La base
        // de rostros NATIVA del equipo (y su push de eventos para la doble verificación) necesita
        // el endpoint de la GDS, que no está en la doc pública: se confirma contra el equipo.
        throw new GrandstreamPendiente("leer la base de rostros nativa del equipo");
    }

    async syncUserWithFace(_user: any, _device: Device): Promise<void> {
        throw new GrandstreamPendiente("cargar un rostro al equipo");
    }

    // ── Bitácora: pendiente (endpoint de log por verificar) ──

    async getDoorlog(_device: Device, _num?: number, _offset?: number): Promise<any[]> {
        throw new GrandstreamPendiente("leer la bitácora del equipo");
    }
}
