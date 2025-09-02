import { v } from 'convex/values';
import { mutation, query, QueryCtx, MutationCtx } from './_generated/server';
import { getUser, getOrCreateUser } from './users';

const getUserQueryCtx = async (ctx: QueryCtx) => {
  const user = await getUser(ctx);
  if (!user) throw new Error('User not authenticated');
  return user;
};

const getUserMutationCtx = async (ctx: MutationCtx) => {
  const user = await getOrCreateUser(ctx);
  if (!user) throw new Error('User not authenticated');
  return user;
};

export const getUserGoals = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserQueryCtx(ctx);
    return await ctx.db
      .query('users_goals')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
  },
});

export const createGoal = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal('active'),
      v.literal('paused'),
      v.literal('completed')
    ),
    targetDateMs: v.optional(v.number()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUserMutationCtx(ctx);
    
    // Validate inputs
    if (!args.title.trim()) {
      throw new Error('Title is required');
    }
    if (args.title.length > 100) {
      throw new Error('Title cannot exceed 100 characters');
    }
    
    const now = Date.now();
    return await ctx.db.insert('users_goals', {
      userId: user._id,
      goalId: crypto.randomUUID(),
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateGoal = mutation({
  args: {
    goalId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('paused'),
        v.literal('completed')
      )
    ),
    targetDateMs: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await getUserMutationCtx(ctx);
    
    const goal = await ctx.db
      .query('users_goals')
      .withIndex('by_user_goal', (q) => 
        q.eq('userId', user._id).eq('goalId', args.goalId)
      )
      .first();
      
    if (!goal) throw new Error('Goal not found');
    
    // Validate inputs
    if (args.title && !args.title.trim()) {
      throw new Error('Title is required');
    }
    if (args.title && args.title.length > 100) {
      throw new Error('Title cannot exceed 100 characters');
    }
    
    await ctx.db.patch(goal._id, {
      ...args,
      updatedAt: Date.now(),
    });
  },
});

export const deleteGoal = mutation({
  args: { goalId: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserMutationCtx(ctx);
    
    const goal = await ctx.db
      .query('users_goals')
      .withIndex('by_user_goal', (q) => 
        q.eq('userId', user._id).eq('goalId', args.goalId)
      )
      .first();
      
    if (!goal) throw new Error('Goal not found');
    
    await ctx.db.delete(goal._id);
  },
});
