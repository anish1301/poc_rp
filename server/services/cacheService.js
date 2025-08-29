const redis = require('redis');

/**
 * Redis caching service for order data and AI responses
 */
class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = parseInt(process.env.CACHE_TTL_SECONDS) || 3600; // 1 hour
    
    // Cache key prefixes
    this.prefixes = {
      order: 'order:',
      conversation: 'conv:',
      aiResponse: 'ai:',
      userSession: 'session:',
      rateLimit: 'rate:',
      stats: 'stats:'
    };
  }

  /**
   * Connect to Redis
   */
  async connect() {
    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://:redis123@localhost:6379',
        password: process.env.REDIS_PASSWORD || 'redis123',
        retry_strategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        console.log('Redis client ready');
      });

      this.client.on('end', () => {
        console.log('Redis connection closed');
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      // Don't throw error, just log and continue without Redis
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Check if Redis is connected
   */
  isReady() {
    return this.isConnected && this.client && this.client.isReady;
  }

  /**
   * Cache order data
   * @param {string} orderId - Order ID
   * @param {Object} orderData - Order information
   * @param {number} ttl - Time to live in seconds
   */
  async cacheOrder(orderId, orderData, ttl = null) {
    if (!this.isReady()) return false;

    try {
      const key = this.prefixes.order + orderId;
      const value = JSON.stringify({
        ...orderData,
        cachedAt: new Date().toISOString()
      });

      await this.client.setEx(key, ttl || this.defaultTTL, value);
      
      // Update cache stats
      await this.incrementStat('cache_writes');
      
      return true;
    } catch (error) {
      console.error('Error caching order:', error);
      return false;
    }
  }

  /**
   * Get cached order data
   * @param {string} orderId - Order ID
   * @returns {Object|null} - Cached order data or null
   */
  async getCachedOrder(orderId) {
    if (!this.isReady()) return null;

    try {
      const key = this.prefixes.order + orderId;
      const cached = await this.client.get(key);

      if (cached) {
        await this.incrementStat('cache_hits');
        return JSON.parse(cached);
      }

      await this.incrementStat('cache_misses');
      return null;
    } catch (error) {
      console.error('Error getting cached order:', error);
      await this.incrementStat('cache_errors');
      return null;
    }
  }

  /**
   * Cache AI response to avoid duplicate processing
   * @param {string} inputHash - Hash of user input + context
   * @param {Object} aiResponse - AI response data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheAIResponse(inputHash, aiResponse, ttl = null) {
    if (!this.isReady()) return false;

    try {
      const key = this.prefixes.aiResponse + inputHash;
      const value = JSON.stringify({
        ...aiResponse,
        cachedAt: new Date().toISOString()
      });

      await this.client.setEx(key, ttl || this.defaultTTL, value);
      await this.incrementStat('ai_cache_writes');
      
      return true;
    } catch (error) {
      console.error('Error caching AI response:', error);
      return false;
    }
  }

  /**
   * Get cached AI response
   * @param {string} inputHash - Hash of user input + context
   * @returns {Object|null} - Cached AI response or null
   */
  async getCachedAIResponse(inputHash) {
    if (!this.isReady()) return null;

    try {
      const key = this.prefixes.aiResponse + inputHash;
      const cached = await this.client.get(key);

      if (cached) {
        await this.incrementStat('ai_cache_hits');
        return JSON.parse(cached);
      }

      await this.incrementStat('ai_cache_misses');
      return null;
    } catch (error) {
      console.error('Error getting cached AI response:', error);
      return null;
    }
  }

  /**
   * Cache conversation context
   * @param {string} sessionId - Session ID
   * @param {Object} context - Conversation context
   * @param {number} ttl - Time to live in seconds
   */
  async cacheConversationContext(sessionId, context, ttl = null) {
    if (!this.isReady()) return false;

    try {
      const key = this.prefixes.conversation + sessionId;
      const value = JSON.stringify({
        ...context,
        updatedAt: new Date().toISOString()
      });

      await this.client.setEx(key, ttl || this.defaultTTL, value);
      return true;
    } catch (error) {
      console.error('Error caching conversation context:', error);
      return false;
    }
  }

  /**
   * Get cached conversation context
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Cached context or null
   */
  async getCachedConversationContext(sessionId) {
    if (!this.isReady()) return null;

    try {
      const key = this.prefixes.conversation + sessionId;
      const cached = await this.client.get(key);

      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached conversation context:', error);
      return null;
    }
  }

  /**
   * Implement rate limiting
   * @param {string} identifier - User ID or IP address
   * @param {number} limit - Request limit
   * @param {number} window - Time window in seconds
   * @returns {Object} - { allowed: boolean, remaining: number, resetTime: number }
   */
  async checkRateLimit(identifier, limit = 100, window = 3600) {
    if (!this.isReady()) return { allowed: true, remaining: limit - 1, resetTime: Date.now() + window * 1000 };

    try {
      const key = this.prefixes.rateLimit + identifier;
      const current = await this.client.get(key);
      const now = Date.now();
      const windowStart = now - (window * 1000);

      if (!current) {
        // First request in window
        await this.client.setEx(key, window, JSON.stringify({
          count: 1,
          windowStart: now
        }));

        return {
          allowed: true,
          remaining: limit - 1,
          resetTime: now + (window * 1000)
        };
      }

      const data = JSON.parse(current);
      
      if (data.windowStart < windowStart) {
        // Window expired, reset
        await this.client.setEx(key, window, JSON.stringify({
          count: 1,
          windowStart: now
        }));

        return {
          allowed: true,
          remaining: limit - 1,
          resetTime: now + (window * 1000)
        };
      }

      if (data.count >= limit) {
        // Rate limit exceeded
        return {
          allowed: false,
          remaining: 0,
          resetTime: data.windowStart + (window * 1000)
        };
      }

      // Increment counter
      data.count++;
      await this.client.setEx(key, Math.ceil((data.windowStart + (window * 1000) - now) / 1000), JSON.stringify(data));

      return {
        allowed: true,
        remaining: limit - data.count,
        resetTime: data.windowStart + (window * 1000)
      };

    } catch (error) {
      console.error('Error checking rate limit:', error);
      return { allowed: true, remaining: 0, resetTime: Date.now() + window * 1000 };
    }
  }

  /**
   * Increment a statistics counter
   * @param {string} statName - Name of the statistic
   * @param {number} increment - Amount to increment (default: 1)
   */
  async incrementStat(statName, increment = 1) {
    if (!this.isReady()) return;

    try {
      const key = this.prefixes.stats + statName;
      await this.client.incrBy(key, increment);
      
      // Set expiry for daily stats
      const ttl = await this.client.ttl(key);
      if (ttl === -1) { // No expiry set
        await this.client.expire(key, 24 * 60 * 60); // 24 hours
      }
    } catch (error) {
      console.error('Error incrementing stat:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  async getStats() {
    if (!this.isReady()) return {};

    try {
      const keys = await this.client.keys(this.prefixes.stats + '*');
      const stats = {};

      for (const key of keys) {
        const statName = key.replace(this.prefixes.stats, '');
        const value = await this.client.get(key);
        stats[statName] = parseInt(value) || 0;
      }

      // Calculate cache hit ratios
      const cacheHits = stats.cache_hits || 0;
      const cacheMisses = stats.cache_misses || 0;
      const aiHits = stats.ai_cache_hits || 0;
      const aiMisses = stats.ai_cache_misses || 0;

      stats.cache_hit_ratio = cacheHits + cacheMisses > 0 
        ? (cacheHits / (cacheHits + cacheMisses)).toFixed(2)
        : '0.00';

      stats.ai_cache_hit_ratio = aiHits + aiMisses > 0
        ? (aiHits / (aiHits + aiMisses)).toFixed(2)
        : '0.00';

      return stats;
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {};
    }
  }

  /**
   * Clear cache for a specific pattern
   * @param {string} pattern - Redis key pattern
   */
  async clearCache(pattern) {
    if (!this.isReady()) return false;

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async quit() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  /**
   * Generate cache key hash for AI responses
   * @param {string} userMessage - User message
   * @param {Array} context - Conversation context
   * @param {Object} metadata - Additional metadata
   * @returns {string} - Hash for caching
   */
  generateAIResponseHash(userMessage, context = [], metadata = {}) {
    const crypto = require('crypto');
    
    const dataToHash = {
      message: userMessage.toLowerCase().trim(),
      contextLength: context.length,
      lastContext: context.slice(-3), // Last 3 messages for context sensitivity
      metadata: metadata
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(dataToHash))
      .digest('hex')
      .substring(0, 32); // First 32 characters for shorter keys
  }
}

module.exports = new CacheService();
