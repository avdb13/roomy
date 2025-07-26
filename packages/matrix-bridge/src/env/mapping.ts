export interface SpaceMappingConfig {
  id?: string;

  dynamic: {
    // Allow Matrix users to join *any* channel in this space.
    enabled: boolean;
    // Allow the AS to publish the new Matrix room to the public room list.
    published: boolean;
    // Publish the rooms to the HS directory, as opposed to the AS room directory.
    // Only used if `published` is on.
    useHomeserverDirectory?: boolean;
    // Allow the AS to create a room alias for the new Matrix room.
    createAlias: boolean;
    // Join rule for the new Matrix room.
    joinRule: "public" | "invite";
    // Allow the AS to federate the new Matrix room.
    federate?: boolean;
    // Prevent the given list of Roomy channels from being mapped.
    exclude?: string[];
  };

  bot: {
    enabled: boolean;
    localpart: string;
  };
  matrix: {
    template: string;
    joinAttempts: number;
  };
  roomy: {
    template: string;
  };
  mappings: {
    [ChannelId: string]: {
      RoomId: string;
    }
  };
}