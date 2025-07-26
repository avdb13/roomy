import { Logger } from "../logging.js";
import { RoomyAction } from "./roomy-action.js";

const log = Logger.get("matrix-action");

export enum ActionType {
  Message = "message",
}

const EVENT_TO_TYPE: Record<string, ActionType> = {
  "m.room.message": ActionType.Message,
} as const;

const ACTION_TYPE_TO_MSGTYPE: Record<ActionType, string | undefined> = {
  [ActionType.Message]: "m.text",
} as const;

const MSGTYPE_TO_TYPE: { [mxKey: string]: ActionType } = {
  "m.text": ActionType.Message,
} as const;

export interface MatrixMessageEvent {
  type: string;
  sender: string;
  room_id: string;
  event_id: string;
  content: {
    "m.relates_to"?: {
      "m.in_reply_to"?: {
        event_id: string;
      };
      // edits
      "rel_type"?: string;
      "event_id": string;
    };
    "m.new_content"?: {
      body: string;
      msgtype: string;
    };
    body?: string;
    topic?: string;
    format?: string;
    formatted_body?: string;
    msgtype: string;
    url?: string;
    info?: {
      size: number;
    };
  };
  origin_server_ts: number;
}

export class MatrixAction {
  constructor(
    public readonly type: ActionType,
    public text?: string,
    public html_text?: string,
    public readonly ts: number = 0,
    public reply_event?: string,
  ) { }

  public get msg_type() {
    return ACTION_TYPE_TO_MSGTYPE[this.type];
  }

  public static async fromEvent(event: MatrixMessageEvent) {
    event.content = event.content || { msgtype: "" };
    let type = EVENT_TO_TYPE[event.type] || ActionType.Message; // mx event type to action type
    let text = event.content.body;
    let html_text: undefined | string = undefined;

    switch (event.type) {
      case "m.room.message":
        if (event.content.format === "org.matrix.custom.html") {
          html_text = event.content.formatted_body;
        }

        if (MSGTYPE_TO_TYPE[event.content.msgtype]) {
          type = MSGTYPE_TO_TYPE[event.content.msgtype];
        }

        if (type === ActionType.Message) {
          text = event.content.body;
        }

        break;
    }

    return new MatrixAction(type, text, html_text, event.origin_server_ts);
  }

  public static fromRoomyAction(roomyAction: RoomyAction) {
    switch (roomyAction.type) {
      case "message": {
        return new MatrixAction(
          roomyAction.type as ActionType,
          roomyAction.text,
          // only set HTML text if we think there is HTML, else the bridge
          // will send everything as HTML and never text only.
          undefined
        );
      }
      default:
        log.error("Unknown action for Matrix action from Roomy: %s", roomyAction.type);
    }

    return null;
  }
}