import { mockCometdAdapter } from './mock-cometd.js';

export const ADAPTER_NAMES = ['mock-cometd'];

/** Adaptateur par nom (celui de `meta.adapter` d'une session). */
export function getAdapter(name) {
  if (name === 'mock-cometd' || name === undefined) return mockCometdAdapter;
  throw new Error(`Adaptateur inconnu : ${name} (disponibles : ${ADAPTER_NAMES.join(', ')})`);
}
