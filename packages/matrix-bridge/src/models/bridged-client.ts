import { EventEmitter } from "node:events";
import { Logger } from "../logging";
import { MatrixUser } from "matrix-appservice-bridge";
import { Account, Group, Profile, RoomyAccount } from "../types";
import * as sdk from "@roomy-chat/sdk";
import { UserId } from "./matrix-entity";

const log = Logger.get("bridged-client");

type ProfileOpts = Omit<Profile, "imageUrl"> & { imageUrl?: string };

export class BridgedClient extends EventEmitter {
  public readonly id: string;
  public readonly userId?: UserId;
  public displayName?: string;
  constructor(
    public readonly roomyAccount?: RoomyAccount,
    public readonly matrixUser?: MatrixUser,
  ) {
    super();

    this.userId = matrixUser && new UserId(matrixUser.getId());
    this.displayName = matrixUser && matrixUser.getDisplayName();
    this.id = (Math.random() * 1e20).toString(36);

    log.info(`Created bridged client for %s`, this.userId || "bot");
  }

  public get profile(): sdk.co.loaded<typeof sdk.Profile> {
    return this.roomyAccount.profile;
  }

  public async checkProfileExists(owner: Account | Group, profile: ProfileOpts): Promise<boolean> {
    const { profile: found } = await sdk.RoomyAccount.loadUnique({
      profile: {
        name: profile.name,
        ...profile.imageUrl &&
        { imageUrl: profile.imageUrl }
      }
    }, owner.id, {
      resolve: {
        profile: true,
      }
    });

    return profile.name === found.name &&
      profile.imageUrl && profile.imageUrl === found.imageUrl;
  }

  public async changeProfile(
    id: string, owner: Account | Group, profile: ProfileOpts
  ): Promise<string> {
    const found = await sdk.Profile.loadUnique({
      id
    }, owner.id, {
      resolve: true,
    });

    log.info(
      `Trying to change profile from %s to %s`,
      JSON.stringify(found, null, 2),
      JSON.stringify(profile, null, 2),
    );

    const value = found.applyDiff({
      ...found,
      name: profile.name,
      ...profile.imageUrl &&
      { imageUrl: profile.imageUrl }
    });

    const exists = await this.checkProfileExists(owner, value);

    if (exists)
      throw Error(`
        The profile ${JSON.stringify(value, null, 2)} is taken in ${"TODO"}.
        Please pick a different name or avatar.
      `);

    return await sdk.Profile.upsertUnique({
      value, unique: { id }, owner, resolve: true
    }).then(({ id }) => id);
  }
}