const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Readable } = require("stream");
const axios = require("axios");
const crypto = require("crypto");
let QRLIB=null; try{ QRLIB=require("qrcode"); }catch(e){}

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

        // Un mismo mensaje puede llegar dos veces: WAHA tiene dos emisores de webhook (el
        // global del contenedor, WHATSAPP_HOOK_URL, y el de la sesión) y además reintenta.
        // El 6/10 cada respuesta salía duplicada por eso. Se recuerda el id del mensaje
        // (o remitente+texto+hora si no viene) durante 2 minutos y la repetición se ignora.
        const dedupeKey = String(messageData.id || `${from}|${body_text}|${messageData.timestamp || ''}`);
        global.__wahaVistos = global.__wahaVistos || new Map();
        const ahora = Date.now();
        for (const [k, t] of global.__wahaVistos) if (ahora - t > 120000) global.__wahaVistos.delete(k);
        if (global.__wahaVistos.has(dedupeKey)) { res.writeHead(200); res.end('DUP'); return; }
        global.__wahaVistos.set(dedupeKey, ahora);
        const chatId = from;
        const lowerBody = body_text.toLowerCase().trim();

        console.log(`${logPrefix} [WAHA] Message from ${from}: "${body_text}"`);

        // ── Interruptores del cajón "Comandos del bot" (Setting WAHA_COMMANDS) ──
        // Hasta acá la pantalla guardaba [{id, active}] y nadie lo leía: un interruptor
        // apagado seguía contestando. Ahora cada comando pregunta antes de actuar; lo que
        // no está en la lista se considera prendido, para no apagar nada por accidente.
        let _cmdCfg = null;
        const cmdActivo = async (id) => {
            if (_cmdCfg === null) {
                _cmdCfg = {};
                try { const r = await prisma.setting.findUnique({ where: { key: 'WAHA_COMMANDS' } }); for (const c of JSON.parse(r?.value || '[]')) if (c && c.id) _cmdCfg[c.id] = c.active !== false; } catch (e) {}
            }
            return _cmdCfg[id] !== false;
        };

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
        // Misma fuente y prioridad que getWhatsAppConfig() (src/lib/whatsapp.ts): OPENWA_*
        // primero, WAHA_* de respaldo. Este handler leía sólo WAHA_*; en San Nicolás la clave
        // vive en OPENWA_API_KEY, así que todo lo que mandaba daba 401 y el bot "no contestaba"
        // (y como el handler devolvía 500, WAHA reintentaba 15 veces el mismo mensaje).
        const cfgRows = await prisma.setting.findMany({ where: { key: { in: ['OPENWA_URL', 'OPENWA_API_KEY', 'WAHA_URL', 'WAHA_API_KEY', 'BASE_URL'] } } });
        const cfg = {}; for (const r of cfgRows) cfg[r.key] = r.value;
        const baseUrlSetting = cfg.BASE_URL ? { value: cfg.BASE_URL } : null;

        const wahaUrl = (cfg.OPENWA_URL || cfg.WAHA_URL || process.env.OPENWA_URL || "http://localhost:3000").replace(/\/+$/, "");
        const wahaApiKey = cfg.OPENWA_API_KEY || cfg.WAHA_API_KEY || process.env.OPENWA_API_KEY;
        const serverBaseUrl = baseUrlSetting?.value || "http://192.168.99.99:10001";

        // ── Resolver número real del remitente (WhatsApp manda @lid oculto) ──
        // Además del número (para reconocer al residente) se guarda el chat "@c.us": el motor
        // WEBJS contesta texto a un @lid, pero sendImage a un @lid falla con "Data passed to
        // getter must include an id property" → el pase llegaba sin QR. A partir de acá todo
        // se manda al chat resuelto; si no se pudo resolver, al @lid original.
        let _senderTailCache = null;
        let chatDestino = chatId;
        const senderTail = async () => {
            if (_senderTailCache !== null) return _senderTailCache;
            let id = from || "";
            if (id.endsWith('@lid')) {
                try {
                    const lid = id.replace('@lid','');
                    const headers = {}; if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;
                    const r = await axios.get(`${wahaUrl}/api/${session || 'default'}/lids/${lid}`, { headers, timeout: 8000 });
                    if (r.data && r.data.pn) { id = r.data.pn; chatDestino = r.data.pn; }
                } catch (e) { console.error('[WAHA] lid resolve error:', e.message); }
            }
            _senderTailCache = String(id).replace(/\D/g,'').slice(-8);
            return _senderTailCache;
        };
        const isAdminSender = async () => {
            const tail = await senderTail(); if (!tail) return false;
            try {
                const users = await prisma.user.findMany({ where:{ role:{ in:['ADMIN','STAFF','SECURITY','OPERATOR'] }, phone:{ not:null } }, select:{ phone:true } });
                if (users.some(u => String(u.phone||'').replace(/\D/g,'').slice(-8) === tail)) return true;
            } catch (e) {}
            try { const r = await prisma.setting.findUnique({ where:{ key:'BOT_ADMIN_PHONES' } }); const arr = JSON.parse(r?.value||'[]'); if (arr.some(p => String((typeof p==='string'?p:p.phone)||'').replace(/\D/g,'').slice(-8) === tail)) return true; } catch (e) {}
            // La lista "Remitentes autorizados" de Ajustes suma números de personal que no
            // tienen usuario cargado (el teléfono de la garita, por ejemplo).
            try { const r = await prisma.setting.findUnique({ where:{ key:'WHATSAPP_ALLOWLIST' } }); const arr = JSON.parse(r?.value||'[]'); if (arr.some(p => String((typeof p==='string'?p:p.phone)||'').replace(/\D/g,'').slice(-8) === tail)) return true; } catch (e) {}
            return false;
        };

        const sendText = async (text) => {
            const headers = {};
            if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;
            await senderTail();
            await axios.post(`${wahaUrl}/api/sendText`, { session: session || 'default', chatId: chatDestino, text }, { headers });
        };

        const sendImage = async (url, caption) => {
            const headers = {};
            if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;

            // For WEBJS Core (Free), /api/sendMedia is often more reliable than /api/sendImage
            // The structure for sendMedia uses 'file' as a link or object
            await senderTail();
            const body = {
                session: session || 'default',
                chatId: chatDestino,
                file: {
                    url: url
                },
                caption: caption
            };

            console.log(`[WAHA-DEBUG] Sending image via URL: ${url}`);
            // Switching back to /api/sendImage but keeping the URL logic
            await axios.post(`${wahaUrl}/api/sendImage`, body, { headers });
        };

        const sendImageB64 = async (b64, caption) => {
            const headers = {}; if (wahaApiKey) headers['X-Api-Key'] = wahaApiKey;
            await senderTail();
            await axios.post(`${wahaUrl}/api/sendImage`, { session: session || 'default', chatId: chatDestino, file: { mimetype: 'image/png', filename: 'pase.png', data: b64 }, caption }, { headers });
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
        if (addPlateRegex.test(lowerBody) && await cmdActivo('agregar_matricula') && await isAdminSender()) {
            await prisma.whatsAppSession.upsert({
                where: { phoneNumber: from },
                create: { phoneNumber: from, step: 'ADD_PLATE_PLATE' },
                update: { step: 'ADD_PLATE_PLATE', data: null }
            });

            await sendText("🚗 *Agregar Matrícula*\n\nPor favor, ingresa la matrícula que deseas registrar:");
            res.writeHead(200); res.end('OK'); return;
        }

        // --- INVITAR VISITA (residentes) ---
        const inviteTokenGen = () => { const abc="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let x=""; for(let i=0;i<6;i++) x+=abc[Math.floor(Math.random()*abc.length)]; return x; };
        const resolveHost = async () => {
            const tail = await senderTail();
            if(!tail) return null;
            try {
                const users = await prisma.user.findMany({ where:{ role:'RESIDENT', phone:{ not:null } }, select:{ id:true,name:true,unitId:true,phone:true,apartment:true } });
                const u = users.find(x => String(x.phone||'').replace(/\D/g,'').slice(-8)===tail);
                if(u){ let label=u.apartment||''; if(u.unitId){ const un=await prisma.unit.findUnique({ where:{id:u.unitId}, select:{name:true,lot:true,houseNumber:true} }); if(un) label=[un.name, un.lot?('Lote '+un.lot):un.houseNumber].filter(Boolean).join(' · ')||label; } return { userId:u.id, name:u.name, unitId:u.unitId, label }; }
            } catch(e){}
            try { const r=await prisma.setting.findUnique({ where:{ key:'INVITE_WA_ALLOWLIST' } }); const arr=JSON.parse(r?.value||'[]'); const hit=arr.find(e=>String((typeof e==='string'?e:e.phone)||'').replace(/\D/g,'').slice(-8)===tail); if(hit) return { userId:(hit.userId||null), name:(hit.name||'Residente'), unitId:(hit.unitId||null), label:(hit.label||'') }; } catch(e){}
            return null;
        };
        const parseWhen = (text) => {
            const t=(text||'').toLowerCase(); const now=new Date(); const base=new Date(now);
            const wd={ 'domingo':0,'lunes':1,'martes':2,'miercoles':3,'miércoles':3,'jueves':4,'viernes':5,'sabado':6,'sábado':6 };
            if(/\bma(ñ|n)ana\b/.test(t)){ base.setDate(base.getDate()+1); }
            else { for(const k in wd){ if(t.includes(k)){ let d=(wd[k]-base.getDay()+7)%7; if(d===0) d=7; base.setDate(base.getDate()+d); break; } } }
            const m=t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:a|hasta|al|-)\s*(\d{1,2})(?:[:.](\d{2}))?/);
            let fromD, toD;
            if(m){ const sh=+m[1], sm=+(m[2]||0), eh=+m[3], em=+(m[4]||0); fromD=new Date(base); fromD.setHours(sh,sm,0,0); toD=new Date(base); toD.setHours(eh,em,0,0); if(toD<=fromD) toD.setDate(toD.getDate()+1); }
            else { const sameDay = base.toDateString()===now.toDateString(); fromD = sameDay ? new Date(now) : new Date(base.setHours(8,0,0,0)); toD = new Date(fromD.getTime()+12*3600*1000); }
            if(fromD < new Date(now.getTime()-60000)) fromD = new Date(now);
            return { from:fromD, to:toD };
        };

        const inviteTrigger = /^(?:invitar|invito|invitaci(o|ó)n|invitacion|visita|pase)\b/i;
        if (inviteTrigger.test(lowerBody) && await cmdActivo('invitar')) {
            const host = await resolveHost();
            if(!host){ console.log(`${logPrefix} [WAHA] invitar desde un número no registrado, se ignora: ${from}`); res.writeHead(200); res.end('OK'); return; }
            await prisma.whatsAppSession.upsert({ where:{ phoneNumber:from }, create:{ phoneNumber:from, step:'INV_NAME', data:JSON.stringify(host) }, update:{ step:'INV_NAME', data:JSON.stringify(host) } });
            await sendText(`👋 Hola ${host.name||''}. Vamos a crear un *pase de visita*.\n\n¿*Nombre* del invitado?`);
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

            // STEP: INV_NAME
            if (activeSession.step === 'INV_NAME') {
                const name = body_text.trim();
                if (name.length < 2) { await sendText("⚠️ Ingresá un nombre válido."); res.writeHead(200); res.end('OK'); return; }
                const d = JSON.parse(activeSession.data || "{}"); d.guestName = name;
                await prisma.whatsAppSession.update({ where:{ phoneNumber:from }, data:{ step:'INV_PLATE', data:JSON.stringify(d) } });
                await sendText(`🚗 ¿*Patente* del invitado? (escribí *sin auto* si viene a pie)`);
                res.writeHead(200); res.end('OK'); return;
            }
            // STEP: INV_PLATE
            if (activeSession.step === 'INV_PLATE') {
                const d = JSON.parse(activeSession.data || "{}");
                const raw = body_text.trim();
                d.plate = /sin\s*auto|no|a pie|ninguna/i.test(raw) ? "" : raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
                await prisma.whatsAppSession.update({ where:{ phoneNumber:from }, data:{ step:'INV_WHEN', data:JSON.stringify(d) } });
                await sendText(`📅 ¿*Para cuándo*? Ejemplos:\n• *hoy*\n• *sábado 20 a 02*\n• *mañana 10 a 14*`);
                res.writeHead(200); res.end('OK'); return;
            }
            // STEP: INV_WHEN  → crea la invitación
            if (activeSession.step === 'INV_WHEN') {
                const d = JSON.parse(activeSession.data || "{}");
                const win = parseWhen(body_text);
                try {
                    const inv = await prisma.invitation.create({ data:{
                        hostUserId: d.userId || null, hostUnitId: d.unitId || null, hostName: d.name || "", hostLabel: d.label || "",
                        kind:'SINGLE', title: d.guestName || "", validFrom: win.from, validTo: win.to, reentry:'MULTI',
                        createdVia:'WHATSAPP', createdBy: from, notify:true, token: inviteTokenGen()
                    }});
                    const qrToken = crypto.randomBytes(18).toString('base64url');
                    await prisma.guest.create({ data:{ invitationId: inv.id, name: d.guestName || "", qrToken, status:'APPROVED', plates: d.plate ? { create:[{ plate:d.plate }] } : undefined } });
                    const fmt = (x)=> new Date(x).toLocaleString('es-UY',{ weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                    const caption = `✅ *Pase creado*\n👤 ${d.guestName}${d.plate?(" ("+d.plate+")"):" (a pie)"}\n🕒 ${fmt(win.from)} → ${fmt(win.to)}\n🏠 Invita: ${d.name||""}${d.label?(" · "+d.label):""}\n\nReenviá este QR a tu invitado para que lo muestre en la garita.`;
                    let imgSent = false;
                    try {
                        if (QRLIB) {
                            const link = `${serverBaseUrl.replace(/\/+$/,'')}/invitado/${qrToken}`;
                            const du = await QRLIB.toDataURL(link, { width: 512, margin: 1, errorCorrectionLevel: 'M' });
                            await sendImageB64(du.split(',')[1], caption);
                            imgSent = true;
                        }
                    } catch (e) { console.error('[WAHA] QR image send error:', e.message); }
                    if (!imgSent) await sendText(caption);
                } catch (e) {
                    console.error("Error creando invitación WA:", e);
                    await sendText(`❌ No pude crear el pase: ${e.message}`);
                }
                await prisma.whatsAppSession.delete({ where:{ phoneNumber:from } });
                res.writeHead(200); res.end('OK'); return;
            }
        }

        // --- COMMAND LOGIC ---

        // Sólo admins/personal usan el bot de consultas. Residentes → flujo de invitación; resto → aviso.
        if (!(await isAdminSender())) {
            const _host = await resolveHost();
            // Al bot sólo le escriben los residentes (por el teléfono cargado en su ficha) y el
            // personal. Un número que no es de nadie se ignora EN SILENCIO: contestarle, aunque
            // sea para decirle que no, confirma que el número existe y que es del barrio.
            if (!_host) { console.log(`${logPrefix} [WAHA] remitente no registrado, se ignora: ${from}`); res.writeHead(200); res.end('OK'); return; }
            await sendText("👋 Para generar un *pase de visita*, escribí *invitar*.");
            res.writeHead(200); res.end('OK'); return;
        }

        // 1. NOTIFICATIONS
        if ((lowerBody.includes('configurar alerta') || lowerBody.includes('activar notifica')) && await cmdActivo('notificaciones')) {
            await prisma.setting.upsert({
                where: { key: 'WAHA_NOTIFICATION_NUMBER' },
                update: { value: from },
                create: { key: 'WAHA_NOTIFICATION_NUMBER', value: from }
            });
            await sendText("✅ *Notificaciones Activadas*\n\nAhora recibirás alertas en tiempo real de todos los eventos de acceso en este chat. 🔔");
            res.writeHead(200); res.end('OK'); return;
        }

        // 2. STATUS / DEVICES
        if ((lowerBody === 'estado' || lowerBody.includes('camara') || lowerBody.includes('viva')) && await cmdActivo('estado')) {
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

        if (isEventQuery && await cmdActivo('eventos')) {
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
        if (plateQueryMatch && await cmdActivo('matricula')) {
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
            `• *"configurar alerta"* - Activar alertas en este chat.\n` +
            `• *"agregar matrícula"* - Dar de alta un vehículo.\n\n` +
            `🎟️ *VISITAS*\n` +
            `• *"invitar"* - Un residente crea un pase de visita y recibe el QR.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 _Tip: Puedes buscar personas escribiendo su nombre._`;

        await sendText(helpMessage);

        res.writeHead(200);
        res.end('OK');

    } catch (error) {
        console.error(`${logPrefix} [WAHA] Handler Error:`, error);
        // 200 aunque haya fallado: con 500 WAHA reintenta el mismo mensaje hasta 15 veces y
        // el residente recibe la respuesta repetida cuando el fallo era transitorio.
        res.writeHead(200);
        res.end('ERR');
    }
};

module.exports = { handleWahaWebhook };
