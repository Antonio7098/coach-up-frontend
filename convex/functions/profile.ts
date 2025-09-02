import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getUser, getOrCreateUser } from './users';

export const getUserProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    return await ctx.db
      .query('users_profile')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();
  },
});

export const updateUserProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getOrCreateUser(ctx);
    if (!user) throw new Error('User not authenticated');

    // Validate inputs
    if (args.displayName && args.displayName.length < 2) {
      throw new Error('Display name must be at least 2 characters');
    }
    if (args.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error('Invalid email format');
    }
    if (args.bio && args.bio.length > 500) {
      throw new Error('Bio cannot exceed 500 characters');
    }

    const existingProfile = await ctx.db
      .query('users_profile')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .first();

    const now = Date.now();
    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        ...args,
        updatedAt: now,
      });
      return existingProfile._id;
    } else {
      return await ctx.db.insert('users_profile', {
        userId: user._id,
        ...args,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
