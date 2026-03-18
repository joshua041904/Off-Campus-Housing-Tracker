/**
 * SMS Provider Abstraction Layer
 * Supports multiple SMS providers with fallback and mock mode for development
 */

export interface SmsProvider {
  sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  getName(): string;
}

// Mock SMS Provider (for development/testing - like MailHog for email)
class MockSmsProvider implements SmsProvider {
  private messages: Array<{ to: string; message: string; timestamp: Date }> = [];

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const messageId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.messages.push({ to, message, timestamp: new Date() });
    
    // Extract verification code from message (format: "Your code is: 123456")
    const codeMatch = message.match(/(?:code is|code:)\s*(\d{6})/i);
    const code = codeMatch ? codeMatch[1] : 'extracted from message';
    
    console.log(`[SMS Mock] Message sent to ${to}:`);
    console.log(`[SMS Mock] Code: ${code}`);
    console.log(`[SMS Mock] Full message: ${message}`);
    console.log(`[SMS Mock] Message ID: ${messageId}`);
    console.log(`[SMS Mock] Access via: GET /api/auth/sms/mock/messages`);
    
    return { success: true, messageId };
  }

  getName(): string {
    return 'Mock SMS Provider';
  }

  getMessages(): Array<{ to: string; message: string; timestamp: Date; code?: string }> {
    return this.messages.map(msg => {
      const codeMatch = msg.message.match(/(?:code is|code:)\s*(\d{6})/i);
      return {
        ...msg,
        code: codeMatch ? codeMatch[1] : undefined,
      };
    });
  }

  clearMessages(): void {
    this.messages = [];
  }
}

// Twilio SMS Provider
class TwilioSmsProvider implements SmsProvider {
  private client: any;
  private fromNumber: string;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    try {
      const twilio = require('twilio');
      this.client = twilio(accountSid, authToken);
      this.fromNumber = fromNumber;
    } catch (error: any) {
      throw new Error(`Twilio package not installed: ${error.message}`);
    }
  }

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: to,
      });
      return { success: true, messageId: result.sid };
    } catch (error: any) {
      console.error('[Twilio SMS] Error:', error);
      return { success: false, error: error.message };
    }
  }

  getName(): string {
    return 'Twilio';
  }
}

// AWS SNS SMS Provider (very cheap, pay-as-you-go)
class AwsSnsSmsProvider implements SmsProvider {
  private sns: any;
  private region: string;

  constructor(accessKeyId: string, secretAccessKey: string, region: string = 'us-east-1') {
    try {
      const AWS = require('aws-sdk');
      this.region = region;
      this.sns = new AWS.SNS({
        accessKeyId,
        secretAccessKey,
        region,
      });
    } catch (error: any) {
      throw new Error(`AWS SDK not installed: ${error.message}`);
    }
  }

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const params = {
        PhoneNumber: to,
        Message: message,
      };
      const result = await this.sns.publish(params).promise();
      return { success: true, messageId: result.MessageId };
    } catch (error: any) {
      console.error('[AWS SNS SMS] Error:', error);
      return { success: false, error: error.message };
    }
  }

  getName(): string {
    return 'AWS SNS';
  }
}

// Vonage (formerly Nexmo) SMS Provider (has free tier)
class VonageSmsProvider implements SmsProvider {
  private client: any;
  private fromNumber: string;

  constructor(apiKey: string, apiSecret: string, fromNumber: string) {
    try {
      const Vonage = require('@vonage/server-sdk');
      this.client = new Vonage({ apiKey, apiSecret });
      this.fromNumber = fromNumber;
    } catch (error: any) {
      throw new Error(`Vonage SDK not installed: ${error.message}`);
    }
  }

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const result = await this.client.sms.send({
        to: to,
        from: this.fromNumber,
        text: message,
      });
      
      if (result.messages[0].status === '0') {
        return { success: true, messageId: result.messages[0]['message-id'] };
      } else {
        return { success: false, error: result.messages[0]['error-text'] };
      }
    } catch (error: any) {
      console.error('[Vonage SMS] Error:', error);
      return { success: false, error: error.message };
    }
  }

  getName(): string {
    return 'Vonage';
  }
}

// MessageBird SMS Provider (has free tier)
class MessageBirdSmsProvider implements SmsProvider {
  private client: any;
  private originator: string;

  constructor(apiKey: string, originator: string) {
    try {
      const messagebird = require('messagebird')(apiKey);
      this.client = messagebird;
      this.originator = originator;
    } catch (error: any) {
      throw new Error(`MessageBird package not installed: ${error.message}`);
    }
  }

  async sendSms(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const params = {
        originator: this.originator,
        recipients: [to],
        body: message,
      };
      const result = await this.client.messages.create(params);
      return { success: true, messageId: result.id };
    } catch (error: any) {
      console.error('[MessageBird SMS] Error:', error);
      return { success: false, error: error.message };
    }
  }

  getName(): string {
    return 'MessageBird';
  }
}

// Factory function to create SMS provider based on configuration
export function createSmsProvider(): SmsProvider | null {
  const providerType = process.env.SMS_PROVIDER || 'auto';
  const useMock = process.env.SMS_USE_MOCK === 'true' || process.env.NODE_ENV === 'test';

  // Mock mode (for development/testing)
  if (useMock || providerType === 'mock') {
    console.log('[SMS] Using Mock SMS Provider (development mode)');
    return new MockSmsProvider();
  }

  // Auto-detect or specific provider
  if (providerType === 'auto' || providerType === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    
    if (accountSid && authToken && fromNumber) {
      console.log('[SMS] Using Twilio SMS Provider');
      return new TwilioSmsProvider(accountSid, authToken, fromNumber);
    }
  }

  if (providerType === 'auto' || providerType === 'aws-sns') {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'us-east-1';
    
    if (accessKeyId && secretAccessKey) {
      console.log('[SMS] Using AWS SNS SMS Provider');
      return new AwsSnsSmsProvider(accessKeyId, secretAccessKey, region);
    }
  }

  if (providerType === 'auto' || providerType === 'vonage') {
    const apiKey = process.env.VONAGE_API_KEY;
    const apiSecret = process.env.VONAGE_API_SECRET;
    const fromNumber = process.env.VONAGE_FROM_NUMBER;
    
    if (apiKey && apiSecret && fromNumber) {
      console.log('[SMS] Using Vonage SMS Provider');
      return new VonageSmsProvider(apiKey, apiSecret, fromNumber);
    }
  }

  if (providerType === 'auto' || providerType === 'messagebird') {
    const apiKey = process.env.MESSAGEBIRD_API_KEY;
    const originator = process.env.MESSAGEBIRD_ORIGINATOR;
    
    if (apiKey && originator) {
      console.log('[SMS] Using MessageBird SMS Provider');
      return new MessageBirdSmsProvider(apiKey, originator);
    }
  }

  // Fallback to mock if no provider configured
  console.warn('[SMS] No SMS provider configured, falling back to Mock SMS Provider');
  return new MockSmsProvider();
}

// Global mock provider instance (for API endpoints that need to access messages)
let globalMockProvider: MockSmsProvider | null = null;

// Export function to get global mock provider (for API endpoints)
export function getMockSmsProvider(): MockSmsProvider | null {
  if (!globalMockProvider) {
    globalMockProvider = new MockSmsProvider();
  }
  return globalMockProvider;
}

// Export mock provider for testing/debugging endpoints
export { MockSmsProvider };

