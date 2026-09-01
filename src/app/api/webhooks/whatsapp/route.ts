import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendWahaText, sendWahaImage } from '@/lib/whatsapp';
import { getQueueDevices, getLatestQueueCounts, getQueueAlerts } from '@/app/actions/queue';
import { getSetting, updateSetting, getS3InternalClient } from '@/app/actions/settings';
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from 'stream';
import { HikvisionDriver } from '@/lib/drivers/HikvisionDriver';
import { DeviceBrand, DeviceType } from '@prisma/client';

// Helper to convert stream to buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function waDigits(s: string): string { return (s || '').replace(/\D/g, ''); }

function extractS3Key(path: string | null): string | null {
    if (!path) return path;
    if (path.includes('/api/files/')) {
        return path.split('/').pop() || path;
    }
    return path;
}

// Helper to log requests
async function logToHistory(fromNumber: string, messageBody: string, status: string, responseDetails?: string) {
    try {
        await prisma.wahaRequestLog.create({
            data: { fromNumber, messageBody, status, responseDetails }
        });
    } catch (e) {
        console.error("Failed to log WAHA request:", e);
    }
}

export async function POST(req: Request) {
    let from = "unknown";
    let messageBody = "";

    try {
        const body = await req.json();

        // Support OpenWA ({ event, data:{...} }) and legacy WAHA ({ payload:{...} }) shapes.
        const evtName: string = body.event || body.type || "";
        const msg: any = body.data || body.payload || body.message || body || {};

        messageBody = msg.body || msg.text || msg.content || msg.caption || msg.message?.body || "";
        from = msg.from || msg.chatId || msg.author || msg.sender || "unknown";
        const fromMe: boolean = (msg.fromMe ?? msg.self ?? body.fromMe) || false;

        // Only react to inbound messages; ignore ack/qr/status/sent events.
        if (evtName && !/message\.received|message\.any|onmessage|message$/i.test(evtName)) {
            return NextResponse.json({ status: 'ignored', reason: 'event:' + evtName });
        }

        if (!from || from === "unknown" || !messageBody) {
            await logToHistory(from, messageBody, 'ignored', 'Missing from or messageBody');
            return NextResponse.json({ status: 'ignored' });
        }

        // Avoid infinite loops (bot replying to itself)
        if (fromMe) {
            await logToHistory(from, messageBody, 'ignored', 'Message from self (fromMe)');
            return NextResponse.json({ status: 'ignored' });
        }

        // Kill-switch global: chatbot desactivado desde Settings
        const _cbEnabled = await getSetting('CHATBOT_ENABLED');
        if (_cbEnabled?.value === 'false') {
            await logToHistory(from, messageBody, 'ignored', 'Chatbot disabled globally');
            return NextResponse.json({ status: 'ignored', reason: 'chatbot_disabled' });
        }

        // Capturar JIDs de grupos vistos (para el selector de destinatarios) — no bloqueante
        if (typeof from === 'string' && from.endsWith('@g.us')) {
            try {
                const rawG = await getSetting('WHATSAPP_SEEN_GROUPS');
                let seen: any[] = [];
                try { seen = JSON.parse(rawG?.value || '[]'); } catch {}
                const gname = (msg.chat?.name || msg.groupName || msg.chatName || msg.notifyName || '').toString().trim();
                const gi = seen.findIndex((g: any) => g.id === from);
                if (gi >= 0) { if (gname) seen[gi].name = gname; seen[gi].ts = Date.now(); }
                else seen.unshift({ id: from, name: gname || from, ts: Date.now() });
                await updateSetting('WHATSAPP_SEEN_GROUPS', JSON.stringify(seen.slice(0, 30)));
            } catch {}
        }

        // ─── SEGURIDAD: lista blanca de remitentes (evita fuga de datos) ───
        // Solo procesa mensajes de números/grupos autorizados cuando está habilitada.
        try {
            const allowEnabled = (await getSetting('WHATSAPP_ALLOWLIST_ENABLED'))?.value === 'true';
            if (allowEnabled) {
                let allow: string[] = [];
                try { allow = JSON.parse((await getSetting('WHATSAPP_ALLOWLIST'))?.value || '[]'); } catch {}
                const isGroup = typeof from === 'string' && from.endsWith('@g.us');
                const fromD = waDigits(from);
                const ok = (allow || []).some((entry: any) => {
                    const e = String(entry || '').trim();
                    if (!e) return false;
                    if (e === from) return true; // identidad exacta (cubre @lid y @c.us)
                    if (isGroup) return waDigits(e) === fromD;
                    const ed = waDigits(e);
                    if (!ed || !fromD) return false;
                    const a = fromD.slice(-8), b = ed.slice(-8);
                    return a.length >= 6 && a === b;
                });
                if (!ok) {
                    await logToHistory(from, messageBody, 'blocked', 'Remitente no autorizado (lista blanca)');
                    return NextResponse.json({ status: 'blocked' });
                }
            }
        } catch (e) {
            console.error('Allowlist check error:', e);
        }

        const lowerMsg = messageBody.toLowerCase().trim();

        // ─── COMANDOS DE CONTROL DE FILAS (aforo / filas / estado) ───
        if (/^(aforo|filas|estado|ocupaci[oó]n|cola|espera)\b/i.test(lowerMsg)) {
            try {
                const [qDevs, qCounts, qAlerts]: any[] = await Promise.all([getQueueDevices(), getLatestQueueCounts(), getQueueAlerts()]);
                if (!qDevs || qDevs.length === 0) {
                    await sendWahaText(from, "\uD83D\uDCCA No hay filas configuradas en el sistema.");
                    await logToHistory(from, messageBody, 'queue_status', 'no queues');
                    return NextResponse.json({ status: 'queue_empty' });
                }
                const OCC = ["Aforo", "IVA Aforo", "Occupancy", "Ocupación"];
                let total = 0;
                let msg = "\uD83D\uDCCA *Aforo en vivo — Control de Filas*\n\n";
                for (const d of qDevs) {
                    const c = (qCounts || []).find((x: any) => x.device?.id === d.id);
                    const ch = c ? (c.channels || []).find((x: any) => OCC.includes(x.channelName)) : null;
                    const aforo = ch ? ch.peopleCount : 0;
                    total += aforo;
                    const al = (qAlerts || []).find((a: any) => a.deviceId === d.id);
                    const thr = al ? al.threshold : null;
                    const emoji = thr ? (aforo >= thr ? "\uD83D\uDD34" : aforo >= thr * 0.7 ? "\uD83D\uDFE1" : "\uD83D\uDFE2") : "⚪";
                    msg += `${emoji} *${d.name}*: ${aforo}${thr ? ` / ${thr}` : ""} personas\n`;
                }
                msg += `\n👥 *Total*: ${total} personas\n_Escribí *aforo* para actualizar._`;
                await sendWahaText(from, msg);
                await logToHistory(from, messageBody, 'queue_status', `aforo total ${total}`);
                return NextResponse.json({ status: 'queue_status' });
            } catch (e: any) {
                await sendWahaText(from, "❌ No pude obtener el aforo en este momento.");
                await logToHistory(from, messageBody, 'queue_error', String(e?.message || e));
                return NextResponse.json({ status: 'queue_error' });
            }
        }

        // ---------------------------------------------------------
        // 0. URGENT TRIGGERS (Direct Commands)
        // ---------------------------------------------------------

        // Use regex for more robust matching
        const addPlateRegex = /^(?:agregar|añadir|nuevo|nueva)\s+(?:matricula|matrícula|vehiculo|vehículo)/i;
        if (addPlateRegex.test(lowerMsg)) {
            await prisma.whatsAppSession.upsert({
                where: { phoneNumber: from },
                create: { phoneNumber: from, step: 'ADD_PLATE_PLATE' },
                update: { step: 'ADD_PLATE_PLATE', data: null }
            });

            await sendWahaText(from, "🚗 *Agregar Matrícula*\n\nPor favor, ingresa la matrícula que deseas registrar:");
            await logToHistory(from, messageBody, 'replied', 'Inició flujo agregar matrícula');
            return NextResponse.json({ status: 'replied' });
        }

        // ---------------------------------------------------------
        // SESSION MANAGEMENT & FLOW 
        // ---------------------------------------------------------

        // Check for active session
        const session = await prisma.whatsAppSession.findUnique({ where: { phoneNumber: from } });

        // A. TRIGGER: "matricula [XXX]"
        if (lowerMsg.startsWith("matricula ") && lowerMsg.split(" ").length > 1) {
            const plateInput = messageBody.split(" ")[1];
            if (plateInput && plateInput.length >= 3) {
                const cleanPlate = plateInput.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");

                await prisma.whatsAppSession.upsert({
                    where: { phoneNumber: from },
                    create: { phoneNumber: from, step: 'MENU', data: cleanPlate },
                    update: { step: 'MENU', data: cleanPlate }
                });

                const menu = `🚗 *Gestión de Matrícula: ${cleanPlate}*\n` +
                    `Selecciona una opción:\n\n` +
                    `1. 📜 Consultar Histórico\n` +
                    `2. 📥 Consultar Entradas\n` +
                    `3. 📤 Consultar Salidas\n` +
                    `5. ➕ Agregar al Sistema (LPR)`;

                await sendWahaText(from, menu);
                await logToHistory(from, messageBody, 'replied', `Menú de gestión para ${cleanPlate}`);
                return NextResponse.json({ status: 'replied' });
            }
        }

        // B. HANDLING STEPS
        if (session) {
            // B0. DIRECT FLOW: ADD_PLATE_PLATE
            if (session.step === 'ADD_PLATE_PLATE') {
                const plate = messageBody.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
                if (plate.length < 3) {
                    await sendWahaText(from, "⚠️ Matrícula inválida. Debe tener al menos 3 caracteres.");
                    return NextResponse.json({ status: 'replied' });
                }

                const existing = await prisma.vehicle.findUnique({ where: { plate } });
                if (existing) {
                    await sendWahaText(from, `⚠️ La matrícula *${plate}* ya existe en el sistema.`);
                    await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                    return NextResponse.json({ status: 'replied' });
                }

                await prisma.whatsAppSession.update({
                    where: { phoneNumber: from },
                    data: {
                        step: 'ADD_PLATE_NAME',
                        data: JSON.stringify({ plate })
                    }
                });

                await sendWahaText(from, `👤 Ingresa el *Nombre del Propietario* para la matrícula *${plate}*:`);
                return NextResponse.json({ status: 'replied' });
            }

            // B0.1 DIRECT FLOW: ADD_PLATE_NAME
            if (session.step === 'ADD_PLATE_NAME') {
                const userName = messageBody.trim();
                if (userName.length < 2) {
                    await sendWahaText(from, "⚠️ Nombre muy corto. Intenta de nuevo.");
                    return NextResponse.json({ status: 'replied' });
                }

                const sessionData = JSON.parse(session.data || "{}");
                sessionData.name = userName;

                const lprDevices = await prisma.device.findMany({
                    where: { deviceType: 'LPR_CAMERA' }
                });

                if (lprDevices.length === 0) {
                    await sendWahaText(from, "❌ No hay cámaras LPR configuradas en el sistema.");
                    await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                    return NextResponse.json({ status: 'replied' });
                }

                await prisma.whatsAppSession.update({
                    where: { phoneNumber: from },
                    data: {
                        step: 'ADD_PLATE_DEVICES',
                        data: JSON.stringify(sessionData)
                    }
                });

                let deviceList = "📹 *Selecciona las Cámaras*\n\n";
                deviceList += "Escribe los números separados por coma (ej: 1,3) o escribe *'todas'*:\n\n";
                lprDevices.forEach((dev, i) => {
                    deviceList += `${i + 1}. ${dev.name} (${dev.ip})\n`;
                });

                await sendWahaText(from, deviceList);
                return NextResponse.json({ status: 'replied' });
            }

            // B0.2 DIRECT FLOW: ADD_PLATE_DEVICES
            if (session.step === 'ADD_PLATE_DEVICES') {
                const sessionData = JSON.parse(session.data || "{}");
                const { plate, name } = sessionData;
                const selection = lowerMsg.trim();

                const lprDevices = await prisma.device.findMany({
                    where: { deviceType: 'LPR_CAMERA' }
                });

                let selectedDevices = [];
                if (selection === 'todas') {
                    selectedDevices = lprDevices;
                } else {
                    const indices = selection.split(',').map(s => parseInt(s.trim()) - 1);
                    selectedDevices = indices
                        .filter(i => i >= 0 && i < lprDevices.length)
                        .map(i => lprDevices[i]);
                }

                if (selectedDevices.length === 0) {
                    await sendWahaText(from, "⚠️ Selección inválida. Por favor, selecciona los números de la lista o 'todas'.");
                    return NextResponse.json({ status: 'replied' });
                }

                try {
                    await sendWahaText(from, `⏳ Registrando *${plate}* para *${name}* en ${selectedDevices.length} cámara(s)...`);

                    // 1. Create in DB (User, Vehicle, Credential)
                    const user = await prisma.user.create({
                        data: { name, role: 'RESIDENT', phone: from.split('@')[0] }
                    });

                    await prisma.vehicle.create({
                        data: {
                            plate, userId: user.id, brand: 'WhatsApp', model: 'Bot',
                            notes: `Vía WhatsApp por ${from}`
                        }
                    });

                    await prisma.credential.create({
                        data: { type: 'PLATE', value: plate, userId: user.id }
                    });

                    // 2. Sync to Cameras
                    const driver = new HikvisionDriver();
                    let successCount = 0;
                    let failCount = 0;

                    for (const dev of selectedDevices) {
                        try {
                            // Currently we assume Hikvision for LPR. 
                            // In a multi-brand environment, we would switch drivers here.
                            if (dev.brand === 'HIKVISION') {
                                await driver.addPlateToCamera(dev, plate);
                                successCount++;
                            } else {
                                // For now, other brands might not have the functionality implemented
                                failCount++;
                            }
                        } catch (e) {
                            console.error(`Failed to add plate to ${dev.ip}`, e);
                            failCount++;
                        }
                    }

                    await sendWahaText(from, `✅ *Proceso Finalizado*\n\nMatrícula: *${plate}*\nPropietario: *${name}*\n\nSincronización:\n✔️ Éxito: ${successCount}\n❌ Fallo: ${failCount}`);
                    await logToHistory(from, messageBody, 'replied', `Registro exitoso via flujo directo: ${plate}`);
                } catch (e: any) {
                    console.error("Error in ADD_PLATE_DEVICES flow:", e);
                    await sendWahaText(from, `❌ Error al procesar: ${e.message}`);
                }

                await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                return NextResponse.json({ status: 'replied' });
            }

            const plate = session.data || "";

            // B1. MENU SELECTION
            if (session.step === 'MENU') {
                // Option 5: Add
                if (lowerMsg === '5') {
                    // Check if already exists
                    const existing = await prisma.vehicle.findUnique({ where: { plate } });
                    if (existing) {
                        await sendWahaText(from, `⚠️ La matrícula ${plate} ya está registrada en el sistema.`);
                        await logToHistory(from, messageBody, 'replied', `Error: Matrícula ${plate} ya existe`);
                        // Clear session
                        await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                        return NextResponse.json({ status: 'replied' });
                    }

                    await prisma.whatsAppSession.update({
                        where: { phoneNumber: from },
                        data: { step: 'ADDING_USER_NAME' }
                    });

                    await sendWahaText(from, `👤 Ingresa el *Nombre del Propietario* para la matrícula ${plate}:`);
                    await logToHistory(from, messageBody, 'replied', `Solicitando nombre para ${plate}`);
                    return NextResponse.json({ status: 'replied' });
                }

                // Options 1, 2, 3: Queries
                if (['1', '2', '3'].includes(lowerMsg)) {
                    let whereClause: any = {
                        OR: [
                            { plateNumber: { contains: plate, mode: 'insensitive' } },
                            { plateDetected: { contains: plate, mode: 'insensitive' } }
                        ]
                    };

                    let title = "Histórico";
                    let actionDesc = "Histórico";
                    if (lowerMsg === '2') { whereClause.direction = 'ENTRY'; title = "Entradas"; actionDesc = "Entradas"; }
                    if (lowerMsg === '3') { whereClause.direction = 'EXIT'; title = "Salidas"; actionDesc = "Salidas"; }

                    const events = await prisma.accessEvent.findMany({
                        where: whereClause,
                        take: 5,
                        orderBy: { timestamp: 'desc' },
                        include: { device: true }
                    });

                    if (events.length === 0) {
                        await sendWahaText(from, `🚫 No se encontraron registros de *${title}* para ${plate}.`);
                    } else {
                        let resp = `📋 *${title} de ${plate}*\n\n`;
                        events.forEach((evt, i) => {
                            const t = new Date(evt.timestamp).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false, timeZone: 'America/Montevideo' });
                            const dev = evt.device?.name || "Cámara";
                            const icon = evt.decision === 'GRANT' ? '✅' : '🚫';
                            resp += `${i + 1}. ${t} - ${dev} ${icon}\n`;
                        });
                        await sendWahaText(from, resp);
                    }

                    await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                    await logToHistory(from, messageBody, 'replied', `Consulta: ${actionDesc} de ${plate}`);
                    return NextResponse.json({ status: 'replied' });
                }
            }

            // B2. ADDING USER NAME (For Option 5 original flow)
            if (session.step === 'ADDING_USER_NAME') {
                const userName = messageBody.trim();
                if (userName.length < 2) {
                    await sendWahaText(from, "⚠️ Nombre muy corto. Por favor intenta de nuevo.");
                    await logToHistory(from, messageBody, 'replied', `Error: Nombre corto (${userName})`);
                    return NextResponse.json({ status: 'replied' });
                }

                try {
                    const user = await prisma.user.create({
                        data: { name: userName, role: 'VISITOR', phone: from.split('@')[0] }
                    });

                    await prisma.vehicle.create({
                        data: {
                            plate: plate, userId: user.id, brand: 'WhatsApp', model: 'Bot',
                            notes: `Creado vía WhatsApp por ${from}`
                        }
                    });

                    await prisma.credential.create({
                        data: { type: 'PLATE', value: plate, userId: user.id }
                    });

                    const lprDevices = await prisma.device.findMany({
                        where: { deviceType: 'LPR_CAMERA', brand: 'HIKVISION' }
                    });

                    const driver = new HikvisionDriver();
                    let syncCount = 0;
                    await sendWahaText(from, "⏳ Procesando en cámaras...");

                    for (const dev of lprDevices) {
                        try {
                            await driver.addPlateToCamera(dev, plate);
                            syncCount++;
                        } catch (e) {
                            console.error(`Failed to add plate to ${dev.ip}`, e);
                        }
                    }

                    await sendWahaText(from, `✅ *Éxito*\n\nMatrícula: *${plate}*\nPropietario: *${userName}*\nSincronizada en: ${syncCount}/${lprDevices.length} cámaras.\n\nEl acceso ya está activo.`);
                    await logToHistory(from, messageBody, 'replied', `Creación Exitosa: ${plate} - ${userName}`);

                } catch (e) {
                    console.error("Error creating user from WhatsApp:", e);
                    await sendWahaText(from, "❌ Ocurrió un error al guardar los datos.");
                    await logToHistory(from, messageBody, 'error', `Fallo en creación DB`);
                }

                await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                return NextResponse.json({ status: 'replied' });
            }
        }


        // COMMANDS
        if (lowerMsg.includes('configurar alerta') || lowerMsg.includes('activar notifica')) {
            try {
                // Determine if user is authorized? For now we assume knowing the bot command implies authorization 
                // or we can check if a user exists with this phone.
                // Simplified: Update the setting.
                await updateSetting('WAHA_NOTIFICATION_NUMBER', from);
                await sendWahaText(from, "✅ *Notificaciones Activadas*\n\nAhora recibirás alertas en tiempo real de todos los eventos de acceso en este chat. 🔔");
                await logToHistory(from, messageBody, 'replied', 'Activó notificaciones');
                return NextResponse.json({ status: 'replied' });
            } catch (e) {
                console.error("Failed to update notification setting", e);
                await sendWahaText(from, "❌ Error al configurar notificaciones.");
            }
        }

        // COMMANDS

        // 1. Check for Plate Query
        // Regex: 3 to 10 alphanumeric chars, optional dot.
        const plateQueryMatch = messageBody.trim().match(/^([A-Za-z0-9]{3,10})(\.)?$/);

        if (plateQueryMatch) {
            const rawPlate = plateQueryMatch[1];
            const hasDot = !!plateQueryMatch[2];
            const hasNumber = /[0-9]/.test(rawPlate);

            // Valid if: has dot OR (no dot but has numbers)
            if (hasDot || hasNumber) {
                const cleanPlate = rawPlate.toUpperCase();

                // Fetch last 10 events for this plate
                const events = await prisma.accessEvent.findMany({
                    where: {
                        OR: [
                            { plateNumber: cleanPlate },
                            { plateDetected: cleanPlate }
                        ]
                    },
                    take: 10,
                    orderBy: { timestamp: 'desc' },
                    include: { user: true, device: true }
                });

                if (events.length === 0) {
                    await sendWahaText(from, `🚫 No se encontraron registros recientes para la matrícula *${cleanPlate}*.`);
                    await logToHistory(from, messageBody, 'replied', `Sin registros para ${cleanPlate}`);
                    return NextResponse.json({ status: 'replied' });
                }

                // Build Summary
                let caption = `📋 *Últimos 10 eventos de ${cleanPlate}*\n\n`;
                events.forEach((evt, i) => {
                    const t = new Date(evt.timestamp).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false, timeZone: 'America/Montevideo' });
                    const dev = evt.device?.name || "Cámara";
                    const icon = evt.decision === 'GRANT' ? '✅' : '🚫';
                    const dir = evt.direction === 'ENTRY' ? 'Entrada' : (evt.direction === 'EXIT' ? 'Salida' : 'Acceso');
                    caption += `${i + 1}. ${t} - ${dev} (${dir}) ${icon}\n`;
                });

                // Find best image (mos recent one with snapshot)
                const eventWithImage = events.find(e => e.snapshotPath || e.imagePath);
                let imageBase64 = null;

                if (eventWithImage) {
                    const imageKey = eventWithImage.snapshotPath || eventWithImage.imagePath;
                    if (imageKey && !imageKey.startsWith('http')) {
                        try {
                            const lprBucketSetting = await getSetting("S3_BUCKET_LPR");
                            const faceBucketSetting = await getSetting("S3_BUCKET_FACE");
                            const bucket = eventWithImage.accessType === 'FACE' ? (faceBucketSetting?.value || "face") : (lprBucketSetting?.value || "lpr");

                            const s3 = await getS3InternalClient();
                            const cleanKey = extractS3Key(imageKey);
                            const command = new GetObjectCommand({ Bucket: bucket, Key: cleanKey || "" });
                            const response = await s3.send(command);
                            if (response.Body) {
                                const buffer = await streamToBuffer(response.Body as Readable);
                                imageBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                                caption += `\n📸 *Foto del evento más reciente (${new Date(eventWithImage.timestamp).toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo' })})*`;
                            }
                        } catch (e) {
                            console.error("S3 Error for plate query", e);
                        }
                    }
                } else {
                    caption += `\n⚠️ *Nota:* No se encontraron fotos en los últimos 10 eventos.`;
                }

                if (imageBase64) {
                    await sendWahaImage(from, { base64: imageBase64 }, caption);
                } else {
                    await sendWahaText(from, caption);
                }
                await logToHistory(from, messageBody, 'replied', `Reporte matrícula ${cleanPlate}`);
                return NextResponse.json({ status: 'replied' });
            }
        }


        // 2. Event Queries (Regular Regex)
        // Matches: ultimo/a, evento/acceso/entrada/salida (singular/plural), with/without accents
        const isEventQuery = /(?:ultimo|último|ultima|última).*(?:evento|acceso|entrada|salida|foto)/i.test(lowerMsg);

        if (isEventQuery) {

            const isPlural = /s\b/i.test(lowerMsg.split(" ").pop() || "") || /(?:eventos|accesos|entradas|salidas)/i.test(lowerMsg);
            const limit = isPlural ? 5 : 1;

            const whereClause: any = {};
            if (/entrada/i.test(lowerMsg)) whereClause.direction = 'ENTRY';
            if (/salida/i.test(lowerMsg)) whereClause.direction = 'EXIT';

            const events = await prisma.accessEvent.findMany({
                where: whereClause,
                take: limit,
                orderBy: { timestamp: 'desc' },
                include: { user: true, device: true }
            });

            if (events.length === 0) {
                await sendWahaText(from, "🚫 *Sistema:* No se encontraron eventos recientes en el registro.");
                await logToHistory(from, messageBody, 'replied', 'Sin eventos recientes');
                return NextResponse.json({ status: 'replied' });
            }

            // ... (Formatting logic) ...
            const lastEvent = events[0];
            let caption = "";
            let imageBase64 = null;

            // Plural Logic
            if (isPlural) {
                const title = /entrada/i.test(lowerMsg) ? 'Entradas' : (/salida/i.test(lowerMsg) ? 'Salidas' : 'Accesos');
                caption = `📋 *Últimas ${events.length} ${title}*\n\n`;
                events.forEach((evt, i) => {
                    const t = new Date(evt.timestamp).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Montevideo' });
                    const icon = evt.decision === 'GRANT' ? '✅' : '🚫';
                    let identity = "Desconocido";
                    if (evt.accessType === 'FACE' && evt.user?.name) identity = `👤 ${evt.user.name}`;
                    else if (evt.plateNumber || evt.plateDetected) identity = `🚘 ${evt.plateNumber || evt.plateDetected}`;
                    else if (evt.user?.name) identity = `👤 ${evt.user.name}`;
                    const devName = evt.device?.name || "Cámara";
                    caption += `${i + 1}. ${icon} ${identity} (@ ${devName}) - ${t}\n`;
                });
                caption += `\n🚨 *Detalle del más reciente:*`;
            } else {
                caption = `🚨 *Último Evento Reportado*`;
            }

            // Detail Logic
            const time = new Date(lastEvent.timestamp).toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
            const plate = lastEvent.plateNumber || lastEvent.plateDetected || "No detectada";
            const userName = lastEvent.user?.name || "Visitante / Desconocido";
            const deviceName = lastEvent.device?.name || "Cámara Sin Nombre";
            const decisionIcon = lastEvent.decision === 'GRANT' ? '✅' : '🚫';

            caption += `\n\n` +
                `🕒 *Hora:* ${time}\n` +
                `📍 *Punto:* ${deviceName}\n` +
                `${lastEvent.accessType === 'FACE' ? `👤 *Usuario:* ${userName}` : `🚘 *Matrícula:* ${plate}`}\n` +
                `📊 *Acceso:* ${decisionIcon} ${lastEvent.decision === 'GRANT' ? 'Permitido' : 'Denegado'}`;

            // Image Logic
            const imageKey = lastEvent.snapshotPath || lastEvent.imagePath;
            if (imageKey && !imageKey.startsWith('http')) {
                try {
                    const lprBucketSetting = await getSetting("S3_BUCKET_LPR");
                    const faceBucketSetting = await getSetting("S3_BUCKET_FACE");
                    const bucket = lastEvent.accessType === 'FACE' ? (faceBucketSetting?.value || "face") : (lprBucketSetting?.value || "lpr");
                    const s3 = await getS3InternalClient();
                    const cleanKey = extractS3Key(imageKey || "");
                    const command = new GetObjectCommand({ Bucket: bucket, Key: cleanKey || "" });
                    const response = await s3.send(command);
                    if (response.Body) {
                        const buffer = await streamToBuffer(response.Body as Readable);
                        imageBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                    }
                } catch (e) {
                    console.error("S3 Error", e);
                    caption += "\n\n⚠️ *Nota:* No se pudo recuperar la imagen adjunta.";
                }
            }

            if (imageBase64) {
                await sendWahaImage(from, { base64: imageBase64 }, caption);
            } else {
                await sendWahaText(from, caption);
            }

            await logToHistory(from, messageBody, 'replied', `Reporte enviado: ${isPlural ? 'Múltiples' : 'Único'}`);
            return NextResponse.json({ status: 'replied' });
        }

        // FALLBACK / HELP MESSAGE
        // If we reached here, no command was matched.
        // Send a help message instead of silence, to guide the user.

        const helpMessage = `🤖 *OmniAccess Bot*\n\n` +
            `👋 Hola, no he reconocido ese comando.\n\n` +
            `🔹 *Consultas Rápidas:*\n` +
            `• "último evento" (o "entrada", "salida")\n` +
            `• "ultimos eventos"\n` +
            `• "[MATRICULA]." (Ej: *ABC123.*) para ver historial\n\n` +
            `🔹 *Gestión:*\n` +
            `• "agregar matricula" (flujo paso a paso)\n` +
            `• "matricula [MATRICULA]" (para ver opciones)\n` +
            `• "activar notificaciones"`;

        await sendWahaText(from, helpMessage);
        await logToHistory(from, messageBody, 'replied', 'Mensaje de ayuda enviado');
        return NextResponse.json({ status: 'help_sent' });

    } catch (error: any) {
        console.error("Webhook Handler Error:", error);
        await logToHistory(from, messageBody || 'unknown', 'error', error.message || 'Unknown error');
        return NextResponse.json({ status: 'error' }, { status: 500 });
    }
}
