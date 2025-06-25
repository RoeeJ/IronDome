# Seq Logging Integration

This document describes how to configure and use Seq structured logging in the Iron Dome simulator. All debug logging is now automatically sent to Seq when enabled.

## Overview

Seq is a structured logging platform that provides powerful search, analysis, and alerting capabilities. The Iron Dome simulator can send logs directly to Seq or through a server proxy.

## Configuration

### Environment Variables

Configure Seq logging using these environment variables in your `.env` file:

```bash
# Enable Seq logging
VITE_SEQ_ENABLED=true

# Direct logging configuration
VITE_SEQ_ENDPOINT=http://localhost:5341
VITE_SEQ_API_KEY=your-api-key-here

# Or use proxy mode (recommended for production)
VITE_SEQ_USE_PROXY=true
VITE_SEQ_PROXY_ENDPOINT=/api/logs/seq

# Batching configuration
VITE_SEQ_BATCH_SIZE=100        # Logs per batch
VITE_SEQ_BATCH_TIMEOUT=2000    # Max wait time in ms
```

### Direct vs Proxy Mode

**Direct Mode**: Frontend sends logs directly to Seq
- Pros: Simple setup, no server required
- Cons: Exposes API key, no server-side enrichment

**Proxy Mode**: Frontend sends logs to your server, which forwards to Seq
- Pros: Secure, server-side enrichment, rate limiting
- Cons: Requires server setup

## Controlling Log Volume

By default, only HIGH priority logs are sent to Seq to reduce volume. You can control verbosity:

```javascript
// In browser console:
window.setSeqVerbosity(window.LogVerbosity.CRITICAL);  // Errors only
window.setSeqVerbosity(window.LogVerbosity.HIGH);      // Important events (default)
window.setSeqVerbosity(window.LogVerbosity.MEDIUM);    // Normal operations  
window.setSeqVerbosity(window.LogVerbosity.LOW);       // Detailed tracking
window.setSeqVerbosity(window.LogVerbosity.VERBOSE);   // Everything (600K+ logs/min!)
```

### Rate-Limited Categories
Some categories are rate-limited to 10 logs/second even when enabled:
- ProximityFuse
- Guidance
- WindowUpdate
- CameraUpdate
- MouseMove

## Usage

### Basic Logging

The existing debug logger automatically sends to Seq when enabled:

```typescript
import { debug } from '@/utils/logger';

// All existing logging methods work with Seq
debug.log('Application started');
debug.warn('Low memory warning');
debug.error('Failed to load resource', error);
debug.category('Combat', 'Interceptor launched');
debug.performance('Frame render', 16.2, 'ms');
```

### Module Logging

Module loggers also support Seq:

```typescript
const logger = debug.module('ThreatManager');
logger.log('Threat spawned', { threatId, type, velocity });
logger.warn('Threat approaching battery', { distance, timeToImpact });
```

### Structured Logging

For rich structured logging (Seq-specific):

```typescript
import { logStructured } from '@/utils/logger';

// Log with message template and properties
logStructured(
  'User {UserId} fired {Count} interceptors at threat {ThreatId}',
  {
    UserId: 'player1',
    Count: 2,
    ThreatId: 'threat_123',
    Battery: 'battery_north',
    SuccessRate: 0.95
  }
);

// With custom log level
import { LogLevel } from '@/utils/seq';
logStructured(
  'Battery {BatteryId} critically damaged',
  { BatteryId: 'battery_01', Health: 10, MaxHealth: 100 },
  LogLevel.Warn
);
```

## Seq Query Examples

Once logs are in Seq, you can query them:

### Find all combat events
```
Category = "Combat"
```

### Find performance issues
```
Category = "Performance" and Duration > 16.67
```

### Track specific user sessions
```
SessionId = "1234567890-abc"
```

### Find errors by module
```
@Level = "Error" and Module = "InterceptionSystem"
```

### Battery health warnings
```
@MessageTemplate like "%battery%damaged%" and Health < 30
```

## Server Proxy Setup

See `server/seq-proxy-example.js` for a complete Express middleware example.

Key features:
- Rate limiting
- Server-side enrichment (IP, user agent, auth info)
- Error handling
- Health check endpoint

### Basic Express Setup

```javascript
const express = require('express');
const seqProxy = require('./server/seq-proxy-example');

const app = express();
app.use(seqProxy);
```

## Performance Considerations

1. **Web Worker**: Seq processing runs in a Web Worker to prevent main thread blocking
2. **Batching**: Logs are batched to reduce HTTP requests  
3. **Payload Size Management**: Automatically splits large payloads to stay under 10MB limit
4. **Graceful Degradation**: Falls back to console if Seq fails
5. **Page Unload**: Uses `sendBeacon` to ensure logs are sent

## Security Best Practices

1. **Use Proxy Mode in Production**: Never expose Seq API keys
2. **Rate Limiting**: Implement rate limiting on proxy
3. **Input Validation**: Sanitize log data on server
4. **API Key Rotation**: Regularly rotate Seq API keys
5. **Network Security**: Use HTTPS for Seq endpoints

## Troubleshooting

### Logs not appearing in Seq

1. Check environment variables are loaded
2. Verify Seq endpoint is reachable
3. Check browser console for errors
4. Verify API key permissions

### Performance issues

1. Check if Web Worker is initialized (browser console message)
2. Increase batch size if too many small requests
3. Increase batch timeout if batches too frequent
4. Use proxy mode to offload work from client
5. Check network latency to Seq
6. Monitor for 413 errors (payload too large) - automatically handled

### Missing properties

1. Ensure objects are serializable
2. Check for circular references
3. Verify property names (Seq prefers PascalCase)

## Advanced Features

### Custom Transports

You can add custom log transports:

```typescript
import { ILogTransport } from '@/utils/seq/types';

class CustomTransport implements ILogTransport {
  async log(event: LogEvent): Promise<void> {
    // Custom logging logic
  }
}
```

### Log Filtering

Filter logs before sending:

```typescript
// In SeqTransport, add filtering logic
if (event.level < LogLevel.Warn && event.category !== 'Combat') {
  return; // Skip verbose non-combat logs
}
```

### Correlation IDs

Track related events across the application:

```typescript
const correlationId = crypto.randomUUID();
debug.module('System').structured(
  'Operation {Operation} started',
  { Operation: 'WaveSpawn', CorrelationId: correlationId }
);
```