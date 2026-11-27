"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateCalendarApprovalSocket = exports.CALENDAR_WORKFLOW_SOCKET_EVENT = exports.CALENDAR_WORKFLOW_SOCKET_NAMESPACE = void 0;
exports.attachCalendarApprovalSocket = attachCalendarApprovalSocket;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
exports.CALENDAR_WORKFLOW_SOCKET_NAMESPACE = '/calendar-approvals';
exports.CALENDAR_WORKFLOW_SOCKET_EVENT = 'calendar-workflow:changed';
// Reuse the HTTP session/RBAC checks; never accept client-provided user/room IDs.
const authenticateCalendarApprovalSocket = (token) => new Promise((resolve, reject) => {
    const request = { headers: { authorization: `Bearer ${token}` } };
    const response = { status() { return this; }, json() { reject(new Error('Unauthorized')); } };
    void auth_middleware_1.default.authenticate(request, response, error => {
        if (error) {
            reject(new Error('Unauthorized'));
            return;
        }
        try {
            const workflowAccess = request.user?.permissions?.includes('*') || request.user?.roles?.includes('admin') || request.user?.permissions?.includes('calendar.view');
            if (!workflowAccess)
                throw new Error('Forbidden');
            const decoded = jsonwebtoken_1.default.decode(token);
            if (!decoded?.exp)
                throw new Error('Invalid expiry');
            resolve({ expiresAt: decoded.exp * 1000, userId: request.user.userId, workflowAccess: Boolean(workflowAccess) });
        }
        catch {
            reject(new Error('Forbidden'));
        }
    });
});
exports.authenticateCalendarApprovalSocket = authenticateCalendarApprovalSocket;
function attachCalendarApprovalSocket(server, options = {}) {
    const allowed = new Set((process.env.CORS_ORIGINS || 'https://lms-fe-ten.vercel.app,http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()));
    const io = new socket_io_1.Server(server, {
        cors: { origin: (origin, callback) => callback(null, !origin || allowed.has(origin)), credentials: true },
        maxHttpBufferSize: 16 * 1024,
    });
    const namespace = io.of(exports.CALENDAR_WORKFLOW_SOCKET_NAMESPACE);
    const authenticate = options.authenticate || exports.authenticateCalendarApprovalSocket;
    namespace.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string' || token.length > 8192) {
            next(new Error('Unauthorized'));
            return;
        }
        authenticate(token).then(identity => { socket.data.identity = identity; next(); }, () => next(new Error('Unauthorized')));
    });
    namespace.on('connection', socket => {
        let checking = false;
        const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2147483647, socket.data.identity.expiresAt - Date.now())));
        const recheck = setInterval(async () => {
            if (checking)
                return;
            checking = true;
            try {
                const identity = await authenticate(socket.handshake.auth.token);
                socket.data.identity = identity;
            }
            catch {
                socket.disconnect(true);
            }
            finally {
                checking = false;
            }
        }, 30_000);
        socket.on('disconnect', () => { clearTimeout(expiry); clearInterval(recheck); });
    });
    let stopped = false, busy = false;
    // Compare committed inbox state per recipient; REST remains the source of truth.
    const tick = async () => {
        if (stopped || busy)
            return;
        busy = true;
        try {
            for (const socket of namespace.sockets.values()) {
                const identity = socket.data.identity;
                if (!identity.workflowAccess || !identity.userId)
                    continue;
                try {
                    const state = await prisma_1.default.$queryRaw `
          SELECT COUNT(*) AS total,SUM(read_at IS NULL) AS unread,MAX(id) AS latest
          FROM calendar_approval_notifications WHERE recipient_id=${identity.userId}`;
                    const signature = JSON.stringify(state, (_k, v) => typeof v === 'bigint' ? String(v) : v);
                    if (!stopped && socket.connected && signature !== socket.data.workflowSignature) {
                        socket.data.workflowSignature = signature;
                        socket.emit(exports.CALENDAR_WORKFLOW_SOCKET_EVENT);
                    }
                }
                catch { /* Durable REST inbox catches up after recovery or migration. */ }
            }
        }
        finally {
            busy = false;
        }
    };
    const timer = setInterval(() => {
        void tick();
    }, options.intervalMs || 1000);
    timer.unref();
    const cleanup = () => { stopped = true; clearInterval(timer); namespace.disconnectSockets(true); };
    server.once('close', cleanup);
    return { io, tick, close: () => { cleanup(); io.close(); } };
}
