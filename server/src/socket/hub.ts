import type { Server as SocketIOServer } from 'socket.io';

class SocketHub {
  private io: SocketIOServer | null = null;

  public attach(io: SocketIOServer) {
    this.io = io;
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  public emitToUser(userId: string, event: string, payload: unknown) {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  public emitToConversation(conversationId: string, event: string, payload: unknown) {
    if (!this.io) return;
    this.io.to(`conversation:${conversationId}`).emit(event, payload);
  }

  public async joinConversationRoom(userId: string, conversationId: string) {
    if (!this.io) return;
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const sock of sockets) {
      sock.join(`conversation:${conversationId}`);
    }
  }

  public async leaveConversationRoom(userId: string, conversationId: string) {
    if (!this.io) return;
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const sock of sockets) {
      sock.leave(`conversation:${conversationId}`);
    }
  }

  public async disconnectUserSockets(userId: string, reason = 'session_terminated') {
    if (!this.io) return;
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const sock of sockets) {
      sock.emit('auth:force_logout', { reason });
      sock.disconnect(true);
    }
  }
}

export const socketHub = new SocketHub();
