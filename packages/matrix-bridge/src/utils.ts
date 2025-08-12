import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import { ILLEGAL_CHARACTERS_REGEX, NAMESPACE_PREFIX } from './constants';
import { BridgeEvent } from './matrix';
import { MatrixMessageEvent } from './models/matrix/action';
import { UserId } from './models/matrix/entities';
import { BridgeRequest } from './models/request';
import { RoomyEntity } from './types';
import { Intent } from 'matrix-appservice-bridge';
import { DataStore } from './data-store';
import { JazzWorker } from './jazz';

export const readYaml = <T>(path: string): Promise<T> =>
  fs.readFile(path, 'utf8').then((contents) => yaml.load(contents) as T);

export const isMatrixMessageEvent = (event: BridgeEvent): event is MatrixMessageEvent =>
  event.type === 'm.room.message';

// the server claims the given user ID if the ID matches the user ID template.
export const claimsUserId = (space: RoomyEntity, userId: UserId) =>
  new RegExp(`/^@${escapeRegExp(NAMESPACE_PREFIX + space.id)}_(.*):(.*)$/`).test(userId.toString());

// https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getRoomyNameFromUserId = (userId: UserId, displayName?: string): string => {
  let localpart = userId.getLocalpart();

  localpart = localpart.replace(ILLEGAL_CHARACTERS_REGEX, '');
  displayName = displayName && displayName.replace(ILLEGAL_CHARACTERS_REGEX, '');

  const name = [displayName, localpart].find(Boolean);

  if (!name) throw new Error('Could not get nick for user, all characters were invalid');

  return `[Matrix] ${name}`;
};

export const getRoomySpace = async (intent: Intent, store: DataStore, matrixSpaceId: string) => {
  try {
    await intent.matrixClient.getSpace(matrixSpaceId);
  } catch (_) {
    return;
  }

  const entry = await store
    .getRoomyMappings(matrixSpaceId)
    .then((entries) => entries.at(0));

  if (!entry) return;

  const roomySpaceId = entry.remote.getId();

  if (!roomySpaceId) return;

  if (entry.remote.get('parent')) return;

  const roomySpace = await JazzWorker.getSpace(roomySpaceId);

  if (!roomySpace) return;

  return roomySpace;
}

export const requestHandler = async <T>(request: BridgeRequest, promise: PromiseLike<T> | void) =>
  Promise.resolve(promise)
    .then((response) => {
      request.resolve(response);

      return response;
    })
    .catch((err) => {
      request.reject(err);

      throw err;
    });
