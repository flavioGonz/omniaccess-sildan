const { XMLParser } = require("fast-xml-parser");
const { uploadToS3 } = require("../lib-s3");
const {
    isDuplicate, addDebugLog, isValidImage,
    formatEventDate, sanitizeName, generateId, parseMultipart,
} = require("./shared");

/**
 * Handle Akuvox Face/RFID/Door webhooks.
 */
const handleAkuvoxWebhook = async (req, res, logPrefix, deps) => {
    const { prisma, io, sendPushToAll, fetchAkuvoxFaceImage, adoptDevice } = deps;
    try {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const params = Object.fromEntries(parsedUrl.searchParams);
        const eventId = generateId();


        // Required params based on our spec
        let eventType = params.event;
        const macAddress = params.mac;
        const cardNumber = params.card;

        // Normalización de eventos según recomendación en docs/akuvox/AKUVOX_CALLBACKS.md
        // Soporta eventos directos (event=door_open) o anidados (event=relay&status=open)
        if (eventType === 'relay' || eventType === 'relay_open' || eventType === 'relay_close') {
            const isOpening = eventType === 'relay_open' || (eventType === 'relay' && params.status === 'open');
            eventType = isOpening ? 'door_open' : 'door_close';
        } else if (eventType === 'card') {
            eventType = params.type === 'invalid' ? 'card_invalid' : 'card_valid';
        } else if (eventType === 'face') {
            eventType = params.type === 'invalid' ? 'face_invalid' : 'face_valid';
        } else if (eventType === 'code') {
            eventType = params.type === 'invalid' ? 'code_invalid' : 'code_valid';
        } else if (eventType === 'qr' || eventType === 'qr_valid' || eventType === 'qr_invalid') {
            const isInvalid = eventType === 'qr_invalid' || params.type === 'invalid' || params.unlocktype === 'Null';
            eventType = isInvalid ? 'qr_invalid' : 'qr_valid';
        } else if (eventType === 'call_start') {
            eventType = 'calling';
        } else if (eventType === 'call_end' || eventType === 'hangup') {
            eventType = 'call_end';
        } else if (eventType === 'boot' || eventType === 'setup_completed') {
            eventType = 'boot';
        }

        // Eventos de sistema (si vienen por el parámetro event directamente)
        // Ejemplos: tamper, calling, login_fail, motion

        if (!macAddress) {
            console.warn(`${logPrefix} Akuvox webhook missing MAC`);
            res.writeHead(400);
            res.end("Missing MAC");
            return;
        } else {
            const allDevices = await prisma.device.findMany({ where: { brand: 'AKUVOX' } });
            const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
            const cleanIncomingMac = normalizeMac(macAddress);
            const device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
            if (device) {
                await prisma.device.update({
                    where: { id: device.id },
                    data: { lastOnlinePush: new Date() }
                }).catch(e => { });
            }
        }

        // Helper to normalize MAC (moved here for broader scope if needed, but also defined above)
        const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
        const cleanMac = normalizeMac(macAddress);

        // Find Device
        const allDevices = await prisma.device.findMany();
        let device = allDevices.find(d => normalizeMac(d.mac) === cleanMac);

        // Emit debug event for monitoring (after finding device)
        addDebugLog({
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'akuvox',
            method: req.method,
            url: req.url,
            params: params,
            deviceName: device?.name || 'Dispositivo Desconocido',
            deviceMac: macAddress,
            credentialValue: params.card || params.user || params.name || params.code || eventType
        });

        if (!device) {
            // RECOVERY: If MAC is invalid (macro literal like $mac) or not found, try by IP
            const remoteIp = req.socket.remoteAddress;
            const cleanRemoteIp = remoteIp ? remoteIp.replace(/^.*:/, '') : null;


            if (cleanRemoteIp) {
                device = allDevices.find(d => d.ip === cleanRemoteIp || d.ip.includes(cleanRemoteIp));
            }

            if (!device && allDevices.length === 1 && allDevices[0].brand === 'AKUVOX') {
                device = allDevices[0];
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, req.socket.remoteAddress, 'AKUVOX', 'DOOR_INTERCOM');
        }

        if (!device) {
            console.warn(`${logPrefix} Unknown Akuvox Device. MAC: ${macAddress}, IP: ${req.socket.remoteAddress}`);
        }

        let accessDecision = "DENY";
        let credentialType = null;
        let credentialValue = null;
        let userId = null;
        let user = null;
        let details = "";
        let snapPath = null; // Defined here for all logic types

        // Process Event Type
        if (eventType === 'door_open') {
            // Door opened remotely or manually
            details = `Puerta Abierta (${params.id || 'Relay A'})`;
            accessDecision = "GRANT";
            credentialType = "TAG";
            credentialValue = "DOOR_OPEN";

            if (device) {
                try {
                    await prisma.device.update({
                        where: { id: device.id },
                        data: { doorStatus: 'OPEN' }
                    });

                    // ATOMIC CAPTURE ON REMOTE OPEN
                    const snapBuffer = await fetchAkuvoxFaceImage(device, { name: params.user || params.name });
                    if (snapBuffer) {
                        try {
                            const devName = sanitizeName(device?.name);
                            const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                            const fDate = formatEventDate(new Date());
                            const filename = `aku-open-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                            snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                            details += " (Evidencia capturada)";
                        } catch (e) {
                            console.error("Error uploading open snapshot to S3:", e.message);
                        }
                    }

                } catch (e) { console.error("Error updating door status:", e); }
            }

            if (global.io) {
                io.emit("device_status", {
                    deviceId: device?.id,
                    mac: macAddress,
                    doorStatus: 'open',
                    timestamp: new Date()
                });
            }

        } else if (eventType === 'door_close') {
            details = `Puerta Cerrada`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'DOOR_CLOSE';

            if (device) {
                try {
                    await prisma.device.update({
                        where: { id: device.id },
                        data: { doorStatus: 'CLOSED' }
                    });
                } catch (e) { console.error("Error updating door status:", e); }
            }

            if (global.io) {
                io.emit("device_status", {
                    deviceId: device?.id,
                    mac: macAddress,
                    doorStatus: 'closed',
                    timestamp: new Date()
                });
            }

        } else if (eventType === 'card_valid') {
            credentialType = 'TAG';
            credentialValue = cardNumber;
            accessDecision = "GRANT";
            details = `Tarjeta RFID Válida: ${cardNumber}`;

            if (device) {
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, card: cardNumber, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-card-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Evidencia capturada)";
                    } catch (e) {
                        console.error("Error uploading card snapshot to S3:", e.message);
                    }
                }
            }

        } else if (eventType === 'card_invalid') {
            credentialType = 'TAG';
            credentialValue = cardNumber;
            accessDecision = "DENY";
            details = `Tarjeta RFID Inválida: ${cardNumber}`;

        } else if (eventType === 'face_valid' || eventType === 'face_invalid') {
            const isSuccess = eventType === 'face_valid';
            credentialType = 'FACE';

            // Filter out device macros that weren't replaced ($name, $user, etc)
            const rawValue = params.user || params.name || (isSuccess ? "Unknown" : "Desconocido");
            credentialValue = rawValue.startsWith('$') ? "No Identificado" : rawValue;

            // Default access decision (will be overridden by MODE_FACE logic if user found)
            accessDecision = isSuccess ? "GRANT" : "DENY";
            details = isSuccess ? `Rostro: ${credentialValue}, Similitud: ${params.similarity || '100'}%` : `Rostro: Desconocido, Similitud: 0%`;

            // ATOMIC CAPTURE ON FACE EVENT
            if (device) {

                // Priority: FaceUrl from hook (if provided), then userId lookup
                const snapBuffer = await fetchAkuvoxFaceImage(device, {
                    userId: params.userid,
                    name: params.user || params.name,
                    path: params.FaceUrl || params.PicUrl,
                    card: params.card
                });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-face-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");

                        // Enrich details for the UI modal (EventDetailsDialog expects FaceImage: <path>)
                        if (details.includes('Rostro:')) {
                            details += `, FaceImage: ${snapPath}`;
                        } else {
                            details += ` - FaceImage: ${snapPath}`;
                        }

                    } catch (e) {
                        console.error("Error uploading face snapshot to S3:", e.message);
                    }
                }
                else {
                    console.warn(`${logPrefix} [AUTO-SNAP] ✗ Failed to fetch face image from device`);
                }
            }

        } else if (eventType === 'code_valid') {
            credentialType = 'PIN';
            credentialValue = params.code;
            accessDecision = "GRANT";
            details = `Código PIN Válido: ${params.code}`;

            if (device) {
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-pin-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Evidencia capturada)";
                    } catch (e) {
                        console.error("Error uploading pin snapshot to S3:", e.message);
                    }
                }
            }

        } else if (eventType === 'code_invalid') {
            credentialType = 'PIN';
            credentialValue = params.code || "XXXX";
            accessDecision = "DENY";
            details = `Código PIN Inválido: ${credentialValue}`;

        } else if (eventType === 'tamper') {
            details = `¡ALERTA!: Sensor Tamper activado (Sabotaje detectado)`;
            accessDecision = "DENY";
            credentialType = 'TAG';
            credentialValue = 'ALARM_TAMPER';

        } else if (eventType === 'calling' || eventType === 'invite' || eventType === 'call_created') {
            details = `Llamada entrante a: ${params.to || 'Central'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'CALL_START';

            // ATOMIC CAPTURE ON CALL
            if (device) {
                // For calls, we only have doorlog strategy since there's no userId yet
                const snapBuffer = await fetchAkuvoxFaceImage(device, { name: params.user || params.name, type: 'intercom' });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-call-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Foto S3 capturada)";
                    } catch (e) {
                        console.error("Error uploading call snapshot to S3:", e.message);
                    }
                }
            }

            if (global.io) {
                io.emit("device_call", { mac: macAddress, to: params.to, timestamp: new Date(), snapshot: snapPath });
            }

        } else if (eventType === 'qr_valid') {
            credentialType = 'TAG';
            credentialValue = params.qrcode || "QR_CODE";
            accessDecision = "GRANT";
            details = `Código QR Válido: ${credentialValue}`;

            if (device) {
                const snapBuffer = await fetchAkuvoxFaceImage(device, { userId: params.userid, name: params.user || params.name });
                if (snapBuffer) {
                    try {
                        const devName = sanitizeName(device?.name);
                        const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                        const fDate = formatEventDate(new Date());
                        const filename = `aku-qr-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                        snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
                        details += " (Foto S3 capturada)";
                    } catch (e) { }
                }
            }

        } else if (eventType === 'qr_invalid') {
            credentialType = 'TAG';
            credentialValue = params.qrcode || "QR_INVALID";
            accessDecision = "DENY";
            details = `Código QR Inválido detectado`;

        } else if (eventType === 'input_open' || eventType === 'input_close') {
            const sensor = params.input || "Default";
            details = `Sensor ${sensor}: ${eventType === 'input_open' ? 'ACTIVADO' : 'CERRADO'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = `INPUT_${sensor}`;

        } else if (eventType === 'call_end') {
            details = `Llamada finalizada (Hang Up)`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'CALL_END';

        } else if (eventType === 'boot') {
            details = `Dispositivo Reiniciado (Boot) - FW: ${params.firmware || 'N/A'}, Modelo: ${params.model || 'N/A'}`;
            accessDecision = "GRANT";
            credentialType = 'TAG';
            credentialValue = 'SYSTEM_BOOT';

        } else {
            console.warn(`${logPrefix} Unknown Akuvox event: ${eventType}`);
            details = `Evento Desconocido: ${eventType}`;
            accessDecision = "DENY";
        }

        // Try to find user by credential or userid
        if (params.userid) {
            // First try by person external ID (numeric ID in Akuvox should match user.id in some setups, or be mapped)
            // In our system, Akuvox ID = numeric translation of user.id
            const potentialUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: params.userid }, // Direct match if ID is numeric
                        { id: { endsWith: params.userid.padStart(4, '0') } } // Fallback for padded IDs
                    ]
                }
            });
            if (potentialUser) {
                user = potentialUser;
                userId = user.id;
                details += ` - User: ${user.name} (Match ID)`;
            }
        }

        if (!user && credentialValue && credentialType) {
            const credential = await prisma.credential.findFirst({
                where: {
                    value: credentialValue,
                    type: credentialType
                },
                include: { user: true }
            });

            if (credential) {
                user = credential.user;
                userId = user.id;
                details += ` - User: ${user.name}`;

                // --- Apply FACE Mode Logic (similar to LPR) ---
                if (credentialType === 'FACE') {
                    const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
                    const mode = modeSetting?.value || 'WHITELIST';
                    details += `, Modo: ${mode}`;

                    if (mode === 'BLACKLIST') {
                        accessDecision = "DENY";
                    } else if (mode === 'WHITELIST') {
                        accessDecision = "GRANT";
                    }
                }
            } else {

                // If FACE event and user NOT found in DB, check MODE to decide
                if (credentialType === 'FACE' && eventType === 'face_valid') {
                    const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
                    const mode = modeSetting?.value || 'WHITELIST';
                    details += `, Modo: ${mode}`;

                    if (mode === 'BLACKLIST') {
                        // In BLACKLIST mode, unknown faces should be GRANTED (not in blacklist)
                        accessDecision = "GRANT";
                    } else {
                        // In WHITELIST mode, unknown faces should be DENIED (not in whitelist)
                        accessDecision = "DENY";
                    }
                }
            }
        }

        // Persist Access Event
        if (device) {
            const event = await prisma.accessEvent.create({
                data: {
                    id: eventId,
                    deviceId: device.id,
                    timestamp: new Date(),
                    accessType: credentialType || (eventType.includes('face') ? 'FACE' : 'TAG'),
                    direction: device.direction || "ENTRY",
                    decision: accessDecision,
                    userId: userId,
                    details: details,
                    plateDetected: credentialValue, // Use this for ID/Tag display if no plate
                    plateNumber: null,
                    snapshotPath: snapPath || null
                }
            });

            // Notify UI via WebSocket
            if (global.io) {
                io.emit("access_event", {
                    ...event,
                    device,
                    user: user || { name: credentialValue },
                    direction: event.direction,
                    brand: 'AKUVOX',
                    userName: credentialValue || user?.name || "Desconocido"
                });
                // Emit webhook event for topology animation
                io.emit("webhook-event", {
                    type: "AKUVOX",
                    device: device?.name || "Unknown",
                    eventType: eventType,
                    timestamp: new Date().toISOString()
                });
            }

        } else {
            console.warn(`${logPrefix} Event skipped - Device not found in DB (MAC: ${macAddress})`);
        }

        res.writeHead(200);
        res.end("OK");

    } catch (error) {
        console.error(`${logPrefix} Akuvox Handler Error:`, error);
        res.writeHead(500);
        res.end("Error");
    }
};


module.exports = { handleAkuvoxWebhook };
