import { getPublicPass, getQrSvg, nombreDelBarrio } from "@/app/actions/invitations";
import PassMapLazy from "./PassMapLazy";

export const dynamic = "force-dynamic";

const fmt = (s?: string) => s ? new Date(s).toLocaleString("es-UY", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

const STATUS: Record<string, { label: string; cls: string }> = {
    valid: { label: "Pase vigente", cls: "bg-emerald-500" },
    notyet: { label: "Aún no vigente", cls: "bg-amber-500" },
    expired: { label: "Vencido", cls: "bg-zinc-500" },
    revoked: { label: "Revocado", cls: "bg-red-600" },
    notfound: { label: "No encontrado", cls: "bg-zinc-600" },
};

export default async function InvitadoPassPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const pass = await getPublicPass(token);
    const svg = pass.ok || pass.qrToken ? await getQrSvg(pass.qrToken || token) : "";
    const st = STATUS[pass.status || "notfound"] || STATUS.notfound;
    const hostName = pass.hostName || pass.host || "";
    const hostLabel = pass.hostLabel || "";
    // El barrio sale de Ajustes → Marca; estaba escrito a mano con el nombre de otro barrio.
    const barrio = await nombreDelBarrio();

    return (
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "20px", background: "linear-gradient(160deg,#0b1220,#111827)", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
                <div style={{ background: "linear-gradient(135deg,#f59e0b,#ea580c)", color: "#fff", padding: "20px 22px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", opacity: .9 }}>PASE DE VISITA{barrio ? ` · ${barrio.toUpperCase()}` : ""}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pass.name || "Invitado"}</div>
                    {hostName && <div style={{ fontSize: 13, opacity: .95, marginTop: 3 }}>Te invita: <b>{hostName}</b></div>}
                    {hostLabel && <div style={{ fontSize: 13, opacity: .95, marginTop: 1 }}>🏠 {hostLabel}</div>}
                </div>
                <div style={{ padding: 22, textAlign: "center" }}>
                    {!pass.name ? (
                        <p style={{ color: "#6b7280", fontWeight: 600, padding: "30px 0" }}>Este pase no existe o fue dado de baja.</p>
                    ) : (
                        <>
                            <div style={{ display: "inline-block", padding: 10, background: "#fff", borderRadius: 16, border: "1px solid #eee" }} dangerouslySetInnerHTML={{ __html: svg }} />
                            <div style={{ marginTop: 14 }}>
                                <span style={{ display: "inline-block", padding: "6px 14px", borderRadius: 999, color: "#fff", fontWeight: 800, fontSize: 13 }} className={st.cls}>{st.label}</span>
                            </div>
                            <div style={{ marginTop: 16, textAlign: "left", fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                                {pass.plates && pass.plates.length > 0 && <div>🚗 <b>{pass.plates.join(", ")}</b></div>}
                                <div>🕒 {fmt(pass.validFrom)}</div>
                                <div style={{ paddingLeft: 22 }}>→ {fmt(pass.validTo)}</div>
                            </div>

                            {pass.geo && (
                                <div style={{ marginTop: 16, textAlign: "left" }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "#9ca3af", marginBottom: 6 }}>Ubicación del lote</div>
                                    <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                        <PassMapLazy lat={pass.geo.lat} lng={pass.geo.lng} poly={pass.poly || null} label={hostLabel || hostName} />
                                    </div>
                                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${pass.geo.lat},${pass.geo.lng}`} target="_blank" rel="noopener noreferrer"
                                        style={{ display: "block", textAlign: "center", marginTop: 8, padding: "10px", borderRadius: 12, background: "#111827", color: "#fff", fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
                                        📍 Cómo llegar
                                    </a>
                                </div>
                            )}

                            <p style={{ marginTop: 18, fontSize: 12, color: "#9ca3af" }}>Mostrá este código en la garita. La cámara también puede reconocer tu patente automáticamente.</p>
                        </>
                    )}
                </div>
            </div>
            <style>{`.bg-emerald-500{background:#10b981}.bg-amber-500{background:#f59e0b}.bg-zinc-500{background:#71717a}.bg-red-600{background:#dc2626}.bg-zinc-600{background:#52525b}`}</style>
        </div>
    );
}
