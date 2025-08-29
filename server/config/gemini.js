const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiClient {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Generation configuration for consistent responses
    this.generationConfig = {
      temperature: 0.1, // Low temperature for consistent responses
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 2048,
    };

    // Safety settings to prevent harmful content
    this.safetySettings = [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
    ];
  }

  async generateContent(prompt) {
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: this.generationConfig,
        safetySettings: this.safetySettings,
      });

      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  async generateStreamContent(prompt) {
    try {
      const result = await this.model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: this.generationConfig,
        safetySettings: this.safetySettings,
      });

      return result.stream;
    } catch (error) {
      console.error('Gemini streaming error:', error);
      throw new Error('Failed to generate streaming AI response');
    }
  }

  // Test connection to Gemini API
  async testConnection() {
    try {
      const testPrompt = 'Respond with "Connection successful" in JSON format: {"status": "success", "message": "Connection successful"}';
      const response = await this.generateContent(testPrompt);
      console.log('Gemini API connection test:', response);
      return true;
    } catch (error) {
      console.error('Gemini API connection test failed:', error);
      return false;
    }
  }
}

module.exports = new GeminiClient();
