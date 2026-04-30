// ari-client has weak / missing typings; keep declarations aligned with runtime usage.
declare module "ari-client" {
  export interface Channel {
    id: string;
    answer(): Promise<void>;
    hangup(): Promise<void>;
    once(ev: string, fn: (...args: unknown[]) => void): void;
  }

  export interface AriClient {
    start(app: string): void;
    on(ev: string, fn: (...args: unknown[]) => void): void;
    removeListener(ev: string, fn: (...args: unknown[]) => void): void;
    ws?: { on: (e: string, cb: () => void) => void };
  }

  export function connect(url: string, user: string, pass: string): Promise<AriClient>;
}
