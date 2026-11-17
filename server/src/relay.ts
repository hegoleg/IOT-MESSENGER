import { WebSocket } from "ws";
import type { Role } from "@iot/shared";

interface TokenSession {
  dev?: WebSocket;
  usrs: Set<WebSocket>;
}

/**
 * In-memory registry of live sessions keyed by device token.
 * The relay server keeps no user logic: it only forwards packets between
 * role=dev and role=usr sockets that belong to the same token.
 */
export class Relay {
  private readonly sessions = new Map<string, TokenSession>();

  add(token: string, role: Role, socket: WebSocket): void {
    let session = this.sessions.get(token);
    if (!session) {
      session = { usrs: new Set() };
      this.sessions.set(token, session);
    }

    if (role === "dev") {
      if (
        session.dev &&
        session.dev !== socket &&
        session.dev.readyState === WebSocket.OPEN
      ) {
        session.dev.close(4000, "replaced by a new dev connection");
      }
      session.dev = socket;
      return;
    }

    session.usrs.add(socket);
  }

  remove(token: string, role: Role, socket: WebSocket): void {
    const session = this.sessions.get(token);
    if (!session) return;

    if (role === "dev") {
      if (session.dev === socket) session.dev = undefined;
    } else {
      session.usrs.delete(socket);
    }

    if (!session.dev && session.usrs.size === 0) {
      this.sessions.delete(token);
    }
  }

  /** Online dev socket for the token, if any. */
  getDev(token: string): WebSocket | undefined {
    const dev = this.sessions.get(token)?.dev;
    return dev && dev.readyState === WebSocket.OPEN ? dev : undefined;
  }

  isDevOnline(token: string): boolean {
    return this.getDev(token) !== undefined;
  }

  /** Sends a payload to every online usr socket; returns the delivery count. */
  broadcastUsr(token: string, payload: string): number {
    const session = this.sessions.get(token);
    if (!session) return 0;

    let delivered = 0;
    for (const socket of session.usrs) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        delivered += 1;
      }
    }
    return delivered;
  }
}
