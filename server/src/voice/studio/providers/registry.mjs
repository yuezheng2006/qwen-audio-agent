import {
  createDashScopeCloneProvider,
} from './dashscope.mjs'
import { createFishCloneProvider } from './fish.mjs'
import {
  createListenHubCloneProvider,
} from './listenhub.mjs'
import { createMinimaxCloneProvider } from './minimax.mjs'

export function createVoiceCloneProviders(config = {}, options = {}) {
  const fetchImpl = options.fetchImpl || config.fetchImpl

  return new Map([
    [
      'dashscope',
      createDashScopeCloneProvider({
        apiKey: config.dashscopeApiKey,
        fetchImpl,
        targetModel: config.dashscopeTargetModel,
        endpoint: config.dashscopeEndpoint,
      }),
    ],
    [
      'fish',
      createFishCloneProvider({
        apiKey: config.fishApiKey,
        fetchImpl,
        enrollEnabled: config.fishEnrollEnabled,
      }),
    ],
    [
      'minimax',
      createMinimaxCloneProvider({
        apiKey: config.minimaxApiKey,
        fetchImpl,
        enrollEnabled: config.minimaxEnrollEnabled,
      }),
    ],
    ['listenhub', createListenHubCloneProvider()],
  ])
}
