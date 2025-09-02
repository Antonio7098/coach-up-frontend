/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as functions_assessments from "../functions/assessments.js";
import type * as functions_events from "../functions/events.js";
import type * as functions_interactions from "../functions/interactions.js";
import type * as functions_sessions from "../functions/sessions.js";
import type * as functions_skills from "../functions/skills.js";
import type * as functions_summaries from "../functions/summaries.js";
import type * as functions_summary_state from "../functions/summary_state.js";
import type * as functions_users from "../functions/users.js";
import type * as functions_goals from "../functions/goals.js";
import type * as functions_profile from "../functions/profile.js";
import type * as seed_skills from "../seed_skills.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "functions/assessments": typeof functions_assessments;
  "functions/events": typeof functions_events;
  "functions/interactions": typeof functions_interactions;
  "functions/sessions": typeof functions_sessions;
  "functions/skills": typeof functions_skills;
  "functions/summaries": typeof functions_summaries;
  "functions/summary_state": typeof functions_summary_state;
  "functions/users": typeof functions_users;
  "functions/goals": typeof functions_goals;
  "functions/profile": typeof functions_profile;
  seed_skills: typeof seed_skills;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
