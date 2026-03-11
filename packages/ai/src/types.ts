/**
 * A command sent by an AI agent (LLM or programmatic).
 */
export interface Command {
  /** Dot-separated action, e.g. "scene.spawn", "audio.play" */
  action: string;
  /** Action-specific parameters */
  params: Record<string, unknown>;
  /** Optional correlation ID for matching responses */
  id?: string;
}

/**
 * Result returned after executing a command.
 */
export interface CommandResult {
  /** Correlation ID from the original command */
  id?: string;
  /** Whether the command succeeded */
  ok: boolean;
  /** Returned data (action-specific) */
  data?: unknown;
  /** Error message if ok === false */
  error?: string;
}

/**
 * JSON Schema-like parameter definition for tool generation.
 */
export interface ParamDef {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  items?: ParamDef;
  properties?: Record<string, ParamDef>;
  enum?: (string | number)[];
  default?: unknown;
}

/**
 * Schema for a single command — used to generate LLM tool definitions.
 */
export interface CommandSchema {
  action: string;
  description: string;
  params: Record<string, ParamDef>;
}

/**
 * OpenAI-compatible function/tool definition.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Handler function for a registered command.
 */
export type CommandHandler = (
  params: Record<string, unknown>,
) => CommandResult | Promise<CommandResult>;

/**
 * Transport interface for receiving commands from external sources.
 */
export interface Transport {
  readonly name: string;
  start(): void | Promise<void>;
  stop(): void;
  onCommand(handler: (cmd: Command) => Promise<CommandResult>): void;
}
