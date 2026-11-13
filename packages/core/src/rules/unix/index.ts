import type { RuleFn } from '../types';
import { UNIX_DATA_LOSS } from './data-loss';
import { UNIX_ELEVATED, UNIX_HIDDEN } from './hidden';
import { UNIX_NETWORK } from './network';
import { UNIX_SYSTEM } from './system';

export const UNIX_RULES: RuleFn[] = [...UNIX_DATA_LOSS, ...UNIX_SYSTEM, ...UNIX_NETWORK, ...UNIX_ELEVATED, ...UNIX_HIDDEN];
