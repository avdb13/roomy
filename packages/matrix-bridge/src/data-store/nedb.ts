import {
  RoomBridgeStoreEntry as Entry,
  MatrixRoom,
  ProvisionSession,
  RemoteUser,
  RoomBridgeStore,
  UserBridgeStore,
} from 'matrix-appservice-bridge';
import { Logger } from '../logging';
import { RoomyRoom } from '../models/roomy/room';
import { RoomyEntity } from '../types';
import { DataStore } from './index';

const log = Logger.get('data-store/NeDB');

export class NeDBDataStore implements DataStore {
  private spaceMappings: { [spaceId: string]: RoomyEntity } = {};

  constructor(
    private userStore: UserBridgeStore,
    private roomStore: RoomBridgeStore
  ) {}

  public async storeRoom(roomyRoom: RoomyRoom, matrixRoom: MatrixRoom) {
    const parent = roomyRoom.getParent();

    log.info(
      'storeRoom (id=%s; roomy: space=%s, channel=%s)',
      matrixRoom.getId(),
      parent || roomyRoom.getId(),
      parent && roomyRoom.getId()
    );

    const mappingId = NeDBDataStore.createMappingId(
      matrixRoom.getId(),
      parent || roomyRoom.getId(),
      parent && roomyRoom.getId()
    );

    await this.roomStore.linkRooms(matrixRoom, roomyRoom, {}, mappingId);
  }

  public async getRoom(matrixRoomId: string, roomySpaceId: string, roomyChannelId?: string) {
    return this.roomStore.getEntryById(
      NeDBDataStore.createMappingId(matrixRoomId, roomySpaceId, roomyChannelId)
    );
  }

  public async removeRoom(matrixRoomId: string, roomySpaceId: string, roomyChannelId?: string) {
    await this.roomStore.delete({
      id: NeDBDataStore.createMappingId(matrixRoomId, roomySpaceId, roomyChannelId),
    });
  }

  public async getRoomyMappings(matrixRoomId: string, _matrixParentId?: string) {
    return this.roomStore.getEntriesByMatrixId(matrixRoomId);
  }

  public async getMatrixMappings(roomyEntityId: string, roomyParentId?: string) {
    return this.roomStore.getEntriesByRemoteId(roomyEntityId).then((entries) => {
      return entries.filter((entry) => entry.remote.get('parent') === roomyParentId);
    });
  }

  public async getChannels(_matrixRoomId: string) {
    return [];
  }

  public async getTrackedChannels(roomySpaceId: string) {
    const entries: Entry[] = await this.roomStore.getEntriesByRemoteRoomData({
      space: roomySpaceId,
    });

    const channels = new Set<string>();

    for (const entry of entries.filter((entry) => entry.remote)) {
      const parent = this.spaceMappings[entry.remote.get('parent') as string];

      if (!parent) continue;

      const roomyRoom = RoomyRoom.fromRemoteRoom(parent, entry.remote);

      channels.add(roomyRoom.getId());
    }

    return [...channels];
  }

  public async getLastSeenTimestamp(roomyThreadId: string) {
    let data = await this.userStore.getRemoteUser('last_seen_timestamp');

    return data && data.get<number>(roomyThreadId);
  }

  public async saveLastSeenTimestamp(roomyThreadId: string, timestamp: number) {
    let data = await this.userStore.getRemoteUser('last_seen_timestamp');

    if (!data) data = new RemoteUser('last_seen_timestamp');

    const latest = data.get<number>(roomyThreadId);

    if (timestamp <= latest) return;

    data.set(roomyThreadId, timestamp);

    return this.userStore.setRemoteUser(data);
  }

  private static createMappingId(
    matrixRoomId: string,
    roomySpaceId: string,
    roomyChannelId?: string
  ) {
    return matrixRoomId + ' ' + roomySpaceId + ' ' + (roomyChannelId ? roomyChannelId : '');
  }

  public async getSessionForToken(): Promise<ProvisionSession | null> {
    throw this.notImplemented();
  }

  public async createSession(): Promise<void> {
    throw this.notImplemented();
  }

  public async deleteSession(): Promise<void> {
    throw this.notImplemented();
  }

  public async deleteAllSessions(): Promise<void> {
    throw this.notImplemented();
  }

  private notImplemented() {
    Error('Not implemented for NeDB store');
  }
}
