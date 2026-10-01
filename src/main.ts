import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import pino from 'pino';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { authRoutes } from './modules/auth/auth.routes';
import { adminRouter } from './modules/admin/admin.router';
import { listingsRouter } from './modules/listings/listings.router';
import { messagesRouter } from './modules/messages/messages.router';
import { uploadsRouter } from './modules/uploads/uploads.router';
import { initChatSocket } from './realtime/chat.socket';

const logger = pino({
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()),
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

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const server = http.createServer(app);
initChatSocket(server);

server.listen(port, host, () => {
  logger.info(`mining-api listening on http://${host}:${port}`);
});
