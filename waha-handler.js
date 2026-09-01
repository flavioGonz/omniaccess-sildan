const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Readable } = require("stream");
const axios = require("axios");
const crypto = require("crypto");

// Helper: Stream to Buffer
async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

// Helper: Extract clean S3 key from possibly prefixed path
function getCleanS3Key(path) {
    if (!path) return path;
    // If it's a URL or contains the API prefix, just get the last segment (filename)
    if (path.includes('api/files/') || path.includes('http')) {
        return path.split('/').pop();
    }
    // If it has slashes, it might be a structured key or a path. 
    // Usually our keys are flat in the bucket.
    if (path.includes('/') && !path.startsWith('http')) {
        return path.split('/').pop();
    }
    return path;
}

// Helper: Get S3 Client
async function getS3Client(prisma) {
    const [endpoint, accessKey, secretKey] = await Promise.all([
        prisma.setting.findUnique({ where: { key: "S3_ENDPOINT" } }),
        prisma.setting.findUnique({ where: { key: "S3_ACCESS_KEY" } }),
        prisma.setting.findUnique({ where: { key: "S3_SECRET_KEY" } }),
    ]);

    return new S3Client({
        endpoint: endpoint?.value || process.env.S3_ENDPOINT || "http://192.168.99.108:9000",
        region: "us-east-1",
        credentials: {
            accessKeyId: accessKey?.value || process.env.S3_ACCESS_KEY || "root",
            secretAccessKey: secretKey?.value || process.env.S3_SECRET_KEY || "flavio20",
        },
        forcePathStyle: true,
    });
}

