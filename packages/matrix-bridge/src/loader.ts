import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('ts-node/register', pathToFileURL('./'));
register('ts-node/esm', pathToFileURL('./'));
