declare module "ari-client" {
  export interface OriginateParams {
    endpoint: string;
    app: string;
    appArgs?: string;
    callerId?: string;
  }
  export interface AriClient {
    channels: {
      originate(params: OriginateParams): Promise<{ id: string }>;
      hangup(params: { channelId: string }): Promise<void>;
    };
  }
  export function connect(
    url: string,
    user: string,
    pass: string,
  ): Promise<AriClient>;
}
