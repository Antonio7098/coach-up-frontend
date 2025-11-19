/*
  Centralized provider registry and resolver for STT/TTS
*/
import { getSttProvider, type SttProvider } from './stt'
import { getTtsProvider, type TtsProvider } from './tts'
import { devLog } from "../observability";

export type ProviderKind = 'stt' | 'tts'

export type ProviderResolution<K extends ProviderKind> = {
  kind: K
  name: string
  // Using union type to accommodate both kinds safely where used
  provider: K extends 'stt' ? SttProvider : TtsProvider
}

export function resolveProvider(kind: 'stt', opts: { envName?: string | null; requestedName?: string | null; allowOverride?: boolean }): ProviderResolution<'stt'>
export function resolveProvider(kind: 'tts', opts: { envName?: string | null; requestedName?: string | null; allowOverride?: boolean }): ProviderResolution<'tts'>
export function resolveProvider(
  kind: ProviderKind,
  opts: { envName?: string | null; requestedName?: string | null; allowOverride?: boolean },
): ProviderResolution<any> {
  const requested = (opts.allowOverride ? (opts.requestedName || '') : '').toLowerCase().trim()
  const specificEnv = (opts.envName || '').toLowerCase().trim()
  const profile = (process.env.SPEECH_PROFILE || '').toLowerCase().trim()

  // Precedence: requested override > specific env var > profile > mock
  const name = (requested || specificEnv || profile || 'mock') as string

  devLog("debug", "speech-registry: resolving provider", {
    kind,
    requested,
    specificEnv,
    profile,
    resolvedName: name
  });

  if (kind === 'stt') {
    const provider = getSttProvider(name)
    devLog("info", "speech-registry: STT provider resolved", {
      kind,
      name: provider.name,
      availableProviders: ['mock', 'deepgram', 'google'] // Add actual available providers
    });
    return { kind, name: provider.name, provider }
  } else {
    const provider = getTtsProvider(name)
    devLog("info", "speech-registry: TTS provider resolved", {
      kind,
      name: provider.name,
      availableProviders: ['mock', 'google', 'aws'] // Add actual available providers
    });
    return { kind, name: provider.name, provider }
  }
}
