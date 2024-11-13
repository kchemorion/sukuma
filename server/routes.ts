import express, { type Express } from "express";
import { setupAuth } from "./auth";
import multer from "multer";
import { db } from "db";
import { posts, channels } from "db/schema";
import { eq } from "drizzle-orm";
import path from "path";

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

export function registerRoutes(app: Express) {
  setupAuth(app);

  // Serve uploaded files
  app.use('/uploads', express.static('uploads'));

  // Channel routes
  app.get("/api/channels", async (req, res) => {
    const startTime = Date.now();
    console.log('[API] Starting channels fetch request');
    
    try {
      const allChannels = await db
        .select()
        .from(channels)
        .orderBy(channels.created_at);
      
      const duration = Date.now() - startTime;
      console.log(`[API] Successfully fetched ${allChannels.length} channels in ${duration}ms`);
      
      res.json(allChannels);
    } catch (error) {
      console.error('[API] Error fetching channels:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });

      // Send a more detailed error response
      res.status(500).json({ 
        error: "Failed to fetch channels",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
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
    try {
      console.log(`[API] Fetching posts for channel: ${req.params.channelId}`);
      
      const channelId = parseInt(req.params.channelId);
      if (isNaN(channelId)) {
        return res.status(400).json({ 
          error: "Invalid channel ID",
          details: "Channel ID must be a number"
        });
      }

      // First check if channel exists
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        return res.status(404).json({ 
          error: "Channel not found",
          details: "The requested channel does not exist"
        });
      }

      const channelPosts = await db
        .select()
        .from(posts)
        .where(eq(posts.channel_id, channelId))
        .orderBy(posts.created_at);

      console.log(`[API] Successfully fetched ${channelPosts.length} posts for channel ${channelId}`);
      res.json(channelPosts);
    } catch (error) {
      console.error('[API] Error fetching channel posts:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ 
        error: "Failed to fetch channel posts",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Get all posts
  app.get("/api/posts", async (req, res) => {
    try {
      const allPosts = await db.select().from(posts).orderBy(posts.created_at);
      res.json(allPosts);
    } catch (error) {
      console.error('[API] Error fetching posts:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ 
        error: "Failed to fetch posts",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Get user's posts
  app.get("/api/posts/user/:userId", async (req, res) => {
    try {
      const userPosts = await db
        .select()
        .from(posts)
        .where(eq(posts.user_id, parseInt(req.params.userId)))
        .orderBy(posts.created_at);
      res.json(userPosts);
    } catch (error) {
      console.error('[API] Error fetching user posts:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.params.userId,
        timestamp: new Date().toISOString()
      });
      res.status(500).json({ 
        error: "Failed to fetch user posts",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Create new post
  app.post("/api/posts", upload.single('audio'), async (req: any, res) => {
    if (!req.user || !req.file) {
      return res.status(400).json({ error: "Missing user or audio file" });
    }

    try {
      const [post] = await db
        .insert(posts)
        .values({
          user_id: req.user.id,
          username: req.user.username,
          audio_url: `/uploads/${req.file.filename}`,
          duration: parseInt(req.body.duration),
          channel_id: req.body.channelId ? parseInt(req.body.channelId) : null,
          likes: [],
          replies: [],
        })
        .returning();

      res.json(post);
    } catch (error) {
      console.error('[API] Error creating post:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.user.id,
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

      if (userIndex === -1) {
        likes.push(req.user.id);
      } else {
        likes.splice(userIndex, 1);
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
}