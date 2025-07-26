import { AutoRouter, cors, error, IRequestStrict, json } from 'itty-router';
import { createServerAdapter } from '@whatwg-node/server';
import { createServer } from 'http';
import { trace } from '@opentelemetry/api';
import { JazzWorker } from './jazz';
import { Logger } from './logging';
import { DataStore } from './data-store';
import * as sdk from '@roomy-chat/sdk';

const log = Logger.get('api');

const tracer = trace.getTracer('api');

export type GetSpaceRequest = {
  query: {
    id: string,
  }
} & IRequestStrict;

export class API {
  private dataStore!: DataStore;

  constructor(
    private readonly appserviceToken: string,
    private readonly env: {
      hostname?: string,
      port?: number,
    },
  ) { }

  public listen(dataStore: DataStore) {
    this.dataStore = dataStore;

    tracer.startActiveSpan('start', (span) => {
      // Create the API router
      const { preflight, corsify } = cors();

      const router = AutoRouter({
        before: [preflight],
        finally: [corsify],
      });

      router.get('/info', () =>
        json({
          appserviceToken: this.appserviceToken,
          jazzAccountId: JazzWorker.account.id,
        })
      );

      router.get('/get-space', async ({ query }: GetSpaceRequest) => {
        log.info('get-space: %s', query.id);

        const roomySpace = await sdk.RoomyEntity.load(query.id, {
          resolve: {
            $onError: null,
          }
        });

        if (!roomySpace)
          return error(400, 'Entity not found for provided Roomy space ID');

        const entry = await this.dataStore.getMatrixMappings(
          query.id,
        ).then(entries => entries.at(0));

        if (!entry)
          return error(404, 'Matrix space not found for provided Roomy space ID');

        return json({ id: entry.matrix.getId() });
      });

      // Start the API server
      const server = createServer(
        createServerAdapter(router.fetch)
      );

      const hostname = this.env.hostname ?? '0.0.0.0';
      const port = this.env.port ?? 3302;

      server.listen(port, hostname);

      span.addEvent('API listening', { hostname, port });

      span.end();

      log.info(
        'API successfully initialised, listening now on %s:%s', hostname, port
      );
    })
  }

}