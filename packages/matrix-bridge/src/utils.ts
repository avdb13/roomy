import fs from "node:fs/promises";
import yaml from "js-yaml";
import { BridgeEvent } from "./matrix";
import { MatrixMessageEvent } from "./models/matrix-action";
import { UserId } from "./models/matrix-entity";
import { ILLEGAL_CHARACTERS_REGEX, NAMESPACE_PREFIX } from "./constants";
import { RoomyEntity } from "./types";
import { BridgeRequest } from "./models/request";

export const readYaml = <T>(
  path: string
): Promise<T> => fs.readFile(path, "utf8")
  .then(contents => yaml.load(contents) as T);

export const isMatrixMessageEvent =
  (event: BridgeEvent): event is MatrixMessageEvent => event.type === "m.room.message";

// the server claims the given user ID if the ID matches the user ID template.
export const claimsUserId = (space: RoomyEntity, userId: UserId) =>
  new RegExp(
    `/^@${escapeRegExp(NAMESPACE_PREFIX + space.id)}_(.*):(.*)$/`
  ).test(userId.toString());

// https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getRoomyNameFromUserId = (userId: UserId, displayName?: string): string => {
  let localpart = userId.getLocalpart();

  localpart = localpart.replace(ILLEGAL_CHARACTERS_REGEX, "");
  displayName = displayName && displayName.replace(ILLEGAL_CHARACTERS_REGEX, "");

  const name = [displayName, localpart].find(Boolean);

  if (!name)
    throw new Error("Could not get nick for user, all characters were invalid");

  return `[Matrix] ${name}`;
}

export const requestHandler = async <T>(
  request: BridgeRequest, promise: PromiseLike<T> | void
) => Promise.resolve(promise)
  .then(response => {
    request.resolve(response);

    return response;
  })
  .catch(err => {
    request.reject(err);

    throw err;
  });