const handleWahaWebhook = async (req, res, logPrefix, prisma) => {
    try {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        await new Promise(resolve => req.on('end', resolve));

        const payload = JSON.parse(body);
        console.log(`${logPrefix} [WAHA] Webhook received message`);

        const event = payload.event;
        const session = payload.session;
        const messageData = payload.payload;

        if (!messageData || event !== 'message') {
            res.writeHead(200);
            res.end('OK');
            return;
        }

        const from = messageData.from;
        const body_text = messageData.body || '';
        const chatId = from;
        const lowerBody = body_text.toLowerCase().trim();

        console.log(`${logPrefix} [WAHA] Message from ${from}: "${body_text}"`);

        // Notification for UI
        if (global.io) {
            global.io.emit("webhook-event", {
                type: "CHAT",
                origin: "WAHA",
                from: from.split('@')[0],
                body: body_text,
                timestamp: new Date().toISOString()
            });
        }

        // Config
        const wahaUrlSetting = await prisma.setting.findUnique({ where: { key: 'WAHA_URL' } });
        const wahaApiKeySetting = await prisma.setting.findUnique({ where: { key: 'WAHA_API_KEY' } });
        const baseUrlSetting = await prisma.setting.findUnique({ where: { key: 'BASE_URL' } }); // e.g. http://192.168.99.99:10001

        const wahaUrl = wahaUrlSetting?.value || "http://localhost:3000";
        const wahaApiKey = wahaApiKeySetting?.value;
        const serverBaseUrl = baseUrlSetting?.value || "http://192.168.99.99:10001";

        const sendText = async (text) => {
            const headers = {};
            if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;
            await axios.post(`${wahaUrl}/api/sendText`, { session: session || 'default', chatId, text }, { headers });
        };

        const sendImage = async (url, caption) => {
            const headers = {};
            if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;

            // For WEBJS Core (Free), /api/sendMedia is often more reliable than /api/sendImage
            // The structure for sendMedia uses 'file' as a link or object
            const body = {
                session: session || 'default',
                chatId,
                file: {
                    url: url
                },
                caption: caption
            };

            console.log(`[WAHA-DEBUG] Sending image via URL: ${url}`);
            // Switching back to /api/sendImage but keeping the URL logic
            await axios.post(`${wahaUrl}/api/sendImage`, body, { headers });
        };

        // --- HIKVISION HELPERS (Internal JS version of HikvisionDriver) ---
        const hikvisionRequest = async (method, url, data, device) => {
            const username = device.username || "admin";
            const password = device.password || "12345";
            const host = (device.ip || "").replace(/^https?:\/\//, "");
            const baseURL = `http://${host}`;
            const headers = { "Content-Type": "application/json" };

            const executeRequest = async (authHeader) => {
                return axios.request({
                    method,
                    baseURL,
                    url,
                    data,
                    headers: {
                        ...headers,
                        ...(authHeader ? { Authorization: authHeader } : {}),
                        "Accept": "application/json"
                    },
                    timeout: 10000,
                });
            };

            try {
                const response = await executeRequest();
                return response.data;
            } catch (error) {
                const authHeader = error.response?.headers["www-authenticate"];
                if (error.response?.status === 401 && authHeader) {
                    const getVal = (key) => {
                        const match = authHeader.match(new RegExp(`${key}="?([^",]+)"?`));
                        return match ? match[1].trim() : null;
                    };

                    const realm = getVal("realm");
                    const nonce = getVal("nonce");
                    const qop = getVal("qop");
                    const opaque = getVal("opaque");
                    const algorithm = (getVal("algorithm") || "MD5").toUpperCase();

                    if (!realm || !nonce) throw error;

                    const nc = "00000001";
                    const cnonce = crypto.randomBytes(8).toString("hex");

                    const calculateDigest = (uri) => {
                        let ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
                        if (algorithm === "MD5-SESS") {
                            ha1 = crypto.createHash("md5").update(`${ha1}:${nonce}:${cnonce}`).digest("hex");
                        }
                        const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");
                        let response = "";
                        if (qop === "auth") {
                            response = crypto.createHash("md5").update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest("hex");
                        } else {
                            response = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
                        }
                        return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm="${algorithm}", response="${response}"${opaque ? `, opaque="${opaque}"` : ""}${qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : ""}`;
                    };

                    try {
                        const res = await executeRequest(calculateDigest(url));
                        return res.data;
                    } catch (retryError) {
                        if (retryError.response?.status === 401 && url.includes('?')) {
                            const pathOnly = url.split('?')[0];
                            const res = await executeRequest(calculateDigest(pathOnly));
                            return res.data;
                        }
                        throw retryError;
                    }
                }
                throw error;
            }
        };

        const addPlateToHikvision = async (device, plate) => {
            const url = `/ISAPI/Traffic/channels/1/licensePlateAuditData/record?format=json`;
            const now = new Date();
            const createTime = now.toISOString().split('.')[0].replace('Z', '');
            const startDate = now.toISOString().split('T')[0];
            const end = new Date();
            end.setFullYear(end.getFullYear() + 10);
            const endDate = end.toISOString().split('T')[0];

            const payload = {
                LicensePlateInfoList: [
                    {
                        LicensePlate: plate,
                        listType: "whiteList",
                        createTime: createTime,
                        effectiveStartDate: startDate,
                        effectiveTime: endDate,
                        id: ""
                    }
                ]
            };

            return hikvisionRequest("PUT", url, payload, device);
        };

        // Check for active session
        const activeSession = await prisma.whatsAppSession.findUnique({ where: { phoneNumber: from } });

        // --- URGENT TRIGGERS (Direct Commands) ---

        // TRIGGER: "agregar matricula"
        const addPlateRegex = /^(?:agregar|añadir|nuevo|nueva)\s+(?:matricula|matrícula|vehiculo|vehículo)/i;
        if (addPlateRegex.test(lowerBody)) {
            await prisma.whatsAppSession.upsert({
                where: { phoneNumber: from },
                create: { phoneNumber: from, step: 'ADD_PLATE_PLATE' },
                update: { step: 'ADD_PLATE_PLATE', data: null }
            });

            await sendText("🚗 *Agregar Matrícula*\n\nPor favor, ingresa la matrícula que deseas registrar:");
            res.writeHead(200); res.end('OK'); return;
        }

        // --- SESSION HANDLING ---
        if (activeSession) {
            // STEP: ADD_PLATE_PLATE
            if (activeSession.step === 'ADD_PLATE_PLATE') {
                const plate = body_text.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
                if (plate.length < 3) {
                    await sendText("⚠️ Matrícula inválida. Debe tener al menos 3 caracteres.");
                    res.writeHead(200); res.end('OK'); return;
                }

                const existing = await prisma.vehicle.findUnique({ where: { plate } });
                if (existing) {
                    await sendText(`⚠️ La matrícula *${plate}* ya existe en el sistema.`);
                    await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                    res.writeHead(200); res.end('OK'); return;
                }

                await prisma.whatsAppSession.update({
                    where: { phoneNumber: from },
                    data: {
                        step: 'ADD_PLATE_NAME',
                        data: JSON.stringify({ plate })
                    }
                });

                await sendText(`👤 Ingresa el *Nombre del Propietario* para la matrícula *${plate}*:`);
                res.writeHead(200); res.end('OK'); return;
            }

            // STEP: ADD_PLATE_NAME
            if (activeSession.step === 'ADD_PLATE_NAME') {
                const userName = body_text.trim();
                const sessionData = JSON.parse(activeSession.data || "{}");
                sessionData.name = userName;

                const lprDevices = await prisma.device.findMany({
                    where: { deviceType: 'LPR_CAMERA' }
                });

                if (lprDevices.length === 0) {
                    await sendText("❌ No hay cámaras LPR configuradas.");
                    await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                    res.writeHead(200); res.end('OK'); return;
                }

                await prisma.whatsAppSession.update({
                    where: { phoneNumber: from },
                    data: {
                        step: 'ADD_PLATE_DEVICES',
                        data: JSON.stringify(sessionData)
                    }
                });

                let deviceList = "📹 *Selecciona las Cámaras*\n\n";
                deviceList += "Escribe los números (ej: 1,3) o escribe *'todas'*:\n\n";
                lprDevices.forEach((dev, i) => {
                    deviceList += `${i + 1}. ${dev.name} (${dev.ip})\n`;
                });

                await sendText(deviceList);
                res.writeHead(200); res.end('OK'); return;
            }

            // STEP: ADD_PLATE_DEVICES
            if (activeSession.step === 'ADD_PLATE_DEVICES') {
                const sessionData = JSON.parse(activeSession.data || "{}");
                const { plate, name } = sessionData;
                const selection = lowerBody.trim();

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
                    await sendText("⚠️ Selección inválida. Elige los números de la lista o 'todas'.");
                    res.writeHead(200); res.end('OK'); return;
                }

                try {
                    await sendText(`⏳ Registrando *${plate}* para *${name}* en ${selectedDevices.length} cámara(s)...`);

                    // 1. Create in DB
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
                    let successCount = 0;
                    let failCount = 0;

                    for (const dev of selectedDevices) {
                        try {
                            if (dev.brand === 'HIKVISION') {
                                await addPlateToHikvision(dev, plate);
                                successCount++;
                            } else {
                                failCount++;
                            }
                        } catch (e) {
                            console.error(`Failed to sync to ${dev.ip}:`, e.message);
                            failCount++;
                        }
                    }

                    await sendText(`✅ *Registro Completado*\n\nMatrícula: *${plate}*\nPropietario: *${name}*\n\nSincronización:\n✔️ Éxito: ${successCount}\n❌ Fallo: ${failCount}`);
                } catch (e) {
                    console.error("Error in WAHA ADD_PLATE flow:", e);
                    await sendText(`❌ Error al procesar: ${e.message}`);
                }

                await prisma.whatsAppSession.delete({ where: { phoneNumber: from } });
                res.writeHead(200); res.end('OK'); return;
            }
        }

        // --- COMMAND LOGIC ---

        // 1. NOTIFICATIONS
        if (lowerBody.includes('configurar alerta') || lowerBody.includes('activar notifica')) {
            await prisma.setting.upsert({
                where: { key: 'WAHA_NOTIFICATION_NUMBER' },
                update: { value: from },
                create: { key: 'WAHA_NOTIFICATION_NUMBER', value: from }
            });
            await sendText("✅ *Notificaciones Activadas*\n\nAhora recibirás alertas en tiempo real de todos los eventos de acceso en este chat. 🔔");
            res.writeHead(200); res.end('OK'); return;
        }

        // 2. STATUS / DEVICES
        if (lowerBody === 'estado' || lowerBody.includes('camara') || lowerBody.includes('viva')) {
            const devices = await prisma.device.findMany();
            let response = `📸 *Estado de Dispositivos*\n\n`;
            if (devices.length === 0) response += "_No hay dispositivos registrados._";
            devices.forEach(d => {
                const icon = d.lastOnlinePush ? '🟢' : '🔴';
                const lastSeen = d.lastOnlinePush ? new Date(d.lastOnlinePush).toLocaleString('es-UY') : 'Nunca';
                response += `${icon} *${d.name}*\n   ├ IP: ${d.ip}\n   ├ Tipo: ${d.deviceType}\n   └ Visto: ${lastSeen}\n\n`;
            });
            await sendText(response);
            res.writeHead(200); res.end('OK'); return;
        }

        // 3. EVENT QUERIES (Latest event/entry/exit)
        const isEventQuery = /^(?:ultimo|último|ultima|última|eventos|entradas|salidas|accesos|foti?o)/i.test(lowerBody);

        if (isEventQuery) {
            const isPlural = /s\b/i.test(lowerBody.split(" ").pop() || "") || /(?:eventos|accesos|entradas|salidas)/i.test(lowerBody);
            const limit = isPlural ? 20 : 1;
            const whereClause = {};
            if (/entrada/i.test(lowerBody)) whereClause.direction = 'ENTRY';
            if (/salida/i.test(lowerBody)) whereClause.direction = 'EXIT';

            const events = await prisma.accessEvent.findMany({
                where: whereClause,
                take: limit,
                orderBy: { timestamp: 'desc' },
                include: { user: true, device: true }
            });

            if (events.length === 0) {
                await sendText("🚫 *Sistema:* No se encontraron eventos recientes en el registro.");
            } else {
                const lastEvent = events[0];
                let caption = "";

                if (isPlural) {
                    const title = /entrada/i.test(lowerBody) ? 'Entradas' : (/salida/i.test(lowerBody) ? 'Salidas' : 'Accesos');
                    caption = `📋 *Últimas ${events.length} ${title}*\n\n`;
                    events.forEach((evt, i) => {
                        const t = new Date(evt.timestamp).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Montevideo' });
                        const icon = evt.decision === 'GRANT' ? '✅' : '🚫';
                        let identity = evt.user?.name || evt.plateNumber || evt.plateDetected || "Desconocido";
                        if (evt.accessType === 'FACE') identity = `👤 ${evt.user?.name || "???"}`;
                        else if (evt.accessType === 'PLATE') identity = `🚘 ${evt.plateNumber || "???"}`;

                        const dir = evt.direction === 'ENTRY' ? 'ENTRADA' : (evt.direction === 'EXIT' ? 'SALIDA' : 'ACCESO');
                        caption += `${i + 1}. ${icon} ${identity} - *${dir}* - ${t}\n`;
                    });
                    caption += `\n🚨 *Detalle del más reciente:*`;
                } else {
                    caption = `🚨 *Último Evento Reportado*`;
                }

                // Detail
                const t = new Date(lastEvent.timestamp).toLocaleString('es-UY', { timeZone: 'America/Montevideo', day: 'numeric', month: 'numeric' });
                const time = new Date(lastEvent.timestamp).toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit' });
                const plate = lastEvent.plateNumber || lastEvent.plateDetected || "No detectada";
                const userName = lastEvent.user?.name || "Visitante / Desconocido";
                const deviceName = lastEvent.device?.name || "Cámara Sin Nombre";
                const directionText = lastEvent.direction === 'ENTRY' ? 'ENTRADA' : (lastEvent.direction === 'EXIT' ? 'SALIDA' : 'ACCESO');
                const decisionIcon = lastEvent.decision === 'GRANT' ? '✅' : '🚫';

                caption += `\n` +
                    `📅 *Fecha:* ${t} ${time}\n` +
                    `📍 *Punto:* ${deviceName}\n` +
                    `↕️ *Sentido:* *${directionText}*\n` +
                    `${lastEvent.accessType === 'FACE' ? `👤 *Usuario:* ${userName}` : `🚘 *Matrícula:* ${plate}`}\n` +
                    `📊 *Acceso:* ${decisionIcon} ${lastEvent.decision === 'GRANT' ? 'Permitido' : 'Denegado'}\n` +
                    `━━━━━━━━━━━━━━━━━━━━`;

                // Image URL
                let imagePublicUrl = null;
                const imageKey = lastEvent.snapshotPath || lastEvent.imagePath;
                if (imageKey) {
                    const cleanKey = getCleanS3Key(imageKey);
                    const bucketSetting = lastEvent.accessType === 'FACE' ? 'S3_BUCKET_FACE' : 'S3_BUCKET_LPR';
                    const bucketConf = await prisma.setting.findUnique({ where: { key: bucketSetting } });
                    const bucket = bucketConf?.value || (lastEvent.accessType === 'FACE' ? 'face' : 'lpr');

                    imagePublicUrl = `${serverBaseUrl}/api/files/${bucket}/${cleanKey}`;
                }

                if (imagePublicUrl) {
                    try {
                        await sendImage(imagePublicUrl, caption);
                    } catch (e) {
                        console.error("WAHA sendImage Error (Event):", e.response?.data || e.message);
                        const imageLink = `\n\n🔗 *Ver Foto:* ${imagePublicUrl}`;
                        await sendText(caption + imageLink);
                    }
                } else {
                    await sendText(caption);
                }
            }
            res.writeHead(200); res.end('OK'); return;
        }

        // 4. PLATE QUERY (Ends with dot OR implicit if nums exist)
        const plateQueryMatch = body_text.trim().match(/^([A-Za-z0-9]{3,10})(\.)?$/);
        if (plateQueryMatch) {
            const rawPlate = plateQueryMatch[1];
            const hasDot = !!plateQueryMatch[2];
            const hasNumber = /[0-9]/.test(rawPlate);

            if (hasDot || hasNumber) {
                const cleanPlate = rawPlate.toUpperCase();
                // Exclude keywords that might have been matched by the regex but aren't actually plates
                const keywords = ['ULTIMO', 'ULTIMA', 'EVENTO', 'EVENTOS', 'ESTADO', 'MENU', 'AYUDA', 'BUSCAR'];
                if (!hasDot && keywords.includes(cleanPlate)) {
                    // Fall through to help if it matched a keyword without dot
                } else {
                    const events = await prisma.accessEvent.findMany({
                        where: { OR: [{ plateNumber: cleanPlate }, { plateDetected: cleanPlate }] },
                        take: 20,
                        orderBy: { timestamp: 'desc' },
                        include: { user: true, device: true }
                    });

                    if (events.length === 0) {
                        await sendText(`🚫 No se encontraron registros recientes para la matrícula *${cleanPlate}*.`);
                    } else {
                        let caption = `📋 *Últimos 20 eventos de ${cleanPlate}*\n\n`;
                        events.forEach((evt, i) => {
                            const t = new Date(evt.timestamp).toLocaleString('es-UY', { timeZone: 'America/Montevideo', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
                            const dev = evt.device?.name || "Cámara";
                            const icon = evt.decision === 'GRANT' ? '✅' : '🚫';
                            const dir = evt.direction === 'ENTRY' ? 'ENTRADA' : (evt.direction === 'EXIT' ? 'SALIDA' : 'ACCESO');
                            caption += `${i + 1}. ${t} - *${dir}* - ${dev} ${icon}\n`;
                        });

                        // Fetch Image URL logic
                        const eventWithImage = events.find(e => e.snapshotPath || e.imagePath);
                        let imagePublicUrl = null;
                        if (eventWithImage) {
                            const imageKey = eventWithImage.snapshotPath || eventWithImage.imagePath;
                            const cleanKey = getCleanS3Key(imageKey);
                            const bucketSetting = eventWithImage.accessType === 'FACE' ? 'S3_BUCKET_FACE' : 'S3_BUCKET_LPR';
                            const bucketConf = await prisma.setting.findUnique({ where: { key: bucketSetting } });
                            const bucket = bucketConf?.value || (eventWithImage.accessType === 'FACE' ? 'face' : 'lpr');

                            imagePublicUrl = `${serverBaseUrl}/api/files/${bucket}/${cleanKey}`;
                            caption += `\n📸 *Foto del evento más reciente*`;
                        } else {
                            caption += `\n⚠️ No hay fotos recientes.`;
                        }

                        if (imagePublicUrl) {
                            try {
                                await sendImage(imagePublicUrl, caption);
                            } catch (e) {
                                console.error("WAHA sendImage Error (Plate):", e.response?.data || e.message);
                                const imageLink = `\n\n🔗 *Ver Foto:* ${imagePublicUrl}`;
                                await sendText(caption + imageLink);
                            }
                        } else {
                            await sendText(caption);
                        }
                    }
                    res.writeHead(200); res.end('OK'); return;
                }
            }
        }

        // 5. FALLBACK / HELP / MENU
        const helpMessage = `🤖 *Asistente OmniAccess*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `¡Hola! Soy tu asistente de control de acceso. Selecciona una opción o escribe un comando:\n\n` +
            `📊 *CONSULTAS DE ACCESO*\n` +
            `• *"ultimo"* - Ver el movimiento más reciente.\n` +
            `• *"entradas"* - Últimos ingresos registrados.\n` +
            `• *"salidas"* - Últimos egresos registrados.\n` +
            `• *"eventos"* - Resumen de los últimos 5 movimientos.\n\n` +
            `🚘 *BÚSQUEDA POR MATRÍCULA*\n` +
            `• Escribe la matrícula (ej: *ABC123*) para ubicar un vehículo.\n` +
            `• Agrega un punto (ej: *ABC123.*) para ver fotos e historial.\n\n` +
            `⚙️ *SISTEMA Y GESTIÓN*\n` +
            `• *"estado"* - Ver cámaras online/offline.\n` +
            `• *"notificaciones"* - Activar alertas en este chat.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 _Tip: Puedes buscar personas escribiendo su nombre._`;

        await sendText(helpMessage);

        res.writeHead(200);
        res.end('OK');

    } catch (error) {
        console.error(`${logPrefix} [WAHA] Handler Error:`, error);
        res.writeHead(500);
        res.end('Error');
    }
};

module.exports = { handleWahaWebhook };
