const sanitizeInput = require('./sanitizeInput');

/**
 * Builds safe and effective prompts for Gemini AI
 */
class GeminiPromptBuilder {
  constructor() {
    this.systemContext = `You are a helpful order management assistant for an e-commerce platform.
Your primary function is to help customers with order-related inquiries.

CRITICAL RULES:
1. ONLY respond in valid JSON format with the exact structure specified
2. NEVER cancel orders that are shipped, delivered, or already cancelled
3. NEVER invent or hallucinate order IDs that don't exist
4. ALWAYS require confirmation before performing any actions
5. If uncertain about an order's status, ask for clarification

RESPONSE FORMAT:
Always respond with this exact JSON structure:
{
  "action": "order_cancellation" | "status_check" | "list_orders" | "refund_status" | "track_order" | "track_specific_order" | "cancel_orders" | "confirm_cancellation" | "cancel_abort" | "general_inquiry" | "clarification_needed",
  "orderId": "extracted_order_id" | null,
  "productName": "extracted_product_name" | null,
  "confidence": 0.0-1.0,
  "message": "user_friendly_response",
  "requiresConfirmation": true | false
}`;

    this.actionTemplates = {
      order_cancellation: {
        examples: [
          {
            user: "Cancel my order ORD-2024-001",
            assistant: {
              "action": "order_cancellation",
              "orderId": "ORD-2024-001",
              "productName": null,
              "confidence": 0.95,
              "message": "I'll help you cancel order ORD-2024-001. Let me check if this order can be cancelled.",
              "requiresConfirmation": true
            }
          }
        ]
      },
      status_check: {
        examples: [
          {
            user: "What's the status of order ORD-2024-002?",
            assistant: {
              "action": "status_check",
              "orderId": "ORD-2024-002",
              "productName": null,
              "confidence": 0.98,
              "message": "Let me check the current status of order ORD-2024-002 for you.",
              "requiresConfirmation": false
            }
          },
          {
            user: "Status of Bluetooth Earphones",
            assistant: {
              "action": "status_check",
              "orderId": null,
              "productName": "Bluetooth Earphones",
              "confidence": 0.95,
              "message": "Let me check the status of your Bluetooth Earphones orders.",
              "requiresConfirmation": false
            }
          },
          {
            user: "What's the status of my wireless headphones?",
            assistant: {
              "action": "status_check",
              "orderId": null,
              "productName": "wireless headphones",
              "confidence": 0.90,
              "message": "Let me find your wireless headphones order.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      list_orders: {
        examples: [
          {
            user: "Show me my orders",
            assistant: {
              "action": "list_orders",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "I'll show you all your orders so you can select the one you're interested in.",
              "requiresConfirmation": false
            }
          },
          {
            user: "Order status",
            assistant: {
              "action": "list_orders",
              "orderId": null,
              "productName": null,
              "confidence": 0.90,
              "message": "Let me display your orders for you to choose from.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      refund_status: {
        examples: [
          {
            user: "What's my refund status?",
            assistant: {
              "action": "refund_status",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "Let me check the refund status for your orders.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      track_order: {
        examples: [
          {
            user: "Track my order",
            assistant: {
              "action": "track_order",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "I'll show you the tracking information for your orders.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      track_specific_order: {
        examples: [
          {
            user: "Show tracking details for order ORD-2024-001",
            assistant: {
              "action": "track_specific_order",
              "orderId": "ORD-2024-001",
              "productName": null,
              "confidence": 0.95,
              "message": "Here are the tracking details for your order.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      cancel_orders: {
        examples: [
          {
            user: "Cancel my order",
            assistant: {
              "action": "cancel_orders",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "I'll show you your orders that can be cancelled. Please select which order you'd like to cancel.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      confirm_cancellation: {
        examples: [
          {
            user: "Yes, cancel it",
            assistant: {
              "action": "confirm_cancellation",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "Order cancellation confirmed.",
              "requiresConfirmation": false
            }
          }
        ]
      },
      cancel_abort: {
        examples: [
          {
            user: "No, keep my order",
            assistant: {
              "action": "cancel_abort",
              "orderId": null,
              "productName": null,
              "confidence": 0.95,
              "message": "Cancellation cancelled. Your order will remain active.",
              "requiresConfirmation": false
            }
          }
        ]
      }
    };
  }

  /**
   * Build a complete prompt for order-related queries
   */
  buildOrderPrompt(userMessage, conversationHistory = [], options = {}) {
    const sanitizationResult = sanitizeInput.sanitizeInput(userMessage, {
      maxLength: 500
    });

    if (sanitizationResult.riskScore > 70) {
      throw new Error('Input rejected due to security concerns');
    }

    const orderIdResult = sanitizeInput.extractOrderIds(sanitizationResult.sanitized);
    
    let prompt = this.systemContext;

    // Add conversation context if available
    if (conversationHistory.length > 0) {
      prompt += '\n\nCONVERSATION HISTORY:\n';
      const recentHistory = conversationHistory.slice(-5);
      recentHistory.forEach((msg, index) => {
        prompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
      });
    }

    // Add order context if we found order IDs
    if (orderIdResult.orderIds.length > 0) {
      prompt += `\n\nDETECTED ORDER IDs: ${orderIdResult.orderIds.join(', ')}\n`;
    }

    // Add specific instructions based on detected intent
    const intent = this.detectIntent(sanitizationResult.sanitized);
    if (intent && this.actionTemplates[intent]) {
      prompt += '\n\nEXAMPLES:\n';
      this.actionTemplates[intent].examples.forEach(example => {
        prompt += `User: "${example.user}"\nAssistant: ${JSON.stringify(example.assistant)}\n\n`;
      });
    }

    // Add current user message
    prompt += `\nCURRENT USER MESSAGE: "${sanitizationResult.sanitized}"\n\n`;

    // Add safety constraints
    prompt += `SAFETY CONSTRAINTS:
- If no valid order ID is found, set orderId to null
- For product status queries (e.g., "Status of Bluetooth Earphones"), use action "status_check" and extract productName
- For general status queries with product names, use action "status_check", not "clarification_needed"
- If the request is unclear, use action "clarification_needed"
- Never make up order IDs or order information
- Always check order status before allowing cancellation
- Confidence should reflect your certainty about the user's intent

IMPORTANT: When a user asks about the status of a specific product (like "Status of Bluetooth Earphones"), use action "status_check" with the productName field populated, NOT "clarification_needed".

Respond now with the JSON format specified above:`;

    return prompt;
  }

  /**
   * Build a validation prompt to double-check AI responses
   */
  buildValidationPrompt(originalMessage, aiResponse, orderData) {
    return `VALIDATION TASK: Review if this AI response is appropriate and safe.

ORIGINAL USER MESSAGE: "${originalMessage}"

AI RESPONSE:
${JSON.stringify(aiResponse, null, 2)}

ACTUAL ORDER DATA:
${orderData ? JSON.stringify({
  orderId: orderData.orderId,
  status: orderData.status,
  cancellationEligible: orderData.cancellationEligible
}, null, 2) : 'ORDER NOT FOUND'}

VALIDATION CRITERIA:
1. Does the orderId in the response match a real order?
2. Is the action appropriate for the order's current status?
3. Is the confidence level realistic?
4. Does the response make sense given the user's request?

Respond with validation result in JSON format:
{
  "isValid": true/false,
  "issues": ["list of any problems found"],
  "recommendation": "approve" | "reject" | "modify",
  "suggestedResponse": "alternative response if modification needed"
}`;
  }

  /**
   * Detect user intent from sanitized input
   */
  detectIntent(sanitizedInput) {
    const lowerInput = sanitizedInput.toLowerCase();

    // Confirmation intent (for cancellation confirmations)
    if (lowerInput.includes('confirm_cancel_') || 
        lowerInput.includes('yes') || 
        lowerInput.includes('confirm') || 
        lowerInput.includes('proceed')) {
      return 'confirm_cancellation';
    }

    // Cancel abort intent
    if (lowerInput.includes('cancel_abort') || 
        lowerInput.includes('no') || 
        lowerInput.includes('keep order')) {
      return 'cancel_abort';
    }

    // Order cancellation intent
    const cancellationKeywords = ['cancel', 'cancellation', 'stop', 'abort', 'terminate'];
    if (cancellationKeywords.some(keyword => lowerInput.includes(keyword))) {
      // If there's an order ID in the message, it's specific cancellation
      const orderIdPattern = /\b(ORD-\d{4}-\d{3}|\d{10,})\b/i;
      if (orderIdPattern.test(lowerInput)) {
        return 'order_cancellation';
      }
      // If no specific order ID, show list of cancellable orders
      return 'cancel_orders';
    }

    // Refund status intent
    const refundKeywords = ['refund', 'refund status', 'money back', 'return money'];
    if (refundKeywords.some(keyword => lowerInput.includes(keyword))) {
      return 'refund_status';
    }

    // Track order intent
    const trackingKeywords = ['track', 'tracking', 'where is', 'location', 'shipment'];
    if (trackingKeywords.some(keyword => lowerInput.includes(keyword))) {
      // If message contains "tracking details for order" or similar, it's specific tracking
      if (lowerInput.includes('tracking details for order') || lowerInput.includes('show tracking details')) {
        return 'track_specific_order';
      }
      return 'track_order';
    }

    // List orders intent (generic status requests)
    const listKeywords = ['order status', 'my orders', 'show orders', 'list orders'];
    if (listKeywords.some(keyword => lowerInput.includes(keyword))) {
      return 'list_orders';
    }

    // Specific status check intent
    const statusKeywords = ['status', 'progress'];
    if (statusKeywords.some(keyword => lowerInput.includes(keyword))) {
      return 'status_check';
    }

    // General inquiry
    return 'general_inquiry';
  }

  /**
   * Build a prompt for streaming responses
   */
  buildStreamingPrompt(userMessage, context = '') {
    const sanitizationResult = sanitizeInput.sanitizeInput(userMessage);
    
    return `${this.systemContext}

CONTEXT: ${context}

USER MESSAGE: "${sanitizationResult.sanitized}"

Provide a helpful response about the user's order inquiry. Start with understanding their request and then provide step-by-step assistance. Keep responses concise and user-friendly.

Response:`;
  }

  /**
   * Build error handling prompt
   */
  buildErrorPrompt(error, userMessage) {
    return JSON.stringify({
      "action": "error",
      "orderId": null,
      "productName": null,
      "confidence": 0.0,
      "message": "I apologize, but I encountered an issue processing your request. Please try again or contact support.",
      "requiresConfirmation": false
    });
  }
}

module.exports = new GeminiPromptBuilder();
