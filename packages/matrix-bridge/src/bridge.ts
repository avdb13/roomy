import {
  AppService,
  Bridge,
  Request as MatrixRequest,
  MatrixRoom,
  AppServiceRegistration as Registration,
} from 'matrix-appservice-bridge';
import { API } from './api';
import { DEAD_TIME_MS, DELAY_TIME_MS, TXN_SIZE_DEFAULT } from './constants';
import { DataStore } from './data-store';
import { NeDBDataStore } from './data-store/nedb';
import { Environment } from './env';
import { JazzWorker } from './jazz';
import { Logger } from './logging';
import { BridgeEvent, BridgeRequestEvent, MatrixContextResponse, MatrixMessagesResponse } from './matrix';
import * as command from './models/matrix/commands';
import { BridgeRequest, BridgeRequestData, BridgeRequestError } from './models/request';
import { RoomyEntity, RoomyMessage, ThreadContent, Timeline } from './types';
import { getRoomySpace, isMatrixMessageEvent } from './utils';

const log = Logger.get('roomy-bridge');

export interface Mapping {
  matrix: MatrixRoom;
  roomy: {
    content: ThreadContent;
    thread: RoomyEntity;
  };
}

export enum Direction {
  RoomyToMatrix,
  MatrixToRoomy,
}

export class RoomyBridge {
  private roomySpaces: RoomyEntity[] = [];
  private dataStore!: DataStore;
  private bridge: Bridge;
  private appservice: AppService;
  private api: API;

  constructor(
    public readonly env: Environment,
    private readonly registration: Registration
  ) {
    if (!this.env.homeserver.domain || !this.env.homeserver.publicUrl)
      throw new Error('Homeserver domain configuration required');

    if (!this.registration.getHomeserverToken())
      throw Error('Homeserver token in registration file required');

    if (!this.registration.getAppServiceToken())
      throw Error('Appservice token in registration file required');

    if (!this.registration.getSenderLocalpart())
      throw Error('Sender localpart in registration file required');

    this.bridge = new Bridge({
      registration: this.registration,
      homeserverUrl: this.env.homeserver.publicUrl,
      domain: this.env.homeserver.domain,
      controller: {
        onEvent: this.onEvent.bind(this),
        onLog: this.onLog.bind(this),
        // thirdPartyLookup: {
        //   protocols: ['roomy']
        // },
      },
      disableContext: true,
      suppressEcho: false, // we use our own dupe suppress for now
      logRequestOutcome: false, // we use our own which has better logging
      queue: {
        type: 'none',
        perRequest: false,
      },
      intentOptions: {
        clients: {
          dontCheckPowerLevel: true,
          enablePresence: false,
        },
        bot: {
          dontCheckPowerLevel: true,
          enablePresence: false,
        },
      },
      // See note below for ESCAPE_DEFAULT
      escapeUserIds: false,
      roomUpgradeOpts: {
        consumeEvent: true,
        migrateGhosts: false,
        // onRoomMigrated: this.onRoomUpgrade.bind(this),
        migrateStoreEntries: false, // Only NeDB supports this.
      },
    });

    this.appservice = new AppService({
      homeserverToken: this.registration.getHomeserverToken(),
      httpMaxSizeBytes: TXN_SIZE_DEFAULT,
    });

    this.api = new API(this.appserviceToken, this.env.api);

    this.addRequestCallbacks();
  }

