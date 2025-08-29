const Joi = require('joi');

/**
 * Sanitizes user input to prevent prompt injection attacks
 */
class InputSanitizer {
  constructor() {
    // Patterns that might indicate prompt injection attempts
    this.suspiciousPatterns = [
      /ignore\s+(previous|all|above|system)\s+instructions?/gi,
      /forget\s+(everything|all|previous)\s+(instructions?|prompts?)/gi,
      /act\s+as\s+(a\s+)?(different|new|another)\s+(ai|bot|assistant|character)/gi,
      /pretend\s+(to\s+be|you\s+are)\s+(a\s+)?(different|evil|malicious)/gi,
      /system\s*:\s*["\']?.*["\']?/gi,
      /assistant\s*:\s*["\']?.*["\']?/gi,
      /human\s*:\s*["\']?.*["\']?/gi,
      /\{\{.*\}\}/g, // Template injection
      /\$\{.*\}/g,   // Variable injection
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // XSS attempts
      /javascript\s*:/gi,
      /data\s*:\s*text\/html/gi,
      /on\w+\s*=\s*["\'][^"\']*["\']?/gi, // Event handlers
    ];

    // Common prompt injection keywords
    this.injectionKeywords = [
      'ignore', 'forget', 'disregard', 'override', 'bypass', 'jailbreak',
      'roleplaying', 'roleplay', 'pretend', 'simulate', 'emulate',
      'system message', 'system prompt', 'initial prompt', 'base prompt'
    ];
  }

  /**
   * Sanitize user input for safe processing
   * @param {string} input - Raw user input
   * @param {Object} options - Sanitization options
   * @returns {Object} - { sanitized: string, warnings: string[] }
   */
  sanitizeInput(input, options = {}) {
    if (!input || typeof input !== 'string') {
      return { sanitized: '', warnings: ['Invalid input provided'] };
    }

    const warnings = [];
    let sanitized = input;

    // Basic validation
    if (input.length > (options.maxLength || 2000)) {
      warnings.push('Input truncated due to length');
      sanitized = sanitized.substring(0, options.maxLength || 2000);
    }

    // Remove or escape suspicious patterns
    this.suspiciousPatterns.forEach((pattern, index) => {
      if (pattern.test(sanitized)) {
        warnings.push(`Suspicious pattern detected and removed (${index + 1})`);
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    });

    // Check for injection keywords (case-insensitive)
    const lowerInput = sanitized.toLowerCase();
    const foundKeywords = this.injectionKeywords.filter(keyword => 
      lowerInput.includes(keyword.toLowerCase())
    );

    if (foundKeywords.length > 0) {
      warnings.push(`Potential injection keywords detected: ${foundKeywords.join(', ')}`);
    }

    // Remove excessive whitespace and normalize
    sanitized = sanitized
      .replace(/\s+/g, ' ')  // Multiple spaces to single space
      .replace(/\n{3,}/g, '\n\n')  // Multiple newlines to max 2
      .trim();

    // Basic HTML/Script tag removal
    sanitized = sanitized
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT_REMOVED]')
      .replace(/<[^>]*>/g, ''); // Remove HTML tags

    // URL sanitization - preserve but mark suspicious ones
    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const urls = sanitized.match(urlPattern) || [];
    if (urls.length > 3) {
      warnings.push('Multiple URLs detected - potential spam');
    }

    return {
      sanitized,
      warnings,
      riskScore: this.calculateRiskScore(input, warnings)
    };
  }

  /**
   * Validate order-related user input
   * @param {string} input - User input
   * @returns {Object} - Validation result
   */
  validateOrderInput(input) {
    const schema = Joi.object({
      message: Joi.string()
        .min(1)
        .max(1000)
        .pattern(/^[a-zA-Z0-9\s\-#.,!?$:()_]+$/)
        .required()
    });

    const sanitizationResult = this.sanitizeInput(input);
    const validation = schema.validate({ message: sanitizationResult.sanitized });

    return {
      isValid: !validation.error,
      sanitized: sanitizationResult.sanitized,
      warnings: sanitizationResult.warnings,
      riskScore: sanitizationResult.riskScore,
      validationError: validation.error?.details[0]?.message
    };
  }

  /**
   * Extract and validate order ID from user input
   * @param {string} input - User input
   * @returns {Object} - { orderIds: string[], isValid: boolean }
   */
  extractOrderIds(input) {
    // Common order ID patterns - more specific
    const patterns = [
      // Pattern for ORD-2024-003 style IDs
      /\b([A-Z]{2,4}[-][0-9]{4}[-][0-9]{3})\b/gi,
      // Pattern for ORD789, ABC123 style IDs  
      /\b([A-Z]{2,4}[0-9]{3,6})\b/gi,
      // Pattern for #12345 style IDs
      /#([A-Z0-9\-]{3,15})/gi,
      // Pattern for "order ORD-2024-003" or "order 12345"
      /order\s+([A-Z0-9\-]{3,15})/gi,
      // Pattern for standalone numbers that look like order IDs (5+ digits)
      /\b([0-9]{5,10})\b/g
    ];

    const orderIds = new Set();
    const sanitized = this.sanitizeInput(input).sanitized;

    patterns.forEach((pattern, index) => {
      const matches = sanitized.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Extract the actual order ID from the match
          let cleaned;
          if (index === 3) { // "order ORD-2024-003" pattern
            cleaned = match.replace(/^order\s+/i, '').toUpperCase();
          } else if (index === 2) { // "#ORD-2024-003" pattern
            cleaned = match.replace(/^#/, '').toUpperCase();
          } else {
            cleaned = match.toUpperCase();
          }
          
          // Filter out common words and too-short IDs
          const commonWords = ['NEED', 'WANT', 'CANCEL', 'CHECK', 'ORDER', 'TRACK', 'STATUS', 'THE', 'MY'];
          if (cleaned.length >= 3 && 
              cleaned.length <= 20 && 
              !commonWords.includes(cleaned)) {
            orderIds.add(cleaned);
          }
        });
      }
    });

    return {
      orderIds: Array.from(orderIds),
      isValid: orderIds.size > 0 && orderIds.size <= 3 // Max 3 orders per request
    };
  }

  /**
   * Calculate risk score based on input and warnings
   * @param {string} input - Original input
   * @param {string[]} warnings - Sanitization warnings
   * @returns {number} - Risk score (0-100)
   */
  calculateRiskScore(input, warnings) {
    let score = 0;

    // Length-based risk
    if (input.length > 1000) score += 10;
    if (input.length > 2000) score += 20;

    // Warning-based risk
    score += warnings.length * 15;

    // Pattern-based risk
    const suspiciousCount = this.suspiciousPatterns.filter(pattern => 
      pattern.test(input)
    ).length;
    score += suspiciousCount * 25;

    // Keyword density risk
    const words = input.toLowerCase().split(/\s+/);
    const keywordCount = words.filter(word => 
      this.injectionKeywords.some(keyword => 
        keyword.toLowerCase().includes(word) || word.includes(keyword.toLowerCase())
      )
    ).length;
    
    if (keywordCount > 0) {
      score += Math.min(keywordCount * 10, 30);
    }

    return Math.min(score, 100);
  }

  /**
   * Check if input should be blocked
   * @param {string} input - User input
   * @param {number} threshold - Risk threshold (default: 70)
   * @returns {boolean} - True if should be blocked
   */
  shouldBlock(input, threshold = 70) {
    const result = this.sanitizeInput(input);
    return result.riskScore >= threshold;
  }
}

module.exports = new InputSanitizer();
