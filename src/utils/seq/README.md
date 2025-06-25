# Seq Logging Integration

This module provides structured logging integration with Seq for the Iron Dome simulator.

## Quick Start

1. **Enable Seq logging** in your `.env` file:
   ```bash
   VITE_SEQ_ENABLED=true
   VITE_SEQ_ENDPOINT=http://localhost:5341
   ```

2. **Import the logger** in your code:
   ```typescript
   import { debug } from '@/utils/logger';
   ```

3. **Use as normal** - all existing logging works:
   ```typescript
   debug.log('System initialized');
   debug.module('Combat').warn('Low ammunition');
   ```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Application   │────▶│  DebugLogger /   │────▶│     Seq     │
│                 │     │  SeqEnabledLogger│     │   Server    │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   Console    │
                        └──────────────┘
```

### Components

- **DebugLogger**: Original console-based logger (backward compatible)
- **SeqEnabledLogger**: Extended logger with Seq support
- **SeqTransport**: Handles batching and sending logs to Seq
- **logger.ts**: Factory that creates the appropriate logger based on config

### Features

- ✅ Backward compatible with existing code
- ✅ Structured logging with properties
- ✅ Automatic batching for performance
- ✅ Graceful degradation if Seq is unavailable
- ✅ Support for both direct and proxy modes
- ✅ Browser unload handling with sendBeacon
- ✅ Session tracking
- ✅ Rate limiting (in proxy mode)

## Configuration Options

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| VITE_SEQ_ENABLED | Enable Seq logging | false |
| VITE_SEQ_ENDPOINT | Seq server URL | - |
| VITE_SEQ_API_KEY | API key for direct mode | - |
| VITE_SEQ_USE_PROXY | Use server proxy | false |
| VITE_SEQ_PROXY_ENDPOINT | Proxy endpoint path | /api/logs/seq |
| VITE_SEQ_BATCH_SIZE | Logs per batch | 100 |
| VITE_SEQ_BATCH_TIMEOUT | Batch timeout (ms) | 2000 |

## Log Levels

```typescript
enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Fatal = 4,
}
```

## Structured Logging

Use message templates for better Seq queries:

```typescript
// Good - structured with properties
debug.structured(
  'Battery {BatteryId} intercepted threat {ThreatId} at {Distance}m',
  { BatteryId: 'north-1', ThreatId: 't-123', Distance: 1250 }
);

// Also good - properties extracted automatically
debug.module('Combat').log('Interception', { 
  battery: 'north-1', 
  threat: 't-123', 
  distance: 1250 
});
```

## Performance Considerations

1. **Batching**: Logs are queued and sent in batches
2. **Non-blocking**: Logging doesn't block the main thread
3. **Debounced**: Batch timer prevents excessive requests
4. **Cached**: Session ID is cached in sessionStorage

## Security Notes

⚠️ **Production Recommendations**:
- Use proxy mode to hide API keys
- Implement rate limiting
- Validate/sanitize log data
- Use HTTPS for all endpoints
- Rotate API keys regularly

## Troubleshooting

### Logs not appearing
- Check browser console for errors
- Verify Seq is running and accessible
- Check API key permissions
- Ensure CORS is configured if using direct mode

### Performance issues
- Increase batch size
- Increase batch timeout
- Use proxy mode
- Check network latency

## See Also

- [Full Documentation](../../../docs/seq-logging.md)
- [Server Proxy Example](../../../server/seq-proxy-example.js)
- [Seq Query Language](https://docs.datalust.co/docs/query-syntax)