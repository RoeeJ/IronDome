/**
 * Example Express server proxy for Seq logging
 * 
 * This proxy allows frontend applications to send logs to Seq without exposing
 * the Seq API key or endpoint to the client. It also adds server-side metadata
 * like IP address, user agent, and authentication info.
 */

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const router = express.Router();

// Configuration from environment variables
const SEQ_ENDPOINT = process.env.SEQ_ENDPOINT || 'http://localhost:5341';
const SEQ_API_KEY = process.env.SEQ_API_KEY;
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.SEQ_RATE_LIMIT || '1000');

// Simple in-memory rate limiting (use Redis in production)
const rateLimitMap = new Map();

// Middleware to parse CLEF format (newline-delimited JSON)
router.use(bodyParser.text({ 
  type: 'application/vnd.serilog.clef',
  limit: '1mb' 
}));

// Rate limiting middleware
router.use((req, res, next) => {
  const clientId = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000; // Current minute
  
  const key = `${clientId}:${windowStart}`;
  const count = rateLimitMap.get(key) || 0;
  
  if (count >= RATE_LIMIT_PER_MINUTE) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  rateLimitMap.set(key, count + 1);
  
  // Clean up old entries
  if (Math.random() < 0.01) { // 1% chance to clean up
    const cutoff = now - 120000; // 2 minutes ago
    for (const [k, _] of rateLimitMap) {
      const timestamp = parseInt(k.split(':')[1]);
      if (timestamp < cutoff) {
        rateLimitMap.delete(k);
      }
    }
  }
  
  next();
});

// Main proxy endpoint
router.post('/api/logs/seq', async (req, res) => {
  try {
    // Parse the CLEF events
    const lines = req.body.split('\n').filter(line => line.trim());
    const events = [];
    
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        
        // Enrich with server-side data
        event.ClientIp = req.ip || req.connection.remoteAddress;
        event.UserAgent = req.headers['user-agent'];
        event.ServerTime = new Date().toISOString();
        
        // Add authentication info if available
        if (req.user) {
          event.UserId = req.user.id;
          event.UserEmail = req.user.email;
        }
        
        // Add request correlation ID if available
        if (req.correlationId) {
          event.CorrelationId = req.correlationId;
        }
        
        // Environment info
        event.Environment = process.env.NODE_ENV || 'development';
        event.ServerHost = process.env.HOSTNAME || require('os').hostname();
        
        events.push(JSON.stringify(event));
      } catch (parseError) {
        console.error('Failed to parse log event:', parseError);
      }
    }
    
    if (events.length === 0) {
      return res.status(400).json({ error: 'No valid events to forward' });
    }
    
    // Forward to Seq
    const headers = {
      'Content-Type': 'application/vnd.serilog.clef',
    };
    
    if (SEQ_API_KEY) {
      headers['X-Seq-ApiKey'] = SEQ_API_KEY;
    }
    
    const response = await fetch(`${SEQ_ENDPOINT}/api/events/raw`, {
      method: 'POST',
      headers,
      body: events.join('\n'),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Seq error:', response.status, error);
      return res.status(response.status).json({ 
        error: 'Failed to forward logs',
        details: process.env.NODE_ENV === 'development' ? error : undefined 
      });
    }
    
    res.status(202).json({ accepted: events.length });
    
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
router.get('/api/logs/seq/health', async (req, res) => {
  try {
    // Check if Seq is reachable
    const response = await fetch(`${SEQ_ENDPOINT}/api`, {
      headers: SEQ_API_KEY ? { 'X-Seq-ApiKey': SEQ_API_KEY } : {},
    });
    
    if (response.ok) {
      res.json({ 
        status: 'healthy',
        endpoint: SEQ_ENDPOINT,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({ 
        status: 'unhealthy',
        error: `Seq returned ${response.status}`
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;

// Example usage in Express app:
/*
const express = require('express');
const seqProxy = require('./seq-proxy');

const app = express();

// Add correlation ID middleware
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || 
                      `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

// Add the Seq proxy
app.use(seqProxy);

app.listen(3001, () => {
  console.log('Server with Seq proxy running on port 3001');
});
*/