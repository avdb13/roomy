import { AppServiceRegistration as Registration, AppServiceOutput } from 'matrix-appservice-bridge';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import * as fs from 'node:fs/promises';
import { create as createRegistration } from './registration';
import * as url from 'node:url';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { readEnv } from './env/index';
import { Logger } from './logging';
import { RoomyBridge } from './bridge/index';
import { readYaml } from './utils';
import { NAMESPACE_PREFIX } from './constants';
import { API } from './api';

const log = Logger.get('main');

// Add support for running behind an http proxy.
const envHttpProxyAgent = new EnvHttpProxyAgent();
setGlobalDispatcher(envHttpProxyAgent)

export const __dirname = path.dirname(
  url.fileURLToPath(import.meta.url)
);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// main function - only used for standalone testing
const main = async () => {
  const env = readEnv();

  log.info('Reading environment: %s', JSON.stringify(env, null, 2));

  const registrationPath =
    env.bridge.registrationPath ?? path.resolve(__dirname, '../registration.yaml');

  try {
    await fs.access(registrationPath);
  } catch {
    log.info('Creating new registration at: %s', registrationPath);

    const registration = createRegistration(
      env.homeserver.publicUrl, env.homeserver.domain, NAMESPACE_PREFIX
    );

    registration.outputAsYaml(registrationPath);
  }

  const contents: AppServiceOutput = await readYaml(registrationPath);
  log.info('Found registration: %s', JSON.stringify(contents, null, 2));

  const bridge = new RoomyBridge(env, Registration.fromObject(contents));

  await bridge.listen();

  await bridge.createAdminRoom();
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`)
  main().catch(err => {
    log.error('Failed to run bridge: %s', JSON.stringify(err, null, 4));

    if (err.stack)
      log.error(err.stack);

    process.exit(1);
  });