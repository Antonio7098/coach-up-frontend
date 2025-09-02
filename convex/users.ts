import { QueryCtx, MutationCtx } from './_generated/server';
import { ConvexError } from 'convex/values';

// Query-only function to get existing user
export async function getUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  // Find existing user
  return await ctx.db
    .query('users')
    .withIndex('by_tokenIdentifier', (q) =>
      q.eq('tokenIdentifier', identity.tokenIdentifier)
    )
    .first();
}

// Mutation function to get or create user
export async function getOrCreateUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  // First try to find existing user
  let user = await ctx.db
    .query('users')
    .withIndex('by_tokenIdentifier', (q) =>
      q.eq('tokenIdentifier', identity.tokenIdentifier)
    )
    .first();

  // If user doesn't exist, create them
  if (!user) {
    const userId = await ctx.db.insert('users', {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name,
      email: identity.email,
      pictureUrl: identity.pictureUrl,
    });
    user = await ctx.db.get(userId);
  }

  return user;
}
