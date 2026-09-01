import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const SUBS_FILE = path.join(process.cwd(), 'push_subs.json');

export async function POST(request: Request) {
    try {
        const subscription = await request.json();

        if (!subscription || !subscription.endpoint) {
            return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
        }

        // Read existing
        let subs = [];
        try {
            const data = await fs.readFile(SUBS_FILE, 'utf-8');
            subs = JSON.parse(data);
        } catch {
            // File doesn't exist yet, start empty
        }

        // Add if not exists (compare endpoints)
        const ua = request.headers.get('user-agent') || '';
        const exists = subs.find((s: any) => s.endpoint === subscription.endpoint);
        if (!exists) {
            subs.push({ ...subscription, ua, createdAt: new Date().toISOString(), enabled: true });
            await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2));
        } else {
            if (ua && !exists.ua) { exists.ua = ua; await fs.writeFile(SUBS_FILE, JSON.stringify(subs, null, 2)); }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[PUSH] Error saving subscription:", error);
        return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
    }
}
