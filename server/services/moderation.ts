import { OpenAI } from 'openai';
import { db } from 'db';
import { moderation_logs, posts, users } from 'db/schema';
import { eq } from 'drizzle-orm';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class ModerationService {
  static async moderateContent(
    contentId: number,
    contentType: 'post' | 'comment',
    content: string,
    userId: number
  ) {
    try {
      // Call OpenAI's moderation API
      const moderation = await openai.moderations.create({
        input: content
      });

      const result = moderation.results[0];
      const aiScore = result.flagged ? 0.0 : 1.0;
      
      // Get categories that were flagged
      const flaggedCategories = Object.entries(result.categories)
        .filter(([_, flagged]) => flagged)
        .map(([category]) => category);

      // Determine action based on moderation result
      let actionTaken: string | null = null;
      if (result.flagged) {
        actionTaken = 'flagged';
        
        // If content is highly toxic, remove it
        const toxicityScore = result.category_scores?.['hate'] || 0;
        if (toxicityScore > 0.8) {
          actionTaken = 'removed';
          
          // Update post status if it's a post
          if (contentType === 'post') {
            await db.update(posts)
              .set({ 
                is_hidden: true,
                ai_moderation_status: 'removed',
                ai_moderation_score: aiScore
              })
              .where(eq(posts.id, contentId));
          }
        }
      } else {
        actionTaken = 'approved';
        
        // Update post status if it's a post
        if (contentType === 'post') {
          await db.update(posts)
            .set({ 
              ai_moderation_status: 'approved',
              ai_moderation_score: aiScore
            })
            .where(eq(posts.id, contentId));
        }
      }

      // Log moderation result
      const [log] = await db.insert(moderation_logs)
        .values({
          content_type: contentType,
          content_id: contentId,
          user_id: userId,
          ai_score: aiScore,
          ai_categories: flaggedCategories,
          action_taken: actionTaken,
          created_at: new Date(),
        })
        .returning();

      // Update user's trust score
      await db.execute(
        `UPDATE users 
         SET ai_trust_score = (
           SELECT AVG(ai_score)::decimal 
           FROM moderation_logs 
           WHERE user_id = $1 
           AND created_at > NOW() - INTERVAL '30 days'
         )
         WHERE id = $1`,
        [userId]
      );

      return {
        flagged: result.flagged,
        categories: flaggedCategories,
        actionTaken,
        moderationLogId: log.id
      };
    } catch (error) {
      console.error('[Moderation] Content moderation error:', error);
      throw error;
    }
  }

  static async reviewModerationDecision(
    logId: number,
    moderatorId: number,
    approved: boolean,
    notes?: string
  ) {
    try {
      const [log] = await db.select()
        .from(moderation_logs)
        .where(eq(moderation_logs.id, logId))
        .limit(1);

      if (!log) {
        throw new Error('Moderation log not found');
      }

      // Update moderation log with human review
      await db.update(moderation_logs)
        .set({
          moderator_id: moderatorId,
          action_taken: approved ? 'approved' : 'removed',
          notes
        })
        .where(eq(moderation_logs.id, logId));

      // Update content status if it's a post
      if (log.content_type === 'post') {
        await db.update(posts)
          .set({
            is_hidden: !approved,
            ai_moderation_status: approved ? 'approved' : 'removed'
          })
          .where(eq(posts.id, log.content_id));
      }

      // Update user's trust score
      if (log.user_id) {
        await db.execute(
          `UPDATE users 
           SET ai_trust_score = (
             SELECT AVG(ai_score)::decimal 
             FROM moderation_logs 
             WHERE user_id = $1 
             AND created_at > NOW() - INTERVAL '30 days'
           )
           WHERE id = $1`,
          [log.user_id]
        );
      }

      return { success: true };
    } catch (error) {
      console.error('[Moderation] Review decision error:', error);
      throw error;
    }
  }
}
