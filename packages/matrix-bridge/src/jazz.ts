import { startWorker } from 'jazz-tools/worker';
import { Account } from 'jazz-tools';
import { readEnv } from './env/index';
import * as schema from './schema';
import * as sdk from '@roomy-chat/sdk';
import { Logger } from './logging';
import { Message, RoomyEntity, RoomyMessage, SpacePermissionsComponent, ThreadComponent, Timeline, WorkerProfile } from './types';
import { DataStore } from './data-store';

const log = Logger.get('main');

export class JazzWorker {
  public static account: Account | null = null;
  private static profile: WorkerProfile | null = null;
  private static dataStore: DataStore | null = null;

  constructor() { }

  public static async initialise(dataStore: DataStore) {
    this.dataStore = dataStore;

    const env = readEnv();

    if (this.account && this.profile)
      return;

    log.info('Initializing Jazz worker');

    const accountID = env.jazz.account;
    const accountSecret = env.jazz.secret;
    const syncServer = `wss://cloud.jazz.tools/?key=${env.jazz.apiKey}`;

    if (!accountID || !accountSecret) {
      throw new Error('Jazz credentials are required');
    }

    this.account = await startWorker({
      AccountSchema: sdk.MatrixWorkerAccount,
      accountID,
      accountSecret,
      syncServer,
    }).then(({ worker }) => worker);

    this.profile = await schema.WorkerProfile.load(this.account.profile.id, {
      loadAs: this.account,
    });

    log.info(`Jazz worker initialized with account: %s`, accountID);
  }

  public static async sendMessage(
    spaceId: string, timeline: Timeline, input: string, author: string, avatarUrl?: string,
  ) {
    const permissions = await this.getSpacePermissions(spaceId);

    log.info('Roomy permissions found: %s', JSON.stringify(permissions, null, 2));

    const message = await sdk.createMessage(input, { permissions });

    message.author = `matrix:${author}${avatarUrl && '#' + avatarUrl}`;

    log.info('Roomy message created: %s', JSON.stringify(message, null, 2));

    if (timeline)
      timeline.push(message.id);
  }

  public static async getSpace(spaceId: string) {
    const space = await sdk.RoomyEntity.load(spaceId, {
      resolve: {
        components: {
          $each: true
        }
      }
    });

    if (!space) {
      log.error('No Roomy space for thread found: %s', space);

      return;
    }

    return space;
  }

  public static async getThread(threadId: string) {
    return sdk.RoomyEntity.load(threadId, {
      resolve: {
        components: {
          $each: true
        }
      }
    });
  }

  public static async getSpaceThreads(spaceId: string) {
    log.info("getSpaceThreads (spaceId=%s)", spaceId);

    const space = await this.getSpace(spaceId);

    await space.ensureLoaded({
      resolve: {
        components: {
          $each: true
        }
      }
    });

    const allThreadsId = space.components[sdk.AllThreadsComponent.id];

    if (!allThreadsId)
      throw new Error('Space has no threads component');

    const allThreads =
      await sdk.AllThreadsComponent.load(allThreadsId, {
        resolve: {
          $each: {
            components: true
          }
        }
      });

    const perAccountThreads =
      Object.values(allThreads.perAccount)
        .map(({ all }) => new Array(...all)).flat().map(({ value }) => value);

    log.info(
      "Space threads: %s", JSON.stringify(
        perAccountThreads.map(({ id, name }) => ({ id, name })), null, 2
      )
    );

    let loaded: Array<
      { thread: RoomyEntity, component: ThreadComponent }
    > = new Array();

    for (
      const thread of Object.values(perAccountThreads)
    ) {
      const component = await this.getThreadComponent(thread);

      loaded.push({ thread, component });
    }

    return loaded;
  }

  public static async getSpacePermissions(spaceId: string) {
    const space = await this.getSpace(spaceId);

    const spacePermissionsComponentId =
      space.components[sdk.SpacePermissionsComponent.id];

    if (!spacePermissionsComponentId) {
      log.error(
        'No permissions component ID for Roomy space found: %s', space.id
      );

      return;
    }

    const permissions: SpacePermissionsComponent =
      await sdk.SpacePermissionsComponent.load(spacePermissionsComponentId);

    if (!permissions) {
      log.error(
        'No permissions component for Roomy space found: %s', spacePermissionsComponentId
      );

      return;
    }

    return permissions;
  }

  public static async getThreadComponent(thread: RoomyEntity) {
    log.info("getThreadComponent (threadId=%s)", thread.id);

    await thread.ensureLoaded({
      resolve: {
        components: {
          $each: true
        }
      }
    });

    const threadComponentId =
      thread.components[sdk.ThreadComponent.id];

    if (!threadComponentId)
      throw new Error('Thread has no component ID');

    const component =
      await sdk.ThreadComponent.load(threadComponentId, {
        resolve: {
          timeline: true
        }
      });

    log.info("Thread has component (threadComponentId=%s)", threadComponentId);

    return component;
  }

  public static async listen(spaceId: string, onRoomyMessage: (message: RoomyMessage) => Promise<void>) {
    const threads = await this.getSpaceThreads(spaceId);

    for (
      const { component, thread } of threads
    ) {
      component.ensureLoaded({
        resolve: {
          timeline: {
            $each: true,
            $onError: null
          },
          $onError: null
        }
      });

      component.timeline.subscribe(async (timeline: Timeline) => {
        const perAccount = Object.values(timeline.perAccount)
          .map(({ all }) => new Array(...all)).flat();

        for (
          const id of perAccount
            .sort((a, b) => b.madeAt.getTime() - a.madeAt.getTime())
        ) {
          const message = await sdk.Message.load(id.value);

          if (!message) continue;

          const lastSeenTimestamp =
            await this.dataStore.getLastSeenTimestamp(thread.id);
          const createdAt = message.createdAt.getTime();

          if (createdAt <= lastSeenTimestamp) continue;

          this.dataStore.saveLastSeenTimestamp(thread.id, createdAt);

          if (message.author?.startsWith('matrix:')) {
            log.warn('Message is from Matrix (%s), skipping', message.author);

            continue;
          }

          const authorId = id.by.profile?.id;

          if (!authorId) {
            log.warn(
              'No author ID found for message: %s', JSON.stringify(message, null, 2)
            );

            continue;
          }

          const author = await sdk.RoomyAccount.load(id.by.id, {
            resolve: {
              profile: true
            }
          });

          if (!author || !author.profile) {
            log.warn('Failed to load author: %s', authorId);

            continue;
          }

          log.info('Received Roomy message: %s',
            JSON.stringify({
              space_id: spaceId, thread_id: thread.name, thread_name: thread.name, message_id: id.value,
              author: author.profile.name,
            }, null, 2)
          );

          if (message.content)
            log.debug('Message body: %s', message.content);

          await onRoomyMessage({
            spaceId,
            channelName: thread.name,
            channelId: thread.id,
            message: message.content,
            localpart: author.profile.name,
            avatarUrl: author.profile.imageUrl,
            timestamp: message.createdAt.getTime(),
            messageId: id.value,
          });

        }
      });
    }
  }
}