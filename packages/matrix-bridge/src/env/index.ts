import * as logging from '../logging';
import { SpaceMappingConfig } from './mapping';

export interface Environment {
  homeserver: {
    publicUrl?: string;
    domain?: string;
    hostname?: string;
  };
  bridge: {
    registrationPath?: string;
    hostname?: string;
    port?: number;
    logging: logging.Config;
  };
  api: {
    hostname?: string;
    port?: number;
  };
  mapping: {
    spaceId?: string,
    channelId?: string,
    roomAliasOrId?: string,
  };
  jazz: {
    account?: string;
    secret?: string;
    apiKey?: string;
  };
  service: {
    spaces: { [spaceId: string]: SpaceMappingConfig };

  },
}

const envStr = (name: string) => {
  const str = process.env[name];
  if (str === undefined || str.length === 0) return undefined;
  return str;
};

const envInt = (name: string) => {
  const parsed = parseInt(process.env[name] || '', 10);
  return isNaN(parsed) ? undefined : parsed;
};

const envBool = (name: string): boolean | undefined => {
  const str = process.env[name]
  return str === 'true' || str === '1' ? true
    : str === 'false' || str === '0' ? false : undefined
}

export const readEnv = (): Environment => ({
  homeserver: {
    publicUrl: envStr('HS_PUBLIC_URL') ? envStr('HS_PUBLIC_URL')
      : envStr('HS_DOMAIN') && `https://${envStr('HS_DOMAIN')}`,
    domain: envStr('HS_DOMAIN'),
  },
  bridge: {
    registrationPath: envStr('REGISTRATION_PATH'),
    hostname: envStr('BRIDGE_HOSTNAME'),
    port: envInt('BRIDGE_PORT'),
    logging: {
      level: envStr('LOG_LEVEL') as logging.Level,
      verbose: envBool('LOG_VERBOSE'),
      timestamp: envBool('LOG_TIMESTAMP'),
      files: {},
      console: envBool('LOG_CONSOLE'),
    }
  },
  api: {
    hostname: envStr('API_HOSTNAME'),
    port: envInt('API_PORT'),
  },
  mapping: {
    spaceId: envStr('SPACE_ID'),
    channelId: envStr('CHANNEL_ID'),
    roomAliasOrId: envStr('ROOM_ALIAS_OR_ID')
  },
  jazz: {
    account: envStr('JAZZ_WORKER_ACCOUNT'),
    secret: envStr('JAZZ_WORKER_SECRET'),
    apiKey: envStr('JAZZ_API_KEY'),
  },
  service: {
    spaces: {}
  }
});