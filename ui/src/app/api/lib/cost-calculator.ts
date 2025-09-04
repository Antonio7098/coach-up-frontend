// Cost Calculation Service — Provider-specific pricing models
// Supports OpenAI, Google, Deepgram pricing with fallback rates

export interface CostCalculationInput {
  provider: string;
  service: 'stt' | 'llm' | 'tts';
  modelId?: string;
  // STT inputs
  durationMs?: number;
  // LLM inputs
  tokensIn?: number;
  tokensOut?: number;
  // TTS inputs
  characters?: number;
}

export interface CostCalculationResult {
  costCents: number;
  usage: {
    durationMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    characters?: number;
  };
  provider: string;
  modelId?: string;
  service: string;
}

// Provider-specific pricing models (in cents)
const PRICING_MODELS = {
  // OpenAI pricing (per 1M tokens, converted to cents)
  openai: {
    llm: {
      'gpt-4o': { input: 0.25, output: 1.0 }, // $2.50/$10.00 per 1M tokens
      'gpt-4o-mini': { input: 0.015, output: 0.06 }, // $0.15/$0.60 per 1M tokens
      'gpt-4-turbo': { input: 1.0, output: 3.0 }, // $10.00/$30.00 per 1M tokens
      'gpt-3.5-turbo': { input: 0.05, output: 0.15 }, // $0.50/$1.50 per 1M tokens
    },
    tts: {
      'tts-1': { perCharacter: 0.00015 }, // $0.015 per 1K characters
      'tts-1-hd': { perCharacter: 0.0003 }, // $0.030 per 1K characters
    },
    stt: {
      'whisper-1': { perMinute: 0.6 }, // $0.006 per minute
    },
  },
  
  // Google pricing (per 1M tokens, converted to cents)
  google: {
    llm: {
      'gemini-1.5-pro': { input: 0.125, output: 0.375 }, // $1.25/$3.75 per 1M tokens
      'gemini-1.5-flash': { input: 0.0075, output: 0.03 }, // $0.075/$0.30 per 1M tokens
    },
    tts: {
      'standard': { perCharacter: 0.00016 }, // $0.016 per 1K characters
      'neural2': { perCharacter: 0.00016 }, // $0.016 per 1K characters
    },
    stt: {
      'standard': { perMinute: 0.6 }, // $0.006 per minute
      'enhanced': { perMinute: 0.9 }, // $0.009 per minute
    },
  },
  
  // Deepgram pricing (per minute, converted to cents)
  deepgram: {
    stt: {
      'nova-2': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-general': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-meeting': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-phonecall': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-finance': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-conversationalai': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-voicemail': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-medical': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-drivethrough': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-automotive': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-smartmeter': { perMinute: 0.4 }, // $0.004 per minute
      'nova-2-iot': { perMinute: 0.4 }, // $0.004 per minute
    },
  },
} as const;

// Fallback rates for unknown providers/models
const FALLBACK_RATES = {
  stt: { perMinute: 0.5 }, // $0.005 per minute
  llm: { input: 0.1, output: 0.3 }, // $1.00/$3.00 per 1M tokens
  tts: { perCharacter: 0.0002 }, // $0.020 per 1K characters
} as const;

export class CostCalculator {
  /**
   * Calculate cost for a given service interaction
   */
  static calculate(input: CostCalculationInput): CostCalculationResult {
    const { provider, service, modelId } = input;

    // Get pricing model for the provider
    const providerPricing = PRICING_MODELS[provider as keyof typeof PRICING_MODELS];
    if (!providerPricing) {
      return this.calculateWithFallback(input);
    }

    // Type-safe property access using 'in' operator
    if (!(service in providerPricing)) {
      return this.calculateWithFallback(input);
    }

    const servicePricing = providerPricing[service as keyof typeof providerPricing];
    if (!servicePricing) {
      return this.calculateWithFallback(input);
    }
    
    // Calculate cost based on service type
    switch (service) {
      case 'stt':
        return this.calculateSTTCost(input, servicePricing as Record<string, { perMinute: number }>);
      case 'llm':
        return this.calculateLLMCost(input, servicePricing as Record<string, { input: number; output: number }>);
      case 'tts':
        return this.calculateTTSCost(input, servicePricing as Record<string, { perCharacter: number }>);
      default:
        return this.calculateWithFallback(input);
    }
  }
  
