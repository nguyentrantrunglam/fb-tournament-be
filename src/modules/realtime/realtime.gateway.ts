import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** Allowed room prefixes — public viewers may subscribe to these read-only rooms. */
const ALLOWED_ROOM_PREFIXES = ['tournament:', 'category:', 'match:'];

/**
 * Realtime push (replaces Firestore onSnapshot). Services inject this gateway and call
 * emit* after committing a Mongo transaction. CORS/session are applied by SessionIoAdapter.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('RealtimeGateway');

  @WebSocketServer()
  server!: Server;

  handleConnection(socket: Socket): void {
    this.logger.debug(`socket connected: ${socket.id}`);
  }

  /** Client joins read-only rooms (e.g. { rooms: ['category:abc', 'match:xyz'] }). */
  @SubscribeMessage('subscribe')
  onSubscribe(
    @MessageBody() payload: { rooms?: string[] },
    @ConnectedSocket() socket: Socket,
  ): { joined: string[] } {
    const rooms = (payload?.rooms ?? []).filter((r) =>
      ALLOWED_ROOM_PREFIXES.some((p) => r.startsWith(p)),
    );
    for (const r of rooms) void socket.join(r);
    return { joined: rooms };
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(
    @MessageBody() payload: { rooms?: string[] },
    @ConnectedSocket() socket: Socket,
  ): { left: string[] } {
    const rooms = payload?.rooms ?? [];
    for (const r of rooms) void socket.leave(r);
    return { left: rooms };
  }

  emitToTournament(tournamentId: string, event: string, data: unknown): void {
    this.server.to(`tournament:${tournamentId}`).emit(event, data);
  }

  emitToCategory(categoryId: string, event: string, data: unknown): void {
    this.server.to(`category:${categoryId}`).emit(event, data);
  }

  emitToMatch(matchId: string, event: string, data: unknown): void {
    this.server.to(`match:${matchId}`).emit(event, data);
  }
}
