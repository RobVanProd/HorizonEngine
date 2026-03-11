import type { Command, CommandResult, Transport } from '../types.js';

/**
 * Web Worker transport for isolating AI agent logic.
 * The worker posts Command messages; results are posted back.
 *
 * Usage from main thread:
 *   const transport = new WorkerTransport(new Worker('./ai-worker.js'));
 *   ai.addTransport(transport);
 *
 * Usage inside worker:
 *   const port = globalThis as unknown as MessagePort;
 *   port.postMessage({ action: 'scene.spawn', params: { position: [0, 1, 0] } });
 *   port.onmessage = (e) => { console.log('Result:', e.data); };
 */
export class WorkerTransport implements Transport {
  readonly name = 'worker';
  private _handler: ((cmd: Command) => Promise<CommandResult>) | null = null;
  private _worker: Worker | MessagePort;

  constructor(worker: Worker | MessagePort) {
    this._worker = worker;
  }

  onCommand(handler: (cmd: Command) => Promise<CommandResult>): void {
    this._handler = handler;
  }

  start(): void {
    this._worker.onmessage = async (event: MessageEvent) => {
      if (!this._handler) return;
      try {
        const cmd = event.data as Command;
        if (!cmd.action) return; // Not a command message
        const result = await this._handler(cmd);
        this._worker.postMessage(result);
      } catch (err) {
        const errResult: CommandResult = {
          ok: false,
          error: `Worker transport error: ${err instanceof Error ? err.message : String(err)}`,
        };
        this._worker.postMessage(errResult);
      }
    };
    console.log('[Worker Transport] Listening for commands');
  }

  stop(): void {
    this._worker.onmessage = null;
  }

  /** Send a command to the worker (for bidirectional communication). */
  sendToWorker(cmd: Command): void {
    this._worker.postMessage(cmd);
  }
}