  private async _onEvent(event: BridgeEvent, baseRequest?: BridgeRequestEvent): Promise<BridgeRequestError | undefined> {
    const requestLog = baseRequest ? (new BridgeRequest(baseRequest)).log : Logger.get("backfill");

    if (!isMatrixMessageEvent(event)) return;

    if (event.sender.startsWith(`@_roomy_`)) return;

    {
      const lastSeenTimestamp = await this.dataStore.getLastSeenTimestamp(event.room_id);

      if (event.origin_server_ts <= lastSeenTimestamp) return;

      this.dataStore.saveLastSeenTimestamp(event.room_id, event.origin_server_ts);
    }

    log.info(
      'Received Matrix event: %s',
      JSON.stringify(
        {
          type: event.type,
          sender: event.sender,
          room_id: event.room_id,
          event_id: event.event_id,
        },
        null,
        2
      )
    );

    if (event.content.body) requestLog.debug('Message body: %s', event.content.body);

    if (event.content.body.startsWith('!')) {
      const intent = this.getIntent();

      let adminRoomId: string | null = null;

      try {
        adminRoomId = await intent.resolveRoom('#_roomy_status:kurosaki.cx');
      } catch (err) {
        log.error('Failed to resolve admin room: %s', err);

        return;
      }

      if (event.room_id === adminRoomId) {
        command.parse(event.content.body, {
          log,
          intent,
          store: this.store,
          adminRoomId,
        });

        return;
      }
    }

    const entry = await this.dataStore
      .getRoomyMappings(event.room_id)
      .then((entries) => entries.at(0));

    if (!entry) {
      requestLog.error('No Roomy mapping found for Matrix room: %s', event.room_id);

      return;
    }

    requestLog.info('Roomy mapping found for Matrix room: %s', JSON.stringify(entry, null, 2));

    const roomyThread = await JazzWorker.getThread(entry.remote.getId());

    if (!roomyThread) {
      requestLog.error('No Roomy thread with ID found: %s', entry.remote.getId());

      return;
    }

    let timeline: Timeline | null = null;

    timeline = await JazzWorker.getThreadComponent(roomyThread).then(
      (component) => component && component.timeline
    );

    if (!timeline) {
      requestLog.error('No timeline found for Roomy thread: %s', roomyThread.id);

      return;
    }

    const roomySpaceId = entry.remote.get('parent') as string;

    if (!roomySpaceId) {
      requestLog.error('No space ID for Roomy thread found: %s', roomyThread.id);

      return;
    }

    const intent = this.getIntent();
    let avatarUrl: string | null = null;

    try {
      const profile = await this.getIntent().getProfileInfo(event.sender, null, true);

      log.info('Found Matrix profile for %s: %s', event.sender, JSON.stringify(profile, null, 2));

      avatarUrl = await intent.matrixClient.mxcToHttp(profile.avatar_url);
    } catch (err) {
      log.error('Failed to get or convert Matrix avatar URL', err);
    }

    try {
      await JazzWorker.sendMessage(
        roomySpaceId,
        timeline,
        event.content.body,
        event.sender,
        avatarUrl
      );
    } catch (err) {
      log.error('Failed to send message to Jazz worker', err);
    }
  }

  private addRequestCallbacks() {
    const logMessage = (request: MatrixRequest<BridgeRequestData>, msg: string) => {
      const data = request.getData();

      log.info(
        `[${request.getId()}] [${data && data.isFromRoomy ? Direction.RoomyToMatrix : Direction.MatrixToRoomy}] ${msg} (${request.getDuration()}ms)`
      );
    };

    const factory = this.bridge.getRequestFactory();

    // SUCCESS
    factory.addDefaultResolveCallback((request, _response) => {
      const response = _response as BridgeRequestError | null;
      const bridgeRequest = request as MatrixRequest<BridgeRequestData>;

      if (response === BridgeRequestError.ERR_VIRTUAL_USER) {
        logMessage(bridgeRequest, 'IGNORE virtual user');
        return; // these aren't true successes so don't skew graphs
      } else if (response === BridgeRequestError.ERR_NOT_MAPPED) {
        logMessage(bridgeRequest, 'IGNORE not mapped');
        return; // these aren't true successes so don't skew graphs
      } else if (response === BridgeRequestError.ERR_DROPPED) {
        logMessage(bridgeRequest, 'IGNORE dropped');
        return;
      }
      logMessage(bridgeRequest, 'SUCCESS');
    });

    // FAILURE
    factory.addDefaultRejectCallback((request) =>
      logMessage(request as MatrixRequest<BridgeRequestData>, 'FAILED')
    );

    // DELAYED
    factory.addDefaultTimeoutCallback(
      (request) => logMessage(request as MatrixRequest<BridgeRequestData>, 'DELAYED'),
      DELAY_TIME_MS
    );

    // DEAD
    factory.addDefaultTimeoutCallback(
      (request) => logMessage(request as MatrixRequest<BridgeRequestData>, 'DEAD'),
      DEAD_TIME_MS
    );
  }

