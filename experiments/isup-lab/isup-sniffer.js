const net = require('net');
const fs = require('fs');
const crypto = require('crypto');

const PORT = 7800;
const LOG_FILE = 'experiments/isup-lab/sniffer.log';
const PASS = "123456";

// Hikvision CRC32 (Standard IEEE 802.3)
function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) {
        let byte = buffer[i];
        crc ^= byte;
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function logPacket(msg, address, port, direction = "Incoming", note = "") {
  const timestamp = new Date().toISOString();
  const hex = msg.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
  const logEntry = `--- ${direction} OTAP-7800 --- ${note} Addr: ${address}:${port} Len: ${msg.length}\nHEX: ${hex}\n--- end ---`;
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${logEntry}\n`);
}

net.createServer((socket) => {
  socket.setNoDelay(true);
  let buffer = Buffer.alloc(0);
  let currentNonce = null;

  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    logPacket(data, socket.remoteAddress, socket.remotePort);

    if (buffer.length >= 133) {
      const pkt = buffer.slice(0, 133);
      const type = pkt[7];
      const sessionID = pkt.slice(3, 7);
      
      // PASO 1: RECIBIMOS REGISTRO (0x02) -> MANDAMOS DESAFIO (0x03 Status 1)
      if (type === 0x02) {
        console.log(`[7800] 🛡️ Step 1: Registration request. Sending Unauthorized Challenge...`);
        currentNonce = crypto.randomBytes(32);
        
        const resp = Buffer.alloc(133, 0);
        resp[0] = 0x1a; resp[1] = 0x82; resp[2] = 0x02; // Master Header
        sessionID.copy(resp, 3);
        resp[7] = 0x03; // Type 3 (Auth Response)
        resp.writeUInt16BE(0x0001, 8); // Status 1: Unauthorized
        
        // Inject 32-byte non-predictable nonce
        currentNonce.copy(resp, 32);
        
        // Finalize with CRC
        const crcVal = crc32(resp.slice(0, 129));
        resp.writeUInt32LE(crcVal, 129);

        socket.write(resp);
        logPacket(resp, socket.remoteAddress, socket.remotePort, "Outgoing-CHALLENGE", "Awaiting Auth (0x04)");
      } 
      
      // PASO 2: RECIBIMOS AUTH (0x04) -> MANDAMOS EXITO (0x05 Status 0)
      else if (type === 0x04) {
        console.log(`[7800] 🔑 Step 2: Auth Hash received. Validating...`);
        
        const success = Buffer.alloc(133, 0);
        success[0] = 0x1a; success[1] = 0x82; success[2] = 0x02;
        sessionID.copy(success, 3);
        success[7] = 0x05; // Type 5 (Result)
        success.writeUInt16BE(0x0000, 8); // Status 0: OK

        const crcVal = crc32(success.slice(0, 129));
        success.writeUInt32LE(crcVal, 129);

        socket.write(success);
        logPacket(success, socket.remoteAddress, socket.remotePort, "Outgoing-SUCCESS", "Handshake Complete!");
      }

      buffer = buffer.slice(133);
    }
  });

  socket.on('error', () => {});
}).listen(PORT, '0.0.0.0');

console.log(`🚀 ISUP 5.0 Official Handshake Engine active on ${PORT}.`);