  /**
   * Calculate STT cost based on duration
   */
  private static calculateSTTCost(
    input: CostCalculationInput,
    pricing: Record<string, { perMinute: number }>
  ): CostCalculationResult {
    const { durationMs = 0, modelId } = input;
    const durationMinutes = durationMs / (1000 * 60);
    
    // Find pricing for specific model or use first available
    const modelPricing = modelId && pricing[modelId] 
      ? pricing[modelId] 
      : Object.values(pricing)[0];
    
    const costCents = Math.ceil(durationMinutes * modelPricing.perMinute);
    
    return {
      costCents,
      usage: { durationMs },
      provider: input.provider,
      modelId,
      service: 'stt',
    };
  }
  
  /**
   * Calculate LLM cost based on token usage
   */
  private static calculateLLMCost(
    input: CostCalculationInput,
    pricing: Record<string, { input: number; output: number }>
  ): CostCalculationResult {
    const { tokensIn = 0, tokensOut = 0, modelId } = input;
    
    // Find pricing for specific model or use first available
    const modelPricing = modelId && pricing[modelId] 
      ? pricing[modelId] 
      : Object.values(pricing)[0];
    
    // Convert tokens to millions for pricing calculation
    const inputCostCents = Math.ceil((tokensIn / 1000000) * modelPricing.input);
    const outputCostCents = Math.ceil((tokensOut / 1000000) * modelPricing.output);
    const totalCostCents = inputCostCents + outputCostCents;
    
    return {
      costCents: totalCostCents,
      usage: { tokensIn, tokensOut },
      provider: input.provider,
      modelId,
      service: 'llm',
    };
  }
  
  /**
   * Calculate TTS cost based on character count
   */
  private static calculateTTSCost(
    input: CostCalculationInput,
    pricing: Record<string, { perCharacter: number }>
  ): CostCalculationResult {
    const { characters = 0, modelId } = input;
    
    // Find pricing for specific model or use first available
    const modelPricing = modelId && pricing[modelId] 
      ? pricing[modelId] 
      : Object.values(pricing)[0];
    
    const costCents = Math.ceil(characters * modelPricing.perCharacter);
    
    return {
      costCents,
      usage: { characters },
      provider: input.provider,
      modelId,
      service: 'tts',
    };
  }
  
  /**
   * Calculate cost using fallback rates for unknown providers/models
   */
  private static calculateWithFallback(input: CostCalculationInput): CostCalculationResult {
    const { service, durationMs = 0, tokensIn = 0, tokensOut = 0, characters = 0 } = input;
    
    let costCents = 0;
    let usage: any = {};
    
    switch (service) {
      case 'stt':
        const durationMinutes = durationMs / (1000 * 60);
        costCents = Math.ceil(durationMinutes * FALLBACK_RATES.stt.perMinute);
        usage = { durationMs };
        break;
      case 'llm':
        const inputCostCents = Math.ceil((tokensIn / 1000000) * FALLBACK_RATES.llm.input);
        const outputCostCents = Math.ceil((tokensOut / 1000000) * FALLBACK_RATES.llm.output);
        costCents = inputCostCents + outputCostCents;
        usage = { tokensIn, tokensOut };
        break;
      case 'tts':
        costCents = Math.ceil(characters * FALLBACK_RATES.tts.perCharacter);
        usage = { characters };
        break;
    }
    
    return {
      costCents,
      usage,
      provider: input.provider,
      modelId: input.modelId,
      service,
    };
  }
  
  /**
   * Validate cost calculation input
   */
  static validateInput(input: CostCalculationInput): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!input.provider) {
      errors.push('Provider is required');
    }
    
    if (!input.service || !['stt', 'llm', 'tts'].includes(input.service)) {
      errors.push('Service must be one of: stt, llm, tts');
    }
    
    switch (input.service) {
      case 'stt':
        if (!input.durationMs || input.durationMs <= 0) {
          errors.push('Duration in milliseconds is required for STT');
        }
        break;
      case 'llm':
        if ((!input.tokensIn || input.tokensIn <= 0) && (!input.tokensOut || input.tokensOut <= 0)) {
          errors.push('At least one of tokensIn or tokensOut is required for LLM');
        }
        break;
      case 'tts':
        if (!input.characters || input.characters <= 0) {
          errors.push('Character count is required for TTS');
        }
        break;
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

