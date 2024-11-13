import { db } from "db";
import { users } from "db/schema";
import { eq, sql } from "drizzle-orm";

export const POINTS = {
  CREATE_POST: 10,
  RECEIVE_LIKE: 5,
  CREATE_CHANNEL: 20,
} as const;

export async function awardPoints(userId: number, amount: number) {
  try {
    const [updatedUser] = await db
      .update(users)
      .set({
        points: sql`${users.points} + ${amount}`,
      })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser;
  } catch (error) {
    console.error('[Points] Error awarding points:', error);
    throw error;
  }
}
