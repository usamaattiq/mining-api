import type { Server } from 'socket.io';
import type { ChatReadReceipt, ChatRealtimeMessage } from './chat.types';

let chatIo: Server | null = null;

function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function setChatSocketServer(io: Server): void {
  chatIo = io;
}

export function emitChatMessage(
  buyerId: string,
  sellerId: string,
  payload: ChatRealtimeMessage,
): void {
  chatIo?.to(userRoom(buyerId)).to(userRoom(sellerId)).emit('chat:message', payload);
}

export function emitChatRead(buyerId: string, sellerId: string, payload: ChatReadReceipt): void {
  chatIo?.to(userRoom(buyerId)).to(userRoom(sellerId)).emit('chat:read', payload);
}
