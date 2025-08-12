import {
  RoomBridgeStoreEntry as Entry,
  MatrixRoom,
  ProvisioningStore,
} from 'matrix-appservice-bridge';
import { RoomyRoom } from '../models/roomy/room';

export interface DataStore extends ProvisioningStore {
  storeRoom(roomyRoom: RoomyRoom, matrixRoom: MatrixRoom): Promise<void>;

  getRoom(
    matrixRoomId: string,
    roomySpaceId: string,
    roomyChannelId?: string
  ): Promise<Entry | null>;

  removeRoom(matrixRoomId: string, roomySpaceId: string, roomyChannelId?: string): Promise<void>;

  getRoomyMappings(matrixRoomId: string, matrixParentId?: string): Promise<Entry[]>;

  getMatrixMappings(roomyEntityId: string, roomyParentId?: string): Promise<Entry[]>;

  getChannels(matrixRoomId: string): Promise<RoomyRoom[]>;

  getTrackedChannels(roomySpaceId: string): Promise<string[]>;

  getLastSeenTimestamp(roomyThreadId: string): Promise<number | undefined>;

  saveLastSeenTimestamp(roomyThreadId: string, timestamp: number): Promise<void>;
}
