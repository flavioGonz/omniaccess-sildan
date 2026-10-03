const http = require("http");
const next = require("next");
const { parse } = require("url");
const { WebSocketServer, WebSocket } = require("ws");

const port = parseInt(process.env.PORT || "10001", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, port });
const handle = app.getRequestHandler();

const GO2RTC_PORT = 1984;

app.prepare().then(() => {
    const server = http.createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    // ── go2rtc WebSocket proxy (ws-to-ws) ──────────────────────
    // Uses the ws library to create a proper WebSocket-to-WebSocket
    // proxy. This avoids the "Invalid frame header" error caused by
    // raw TCP pipe forwarding the 101 response bytes as WS data.
    const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    const SOCKETIO_PORT = 10000;
    server.on("upgrade", (req, socket, head) => {
        // Socket.IO WS (guardias/eventos + panel): proxy con la lib ws para frames válidos
        if (req.url && (req.url.startsWith("/io/") || req.url.startsWith("/socket.io/"))) {
            const targetPath = req.url.startsWith("/io/") ? req.url.replace(/^\/io/, "") : req.url;
            wss.handleUpgrade(req, socket, head, (clientWs) => {
                const upstream = new WebSocket(`ws://127.0.0.1:${SOCKETIO_PORT}${targetPath}`, { perMessageDeflate: false });
                const pending = [];
                clientWs.on("message", (data, isBinary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary }); else pending.push({ data, isBinary }); });
                upstream.on("open", () => { for (const m of pending) upstream.send(m.data, { binary: m.isBinary }); pending.length = 0; });
                upstream.on("message", (data, isBinary) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary }); });
                upstream.on("close", (code) => { try { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code >= 1000 && code <= 4999 ? code : 1000); } catch (e) {} });
                upstream.on("error", () => { try { clientWs.close(1011); } catch (e) {} });
                clientWs.on("close", () => { try { upstream.close(); } catch (e) {} });
                clientWs.on("error", () => { try { upstream.close(); } catch (e) {} });
            });
            return;
        }
        if (!req.url || !req.url.startsWith("/go2rtc/")) {
            // Let Next.js handle its own HMR WebSocket upgrades
            return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {
            const targetPath = req.url.replace(/^\/go2rtc/, "");
            const targetUrl = `ws://127.0.0.1:${GO2RTC_PORT}${targetPath}`;

            const upstream = new WebSocket(targetUrl, {
                // Forward any subprotocols the client requested
                protocols: req.headers["sec-websocket-protocol"]
                    ? req.headers["sec-websocket-protocol"].split(",").map(s => s.trim())
                    : [],
                // go2rtc does not negotiate deflate — keep disabled
                perMessageDeflate: false,
            });

            // Buffer client messages until upstream is open
            const pendingMessages = [];

            clientWs.on("message", (data, isBinary) => {
                if (upstream.readyState === WebSocket.OPEN) {
                    upstream.send(data, { binary: isBinary });
                } else {
                    pendingMessages.push({ data, isBinary });
                }
            });

            upstream.on("open", () => {
                // Flush any buffered messages
                for (const msg of pendingMessages) {
                    upstream.send(msg.data, { binary: msg.isBinary });
                }
                pendingMessages.length = 0;
            });

            upstream.on("message", (data, isBinary) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(data, { binary: isBinary });
                }
            });

            upstream.on("close", (code, reason) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close(code, reason);
                }
            });

            upstream.on("error", (err) => {
                console.error("[go2rtc-ws-proxy] upstream error:", err.message);
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close(1011, "Upstream error");
                }
            });

            clientWs.on("close", () => {
                if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
                    upstream.close();
                }
            });

            clientWs.on("error", (err) => {
                console.error("[go2rtc-ws-proxy] client error:", err.message);
                if (upstream.readyState === WebSocket.OPEN) {
                    upstream.close();
                }
            });
        });
    });

    server.listen(port, "0.0.0.0", () => {
        console.log("> Next.js + go2rtc WS proxy ready on http://0.0.0.0:" + port);
        setTimeout(function () {
            try {
                var http = require("http");
                http.get("http://127.0.0.1:" + port + "/api/queue/poll?start=1", function (r) {
                    var b = ""; r.on("data", function (d) { b += d; }); r.on("end", function () { console.log("> ONVIF auto-polling:", b.slice(0, 80)); });
                }).on("error", function (e) { console.log("> ONVIF auto-poll start failed:", e.message); });
            } catch (e) { console.log("> ONVIF auto-poll error:", e.message); }
        }, 9000);
    });
});
