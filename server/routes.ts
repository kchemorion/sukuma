import express, { type Express } from "express";
import { setupAuth } from "./auth";
import multer from "multer";
import { db } from "db";
import { posts, channels } from "db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import { sql } from "drizzle-orm";
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
      // Optimize query with proper ordering and limit
      const allChannels = await withTimeout(
        db.select()
          .from(channels)
          .orderBy(sql`channels.created_at DESC`)
          .limit(100)
      );
      
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allChannels.length} channels in ${duration}ms`, {
        queryDuration: duration,
        channelCount: allChannels.length,
        timestamp: new Date().toISOString()
      });
      
      res.json(allChannels);
    } catch (error) {
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        queryDuration: Date.now() - startTime
      };

      console.error('[API] Error fetching channels:', errorDetails);

      const statusCode = error instanceof Error && error.message.includes('timed out') 
        ? 504 // Gateway Timeout
        : 500; // Internal Server Error

      res.status(statusCode).json({ 
        error: "Failed to fetch channels",
        details: errorDetails.error,
        timestamp: errorDetails.timestamp
      });
    }
  });

  app.post("/api/channels", async (req: any, res) => {
    if (!req.user) {
      console.warn('[API] Unauthorized attempt to create channel');
      return res.status(401).json({ 
        error: "Unauthorized",
        details: "You must be logged in to create a channel"
      });
    }

    try {
      console.log('[API] Creating new channel:', {
        name: req.body.name,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      });
      
      if (!req.body.name || !req.body.description) {
        return res.status(400).json({ 
          error: "Missing required fields",
          details: "Name and description are required"
        });
      }

      const [channel] = await db
        .insert(channels)
        .values({
          name: req.body.name,
          description: req.body.description,
          created_by: req.user.id,
        })
        .returning();

      // Award points for creating a channel
      await awardPoints(req.user.id, POINTS.CREATE_CHANNEL);

      console.log('[API] Successfully created channel:', {
        channelId: channel.id,
        name: channel.name,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      });
      
      res.json(channel);
    } catch (error) {
      console.error('[API] Error creating channel:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestBody: req.body,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      });
      
      if (error instanceof Error && error.message.includes('unique constraint')) {
        return res.status(400).json({ 
          error: "Channel name already exists",
          details: "Please choose a different name"
        });
      }

      res.status(500).json({ 
        error: "Failed to create channel",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

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
}