import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import auth from '../auth/auth.middleware';
import prisma from '../../lib/prisma';

export const CALENDAR_WORKFLOW_SOCKET_NAMESPACE = '/calendar-approvals';
type Identity = { expiresAt: number; userId:number; workflowAccess:boolean };
export const CALENDAR_WORKFLOW_SOCKET_EVENT = 'calendar-workflow:changed';

// Reuse the HTTP session/RBAC checks; never accept client-provided user/room IDs.
export const authenticateCalendarApprovalSocket = (token: string): Promise<Identity> => new Promise((resolve, reject) => {
  const request = { headers: { authorization: `Bearer ${token}` } } as Request;
  const response = { status() { return this; }, json() { reject(new Error('Unauthorized')); } } as unknown as Response;
  void auth.authenticate(request, response, error => {
    if (error) { reject(new Error('Unauthorized')); return; }
    try {
      const workflowAccess=request.user?.permissions?.includes('*') || request.user?.roles?.includes('admin') || request.user?.permissions?.includes('calendar.view');
      if(!workflowAccess) throw new Error('Forbidden');
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (!decoded?.exp) throw new Error('Invalid expiry');
      resolve({ expiresAt: decoded.exp * 1000, userId:request.user.userId, workflowAccess:Boolean(workflowAccess) });
    } catch { reject(new Error('Forbidden')); }
  });
});

export function attachCalendarApprovalSocket(server: HttpServer, options: {
  authenticate?: (token: string) => Promise<Identity>;
  intervalMs?: number;
} = {}) {
  const allowed = new Set((process.env.CORS_ORIGINS || 'https://lms-fe-ten.vercel.app,http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()));
  const io = new Server(server, {
    cors: { origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, !origin || allowed.has(origin)), credentials: true },
    maxHttpBufferSize: 16 * 1024,
  });
  const namespace = io.of(CALENDAR_WORKFLOW_SOCKET_NAMESPACE);
  const authenticate = options.authenticate || authenticateCalendarApprovalSocket;
  namespace.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length > 8192) { next(new Error('Unauthorized')); return; }
    authenticate(token).then(identity => { socket.data.identity = identity; next(); }, () => next(new Error('Unauthorized')));
  });
  namespace.on('connection', socket => {
    let checking = false;
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2147483647, socket.data.identity.expiresAt - Date.now())));
    const recheck = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const identity=await authenticate(socket.handshake.auth.token);
        socket.data.identity=identity;
      } catch { socket.disconnect(true); }
      finally { checking = false; }
    }, 30_000);
    socket.on('disconnect', () => { clearTimeout(expiry); clearInterval(recheck); });
  });
  let stopped = false, busy = false;
  // Compare committed inbox state per recipient; REST remains the source of truth.
  const tick=async()=>{
    if (stopped || busy) return;
    busy = true;
    try {
    for(const socket of namespace.sockets.values()) {
      const identity=socket.data.identity as Identity;
      if(!identity.workflowAccess||!identity.userId) continue;
      try {
        const state=await prisma.$queryRaw<Array<{total:bigint;unread:bigint;latest:bigint|null}>>`
          SELECT COUNT(*) AS total,SUM(read_at IS NULL) AS unread,MAX(id) AS latest
          FROM calendar_approval_notifications WHERE recipient_id=${identity.userId}`;
        const signature=JSON.stringify(state,(_k,v)=>typeof v==='bigint'?String(v):v);
        if(!stopped && socket.connected && signature!==socket.data.workflowSignature) {socket.data.workflowSignature=signature; socket.emit(CALENDAR_WORKFLOW_SOCKET_EVENT);}
      } catch { /* Durable REST inbox catches up after recovery or migration. */ }
    }
    } finally { busy = false; }
  };
  const timer = setInterval(() => {
    void tick();
  }, options.intervalMs || 1000);
  timer.unref();
  const cleanup = () => { stopped = true; clearInterval(timer); namespace.disconnectSockets(true); };
  server.once('close', cleanup);
  return { io, tick, close: () => { cleanup(); io.close(); } };
}
