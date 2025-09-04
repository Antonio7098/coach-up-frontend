// Cost Calculator Tests — Validate pricing accuracy and edge cases

import { CostCalculator, CostCalculationInput } from '../../src/app/api/lib/cost-calculator';

describe('CostCalculator', () => {
  describe('STT Cost Calculation', () => {
    it('should calculate OpenAI Whisper cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        modelId: 'whisper-1',
        durationMs: 60000, // 1 minute
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // $0.006 per minute = 0.6 cents, rounded up to 1
      expect(result.usage.durationMs).toBe(60000);
      expect(result.provider).toBe('openai');
      expect(result.service).toBe('stt');
    });
    
    it('should calculate Deepgram Nova-2 cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'deepgram',
        service: 'stt',
        modelId: 'nova-2',
        durationMs: 120000, // 2 minutes
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // $0.004 per minute * 2 = 0.8 cents, rounded up to 1
      expect(result.usage.durationMs).toBe(120000);
    });
    
    it('should handle unknown STT model with fallback', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        modelId: 'unknown-model',
        durationMs: 60000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // Uses first available model pricing
    });
  });
  
  describe('LLM Cost Calculation', () => {
    it('should calculate GPT-4o cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'llm',
        modelId: 'gpt-4o',
        tokensIn: 1000000, // 1M tokens
        tokensOut: 500000, // 0.5M tokens
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(2); // Math.ceil(0.25) + Math.ceil(0.5) = 1 + 1 = 2 cents
      expect(result.usage.tokensIn).toBe(1000000);
      expect(result.usage.tokensOut).toBe(500000);
    });
    
    it('should calculate GPT-4o-mini cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'llm',
        modelId: 'gpt-4o-mini',
        tokensIn: 1000000,
        tokensOut: 1000000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(2); // Math.ceil(0.015) + Math.ceil(0.06) = 1 + 1 = 2 cents
    });
    
    it('should calculate Gemini-1.5-pro cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'google',
        service: 'llm',
        modelId: 'gemini-1.5-pro',
        tokensIn: 1000000,
        tokensOut: 1000000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(2); // Math.ceil(0.125) + Math.ceil(0.375) = 1 + 1 = 2 cents
    });
  });
  
  describe('TTS Cost Calculation', () => {
    it('should calculate OpenAI TTS-1 cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'tts',
        modelId: 'tts-1',
        characters: 1000, // 1K characters
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // 1000 * $0.00015 = 0.15 cents, rounded up to 1
      expect(result.usage.characters).toBe(1000);
    });
    
    it('should calculate OpenAI TTS-1-HD cost correctly', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'tts',
        modelId: 'tts-1-hd',
        characters: 1000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // 1000 * $0.0003 = 0.3 cents, rounded up to 1
    });
  });
  
  describe('Fallback Rates', () => {
    it('should use fallback rates for unknown provider', () => {
      const input: CostCalculationInput = {
        provider: 'unknown-provider',
        service: 'stt',
        durationMs: 60000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // $0.005 per minute = 0.5 cents, rounded up to 1
      expect(result.provider).toBe('unknown-provider');
    });
    
    it('should use fallback rates for unknown service', () => {
      const input: CostCalculationInput = {
        provider: 'unknown-provider',
        service: 'llm',
        tokensIn: 1000000,
        tokensOut: 1000000,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(2); // Fallback: Math.ceil(0.1) + Math.ceil(0.3) = 1 + 1 = 2 cents
    });
  });
  
  describe('Input Validation', () => {
    it('should validate required fields', () => {
      const invalidInput: CostCalculationInput = {
        provider: '',
        service: 'stt',
        durationMs: 60000,
      };
      
      const validation = CostCalculator.validateInput(invalidInput);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Provider is required');
    });
    
    it('should validate service type', () => {
      const invalidInput: CostCalculationInput = {
        provider: 'openai',
        service: 'invalid' as any,
        durationMs: 60000,
      };
      
      const validation = CostCalculator.validateInput(invalidInput);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Service must be one of: stt, llm, tts');
    });
    
    it('should validate STT input', () => {
      const invalidInput: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        durationMs: 0,
      };
      
      const validation = CostCalculator.validateInput(invalidInput);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Duration in milliseconds is required for STT');
    });
    
    it('should validate LLM input', () => {
      const invalidInput: CostCalculationInput = {
        provider: 'openai',
        service: 'llm',
        tokensIn: 0,
        tokensOut: 0,
      };
      
      const validation = CostCalculator.validateInput(invalidInput);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('At least one of tokensIn or tokensOut is required for LLM');
    });
    
    it('should validate TTS input', () => {
      const invalidInput: CostCalculationInput = {
        provider: 'openai',
        service: 'tts',
        characters: 0,
      };
      
      const validation = CostCalculator.validateInput(invalidInput);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Character count is required for TTS');
    });
    
    it('should pass validation for valid input', () => {
      const validInput: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        durationMs: 60000,
      };
      
      const validation = CostCalculator.validateInput(validInput);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle zero duration for STT', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        durationMs: 0,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(0);
    });
    
    it('should handle zero tokens for LLM', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'llm',
        tokensIn: 0,
        tokensOut: 0,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(0);
    });
    
    it('should handle zero characters for TTS', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'tts',
        characters: 0,
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(0);
    });
    
    it('should round up fractional costs', () => {
      const input: CostCalculationInput = {
        provider: 'openai',
        service: 'stt',
        durationMs: 10000, // 10 seconds = 0.167 minutes
      };
      
      const result = CostCalculator.calculate(input);
      
      expect(result.costCents).toBe(1); // 0.167 * $0.006 = 0.001 cents, rounded up to 1
    });
  });
});

