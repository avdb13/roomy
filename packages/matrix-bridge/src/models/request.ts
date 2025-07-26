import * as m from "matrix-appservice-bridge";
import { Logger, RequestLogger } from "../logging";

export type RequestEvent = m.Request<{
  event_id: string;
  sender: string;
  type: string;
  state_key?: string;
  room_id: string;
  content: Record<string, unknown>;
  origin_server_ts: number;
}>;

export type BridgeRequestData = {
  isFromRoomy?: boolean;
  event_id?: string;
  room_id?: string;
  type?: string;
} | null;

export class BridgeRequest {
  log: RequestLogger;

  constructor(private request: m.Request<BridgeRequestData>) {
    this.log = Logger.request({
      id: request.getId(),
      direction:
        request.getData()?.isFromRoomy ? "Roomy -> Matrix" : "Matrix -> Roomy"
    });
  }

  getId() {
    return this.request.getId();
  }

  getPromise() {
    return this.request.getPromise();
  }

  resolve(thing?: unknown) {
    this.request.resolve(thing);
  }

  reject(err?: unknown) {
    this.request.reject(err);
  }
}

export enum BridgeRequestError {
  ERR_VIRTUAL_USER,
  ERR_NOT_MAPPED,
  ERR_DROPPED,
}