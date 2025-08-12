import * as dotenv from 'dotenv';
import { AppServiceOutput, AppServiceRegistration as Registration } from 'matrix-appservice-bridge';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { RoomyBridge } from './bridge';
import { NAMESPACE_PREFIX } from './constants';
import { readEnv } from './env';
import { Logger } from './logging';
import { create as createRegistration } from './registration';
import { readYaml } from './utils';

const log = Logger.get('main');

// Add support for running behind an http proxy.
const envHttpProxyAgent = new EnvHttpProxyAgent();
setGlobalDispatcher(envHttpProxyAgent);

export const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const main = async () => {
  const env = readEnv();

  log.debug('Reading environment: %s', JSON.stringify(env, null, 2));

  const registrationPath =
    env.bridge.registrationPath ?? path.resolve(__dirname, '../registration.yaml');

  try {
    await fs.access(registrationPath);
  } catch {
    log.info('Creating new registration at: %s', registrationPath);

    const registration = createRegistration(
      env.homeserver.publicUrl,
      env.homeserver.domain,
      NAMESPACE_PREFIX
    );

    registration.outputAsYaml(registrationPath);
  }

  const contents: AppServiceOutput = await readYaml(registrationPath);
  log.debug('Found registration: %s', JSON.stringify(contents, null, 2));

  const bridge = new RoomyBridge(env, Registration.fromObject(contents));

  await bridge.listen();

  await bridge.createAdminRoom();
};

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((err) => {
    log.error('Failed to run bridge: %s', JSON.stringify(err, null, 2));

    if (err.stack) log.error(err.stack);

    process.exit(1);
  });
