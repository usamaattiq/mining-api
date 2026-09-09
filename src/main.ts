import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { authRoutes } from './modules/auth/auth.routes';
import { uploadsRouter } from './modules/uploads/uploads.router';

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
app.use('/api/notifications', notificationsRouter);
app.use('/api/uploads', uploadsRouter);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen(port, host, () => {
  logger.info(`mining-api listening on http://${host}:${port}`);
});
