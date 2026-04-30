import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import Redis from "ioredis";

@WebSocketGateway({
  cors: { origin: true },
})
export class EventsGateway implements OnGatewayInit {
  private readonly log = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  private sub: Redis | null = null;

  afterInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn("REDIS_URL not set; Socket.IO call-events disabled");
      return;
    }
    this.sub = new Redis(url);
    void this.sub.subscribe("call-events", (err) => {
      if (err) this.log.warn(`Redis subscribe error: ${err.message}`);
    });
    this.sub.on("message", (_channel, message) => {
      try {
        const payload = JSON.parse(String(message));
        this.server.emit("call", payload);
      } catch (e) {
        this.log.warn(`Invalid call-events payload: ${(e as Error).message}`);
      }
    });
    this.log.log("Socket.IO subscribed to Redis call-events");
  }
}
