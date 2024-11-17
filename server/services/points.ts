import { db } from 'db';
import { points_transactions, users } from 'db/schema';
import { eq } from 'drizzle-orm';

export const POINTS_CONFIG = {
  // Content creation
  CREATE_POST: 10,
  RECEIVE_LIKE: 2,
  RECEIVE_COMMENT: 3,
  
  // Premium bonuses
  PREMIUM_MULTIPLIER: 1.5,
  PREMIUM_MONTHLY_BONUS: 100,
  PREMIUM_YEARLY_BONUS: 1500,
  
  // Engagement rewards
  DAILY_LOGIN: 5,
  WEEKLY_STREAK: 50,
  MONTHLY_STREAK: 250,
  
  // Achievement thresholds
  RANKS: {
    newcomer: 0,
    contributor: 100,
    enthusiast: 500,
    creator: 1000,
    expert: 5000,
    elite: 10000,
    legend: 50000
  }
};

export class PointsService {
  static async awardPoints(
    userId: number,
    amount: number,
    type: string,
    source: string,
    sourceId?: number,
    metadata: Record<string, any> = {}
  ) {
    try {
      // Get user's premium status for bonus calculation
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error('User not found');
      }

      // Apply premium multiplier if applicable
      const finalAmount = user.is_premium 
        ? Math.round(amount * POINTS_CONFIG.PREMIUM_MULTIPLIER)
        : amount;

      // Record points transaction
      const [transaction] = await db.insert(points_transactions)
        .values({
          user_id: userId,
          amount: finalAmount,
          type,
          source,
          source_id: sourceId,
          metadata: {
            ...metadata,
            original_amount: amount,
            premium_bonus: user.is_premium ? (finalAmount - amount) : 0
          }
        })
        .returning();

      // Update user's total points
      await db.transaction(async (tx) => {
        // Update total points
        await tx.execute(
          `UPDATE users 
           SET points = points + $1,
               total_points_earned = total_points_earned + $1
           WHERE id = $2`,
          [finalAmount, userId]
        );

        // Update user rank based on total points
        const [updatedUser] = await tx.select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (updatedUser) {
          const newRank = Object.entries(POINTS_CONFIG.RANKS)
            .reverse()
            .find(([_, threshold]) => updatedUser.total_points_earned >= threshold)?.[0] || 'newcomer';

          if (newRank !== updatedUser.rank) {
            await tx.update(users)
              .set({ rank: newRank })
              .where(eq(users.id, userId));
          }
        }
      });

      return {
        transactionId: transaction.id,
        amount: finalAmount,
        newTotal: (user.points || 0) + finalAmount
      };
    } catch (error) {
      console.error('[Points] Award points error:', error);
      throw error;
    }
  }

  static async getPointsHistory(userId: number, limit = 50, offset = 0) {
    try {
      const transactions = await db.select()
        .from(points_transactions)
        .where(eq(points_transactions.user_id, userId))
        .orderBy(sql`points_transactions.created_at DESC`)
        .limit(limit)
        .offset(offset);

      const total = await db.select({ count: sql`count(*)` })
        .from(points_transactions)
        .where(eq(points_transactions.user_id, userId));

      return {
        transactions,
        total: total[0].count
      };
    } catch (error) {
      console.error('[Points] Get points history error:', error);
      throw error;
    }
  }

  static async deductPoints(
    userId: number,
    amount: number,
    reason: string,
    metadata: Record<string, any> = {}
  ) {
    try {
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error('User not found');
      }

      if ((user.points || 0) < amount) {
        throw new Error('Insufficient points');
      }

      const [transaction] = await db.insert(points_transactions)
        .values({
          user_id: userId,
          amount: -amount,
          type: 'spent',
          source: reason,
          metadata
        })
        .returning();

      await db.update(users)
        .set({ points: sql`points - ${amount}` })
        .where(eq(users.id, userId));

      return {
        transactionId: transaction.id,
        amount: -amount,
        newTotal: (user.points || 0) - amount
      };
    } catch (error) {
      console.error('[Points] Deduct points error:', error);
      throw error;
    }
  }
}
