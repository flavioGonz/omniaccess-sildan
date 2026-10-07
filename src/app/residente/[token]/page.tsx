"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
    Ticket, Plus, X, Loader2, Car, Clock, LogIn, QrCode, Trash2, CalendarPlus, Users,
    PartyPopper, UserPlus, Copy, Download, ShieldCheck, Home, Check,
} from "lucide-react";
import {
    listMyInvitations, createMyInvitation, addMyGuest, revokeMyInvitation, extendMyInvitation, getQrSvg, nombreDelBarrio,
    type MyInvitation, type MyGuest, type PortalHost,
} from "@/app/actions/invitations";

/* ───────────────── helpers ───────────────── */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtRange = (from: string, to: string) => {
    const f = new Date(from), t = new Date(to);
    const day = (d: Date) => cap(d.toLocaleDateString("es-UY", { weekday: "short", day: "2-digit", month: "short" }));
    const hm = (d: Date) => d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
    const sameDay = f.toDateString() === t.toDateString();
    return sameDay ? `${day(f)} · ${hm(f)} – ${hm(t)}` : `${day(f)} ${hm(f)} → ${day(t)} ${hm(t)}`;
};
const toLocal = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const STATUS: Record<string, { t: string; cls: string }> = {
    ACTIVE: { t: "Vigente", cls: "ok" }, EXPIRED: { t: "Vencido", cls: "mut" }, REVOKED: { t: "Anulado", cls: "bad" },
};

export default function ResidentePortal() {
    const params = useParams();
    const token = String((params as any)?.token || "");
    const [host, setHost] = useState<PortalHost | null>(null);
    // El nombre del barrio (Ajustes → Marca); antes decía a mano el nombre de otro barrio.
    const [barrio, setBarrio] = useState("");
    useEffect(() => { nombreDelBarrio().then(setBarrio).catch(() => { }); }, []);
    const [items, setItems] = useState<MyInvitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [bad, setBad] = useState(false);
    const [newKind, setNewKind] = useState<"SINGLE" | "EVENT" | null>(null);
    const [qr, setQr] = useState<MyGuest | null>(null);
    const [addTo, setAddTo] = useState<MyInvitation | null>(null);

    const load = useCallback(async () => {
        try { const r = await listMyInvitations(token); if (!r.ok) setBad(true); else { setHost(r.host!); setItems(r.items || []); } }
        catch { setBad(true); } finally { setLoading(false); }
    }, [token]);
    useEffect(() => { load(); }, [load]);

    const active = items.filter((i) => i.status === "ACTIVE");
    const past = items.filter((i) => i.status !== "ACTIVE");

    return (
        <div className="rp-root">
            <Styles />
            <header className="rp-topbar">
                <div className="rp-brand">
                    <span className="rp-logo" aria-hidden="true"><Ticket size={18} /></span>
                    <span className="rp-brandname">{barrio || "Mis invitados"}</span>
                </div>
            </header>

            {loading ? (
                <main className="rp-main" aria-busy="true"><div className="rp-center"><Loader2 className="rp-spin" aria-hidden="true" /><span className="rp-sr">Cargando…</span></div></main>
            ) : bad || !host ? (
                <main className="rp-main">
                    <div className="rp-empty" role="status">
                        <Ticket size={44} aria-hidden="true" />
                        <h1 className="rp-h1">Link inválido o vencido</h1>
                        <p className="rp-sub">Pedile al barrio que te reenvíe tu acceso para gestionar invitaciones.</p>
                    </div>
                </main>
            ) : (
                <main className="rp-main" aria-labelledby="rp-greet">
                    <section className="rp-hero">
                        <p className="rp-eyebrow">Invitaciones</p>
                        <h1 id="rp-greet" className="rp-h1">Hola, {host.name.split(" ")[0]}</h1>
                        {host.label && <p className="rp-sub"><Home size={14} aria-hidden="true" /> {host.label}</p>}
                    </section>

                    <div className="rp-actions">
                        <button className="rp-cta rp-cta--visit" onClick={() => setNewKind("SINGLE")}>
                            <UserPlus size={20} aria-hidden="true" /><span>Invitar visita</span>
                        </button>
                        <button className="rp-cta rp-cta--event" onClick={() => setNewKind("EVENT")}>
                            <PartyPopper size={20} aria-hidden="true" /><span>Crear fiesta</span>
                        </button>
                    </div>

                    {active.length === 0 && past.length === 0 && (
                        <div className="rp-empty rp-empty--soft" role="status">
                            <Ticket size={36} aria-hidden="true" />
                            <p className="rp-sub">Todavía no invitaste a nadie. Creá tu primer pase arriba.</p>
                        </div>
                    )}

                    {active.length > 0 && <h2 className="rp-section">Activas</h2>}
                    {active.map((inv) => (
                        <InvCard key={inv.id} inv={inv} onQr={setQr}
                            onRevoke={async () => { if (confirm("¿Anular esta invitación? Dejará de validar en las garitas.")) { await revokeMyInvitation(token, inv.id); load(); } }}
                            onExtend={async () => { await extendMyInvitation(token, inv.id, new Date(new Date(inv.validTo).getTime() + 2 * 3600 * 1000)); load(); }}
                            onAdd={() => setAddTo(inv)} />
                    ))}

                    {past.length > 0 && <h2 className="rp-section">Anteriores</h2>}
                    {past.map((inv) => <InvCard key={inv.id} inv={inv} past onQr={setQr} />)}
                    <div style={{ height: 24 }} />
                </main>
            )}

            {newKind && <CreateSheet kind={newKind} token={token} onClose={() => setNewKind(null)} onDone={() => { setNewKind(null); load(); }} />}
            {addTo && <AddGuestSheet inv={addTo} token={token} onClose={() => setAddTo(null)} onDone={() => { setAddTo(null); load(); }} />}
            {qr && <QrSheet guest={qr} token={token} onClose={() => setQr(null)} />}
        </div>
    );
}

