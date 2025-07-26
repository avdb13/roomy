import { RemoteRoom } from "matrix-appservice-bridge";
import { RoomyEntity } from "../types";

export class RoomyRoom extends RemoteRoom {
  constructor(
    public readonly entity: RoomyEntity,
    public readonly parent?: string,
  ) {
    // Because `super` must be called first, we convert the case several times.
    super(entity.id, {
      name: entity.name,
      ...parent && { parent }
    });
  }

  getEntity() {
    return this.entity;
  }

  getId() {
    return super.getId();
  }

  getName() {
    return super.get("name") as string;
  }

  getParent() {
    return super.get("parent") as string | undefined;
  }

  public static fromRemoteRoom(entity: RoomyEntity, room: RemoteRoom) {
    return new RoomyRoom(entity, room.get("parent"));
  }
}