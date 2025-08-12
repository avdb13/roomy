import { Request } from 'matrix-appservice-bridge';

export interface BridgeEvent {
  event_id: string;
  sender: string;
  type: string;
  state_key?: string;
  room_id: string;
  content: Record<string, unknown>;
  origin_server_ts: number;
}

export type BridgeRequestEvent = Request<BridgeEvent>;

export type RoomStateEvent = Pick<BridgeEvent, 'type' | 'sender' | 'state_key' | 'content'>;

export interface MatrixContextResponse {
  start: string;
  end: string;
  events_before: BridgeEvent[];
  events_after: BridgeEvent[];
  state: BridgeEvent[];
}

export interface MatrixMessagesResponse {
  chunk: BridgeEvent[];
  start: string;
  end: string;
}
