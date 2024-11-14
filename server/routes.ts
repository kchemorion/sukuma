import express, { type Express } from "express";
import { setupAuth } from "./auth";
import multer from "multer";
import { db } from "db";
import { posts, channels, guest_preferences, channel_subscribers, users } from "db/schema";
import { eq, and, sql } from "drizzle-orm";
import path from "path";
import { awardPoints, POINTS } from "./points";

// Configure timeout for database queries (30 seconds)
const QUERY_TIMEOUT = 30000;

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

// Wrapper for database queries with timeout
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = QUERY_TIMEOUT
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

export function registerRoutes(app: Express) {
  setupAuth(app);

  // Serve uploaded files
  app.use('/uploads', express.static('uploads'));

  // Channel routes
  app.get("/api/channels", async (_req, res) => {
    const startTime = Date.now();
    console.log('[API] Starting channels fetch request');
    
    try {
      const allChannels = await withTimeout(
        db.select({
          ...channels,
          subscriber_count: sql`(SELECT COUNT(*) FROM ${channel_subscribers} WHERE channel_id = ${channels.id})`
        })
        .from(channels)
        .orderBy(sql`channels.created_at DESC`)
        .limit(100)
      );
      
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allChannels.length} channels`, {
        queryDuration: duration,
        channelCount: allChannels.length,
        timestamp: new Date().toISOString()
      });
      
      res.json(allChannels);
    } catch (error) {
      console.error('[API] Error fetching channels:', error);
      res.status(500).json({ error: "Failed to fetch channels" });
    }
  });

  // Subscribe to channel
  app.post("/api/channels/:channelId/subscribe", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const channelId = parseInt(req.params.channelId);
      await db.insert(channel_subscribers).values({
        channel_id: channelId,
        user_id: req.user.id
      });
      
      // Update subscriber count
      await db.execute(sql`
        UPDATE channels 
        SET subscriber_count = (
          SELECT COUNT(*) FROM channel_subscribers 
          WHERE channel_id = ${channelId}
        )
        WHERE id = ${channelId}
      `);

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error subscribing to channel:', error);
      res.status(500).json({ error: "Failed to subscribe to channel" });
    }
  });

  // Unsubscribe from channel
  app.delete("/api/channels/:channelId/subscribe", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const channelId = parseInt(req.params.channelId);
      await db.delete(channel_subscribers)
        .where(and(
          eq(channel_subscribers.channel_id, channelId),
          eq(channel_subscribers.user_id, req.user.id)
        ));

      // Update subscriber count
      await db.execute(sql`
        UPDATE channels 
        SET subscriber_count = (
          SELECT COUNT(*) FROM channel_subscribers 
          WHERE channel_id = ${channelId}
        )
        WHERE id = ${channelId}
      `);

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error unsubscribing from channel:', error);
      res.status(500).json({ error: "Failed to unsubscribe from channel" });
    }
  });

  // Get channel flairs
  app.get("/api/channels/:channelId/flairs", async (req, res) => {
    try {
      const channelId = parseInt(req.params.channelId);
      const [channel] = await db.select({
        available_flairs: channels.available_flairs
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

      res.json(channel?.available_flairs || []);
    } catch (error) {
      console.error('[API] Error fetching channel flairs:', error);
      res.status(500).json({ error: "Failed to fetch channel flairs" });
    }
  });

  // Update channel settings (moderators only)
  app.patch("/api/channels/:channelId", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const channelId = parseInt(req.params.channelId);
      const [channel] = await db.select()
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        return res.status(404).json({ error: "Channel not found" });
      }

      // Check if user is moderator
      if (!channel.moderators?.includes(req.user.id)) {
        return res.status(403).json({ error: "Not a moderator" });
      }

      const updates: Partial<typeof channels.$inferSelect> = {};
      if (req.body.rules) updates.rules = req.body.rules;
      if (req.body.available_flairs) updates.available_flairs = req.body.available_flairs;
      if (req.body.banner_url) updates.banner_url = req.body.banner_url;
      if (req.body.theme_color) updates.theme_color = req.body.theme_color;
      if (req.body.is_private !== undefined) updates.is_private = req.body.is_private;

      await db.update(channels)
        .set(updates)
        .where(eq(channels.id, channelId));

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error updating channel:', error);
      res.status(500).json({ error: "Failed to update channel" });
    }
  });

  // Create new post with improved features
  app.post("/api/posts", upload.single('audio'), async (req: any, res) => {
    if (!req.user || !req.file) {
      return res.status(400).json({ error: "Missing user or audio file" });
    }

    try {
      const channelId = req.body.channel_id ? parseInt(req.body.channel_id) : null;
      const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
      
      // Verify channel exists and user can post
      if (channelId) {
        const [channel] = await db.select()
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1);

        if (!channel) {
          return res.status(400).json({ error: "Channel does not exist" });
        }

        if (channel.is_private) {
          // Check if user is subscribed
          const [subscription] = await db.select()
            .from(channel_subscribers)
            .where(and(
              eq(channel_subscribers.channel_id, channelId),
              eq(channel_subscribers.user_id, req.user.id)
            ))
            .limit(1);

          if (!subscription) {
            return res.status(403).json({ error: "Must be subscribed to post" });
          }
        }
      }

      const [post] = await db.insert(posts)
        .values({
          user_id: req.user.id,
          username: req.user.username,
          title: req.body.title,
          audio_url: `/uploads/${req.file.filename}`,
          duration: parseInt(req.body.duration),
          channel_id: channelId,
          parent_id: parentId,
          flair: req.body.flair,
          tags: req.body.tags ? JSON.parse(req.body.tags) : [],
          likes: [],
          view_count: 0
        })
        .returning();

      await awardPoints(req.user.id, POINTS.CREATE_POST);

      res.json(post);
    } catch (error) {
      console.error('[API] Error creating post:', error);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  // Increment view count
  app.post("/api/posts/:postId/view", async (req, res) => {
    try {
      const postId = parseInt(req.params.postId);
      await db.execute(sql`
        UPDATE posts 
        SET view_count = view_count + 1 
        WHERE id = ${postId}
      `);
      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error incrementing view count:', error);
      res.status(500).json({ error: "Failed to increment view count" });
    }
  });

  // Pin/unpin post (moderators only)
  app.patch("/api/posts/:postId/pin", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const postId = parseInt(req.params.postId);
      const [post] = await db.select({
        id: posts.id,
        channel_id: posts.channel_id
      })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

      if (!post?.channel_id) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Check if user is channel moderator
      const [channel] = await db.select()
        .from(channels)
        .where(eq(channels.id, post.channel_id))
        .limit(1);

      if (!channel?.moderators?.includes(req.user.id)) {
        return res.status(403).json({ error: "Not a moderator" });
      }

      await db.update(posts)
        .set({ is_pinned: req.body.pinned })
        .where(eq(posts.id, postId));

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error updating pin status:', error);
      res.status(500).json({ error: "Failed to update pin status" });
    }
  });

  // Lock/unlock post (moderators only)
  app.patch("/api/posts/:postId/lock", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const postId = parseInt(req.params.postId);
      const [post] = await db.select({
        id: posts.id,
        channel_id: posts.channel_id
      })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);

      if (!post?.channel_id) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Check if user is channel moderator
      const [channel] = await db.select()
        .from(channels)
        .where(eq(channels.id, post.channel_id))
        .limit(1);

      if (!channel?.moderators?.includes(req.user.id)) {
        return res.status(403).json({ error: "Not a moderator" });
      }

      await db.update(posts)
        .set({ is_locked: req.body.locked })
        .where(eq(posts.id, postId));

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error updating lock status:', error);
      res.status(500).json({ error: "Failed to update lock status" });
    }
  });

  // Get all posts
  app.get("/api/posts", async (req, res) => {
    const startTime = Date.now();
    try {
      console.log(`[API] Fetching all posts`);
      const allPosts = await withTimeout(
        db.select()
          .from(posts)
          .orderBy(sql`posts.created_at DESC`)
          .limit(50)
      );
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allPosts.length} posts`, {
        queryDuration: duration,
        postsCount: allPosts.length,
        timestamp: new Date().toISOString()
      });
      res.json(allPosts);
    } catch (error) {
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        queryDuration: Date.now() - startTime
      };

      console.error('[API] Error fetching all posts:', errorDetails);

      const statusCode = error instanceof Error && error.message.includes('timed out')
        ? 504 // Gateway Timeout
        : 500; // Internal Server Error

      res.status(statusCode).json({ 
        error: "Failed to fetch all posts",
        details: errorDetails.error,
        timestamp: errorDetails.timestamp
      });
    }
  });

  // Get posts by flair
  app.get("/api/posts/flair/:flair", async (req, res) => {
    const startTime = Date.now();
    try {
      console.log(`[API] Fetching posts with flair: ${req.params.flair}`);
      const flair = req.params.flair;
      const allPosts = await withTimeout(
        db.select()
          .from(posts)
          .where(eq(posts.flair, flair))
          .orderBy(sql`posts.created_at DESC`)
          .limit(50)
      );
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allPosts.length} posts`, {
        queryDuration: duration,
        postsCount: allPosts.length,
        timestamp: new Date().toISOString()
      });
      res.json(allPosts);
    } catch (error) {
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        queryDuration: Date.now() - startTime
      };

      console.error('[API] Error fetching posts with flair:', errorDetails);

      const statusCode = error instanceof Error && error.message.includes('timed out')
        ? 504 // Gateway Timeout
        : 500; // Internal Server Error

      res.status(statusCode).json({ 
        error: "Failed to fetch posts with flair",
        details: errorDetails.error,
        timestamp: errorDetails.timestamp
      });
    }
  });

  // Get posts by tag
  app.get("/api/posts/tag/:tag", async (req, res) => {
    const startTime = Date.now();
    try {
      console.log(`[API] Fetching posts with tag: ${req.params.tag}`);
      const tag = req.params.tag;
      const allPosts = await withTimeout(
        db.select()
          .from(posts)
          .where(sql`posts.tags @> ARRAY[${tag}]`)
          .orderBy(sql`posts.created_at DESC`)
          .limit(50)
      );
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allPosts.length} posts`, {
        queryDuration: duration,
        postsCount: allPosts.length,
        timestamp: new Date().toISOString()
      });
      res.json(allPosts);
    } catch (error) {
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        queryDuration: Date.now() - startTime
      };

      console.error('[API] Error fetching posts with tag:', errorDetails);

      const statusCode = error instanceof Error && error.message.includes('timed out')
        ? 504 // Gateway Timeout
        : 500; // Internal Server Error

      res.status(statusCode).json({ 
        error: "Failed to fetch posts with tag",
        details: errorDetails.error,
        timestamp: errorDetails.timestamp
      });
    }
  });

  // Get posts by channel
  app.get("/api/channels/:channelId/posts", async (req, res) => {
    const startTime = Date.now();
    try {
      console.log(`[API] Fetching posts for channel: ${req.params.channelId}`);
      
      const channelId = parseInt(req.params.channelId);
      if (isNaN(channelId)) {
        console.warn('[API] Invalid channel ID provided:', req.params.channelId);
        return res.status(400).json({ 
          error: "Invalid channel ID",
          details: "Channel ID must be a number"
        });
      }

      // First check if channel exists using optimized query
      const [channel] = await withTimeout(
        db.select()
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1)
      );

      if (!channel) {
        console.warn('[API] Channel not found:', channelId);
        return res.status(404).json({ 
          error: "Channel not found",
          details: "The requested channel does not exist"
        });
      }

      // Optimize posts query with proper ordering and limit
      const channelPosts = await withTimeout(
        db.select()
          .from(posts)
          .where(eq(posts.channel_id, channelId))
          .orderBy(sql`posts.created_at DESC`)
          .limit(50)
      );

      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched posts for channel ${channelId}`, {
        channelName: channel.name,
        postsCount: channelPosts.length,
        queryDuration: duration,
        timestamp: new Date().toISOString()
      });

      res.json(channelPosts);
    } catch (error) {
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        channelId: req.params.channelId,
        timestamp: new Date().toISOString(),
        queryDuration: Date.now() - startTime
      };

      console.error('[API] Error fetching channel posts:', errorDetails);

      const statusCode = error instanceof Error && error.message.includes('timed out')
        ? 504 // Gateway Timeout
        : 500; // Internal Server Error

      res.status(statusCode).json({ 
        error: "Failed to fetch channel posts",
        details: errorDetails.error,
        timestamp: errorDetails.timestamp
      });
    }
  });

  // Create new post with improved channel handling
  app.post("/api/posts", upload.single('audio'), async (req: any, res) => {
    if (!req.user || !req.file) {
      console.warn('[API] Missing user or audio file in post creation');
      return res.status(400).json({ 
        error: "Missing user or audio file",
        details: "Both user authentication and audio file are required"
      });
    }

    try {
      const channelId = req.body.channel_id ? parseInt(req.body.channel_id) : null;
      const parentId = req.body.parent_id ? parseInt(req.body.parent_id) : null;
      
      console.log('[API] Creating new post:', {
        userId: req.user.id,
        username: req.user.username,
        channelId,
        parentId,
        fileName: req.file.filename,
        timestamp: new Date().toISOString()
      });

      // Verify channel exists if channelId is provided
      if (channelId) {
        const [channel] = await db
          .select()
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1);

        if (!channel) {
          console.warn('[API] Attempted to post to non-existent channel:', channelId);
          return res.status(400).json({
            error: "Invalid channel",
            details: "The specified channel does not exist"
          });
        }
      }

      // Verify parent post exists if this is a reply
      if (parentId) {
        const [parentPost] = await db
          .select()
          .from(posts)
          .where(eq(posts.id, parentId))
          .limit(1);

        if (!parentPost) {
          console.warn('[API] Attempted to reply to non-existent post:', parentId);
          return res.status(400).json({
            error: "Invalid parent post",
            details: "The post you're trying to reply to does not exist"
          });
        }
      }

      const [post] = await db
        .insert(posts)
        .values({
          user_id: req.user.id,
          username: req.user.username,
          audio_url: `/uploads/${req.file.filename}`,
          duration: parseInt(req.body.duration),
          channel_id: channelId,
          parent_id: parentId,
          likes: [],
        })
        .returning();

      // Award points for creating a post
      await awardPoints(req.user.id, POINTS.CREATE_POST);

      console.log('[API] Successfully created post:', {
        postId: post.id,
        channelId: post.channel_id,
        parentId: post.parent_id,
        userId: post.user_id,
        timestamp: new Date().toISOString()
      });

      res.json(post);
    } catch (error) {
      console.error('[API] Error creating post:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.user.id,
        channelId: req.body.channel_id,
        parentId: req.body.parent_id,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ 
        error: "Failed to create post",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Like/unlike post
  app.post("/api/posts/:postId/like", async (req: any, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const post = await db
        .select()
        .from(posts)
        .where(eq(posts.id, parseInt(req.params.postId)))
        .limit(1);

      if (!post.length) {
        return res.status(404).json({ error: "Post not found" });
      }

      const likes = post[0].likes || [];
      const userIndex = likes.indexOf(req.user.id);
      const postAuthorId = post[0].user_id;

      if (userIndex === -1) {
        likes.push(req.user.id);
        // Award points to the post author for receiving a like
        if (postAuthorId !== req.user.id) {  // Don't award points for self-likes
          await awardPoints(postAuthorId, POINTS.RECEIVE_LIKE);
        }
      } else {
        likes.splice(userIndex, 1);
        // Remove points if like is removed
        if (postAuthorId !== req.user.id) {  // Don't remove points for self-unlikes
          await awardPoints(postAuthorId, -POINTS.RECEIVE_LIKE);
        }
      }

      await db
        .update(posts)
        .set({ likes })
        .where(eq(posts.id, parseInt(req.params.postId)));

      res.json({ success: true });
    } catch (error) {
      console.error('[API] Error updating like:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.user.id,
        postId: req.params.postId,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ error: "Failed to update like" });
    }
  });

  // Add new route for fetching user posts
  app.get("/api/posts/user/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const userPosts = await db
        .select()
        .from(posts)
        .where(eq(posts.user_id, userId))
        .orderBy(sql`posts.created_at DESC`);

      res.json(userPosts);
    } catch (error) {
      console.error('[API] Error fetching user posts:', error);
      res.status(500).json({ error: "Failed to fetch user posts" });
    }
  });

  // Single route for fetching post replies
  app.get("/api/posts/:postId/replies", async (req, res) => {
    try {
      const postId = parseInt(req.params.postId);
      if (isNaN(postId)) {
        return res.status(400).json({ error: "Invalid post ID" });
      }

      const replies = await db
        .select()
        .from(posts)
        .where(eq(posts.parent_id, postId))
        .orderBy(sql`posts.created_at DESC`);

      res.json(replies);
    } catch (error) {
      console.error('[API] Error fetching post replies:', error);
      res.status(500).json({ error: "Failed to fetch replies" });
    }
  });

  // Guest preferences routes
  app.get("/api/guest-preferences", async (req, res) => {
    try {
      if (!req.session.guestUser) {
        return res.status(401).json({ 
          error: "Unauthorized",
          details: "Only guest users can access preferences"
        });
      }

      const [preferences] = await db
        .select()
        .from(guest_preferences)
        .where(eq(guest_preferences.session_id, req.sessionID))
        .limit(1);

      res.json(preferences?.preferences || {});
    } catch (error) {
      console.error('[API] Error fetching guest preferences:', error);
      res.status(500).json({ 
        error: "Failed to fetch guest preferences",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/guest-preferences", async (req, res) => {
    try {
      if (!req.session.guestUser) {
        return res.status(401).json({ 
          error: "Unauthorized",
          details: "Only guest users can update preferences"
        });
      }

      const [existingPrefs] = await db
        .select()
        .from(guest_preferences)
        .where(eq(guest_preferences.session_id, req.sessionID))
        .limit(1);

      if (existingPrefs) {
        await db
          .update(guest_preferences)
          .set({ 
            preferences: req.body,
            updated_at: new Date()
          })
          .where(eq(guest_preferences.session_id, req.sessionID));
      } else {
        await db
          .insert(guest_preferences)
          .values({
            session_id: req.sessionID,
            preferences: req.body,
          });
      }

      res.json({ success: true, preferences: req.body });
    } catch (error) {
      console.error('[API] Error updating guest preferences:', error);
      res.status(500).json({ 
        error: "Failed to update guest preferences",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get trending channels
  app.get("/api/channels/trending", async (_req, res) => {
    try {
      const trendingChannels = await db.select({
        ...channels,
        subscriber_count: sql`(SELECT COUNT(*) FROM ${channel_subscribers} WHERE channel_id = ${channels.id})`
      })
      .from(channels)
      .orderBy(sql`weekly_activity DESC`)
      .limit(10);

      res.json(trendingChannels);
    } catch (error) {
      console.error('[API] Error fetching trending channels:', error);
      res.status(500).json({ error: "Failed to fetch trending channels" });
    }
  });

  // Get channel recommendations based on user's interests
  app.get("/api/channels/recommended", async (req: any, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get user's subscribed channels
      const userSubscriptions = await db.select({
        channel_id: channel_subscribers.channel_id
      })
      .from(channel_subscribers)
      .where(eq(channel_subscribers.user_id, req.user.id));

      const subscribedIds = userSubscriptions.map(sub => sub.channel_id);

      // Get categories from user's subscribed channels
      const userCategories = await db.select({
        categories: channels.categories
      })
      .from(channels)
      .where(sql`id = ANY(${subscribedIds})`);

      const flatCategories = userCategories
        .flatMap(channel => channel.categories || [])
        .filter((category, index, self) => self.indexOf(category) === index);

      // Get recommended channels based on categories and exclude already subscribed ones
      const recommendedChannels = await db.select({
        ...channels,
        subscriber_count: sql`(SELECT COUNT(*) FROM ${channel_subscribers} WHERE channel_id = ${channels.id})`
      })
      .from(channels)
      .where(
        and(
          sql`categories && ${flatCategories}`,
          sql`id != ALL(${subscribedIds})`,
          eq(channels.is_private, false)
        )
      )
      .orderBy(sql`weekly_activity DESC`)
      .limit(10);

      res.json(recommendedChannels);
    } catch (error) {
      console.error('[API] Error fetching recommended channels:', error);
      res.status(500).json({ error: "Failed to fetch recommended channels" });
    }
  });

  // Get channels by category
  app.get("/api/channels/category/:category", async (req, res) => {
    try {
      const category = req.params.category;
      
      const categoryChannels = await db.select({
        ...channels,
        subscriber_count: sql`(SELECT COUNT(*) FROM ${channel_subscribers} WHERE channel_id = ${channels.id})`
      })
      .from(channels)
      .where(sql`${category} = ANY(categories)`)
      .orderBy(sql`subscriber_count DESC`)
      .limit(20);

      res.json(categoryChannels);
    } catch (error) {
      console.error('[API] Error fetching channels by category:', error);
      res.status(500).json({ error: "Failed to fetch channels by category" });
    }
  });

}