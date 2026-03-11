import type { Command, CommandResult, Transport } from '../types.js';

/**
 * WebSocket transport for remote AI agent access.
 * Starts a WebSocket server (in Node.js) or connects to one (in browser).
 * Commands are JSON-encoded messages, results are sent back on the same socket.
 */
export class WebSocketTransport implements Transport {
  readonly name = 'websocket';
  private _handler: ((cmd: Command) => Promise<CommandResult>) | null = null;
  private _ws: WebSocket | null = null;
  private _server: any = null;
  private _url: string;
  private _mode: 'client' | 'server';

  /**
   * @param url WebSocket URL to connect to (client mode) or port to listen on (server mode).
   * @param mode 'client' to connect to an existing WS server, 'server' to start one (Node only).
   */
  constructor(url: string = 'ws://localhost:9090', mode: 'client' | 'server' = 'client') {
    this._url = url;
    this._mode = mode;
  }

  onCommand(handler: (cmd: Command) => Promise<CommandResult>): void {
    this._handler = handler;
  }

  async start(): Promise<void> {
    if (this._mode === 'client') {
      this._startClient();
    } else {
      await this._startServer();
    }
  }

  stop(): void {
    this._ws?.close();
    this._ws = null;
    this._server?.close?.();
    this._server = null;
  }

  private _startClient(): void {
    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      console.log(`[WS Transport] Connected to ${this._url}`);
    };

    this._ws.onmessage = async (event) => {
      if (!this._handler) return;
      try {
        const data = typeof event.data === 'string' ? event.data : await (event.data as Blob).text();
        const cmd = JSON.parse(data) as Command;
        const result = await this._handler(cmd);
        this._ws?.send(JSON.stringify(result));
      } catch (err) {
        const errResult: CommandResult = {
          ok: false,
          error: `Transport error: ${err instanceof Error ? err.message : String(err)}`,
        };
        this._ws?.send(JSON.stringify(errResult));
      }
    };

    this._ws.onerror = (err) => {
      console.error('[WS Transport] Error:', err);
    };

    this._ws.onclose = () => {
      console.log('[WS Transport] Disconnected');
    };
  }

  private async _startServer(): Promise<void> {
    // Server mode is for Node.js environments (e.g., during development tooling)
    console.warn('[WS Transport] Server mode requires a Node.js WebSocket library (ws). Using client mode is recommended for browser.');
  }
}
