import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import https from "https";

// ─── ONVIF GetEventProperties → flat topic list ─────
function onvifRequest(ip: string, user: string, pass: string, body: string, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${user}:${pass}`).toString("base64");
        const envelope = `<?xml version="1.0" encoding="UTF-8"?>` +
            `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tev="http://www.onvif.org/ver10/events/wsdl">` +
            `<s:Body>${body}</s:Body></s:Envelope>`;
        const req = https.request({
            host: ip, port: 443, path, method: "POST",
            headers: {
                "Content-Type": "application/soap+xml; charset=utf-8",
                Authorization: `Basic ${auth}`,
                "Content-Length": Buffer.byteLength(envelope),
            },
            rejectUnauthorized: false, timeout: 10000,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.end(envelope);
    });
}

// Parse the <wstop:TopicSet> into a flat list of topic paths (tns1:A/B/C)
function parseTopicSet(xml: string): string[] {
    const start = xml.search(/<[\w-]*:?TopicSet[\s>]/);
    if (start === -1) return [];
    const endIdx = xml.search(/<\/[\w-]*:?TopicSet>/);
    const region = endIdx === -1 ? xml.slice(start) : xml.slice(start, endIdx);

    const topics = new Set<string>();
    const stack: string[] = [];
    const tagRe = /<(\/?)([A-Za-z0-9_]+:)?([A-Za-z0-9_.-]+)([^>]*?)(\/?)>/g;
    let m: RegExpExecArray | null;
    let first = true;
    while ((m = tagRe.exec(region)) !== null) {
        const closing = m[1] === "/";
        const local = m[3];
        const attrs = m[4] || "";
        const selfClose = m[5] === "/";
        if (first) { first = false; continue; } // skip the TopicSet root itself
        if (local === "MessageDescription" || local === "Message" || local === "SimpleItemDescription"
            || local === "ElementItemDescription" || local === "Source" || local === "Data" || local === "Key") {
            // skip message body descriptors, not topic nodes
            if (!selfClose && !closing) { /* but they may nest; track to balance */ }
        }
        const isTopic = /wstop:topic\s*=\s*["']true["']/i.test(attrs) || /\btopic\s*=\s*["']true["']/i.test(attrs);
        if (closing) {
            if (stack.length) stack.pop();
            continue;
        }
        // skip descriptor nodes entirely (don't add to path)
        const isDescriptor = ["MessageDescription", "Message", "SimpleItemDescription", "ElementItemDescription", "Source", "Data", "Key"].includes(local);
        if (selfClose) {
            if (isTopic && !isDescriptor) topics.add("tns1:" + [...stack, local].join("/"));
            continue;
        }
        if (isDescriptor) {
            // push a marker so close balances, but never produce topics from inside
            stack.push("__desc__:" + local);
            continue;
        }
        stack.push(local);
        if (isTopic) topics.add("tns1:" + stack.filter(s => !s.startsWith("__desc__:")).join("/"));
    }
    return [...topics].filter(Boolean);
}

const SETTING_KEY = (deviceId: string) => `onvif_topics_${deviceId}`;

export async function GET(req: NextRequest) {
    try {
        const deviceId = req.nextUrl.searchParams.get("deviceId");
        if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: { ip: true, username: true, password: true },
        });
        if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 });

        let topics: string[] = [];
        try {
            const xml = await onvifRequest(device.ip, device.username || "admin", device.password || "admin",
                "<tev:GetEventProperties/>", "/onvif/events_service");
            topics = parseTopicSet(xml);
        } catch { topics = []; }
        topics.sort();

        const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY(deviceId) } }).catch(() => null);
        let enabled: string[] = [];
        if (setting?.value) { try { enabled = JSON.parse(setting.value); } catch { enabled = []; } }

        return NextResponse.json({ topics, enabled });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const deviceId = req.nextUrl.searchParams.get("deviceId");
        if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
        const body = await req.json();
        const enabled: string[] = Array.isArray(body?.enabled) ? body.enabled : [];
        await prisma.setting.upsert({
            where: { key: SETTING_KEY(deviceId) },
            update: { value: JSON.stringify(enabled) },
            create: { key: SETTING_KEY(deviceId), value: JSON.stringify(enabled) },
        });
        return NextResponse.json({ ok: true, enabled });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
