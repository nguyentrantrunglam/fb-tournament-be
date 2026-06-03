import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { RequestHandler } from 'express';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter that runs the express-session + passport middlewares on the
 * socket handshake, so `connect.sid` authenticates websocket connections the same
 * way it does REST. After this, `socket.request.session` / `socket.request.user`
 * are available in gateways. Also applies CORS with credentials for the web origin.
 */
export class SessionIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly middlewares: RequestHandler[],
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });

    // express-session / passport may touch a few response methods on some paths (store
    // errors, cookie rolls). Give them a no-op response shim instead of an empty object so
    // those paths surface as `next(err)` rather than throwing inside the handshake.
    const resShim = {
      getHeader: () => undefined,
      setHeader: () => undefined,
      writeHead: () => undefined,
      end: () => undefined,
      on: () => undefined,
      once: () => undefined,
      emit: () => undefined,
    };
    const wrap = (mw: RequestHandler) => (socket: unknown, next: (err?: unknown) => void) =>
      mw((socket as { request: unknown }).request as never, resShim as never, next as never);

    for (const mw of this.middlewares) {
      (server as { use: (fn: unknown) => void }).use(wrap(mw));
    }
    return server;
  }
}
