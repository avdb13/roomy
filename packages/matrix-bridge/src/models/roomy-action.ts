import { MatrixAction } from "./matrix-action.js";
import { Logger } from "../logging";

const log = Logger.get("roomy-action");

const roomyActions = ["message"] as const;
type RoomyActionType = (typeof roomyActions)[number];

export class RoomyAction {
  constructor(
    public readonly type: RoomyActionType,
    public text: string,
    public readonly ts: number = 0
  ) {
    if (!roomyActions.includes(type))
      throw new Error(`Unknown roomy action type: ${type}`);
  }

  public static fromMatrixAction(matrixAction: MatrixAction): RoomyAction | undefined {
    switch (matrixAction.type) {
      case "message":
        if (!matrixAction.text) break;

        return new RoomyAction(matrixAction.type, matrixAction.text, matrixAction.ts);
      default:
        log.error("Unknown action for Roomy action from Matrix: %s", matrixAction.type);
    }

    return undefined;
  }
}