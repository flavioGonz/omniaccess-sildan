import crypto from "crypto";

/**
 * API RPC2 (JSON) de Dahua: la que usa su propia web. El CGI viejo no expone CPU, memoria,
 * interfaces de red ni el estado de cada canal (en el NVR5232 de Olivos contesta 501);
 * RPC2 sí. Login en dos pasos (realm/random → hash MD5), una sesión por consulta y logout.
 */
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex").toUpperCase();

export type Rpc2 = { call: (method: string, params?: any) => Promise<any>; close: () => Promise<void> };

export async function rpc2Sesion(dev: { ip: string; username?: string | null; password?: string | null; port?: number | null }, timeoutMs = 6000): Promise<Rpc2> {
    const base = `http://${dev.ip}`;
    const user = dev.username || "admin";
    let id = 1;
    const post = async (path: string, body: any) => {
        const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    };
    const a = await post("/RPC2_Login", { method: "global.login", params: { userName: user, password: "", clientType: "Web3.0", loginType: "Direct" }, id: id++ });
    const { realm, random } = a?.params || {};
    if (!realm || !random) throw new Error("El equipo no habla RPC2");
    const hash = md5(`${user}:${random}:${md5(`${user}:${realm}:${dev.password || ""}`)}`);
    const b = await post("/RPC2_Login", { method: "global.login", params: { userName: user, password: hash, clientType: "Web3.0", loginType: "Direct", authorityType: "Default", passwordType: "Default" }, id: id++, session: a.session });
    if (!b?.result) throw new Error(b?.error?.code === 268632085 ? "Usuario o contraseña incorrectos" : "Login RPC2 rechazado");
    const session = b.session || a.session;
    return {
        call: async (method, params = null) => {
            const r = await post("/RPC2", { method, params, id: id++, session });
            if (!r?.result) throw new Error(r?.error?.message || `${method} falló`);
            return r.params;
        },
        close: async () => { try { await post("/RPC2", { method: "global.logout", params: null, id: id++, session }); } catch { } },
    };
}

/** Ejecuta varias llamadas tolerando las que el modelo no implemente. */
export async function rpc2Varios(s: Rpc2, llamadas: Record<string, [string, any?]>): Promise<Record<string, any>> {
    const out: Record<string, any> = {};
    await Promise.all(Object.entries(llamadas).map(async ([k, [m, p]]) => { try { out[k] = await s.call(m, p ?? null); } catch { out[k] = null; } }));
    return out;
}