  private onLog(line: string, isError: boolean): void {
    if (isError) {
      log.error(line);
    } else {
      log.info(line);
    }
  }

  public async listen() {
    await this.bridge.initialise().then(() => this.bridge.loadDatabases());

    const userStore = this.bridge.getUserStore();
    const roomStore = this.bridge.getRoomStore();

    log.info('Using NeDB for datastore');

    if (!userStore || !roomStore) throw Error('Could not load datastores');

    this.dataStore = new NeDBDataStore(userStore, roomStore);

    const port = this.env.bridge.port ?? 2121;
    const hostname = this.env.bridge.hostname ?? '0.0.0.0';

    await this.bridge.listen(port, hostname, undefined, this.appservice);

    log.info('Bridge successfully initialised, listening now on %s:%s', hostname, port);

    this.api.listen(this.dataStore);

    await JazzWorker.initialise(this.dataStore);

    let mappings: string[] | null = null;

    try {
      mappings = await this.getActiveMappings();
    } catch (err) {
      log.error('Failed to get active mappings: %s', JSON.stringify(err, null, 2));

      throw err;
    }

    log.info('Mappings: %s', JSON.stringify(mappings, null, 2));

    for (const roomySpaceId of mappings)
      JazzWorker.listen(roomySpaceId, async (message: RoomyMessage) => {
        const entry = await this.dataStore
          .getMatrixMappings(message.channelId, message.spaceId)
          .then((entries) => entries.at(0));

        if (!entry) {
          log.error(
            'Failed to find mapping for thread %s of space %s, skipping: %s',
            message.channelId,
            message.spaceId,
            message.messageId
          );

          return;
        }

        const intent = this.bridge.getIntentFromLocalpart(`_roomy_${message.localpart}`);

        await intent.sendText(entry.matrix.getId(), message.message);
      });
  }

  public async getActiveMappings() {
    let joinedRooms: string[] | null = null;

    try {
      joinedRooms = await this.getIntent().matrixClient.getJoinedRooms();
    } catch (err) {
      log.error('Failed to get joined rooms: %s', err);

      throw err;
    }

    log.info('Found joined rooms: %s', JSON.stringify(joinedRooms, null, 2));

    let roomySpaceIds: string[] | null = null;

    for (const matrixRoomId of joinedRooms) {
      const roomySpace = await getRoomySpace(this.getIntent(), this.store, matrixRoomId);

      log.info(
        'Found active mapping: %s => %s',
        matrixRoomId,
        JSON.stringify([roomySpace.id, roomySpace.name], null, 2)
      );

      (roomySpaceIds ??= []).push(roomySpace.id);
    }

    return roomySpaceIds;
  }

  private async backfillFromEvent(matrixRoomId: string, fromEventId: string, limit: number = 100) {
    const intent = this.bridge.getIntent();

    let token: string | null = null;

    try {
      //  Resolve event ID -> pagination token
      const context: MatrixContextResponse = await intent.matrixClient.doRequest(
        "GET",
        `/rooms/${encodeURIComponent(matrixRoomId)}/context/${encodeURIComponent(fromEventId)}`,
        { limit: 0 } // We just want the token, not context events
      );

      token = context.start;

      if (!token) {
        log.error(
          'Missing pagination token in context: %s',
          JSON.stringify(context, null, 2),
        );

        return;
      }
    } catch (err) {
      log.error('Failed to get pagination token: %s', JSON.stringify(err, null, 2));

      return;
    }

    while (token) {
      const resp: MatrixMessagesResponse = await intent.matrixClient.doRequest(
        "GET",
        `/rooms/${encodeURIComponent(matrixRoomId)}/messages`,
        { dir: "b", from: token, limit }
      );

      // Returns newest -> oldest for backwards, reverse so it's oldest -> newest
      const chunk = (resp.chunk || []).reverse();

      for (const event of chunk) await this._onEvent(event);

      token = resp.end;

      // Stop if fewer than limit (end of history)
      if (!resp.chunk || resp.chunk.length < limit) break;
    }
  }

