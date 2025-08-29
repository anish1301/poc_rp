const express = require('express');
const router = express.Router();
const cacheService = require('../services/cacheService');
const AuditLog = require('../models/AuditLog');

/**
 * Get cache statistics and health
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await cacheService.getStats();
    const isHealthy = cacheService.isReady();

    res.json({
      healthy: isHealthy,
      connected: cacheService.isReady(),
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve cache statistics',
      healthy: false,
      connected: false
    });
  }
});

/**
 * Clear specific cache patterns
 */
router.delete('/clear', async (req, res) => {
  try {
    const { pattern, type } = req.body;

    if (!pattern && !type) {
      return res.status(400).json({ 
        error: 'Pattern or type parameter required',
        examples: {
          pattern: 'order:*',
          type: 'orders|conversations|ai_responses|all'
        }
      });
    }

    let clearPattern = pattern;
    
    // Handle predefined types
    if (type) {
      switch (type) {
        case 'orders':
          clearPattern = 'order:*';
          break;
        case 'conversations':
          clearPattern = 'conv:*';
          break;
        case 'ai_responses':
          clearPattern = 'ai:*';
          break;
        case 'all':
          clearPattern = '*';
          break;
        default:
          return res.status(400).json({ 
            error: 'Invalid type. Use: orders, conversations, ai_responses, or all' 
          });
      }
    }

    const success = await cacheService.clearCache(clearPattern);

    if (success) {
      // Log cache clear action
      await AuditLog.logAction({
        sessionId: req.get('X-Session-ID') || 'system',
        userId: req.get('X-User-ID') || 'admin',
        action: 'cache_clear',
        details: {
          pattern: clearPattern,
          type: type || 'custom',
          timestamp: new Date().toISOString()
        },
        result: 'success'
      });

      res.json({
        message: 'Cache cleared successfully',
        pattern: clearPattern,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to clear cache',
        pattern: clearPattern 
      });
    }

  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ 
      error: 'Cache clear operation failed',
      details: error.message 
    });
  }
});

/**
 * Get cached item by key
 */
router.get('/item/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { prefix } = req.query;

    let fullKey = key;
    if (prefix) {
      const prefixMap = {
        order: 'order:',
        conversation: 'conv:',
        ai: 'ai:',
        session: 'session:',
        rate: 'rate:',
        stats: 'stats:'
      };
      
      if (prefixMap[prefix]) {
        fullKey = prefixMap[prefix] + key;
      }
    }

    let cachedItem;
    
    // Try different cache methods based on prefix
    if (fullKey.startsWith('order:')) {
      const orderId = fullKey.replace('order:', '');
      cachedItem = await cacheService.getCachedOrder(orderId);
    } else if (fullKey.startsWith('conv:')) {
      const sessionId = fullKey.replace('conv:', '');
      cachedItem = await cacheService.getCachedConversationContext(sessionId);
    } else if (fullKey.startsWith('ai:')) {
      const hash = fullKey.replace('ai:', '');
      cachedItem = await cacheService.getCachedAIResponse(hash);
    } else {
      // Direct Redis get for other types
      if (cacheService.isReady()) {
        const rawValue = await cacheService.client.get(fullKey);
        if (rawValue) {
          try {
            cachedItem = JSON.parse(rawValue);
          } catch {
            cachedItem = rawValue; // Return as string if not JSON
          }
        }
      }
    }

    if (cachedItem) {
      res.json({
        key: fullKey,
        found: true,
        data: cachedItem,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        key: fullKey,
        found: false,
        message: 'Cache item not found'
      });
    }

  } catch (error) {
    console.error('Error getting cached item:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve cached item',
      key: req.params.key 
    });
  }
});

/**
 * Set cache item manually
 */
router.post('/item', async (req, res) => {
  try {
    const { key, value, ttl, prefix } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ 
        error: 'Key and value are required' 
      });
    }

    let fullKey = key;
    if (prefix) {
      const prefixMap = {
        order: 'order:',
        conversation: 'conv:',
        ai: 'ai:',
        session: 'session:',
        stats: 'stats:'
      };
      
      if (prefixMap[prefix]) {
        fullKey = prefixMap[prefix] + key;
      }
    }

    // Cache the item
    if (cacheService.isReady()) {
      const cacheValue = typeof value === 'string' ? value : JSON.stringify(value);
      const cacheTTL = ttl || 3600; // Default 1 hour
      
      await cacheService.client.setEx(fullKey, cacheTTL, cacheValue);
      
      res.json({
        message: 'Cache item set successfully',
        key: fullKey,
        ttl: cacheTTL,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({ 
        error: 'Cache service not available' 
      });
    }

  } catch (error) {
    console.error('Error setting cache item:', error);
    res.status(500).json({ 
      error: 'Failed to set cache item',
      details: error.message 
    });
  }
});

/**
 * Get cache keys by pattern
 */