/* ───────────────── invitation card ───────────────── */
function InvCard({ inv, past, onQr, onRevoke, onExtend, onAdd }: { inv: MyInvitation; past?: boolean; onQr: (g: MyGuest) => void; onRevoke?: () => void; onExtend?: () => void; onAdd?: () => void }) {
    const st = STATUS[inv.status] || STATUS.EXPIRED;
    const inside = inv.guests.filter((g) => g.inside).length;
    const isEvent = inv.kind === "EVENT";
    return (
        <article className={`rp-card${past ? " rp-card--past" : ""}`} aria-label={inv.title || (isEvent ? "Fiesta" : "Visita")}>
            <div className="rp-card-head">
                <span className={`rp-kind ${isEvent ? "ev" : "vi"}`} aria-hidden="true">{isEvent ? <PartyPopper size={18} /> : <Ticket size={18} />}</span>
                <div className="rp-card-title">
                    <h3 className="rp-cardh">{inv.title || (isEvent ? "Fiesta" : "Visita")}</h3>
                    <p className="rp-when"><Clock size={13} aria-hidden="true" /> {fmtRange(inv.validFrom, inv.validTo)}</p>
                </div>
                <span className={`rp-pill ${st.cls}`}>{st.t}</span>
            </div>

            {isEvent && (
                <p className="rp-meta">
                    <span><Users size={13} aria-hidden="true" /> {inv.guests.length}{inv.maxGuests ? ` / ${inv.maxGuests}` : ""} invitados</span>
                    {inside > 0 && <span className="rp-inside">● {inside} adentro</span>}
                </p>
            )}

            <ul className="rp-guests">
                {inv.guests.map((g) => (
                    <li key={g.guestId} className="rp-guest">
                        <div className="rp-guest-info">
                            <span className="rp-guest-name">{g.name || "Invitado"}</span>
                            <span className="rp-guest-sub">
                                {g.plates.length ? g.plates.map((p) => <span key={p} className="rp-plate"><Car size={12} aria-hidden="true" /> {p}</span>) : <span className="rp-afoot">a pie</span>}
                                {g.inside ? <span className="rp-chip ok"><LogIn size={11} aria-hidden="true" /> adentro</span> : g.entries > 0 ? <span className="rp-chip mut">ingresó {g.lastEntryAt ? new Date(g.lastEntryAt).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" }) : ""}</span> : null}
                            </span>
                        </div>
                        <button className="rp-iconbtn" onClick={() => onQr(g)} aria-label={`Ver código QR de ${g.name || "invitado"}`}><QrCode size={18} aria-hidden="true" /></button>
                    </li>
                ))}
            </ul>

            {!past && (onRevoke || onExtend || onAdd) && (
                <div className="rp-card-actions">
                    {isEvent && onAdd && <button className="rp-act ev" onClick={onAdd}><Plus size={15} aria-hidden="true" /> Invitado</button>}
                    {onExtend && <button className="rp-act neutral" onClick={onExtend}><CalendarPlus size={15} aria-hidden="true" /> +2 h</button>}
                    {onRevoke && <button className="rp-act bad" onClick={onRevoke}><Trash2 size={15} aria-hidden="true" /> Anular</button>}
                </div>
            )}
        </article>
    );
}

/* ───────────────── sheets ───────────────── */
function Sheet({ title, onClose, children, accent = "brand" }: { title: string; onClose: () => void; children: React.ReactNode; accent?: "brand" | "visit" | "event" | "qr" }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const prev = document.activeElement as HTMLElement | null;
        ref.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
    }, [onClose]);
    return (
        <div className="rp-overlay" onClick={onClose}>
            <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`rp-sheet acc-${accent}`} onClick={(e) => e.stopPropagation()}>
                <div className="rp-grab" aria-hidden="true" />
                <div className="rp-sheet-head">
                    <h2 className="rp-sheeth">{title}</h2>
                    <button className="rp-closebtn" onClick={onClose} aria-label="Cerrar"><X size={20} aria-hidden="true" /></button>
                </div>
                <div className="rp-sheet-body">{children}</div>
            </div>
        </div>
    );
}

