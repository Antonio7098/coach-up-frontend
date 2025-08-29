import { QueryCtx } from './_generated/server';
import { ConvexError } from 'convex/values';

export async function getUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query('users')
    .withIndex('by_tokenIdentifier', (q) =>
      q.eq('tokenIdentifier', identity.tokenIdentifier)
    )
    .first();
}
