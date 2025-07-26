import { co } from "jazz-tools";
import * as schema from "./schema";
import * as sdk from "@roomy-chat/sdk";

export type RoomyMessage = {
  spaceId: string;
  channelId: string;
  channelName: string;
  message: string;
  localpart?: string;
  avatarUrl?: string;
  timestamp: number;
  messageId: string;
}

export type WorkerProfile = co.loaded<typeof schema.WorkerProfile>;
export type WorkerAccount = co.loaded<typeof schema.WorkerAccount>;

export type Timeline = co.loaded<typeof sdk.Timeline>;
export type RoomyAccount = co.loaded<typeof sdk.RoomyAccount>;
export type Account = co.loaded<typeof sdk.Account>;
export type Group = co.loaded<typeof sdk.Group>;
export type Profile = co.loaded<typeof sdk.Profile>;
export type RoomyEntity = co.loaded<typeof sdk.RoomyEntity>;
export type ThreadComponent = co.loaded<typeof sdk.ThreadComponent>;
export type ThreadContent = co.loaded<typeof sdk.ThreadContent>;
export type SpacePermissionsComponent = co.loaded<typeof sdk.SpacePermissionsComponent>;
export type Message = co.loaded<typeof sdk.Message>;