function CreateSheet({ kind, token, onClose, onDone }: { kind: "SINGLE" | "EVENT"; token: string; onClose: () => void; onDone: () => void }) {
    const now = new Date();
    const [title, setTitle] = useState("");
    const [from, setFrom] = useState(toLocal(now));
    const [to, setTo] = useState(toLocal(new Date(now.getTime() + (kind === "EVENT" ? 10 : 6) * 3600 * 1000)));
    const [maxG, setMaxG] = useState(kind === "EVENT" ? "40" : "");
    const [rows, setRows] = useState<{ name: string; plate: string }[]>([{ name: "", plate: "" }]);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const isEvent = kind === "EVENT";

    const setRow = (i: number, k: "name" | "plate", v: string) => setRows((r) => r.map((x, j) => j === i ? { ...x, [k]: k === "plate" ? v.toUpperCase() : v } : x));
    const submit = async () => {
        setErr("");
        const guests = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), plate: r.plate.trim() || undefined }));
        if (guests.length === 0) { setErr("Agregá al menos un invitado con nombre."); return; }
        if (new Date(to) <= new Date(from)) { setErr("La hora de fin debe ser posterior a la de inicio."); return; }
        setSaving(true);
        try { const r = await createMyInvitation(token, { kind, title: title.trim() || undefined, validFrom: from, validTo: to, reentry: "MULTI", maxGuests: isEvent ? (parseInt(maxG) || null) : null, guests }); if (r.ok) onDone(); else setErr(r.error || "No se pudo crear."); }
        catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
    };

    return (
        <Sheet title={isEvent ? "Crear fiesta" : "Invitar visita"} accent={isEvent ? "event" : "visit"} onClose={onClose}>
            <Field id="f-title" label={isEvent ? "Nombre del evento" : "Nombre (opcional)"}>
                <input id="f-title" className="rp-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isEvent ? "Cumple de Mateo" : "Plomero, delivery…"} autoFocus />
            </Field>
            <div className="rp-grid2">
                <Field id="f-from" label="Desde"><input id="f-from" type="datetime-local" className="rp-input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field id="f-to" label="Hasta"><input id="f-to" type="datetime-local" className="rp-input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            {isEvent && <Field id="f-max" label="Tope de invitados"><input id="f-max" className="rp-input" inputMode="numeric" value={maxG} onChange={(e) => setMaxG(e.target.value.replace(/\D/g, ""))} placeholder="40" /></Field>}

            <p className="rp-grouplabel">Invitados</p>
            {rows.map((r, i) => (
                <div className="rp-row" key={i}>
                    <input className="rp-input" value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} placeholder="Nombre" aria-label={`Nombre del invitado ${i + 1}`} />
                    <input className="rp-input rp-input--plate" value={r.plate} onChange={(e) => setRow(i, "plate", e.target.value)} placeholder="Patente" aria-label={`Patente del invitado ${i + 1}`} />
                    {rows.length > 1 && <button className="rp-rowdel" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Quitar invitado ${i + 1}`}><X size={16} aria-hidden="true" /></button>}
                </div>
            ))}
            <button className="rp-addrow" onClick={() => setRows((r) => [...r, { name: "", plate: "" }])}><Plus size={16} aria-hidden="true" /> Agregar invitado</button>

            {err && <p className="rp-err" role="alert">{err}</p>}
            <button className="rp-submit" disabled={saving} onClick={submit}>
                {saving ? <Loader2 size={18} className="rp-spin" aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />} Crear y avisar a garita
            </button>
        </Sheet>
    );
}

function AddGuestSheet({ inv, token, onClose, onDone }: { inv: MyInvitation; token: string; onClose: () => void; onDone: () => void }) {
    const [name, setName] = useState(""); const [plate, setPlate] = useState(""); const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
    const submit = async () => { if (!name.trim()) { setErr("Ingresá el nombre."); return; } setSaving(true); try { const r = await addMyGuest(token, inv.id, { name: name.trim(), plate: plate.trim() || undefined }); if (r.ok) onDone(); else setErr(r.error || "No se pudo."); } finally { setSaving(false); } };
    return (
        <Sheet title="Agregar invitado" accent="event" onClose={onClose}>
            <Field id="g-name" label="Nombre"><input id="g-name" className="rp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" autoFocus /></Field>
            <Field id="g-plate" label="Patente (opcional)"><input id="g-plate" className="rp-input" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="SAB1234" /></Field>
            {err && <p className="rp-err" role="alert">{err}</p>}
            <button className="rp-submit" disabled={saving} onClick={submit}>{saving ? <Loader2 size={18} className="rp-spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />} Agregar</button>
        </Sheet>
    );
}

function QrSheet({ guest, token, onClose }: { guest: MyGuest; token: string; onClose: () => void }) {
    const [svg, setSvg] = useState("");
    const [copied, setCopied] = useState(false);
    const link = typeof window !== "undefined" ? `${window.location.origin}/invitado/${guest.qrToken}` : "";
    useEffect(() => { getQrSvg(guest.qrToken).then(setSvg).catch(() => { }); }, [guest.qrToken]);
    const dl = () => { const b = new Blob([svg], { type: "image/svg+xml" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `pase-${(guest.name || "invitado").replace(/\s+/g, "_")}.svg`; a.click(); URL.revokeObjectURL(u); };
    const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { } };
    return (
        <Sheet title={guest.name || "Invitado"} accent="qr" onClose={onClose}>
            <div className="rp-qrwrap">
                <div className="rp-qr" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`Código QR del pase de ${guest.name || "invitado"}`} />
                <p className="rp-qrhint">Ya te lo enviamos a tu WhatsApp. También podés reenviárselo a tu invitado desde acá.</p>
                <div className="rp-grid2">
                    <button className="rp-ghost" onClick={copy}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "¡Copiado!" : "Copiar link"}</button>
                    <button className="rp-ghost" onClick={dl}><Download size={16} aria-hidden="true" /> Descargar</button>
                </div>
            </div>
        </Sheet>
    );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return <div className="rp-field"><label htmlFor={id} className="rp-label">{label}</label>{children}</div>;
}

/* ───────────────── styles ───────────────── */
function Styles() {
    return (
        <style jsx global>{`
        .rp-root {
          --bg:#eef1f0; --surface:#ffffff; --surface-2:#f6f8f7; --border:#e2e7e4;
          --text:#13201a; --muted:#59685f; --subtle:#8a978f;
          --brand:#167a54; --brand-ink:#ffffff; --visit:#b45309; --event:#6d28d9; --qr:#0e7490;
          --ok:#15803d; --okbg:#dcfce7; --bad:#dc2626; --badbg:#fee2e2; --mutbg:#eef1f0;
          --radius:18px; --ring:0 0 0 3px rgba(22,122,84,.35);
          min-height:100dvh; background:var(--bg); color:var(--text);
          font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        @media (prefers-color-scheme: dark) {
          .rp-root { --bg:#0c1310; --surface:#121a16; --surface-2:#172019; --border:#273029;
            --text:#e9f1ec; --muted:#9db0a6; --subtle:#71837a; --brand:#2ea772; --okbg:#0f2e1d; --badbg:#3a1414; --mutbg:#1a221c; }
        }
        .rp-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
        .rp-root *:focus-visible { outline:none; box-shadow:var(--ring); border-radius:12px; }
        .rp-spin { animation:rp-spin 1s linear infinite; color:var(--brand); }
        @keyframes rp-spin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .rp-root *, .rp-overlay, .rp-sheet { animation:none !important; transition:none !important; } }

        .rp-topbar { position:sticky; top:0; z-index:5; display:flex; align-items:center; height:56px; padding:0 16px;
          background:color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter:blur(10px); border-bottom:1px solid var(--border); }
        .rp-brand { display:flex; align-items:center; gap:9px; }
        .rp-logo { width:30px; height:30px; display:grid; place-items:center; border-radius:9px; background:var(--brand); color:var(--brand-ink); }
        .rp-brandname { font-weight:800; letter-spacing:-.01em; }

        .rp-main { max-width:560px; margin:0 auto; padding:16px 16px 28px; }
        .rp-center { display:grid; place-items:center; padding:64px 0; }
        .rp-hero { padding:10px 2px 14px; }
        .rp-eyebrow { font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--brand); margin:0 0 2px; }
        .rp-h1 { font-size:26px; line-height:1.15; font-weight:850; letter-spacing:-.02em; margin:0; }
        .rp-sub { display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:14.5px; margin:6px 0 0; }

        .rp-actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:8px 0 18px; }
        .rp-cta { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; min-height:92px; border:none;
          border-radius:var(--radius); color:#fff; font-weight:800; font-size:15px; cursor:pointer; padding:14px; transition:transform .12s, filter .12s; }
        .rp-cta:active { transform:scale(.97); }
        .rp-cta:hover { filter:brightness(1.05); }
        .rp-cta--visit { background:linear-gradient(140deg,#d97706,#b45309); }
        .rp-cta--event { background:linear-gradient(140deg,#7c3aed,#6d28d9); }

        .rp-section { font-size:12.5px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--subtle); margin:18px 2px 8px; }

        .rp-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); margin-bottom:12px; overflow:hidden;
          box-shadow:0 1px 2px rgba(0,0,0,.04); }
        .rp-card--past { opacity:.72; }
        .rp-card-head { display:flex; align-items:flex-start; gap:11px; padding:14px 14px 10px; }
        .rp-kind { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; flex:none; }
        .rp-kind.vi { background:#f59e0b1f; color:#b45309; } .rp-kind.ev { background:#7c3aed1f; color:#6d28d9; }
        @media (prefers-color-scheme: dark){ .rp-kind.vi{color:#fbbf24} .rp-kind.ev{color:#a78bfa} }
        .rp-card-title { min-width:0; flex:1; }
        .rp-cardh { font-size:16.5px; font-weight:800; margin:0; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .rp-when { display:flex; align-items:center; gap:5px; color:var(--muted); font-size:13px; margin:3px 0 0; }
        .rp-pill { flex:none; font-size:11.5px; font-weight:800; padding:5px 10px; border-radius:999px; }
        .rp-pill.ok { background:var(--okbg); color:var(--ok); } .rp-pill.bad { background:var(--badbg); color:var(--bad); } .rp-pill.mut { background:var(--mutbg); color:var(--muted); }

        .rp-meta { display:flex; gap:14px; padding:0 14px 8px; margin:0; font-size:12.5px; color:var(--muted); }
        .rp-meta span { display:inline-flex; align-items:center; gap:5px; }
        .rp-inside { color:var(--ok); font-weight:700; }

        .rp-guests { list-style:none; margin:0; padding:0; border-top:1px solid var(--border); }
        .rp-guest { display:flex; align-items:center; gap:10px; padding:11px 14px; border-bottom:1px solid var(--border); }
        .rp-guest:last-child { border-bottom:none; }
        .rp-guest-info { min-width:0; flex:1; }
        .rp-guest-name { display:block; font-weight:700; font-size:14.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .rp-guest-sub { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:3px; font-size:12.5px; color:var(--muted); }
        .rp-plate { display:inline-flex; align-items:center; gap:4px; font-weight:700; letter-spacing:.02em; }
        .rp-afoot { color:var(--subtle); }
        .rp-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-weight:700; font-size:11.5px; }
        .rp-chip.ok { background:var(--okbg); color:var(--ok); } .rp-chip.mut { background:var(--mutbg); color:var(--muted); }
        .rp-iconbtn { flex:none; width:42px; height:42px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); color:var(--qr); display:grid; place-items:center; cursor:pointer; transition:background .12s; }
        .rp-iconbtn:hover { background:#0e74901a; }

        .rp-card-actions { display:flex; gap:8px; padding:10px 12px 12px; }
        .rp-act { flex:1; min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; border-radius:12px; font-weight:800; font-size:13px; cursor:pointer; }
        .rp-act.ev { background:#7c3aed14; color:#6d28d9; } .rp-act.neutral { background:var(--surface-2); color:var(--text); border:1px solid var(--border); } .rp-act.bad { background:var(--badbg); color:var(--bad); }
        @media (prefers-color-scheme: dark){ .rp-act.ev{color:#a78bfa} }

        .rp-empty { display:grid; place-items:center; text-align:center; gap:10px; padding:52px 24px; color:var(--subtle); }
        .rp-empty .rp-h1 { color:var(--text); font-size:20px; }
        .rp-empty--soft { background:var(--surface); border:1px dashed var(--border); border-radius:var(--radius); padding:36px 24px; margin-top:6px; }

        /* sheets */
        .rp-overlay { position:fixed; inset:0; z-index:100; background:rgba(8,14,11,.55); display:flex; align-items:flex-end; justify-content:center; animation:rp-fade .18s ease; }
        @keyframes rp-fade { from { opacity:0 } to { opacity:1 } }
        .rp-sheet { width:100%; max-width:560px; max-height:92dvh; background:var(--surface); border-radius:24px 24px 0 0; padding:6px 18px 22px; overflow-y:auto; animation:rp-up .24s cubic-bezier(.22,1,.36,1); box-shadow:0 -10px 40px rgba(0,0,0,.25); }
        @keyframes rp-up { from { transform:translateY(24px) } to { transform:translateY(0) } }
        .rp-grab { width:40px; height:4px; border-radius:999px; background:var(--border); margin:6px auto 8px; }
        .rp-sheet-head { display:flex; align-items:center; gap:10px; padding:2px 0 12px; position:sticky; top:0; background:var(--surface); }
        .rp-sheeth { font-size:18px; font-weight:800; margin:0; }
        .acc-visit .rp-sheeth { color:var(--visit); } .acc-event .rp-sheeth { color:var(--event); } .acc-qr .rp-sheeth { color:var(--qr); }
        .rp-closebtn { margin-left:auto; width:40px; height:40px; border-radius:999px; border:none; background:var(--surface-2); color:var(--muted); display:grid; place-items:center; cursor:pointer; }

        .rp-field { margin-bottom:12px; }
        .rp-label { display:block; font-size:12.5px; font-weight:700; color:var(--muted); margin-bottom:5px; }
        .rp-input { width:100%; min-height:46px; padding:0 13px; border-radius:13px; background:var(--surface-2); border:1.5px solid var(--border); color:var(--text); font-size:16px; font-weight:600; box-sizing:border-box; }
        .rp-input::placeholder { color:var(--subtle); font-weight:500; }
        .rp-input:focus { border-color:var(--brand); }
        .rp-input--plate { letter-spacing:.04em; text-transform:uppercase; }
        .rp-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .rp-grouplabel { font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--subtle); margin:14px 0 8px; }
        .rp-row { display:flex; gap:8px; margin-bottom:8px; }
        .rp-row .rp-input:first-child { flex:2; } .rp-row .rp-input--plate { flex:1; }
        .rp-rowdel { width:46px; flex:none; border:none; border-radius:13px; background:var(--badbg); color:var(--bad); cursor:pointer; display:grid; place-items:center; }
        .rp-addrow { width:100%; min-height:44px; border:1.5px dashed var(--border); border-radius:13px; background:transparent; color:var(--brand); font-weight:800; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; margin-bottom:6px; }

        .rp-err { color:var(--bad); background:var(--badbg); padding:9px 12px; border-radius:11px; font-size:13.5px; font-weight:700; margin:10px 0 0; }
        .rp-submit { width:100%; min-height:52px; margin-top:14px; border:none; border-radius:16px; background:var(--brand); color:var(--brand-ink); font-size:15.5px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:9px; }
        .rp-submit:disabled { opacity:.6; }
        .rp-submit:active { transform:scale(.99); }

        .rp-qrwrap { text-align:center; padding:4px 0 2px; }
        .rp-qr { display:inline-block; padding:14px; background:#fff; border-radius:18px; border:1px solid var(--border); }
        .rp-qr svg { display:block; width:232px; height:232px; }
        .rp-qrhint { color:var(--muted); font-size:13px; margin:12px 0; }
        .rp-wa-send { width:100%; min-height:48px; margin-top:4px; border:none; border-radius:14px; background:#25d366; color:#06371a; font-weight:800; font-size:14.5px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; }
        .rp-wa-send:disabled { opacity:.6; }
        .rp-ok { color:var(--ok); background:var(--okbg); padding:9px 12px; border-radius:11px; font-size:13px; font-weight:700; margin:10px 0 0; display:flex; align-items:center; gap:6px; text-align:left; }
        .rp-ghost { min-height:46px; border:1.5px solid var(--border); border-radius:13px; background:var(--surface-2); color:var(--text); font-weight:800; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:7px; }
      `}</style>
    );
}
