import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import pino from 'pino';
import { verifyUserAccessToken } from '../modules/auth/security/user-jwt.service';
import { userSessionRepository } from '../modules/auth/repositories/user-session.repository';
import { conversationRepository } from '../modules/messages/repositories/conversation.repository';
import { setChatSocketServer } from './chat.emitter';

const logger = pino({
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

type AuthedSocket = Socket & {
  data: {
    userId: string;
  };
};

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function extractToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

async function authenticateSocket(socket: Socket): Promise<string> {
  const token = extractToken(socket);
  if (!token) {
    throw new Error('Authentication required');
  }

  const claims = verifyUserAccessToken(token);
  const active = await userSessionRepository.isActive(claims.jti);
  if (!active) {
    throw new Error('Session has been revoked');
  }

  return claims.sub;
}

export function initChatSocket(httpServer: HttpServer): Server {
  const chatIo = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: true,
      credentials: true,
    },
  });
  setChatSocketServer(chatIo);

  chatIo.use((socket, next) => {
    void authenticateSocket(socket)
      .then((userId) => {
        socket.data.userId = userId;
        next();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unauthorized';
        next(new Error(message));
      });
  });

  chatIo.on('connection', (socket: AuthedSocket) => {
    const userId = socket.data.userId;
    void socket.join(userRoom(userId));

    socket.on(
      'chat:join',
      (
        payload: { conversationId?: string },
        ack?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        void (async () => {
          try {
            const conversationId = payload?.conversationId;
            if (!conversationId) {
              ack?.({ ok: false, error: 'conversationId is required' });
              return;
            }
            const conversation = await conversationRepository.findById(conversationId);
            if (!conversation) {
              ack?.({ ok: false, error: 'Conversation not found' });
              return;
            }
            if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
              ack?.({ ok: false, error: 'Forbidden' });
              return;
            }
            await socket.join(conversationRoom(conversationId));
            ack?.({ ok: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to join chat';
            logger.warn({ err: error, userId }, 'chat:join failed');
            ack?.({ ok: false, error: message });
          }
        })();
      },
    );

    socket.on('chat:leave', (payload: { conversationId?: string }) => {
      const conversationId = payload?.conversationId;
      if (conversationId) {
        void socket.leave(conversationRoom(conversationId));
      }
    });
  });

  logger.info('Chat socket gateway ready');
  return chatIo;
}
