/**
 * Compatibility re-exports for @earendil-works/pi-ai catalog / completion APIs.
 * Prefer importing model/completion helpers through this module.
 */
export {
  getModel,
  getModels,
  getProviders,
  completeSimple,
  streamSimple,
  registerFauxProvider,
} from '@earendil-works/pi-ai/compat';

export type {
  Api,
  Model,
  AssistantMessageEvent,
  BuiltinProvider,
} from '@earendil-works/pi-ai/compat';

/** Alias for pre-0.84 KnownProvider naming. */
export type { BuiltinProvider as KnownProvider } from '@earendil-works/pi-ai/compat';

export { Type } from '@earendil-works/pi-ai';
