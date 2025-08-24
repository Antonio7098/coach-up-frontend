// @ts-nocheck
// Seed data for Skills table
// Example skills based on PRD requirements

import { Id } from "../_generated/dataModel";

export interface SkillLevel {
  level: number;
  criteria: string;
  examples?: string[];
  rubricHints?: string[];
}

export interface SkillDoc {
  id: string;
  title: string;
  description: string;
  levels: SkillLevel[];
  category?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// Example: Clarity/Eloquence skill based on PRD
export const CLARITY_ELOQUENCE_SKILL: Omit<SkillDoc, 'createdAt' | 'updatedAt'> = {
  id: "clarity_eloquence",
  title: "Clarity/Eloquence",
  description: "Ability to express ideas clearly, avoiding ambiguity and jargon",
  category: "communication",
  isActive: true,
  levels: [
    {
      level: 1,
      criteria: "Often confusing or disorganized",
      examples: ["So, we've implemented a new synergistic paradigm leveraging our backend architecture..."],
      rubricHints: ["Uses excessive jargon", "Lacks clear structure"]
    },
    {
      level: 2,
      criteria: "Often confusing or disorganized",
      examples: ["So, we've implemented a new synergistic paradigm leveraging our backend architecture..."],
      rubricHints: ["Uses excessive jargon", "Lacks clear structure"]
    },
    {
      level: 3,
      criteria: "Often confusing or disorganized",
      examples: ["So, we've implemented a new synergistic paradigm leveraging our backend architecture..."],
      rubricHints: ["Uses excessive jargon", "Lacks clear structure"]
    },
    {
      level: 4,
      criteria: "Generally understandable",
      examples: ["We made a change to how the app gets data... it's asynchronous so it should feel a bit faster."],
      rubricHints: ["Basic clarity but could be more precise"]
    },
    {
      level: 5,
      criteria: "Generally understandable",
      examples: ["We made a change to how the app gets data... it's asynchronous so it should feel a bit faster."],
      rubricHints: ["Basic clarity but could be more precise"]
    },
    {
      level: 6,
      criteria: "Generally understandable",
      examples: ["We made a change to how the app gets data... it's asynchronous so it should feel a bit faster."],
      rubricHints: ["Basic clarity but could be more precise"]
    },
    {
      level: 7,
      criteria: "Clear, direct; simplifies complexity",
      examples: ["We fetch data in the background, so the interface stays responsive and feels faster."],
      rubricHints: ["Explains complex concepts simply"]
    },
    {
      level: 8,
      criteria: "Clear, direct; simplifies complexity",
      examples: ["We fetch data in the background, so the interface stays responsive and feels faster."],
      rubricHints: ["Explains complex concepts simply"]
    },
    {
      level: 9,
      criteria: "Consistently exceptional clarity",
      examples: ["Data now loads asynchronously, eliminating UI freezes and ensuring a seamless experience."],
      rubricHints: ["Precise technical language with clear benefits"]
    },
    {
      level: 10,
      criteria: "Effortless, memorable communication",
      examples: ["The app is instantly responsive because data loads silently in the background."],
      rubricHints: ["Elegant simplicity with impact"]
    }
  ]
};

// Additional skill examples
export const STUTTER_REDUCTION_SKILL: Omit<SkillDoc, 'createdAt' | 'updatedAt'> = {
  id: "stutter_reduction",
  title: "Stutter Reduction",
  description: "Reducing disfluencies and improving speech flow",
  category: "fluency",
  isActive: true,
  levels: [
    {
      level: 1,
      criteria: "Frequent stuttering and blocks",
      rubricHints: ["Multiple repetitions per sentence", "Long pauses"]
    },
    {
      level: 5,
      criteria: "Moderate disfluencies",
      rubricHints: ["Occasional repetitions", "Some filled pauses"]
    },
    {
      level: 10,
      criteria: "Smooth, fluent speech",
      rubricHints: ["Minimal disfluencies", "Natural flow"]
    }
  ]
};

export const SALES_PERSUASIVENESS_SKILL: Omit<SkillDoc, 'createdAt' | 'updatedAt'> = {
  id: "sales_persuasiveness",
  title: "Sales Persuasiveness",
  description: "Effectively influencing and convincing others",
  category: "communication",
  isActive: true,
  levels: [
    {
      level: 1,
      criteria: "Lacks persuasive elements",
      rubricHints: ["Focuses on features, not benefits"]
    },
    {
      level: 5,
      criteria: "Basic persuasive structure",
      rubricHints: ["Mentions some benefits", "Basic call to action"]
    },
    {
      level: 10,
      criteria: "Highly persuasive and compelling",
      rubricHints: ["Strong value proposition", "Emotional appeal", "Clear CTA"]
    }
  ]
};

// All predefined skills
export const ALL_PREDEFINED_SKILLS = [
  CLARITY_ELOQUENCE_SKILL,
  STUTTER_REDUCTION_SKILL,
  SALES_PERSUASIVENESS_SKILL,
];

