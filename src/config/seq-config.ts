// Seq configuration
// This file will be processed by Bun's bundler and the values will be inlined

export const SEQ_CONFIG = {
  enabled: 'true',
  endpoint: 'https://seq.ptt.blue',
  apiKey: 'aEsqllQzNjZBjcyf0jCO',
  useProxy: 'false',
  proxyEndpoint: '/api/logs/seq',
  batchSize: '100',
  batchTimeout: '2000'
};

// Set window.__ENV__ for compatibility with existing code
if (typeof window !== 'undefined') {
  window.__ENV__ = {
    SEQ_ENABLED: SEQ_CONFIG.enabled,
    SEQ_ENDPOINT: SEQ_CONFIG.endpoint,
    SEQ_API_KEY: SEQ_CONFIG.apiKey,
    SEQ_USE_PROXY: SEQ_CONFIG.useProxy,
    SEQ_PROXY_ENDPOINT: SEQ_CONFIG.proxyEndpoint,
    SEQ_BATCH_SIZE: SEQ_CONFIG.batchSize,
    SEQ_BATCH_TIMEOUT: SEQ_CONFIG.batchTimeout
  };
}