router.get('/keys', async (req, res) => {
  try {
    const { pattern = '*', limit = 100 } = req.query;

    if (!cacheService.isReady()) {
      return res.status(503).json({ 
        error: 'Cache service not available' 
      });
    }

    const keys = await cacheService.client.keys(pattern);
    const limitedKeys = keys.slice(0, parseInt(limit));

    res.json({
      pattern,
      totalKeys: keys.length,
      keys: limitedKeys,
      truncated: keys.length > parseInt(limit),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting cache keys:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve cache keys',
      pattern: req.query.pattern || '*'
    });
  }
});

/**
 * Get cache performance metrics
 */
router.get('/performance', async (req, res) => {
  try {
    const { timeWindow = 24 } = req.query;
    const since = new Date(Date.now() - parseInt(timeWindow) * 60 * 60 * 1000);

    // Get cache-related audit logs
    const cacheEvents = await AuditLog.find({
      timestamp: { $gte: since },
      action: { $in: ['cache_hit', 'cache_miss', 'ai_cache_hits', 'ai_cache_misses'] }
    }).sort({ timestamp: -1 });

    // Calculate performance metrics
    const metrics = {
      timeWindow: `${timeWindow} hours`,
      totalEvents: cacheEvents.length,
      cacheHits: 0,
      cacheMisses: 0,
      aiCacheHits: 0,
      aiCacheMisses: 0,
      avgResponseTime: 0
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;

    cacheEvents.forEach(event => {
      switch (event.action) {
        case 'cache_hit':
          metrics.cacheHits++;
          break;
        case 'cache_miss':
          metrics.cacheMisses++;
          break;
        case 'ai_cache_hits':
          metrics.aiCacheHits++;
          break;
        case 'ai_cache_misses':
          metrics.aiCacheMisses++;
          break;
      }

      if (event.details?.performanceMetrics?.totalResponseTime) {
        totalResponseTime += event.details.performanceMetrics.totalResponseTime;
        responseTimeCount++;
      }
    });

    if (responseTimeCount > 0) {
      metrics.avgResponseTime = Math.round(totalResponseTime / responseTimeCount);
    }

    // Calculate hit ratios
    const totalCacheEvents = metrics.cacheHits + metrics.cacheMisses;
    const totalAICacheEvents = metrics.aiCacheHits + metrics.aiCacheMisses;

    metrics.cacheHitRatio = totalCacheEvents > 0 
      ? ((metrics.cacheHits / totalCacheEvents) * 100).toFixed(2) + '%'
      : '0%';

    metrics.aiCacheHitRatio = totalAICacheEvents > 0
      ? ((metrics.aiCacheHits / totalAICacheEvents) * 100).toFixed(2) + '%'
      : '0%';

    // Get current cache stats
    const currentStats = await cacheService.getStats();

    res.json({
      historical: metrics,
      current: currentStats,
      cacheService: {
        connected: cacheService.isReady(),
        healthy: cacheService.isReady()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting cache performance metrics:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve cache performance metrics' 
    });
  }
});

/**
 * Test cache performance
 */
router.post('/test', async (req, res) => {
  try {
    const { operations = 10, keyPrefix = 'test' } = req.body;

    if (!cacheService.isReady()) {
      return res.status(503).json({ 
        error: 'Cache service not available' 
      });
    }

    const results = {
      operations: parseInt(operations),
      keyPrefix,
      writeTime: 0,
      readTime: 0,
      deleteTime: 0,
      errors: []
    };

    // Test writes
    const writeStart = Date.now();
    for (let i = 0; i < operations; i++) {
      try {
        await cacheService.client.setEx(
          `${keyPrefix}:test:${i}`, 
          60, // 1 minute TTL
          JSON.stringify({ id: i, timestamp: new Date(), data: 'test data' })
        );
      } catch (error) {
        results.errors.push(`Write ${i}: ${error.message}`);
      }
    }
    results.writeTime = Date.now() - writeStart;

    // Test reads
    const readStart = Date.now();
    for (let i = 0; i < operations; i++) {
      try {
        await cacheService.client.get(`${keyPrefix}:test:${i}`);
      } catch (error) {
        results.errors.push(`Read ${i}: ${error.message}`);
      }
    }
    results.readTime = Date.now() - readStart;

    // Test deletes
    const deleteStart = Date.now();
    for (let i = 0; i < operations; i++) {
      try {
        await cacheService.client.del(`${keyPrefix}:test:${i}`);
      } catch (error) {
        results.errors.push(`Delete ${i}: ${error.message}`);
      }
    }
    results.deleteTime = Date.now() - deleteStart;

    // Calculate averages
    results.avgWriteTime = Math.round(results.writeTime / operations * 100) / 100;
    results.avgReadTime = Math.round(results.readTime / operations * 100) / 100;
    results.avgDeleteTime = Math.round(results.deleteTime / operations * 100) / 100;

    res.json({
      message: 'Cache performance test completed',
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error running cache test:', error);
    res.status(500).json({ 
      error: 'Cache performance test failed',
      details: error.message 
    });
  }
});

module.exports = router;
