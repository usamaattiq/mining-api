import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import http from 'http';
import { env } from './config/env';
import { logger } from './common/logger';
import { sendError } from './common/http/api-response';
import { ErrorCode } from './common/errors/error-codes';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { authRoutes } from './modules/auth/auth.routes';
import { adminRouter } from './modules/admin/admin.router';
import { listingsRouter } from './modules/listings/listings.router';
import { messagesRouter } from './modules/messages/messages.router';
import { uploadsRouter } from './modules/uploads/uploads.router';
import { initChatSocket } from './realtime/chat.socket';

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(
  cors({
    origin: env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()),
    credentials: true,
  }),
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/uploads', uploadsRouter);

app.use((_req: Request, res: Response) => {
  res
    .status(404)
    .json({ success: false, error: { code: ErrorCode.NOT_FOUND, message: 'Route not found' } });
});

// Catches anything that throws/rejects outside a route's own wrap() (e.g. a
// malformed-JSON body-parser failure) so clients always get the JSON error
// envelope instead of Express's default HTML error page.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  sendError(res, err);
});

const server = http.createServer(app);
initChatSocket(server);

server.listen(env.PORT, env.HOST, () => {
  logger.info(`mining-api listening on http://${env.HOST}:${env.PORT}`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down mining-api…`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Don't hang forever waiting for stubborn keep-alive sockets to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
