import * as sdk from '@roomy-chat/sdk';
import { Intent, MatrixRoom } from 'matrix-appservice-bridge';
import { Logger } from 'winston';
import { DataStore } from '../../data-store';
import { JazzWorker } from '../../jazz';
import { RoomStateEvent } from '../../matrix';
import { RoomyRoom } from '../roomy/room';

export interface Args {
  bridge: [matrixSpaceAliasOrId: string, roomySpaceId: string];
}

export interface Context {
  log: Logger;
  intent: Intent;
  store: DataStore;
  adminRoomId: string;
}

export type Name = keyof Args;

export class Command<N extends Name, C> {
  constructor(
    public name: N,
    private handler: (args: Args[N], context: C) => void
  ) {}

  execute(args: Args[N], context: C) {
    this.handler(args, context);
  }
}

export const registry: {
  [N in Name]: Command<N, Context>;
} = {
  bridge: new Command(
    'bridge',
    async ([matrixSpaceAliasOrId, roomySpaceId], { log, intent, store, adminRoomId }) => {
      let matrixSpaceId = matrixSpaceAliasOrId;

      if (matrixSpaceAliasOrId.startsWith('#')) {
        try {
          matrixSpaceId = await intent.resolveRoom(matrixSpaceAliasOrId);
        } catch (err) {
          log.error('Failed to resolve room: %s', err);

          await intent.sendText(adminRoomId, `Failed to resolve room: ${err}`).catch(() => {});

          return;
        }
      }

      const roomySpace = await sdk.RoomyEntity.load(roomySpaceId);

      if (!roomySpace) {
        await intent
          .sendText(adminRoomId, '🛑 Could not find a space with that ID. 😕')
          .catch(() => {});

        return;
      }

      const entries = await store.getRoomyMappings(matrixSpaceId);

      log.info('entries: %s', JSON.stringify(entries, null, 2));

      const entry = entries.at(0);

      if (entry) {
        // TODO
        const href = `https://roomy.space/${entry.remote.get('id')}`;

        await intent
          .sendText(
            adminRoomId,
            `🛑 This Matrix room is already bridged to another Roomy channel.` +
              ' If you want to connect to a new channel, first disconnect it.'
          )
          .catch(() => {});

        return;
      }

      let roomState: RoomStateEvent[] | null = null;

      try {
        roomState = (await intent.roomState(matrixSpaceId, false)) as RoomStateEvent[];
      } catch (err) {
        log.error('Failed to get room state: %s', err);

        await intent.sendText(adminRoomId, `Failed to get room state: ${err}`).catch(() => {});

        return;
      }

      const matrixSpaceChildren = roomState
        .filter((event) => event.type === 'm.space.child')
        .map(({ state_key, content }) => ({
          roomId: state_key,
          via: content['via'],
          suggested: content['suggested'] ?? false,
        }));

      if (matrixSpaceChildren.length === 0) {
        log.error(`Matrix space ${matrixSpaceAliasOrId} has no children`);

        await intent
          .sendText(adminRoomId, `Matrix space ${matrixSpaceAliasOrId} has no children`)
          .catch(() => {});

        return;
      }

      log.info(
        'Successfully resolved Matrix space children: %s',
        JSON.stringify(
          matrixSpaceChildren.map(({ roomId }) => ({ roomId })),
          null,
          2
        )
      );

      let roomySpaceThreads: Awaited<ReturnType<typeof JazzWorker.getSpaceThreads>> | null = null;

      try {
        roomySpaceThreads = await JazzWorker.getSpaceThreads(roomySpaceId);
      } catch (err) {
        log.error('Failed to get Roomy space threads: %s', err);

        await intent
          .sendText(adminRoomId, `Failed to get Roomy space threads: ${err}`)
          .catch(() => {});

        return;
      }

      log.info(
        'Successfully resolved Roomy space threads: %s',
        JSON.stringify(
          roomySpaceThreads.map(({ thread: { id, name } }) => ({ id, name })),
          null,
          2
        )
      );

      try {
        await store.storeRoom(new RoomyRoom(roomySpace), new MatrixRoom(matrixSpaceId));
      } catch (err) {
        log.error('Failed to store space: %s', err);

        await intent.sendText(adminRoomId, `Failed to store space: ${err}`).catch(() => {});

        return;
      }

      for (const { thread } of roomySpaceThreads) {
        try {
          const matrixRoomId = await intent.resolveRoom(`#${thread.name}:kurosaki.cx`);

          if (!matrixSpaceChildren.map(({ roomId }) => roomId).includes(matrixRoomId))
            throw new Error(
              `Room ${matrixRoomId} (${`#${thread.name}:kurosaki.cx`}) is not a space child of ${matrixSpaceId}`
            );

          const { membership }: { membership: string } = await intent.getStateEvent(
            matrixRoomId,
            'm.room.member',
            intent.userId
          );

          if (!(membership === 'invite' || membership === 'join'))
            throw new Error(
              `Appservice bot is not invited to ${matrixRoomId} (${`#${thread.name}:kurosaki.cx`})`
            );

          await store.storeRoom(new RoomyRoom(thread, roomySpace.id), new MatrixRoom(matrixRoomId));
        } catch (err) {
          log.error('Failed to resolve or store room: %s', err);

          await intent
            .sendText(adminRoomId, `Failed to resolve or store room: ${err}`)
            .catch(() => {});

          return;
        }
      }

      await intent.sendText(adminRoomId, 'Roomy channel has been connected! 🥳').catch(() => {});
    }
  ),
};

export const parse = (message: string, context: Context) => {
  if (!message.startsWith('!')) return;

  const [name, ...args] = message.slice(1).trim().split(/\s+/);

  const isCmd = (cmd: string): cmd is Name => cmd in registry;

  const dispatch = <N extends Name>(name: N, args: string[], f: (args: Args[N]) => void) => {
    if (args.length < registry[name].execute.length) return;

    f(args as unknown as Args[N]);
  };

  if (isCmd(name)) dispatch(name, args, (args) => registry[name].execute(args, context));
};
