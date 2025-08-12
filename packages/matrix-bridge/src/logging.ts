import winston, { LeveledLogMethod } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as Transport from 'winston-transport';

const levels = ['debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof levels)[number];

type Methods = {
  [K in Level]: (message: string, ...meta: any) => void;
};

interface RequestConfig {
  id: string;
  direction?: 'Roomy -> Matrix' | 'Matrix -> Roomy';
}

export type RequestLogger = Pick<Methods, Level>;

export type Config = {
  level?: Level;
  verbose?: boolean;
  timestamp?: boolean;
  files?: Partial<{
    [K in Level]: string | undefined;
  }>;
  console?: boolean;
};

export class Logger {
  private static config: Required<Config> = {
    level: 'debug',
    verbose: false,
    timestamp: true,
    files: {},
    console: true,
  };

  private static cache = new Map<string, winston.Logger>();

  public static configure(config: Partial<Config>, updateAll: boolean = true): void {
    Object.assign(this.config, config);
    updateAll && this.updateAll();
  }

  private static updateAll(): void {
    Logger.cache.forEach((log) => {
      log.configure({
        format: Logger.getFormat(Logger.config.timestamp),
        transports: Logger.createTransports(),
      });
    });
  }

  public static get(name: string, opts?: Partial<Config>): winston.Logger {
    return Logger.cache.get(name) || Logger.create(name, opts);
  }

  private static create(name: string, opts?: Partial<Config>): winston.Logger {
    const logger = winston.createLogger({
      level: opts?.level ?? Logger.config.level,
      defaultMeta: { loggerName: name },
      format: Logger.getFormat(opts?.timestamp ?? Logger.config.timestamp),
      transports: Logger.createTransports(),
    });

    Logger.cache.set(name, logger);

    return logger;
  }

  public static request(config: RequestConfig): RequestLogger {
    const base = Logger.get('request');

    const decorate = function (fn: LeveledLogMethod, args: any[]) {
      const newArgs: Array<unknown> = [];
      // don't slice this; screws v8 optimisations apparently
      for (let i = 0; i < args.length; i++) {
        newArgs.push(args[i]);
      }
      // add a piece of metadata to the log line, with the request ID.
      newArgs[args.length] = {
        reqId: config.id,
        dir: config.direction,
      };
      fn.apply(base, newArgs as any);
    };

    return {
      debug: (msg: string, ...meta: any[]) => {
        decorate(base.debug, [msg, ...meta]);
      },
      info: (msg: string, ...meta: any[]) => {
        decorate(base.info, [msg, ...meta]);
      },
      warn: (msg: string, ...meta: any[]) => {
        decorate(base.warn, [msg, ...meta]);
      },
      error: (msg: string, ...meta: any[]) => {
        decorate(base.error, [msg, ...meta]);
      },
    };
  }

  public static handleUncaught() {
    process.on('uncaughtException', (err) => {
      const log = Logger.get('uncaught');

      console.error('FATAL EXCEPTION', (err && err.stack) ?? err.toString());

      if (err && err.stack) {
        log.error(err.stack);
      } else {
        log.error(err.name, err.message);
      }

      this.flushAndExit(log, 101);
    });
  }

  private static flushAndExit(log: winston.Logger, code: number): void {
    let pending = 0;
    let done = 0;

    log.transports.forEach((stream) => {
      if (!stream) return;

      pending += 1;

      stream.once('finish', () => {
        done += 1;
        pending === done && process.exit(code);
      });

      stream.on('error', () => {});

      stream.end();
    });

    pending || process.exit(code);
  }

  public static getFormat(useTimestamp: boolean) {
    const printf = (info: winston.Logform.TransformableInfo) =>
      [
        useTimestamp ? info.timestamp : '',
        info.level.toUpperCase(),
        `( ${info.loggerName} )` || '',
        info.reqId ? `[${info.reqId}]` : '',
        info.dir ? `[${info.dir}]` : '',
        info.message,
      ]
        .filter(Boolean)
        .join(' ');

    const formats = [winston.format.splat(), winston.format.printf(printf)];

    useTimestamp && formats.unshift(winston.format.timestamp());

    return winston.format.combine(...formats);
  }

  private static createTransports(opts?: Required<Config>) {
    const list: Transport[] = [];
    const files = opts?.files ?? Logger.config.files;

    if (opts?.console ?? Logger.config.console) {
      const transport = new winston.transports.Console({
        format: this.getFormat(true),
        level: opts?.level ?? Logger.config.level,
      });

      list.push(transport);
    }

    for (const level of levels) {
      const filename = files[level];

      if (typeof filename !== 'string') continue;

      const transport = new DailyRotateFile({
        filename,
        level, // Known to be valid Level
        format: this.getFormat(Logger.config.timestamp),
        maxFiles: 4,
        datePattern: 'YYYY-MM-DD',
        createSymlink: true,
      });

      transport.setMaxListeners(0);

      list.push(transport);
    }

    return list;
  }
}