  public async backfill(matrixSpaceIds: string) {
    const intent = this.getIntent();

    for (const matrixSpaceId of matrixSpaceIds) {
      log.info("Backfilling Matrix space: %s", matrixSpaceId);

      const roomySpace =
        await getRoomySpace(this.getIntent(), this.store, matrixSpaceId);

      if (!roomySpace) continue;

      const threads = await JazzWorker.getSpaceThreads(roomySpace);

      for (const { component, thread } of threads) {
        component.ensureLoaded({
          resolve: {
            timeline: {
              $each: true,
              $onError: null,
            },
            $onError: null,
          },
        });

        const entry = await this.dataStore.getMatrixMappings(thread.id, roomySpace.id)
          .then((entries) => entries.at(0));

        if (!entry) continue;

        const matrixRoomId = entry.matrix.getId();

        const lastSeenTimestamp =
          await this.dataStore.getLastSeenTimestamp(matrixRoomId);

        const event =
          await intent.matrixClient.getEventNearestToTimestamp(matrixRoomId, lastSeenTimestamp, "f");

        await this.backfillFromEvent(matrixRoomId, event.event_id);
      }
    }
  }

  public async createAdminRoom() {
    const intent = this.getIntent();

    let room: MatrixRoom | null = null;

    try {
      room = await intent
        .resolveRoom('#_roomy_status:kurosaki.cx')
        .then((roomId) => new MatrixRoom(roomId));
    } catch (err) {
      log.error('Failed to resolve admin room: %s', err);
    }

    if (!room) {
      try {
        room = await intent
          .createRoom({
            options: {
              name: `Roomy Bridge status`,
              topic:
                `This room shows any errors or status messages from ` +
                `${this.env.homeserver.domain}, as well as letting you control ` +
                'the connection.',
              preset: 'public_chat',
              visibility: 'public',
              invite: ['@avdb13:kurosaki.cx'],
            },
          })
          .then(({ room_id }) => new MatrixRoom(room_id));

        log.info('Successfully created room.');

        await intent.createAlias('#_roomy_status:kurosaki.cx', room.getId());
      } catch (err) {
        log.error(
          `
        Homeserver cannot reach the bridge. 
        You probably need to adjust your configuration: %s
      `,
          err
        );
      }
    } else {
      log.info('Admin room already exists: %s', room.getId());
    }

    try {
      await intent.join(room.getId());
    } catch (err) {
      log.error('Cannot join admin room: %s', err);
    }
  }

  public get appServiceUserId() {
    return `@${this.registration.getSenderLocalpart()}:${this.domain}`;
  }

  public get appserviceToken() {
    return this.registration.getAppServiceToken();
  }

  public get store() {
    return this.dataStore;
  }

  public get domain() {
    return this.env.homeserver.domain;
  }

  public onEvent(baseRequest: BridgeRequestEvent): void {
    const event = baseRequest.getData();

    const request = new BridgeRequest(baseRequest);

    baseRequest.outcomeFrom(this._onEvent(event, request));
  }

  public getSpace(id: string) {
    return this.roomySpaces.find((s) => s.id === id);
  }

  public getSpaces() {
    return this.roomySpaces || [];
  }

  public getIntent(userId?: string) {
    return this.bridge.getIntent(userId);
  }
}
