declare module "ari-client" {
  export interface Channel {
    answer(): Promise<void>;
    hangup(): Promise<void>;
  }
  export function connect(
    url: string,
    user: string,
    pass: string,
  ): Promise<{
    start(app: string): void;
    on(
      ev: string,
      fn: (event: { args?: string[] }, channel: Channel) => void,
    ): void;
  }>;
}
