import express, { type Express } from "express";
import { setupAuth } from "./auth";
import multer from "multer";
import { db } from "db";
import { posts } from "db/schema";
import { eq } from "drizzle-orm";
import path from "path";

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

export function registerRoutes(app: Express) {
  setupAuth(app);

  // Serve uploaded files
  app.use('/uploads', express.static('uploads'));

  // Get all posts
  app.get("/api/posts", async (req, res) => {
    try {
      const allPosts = await db.select().from(posts).orderBy(posts.createdAt);
      res.json(allPosts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  });

  // Get user's posts
  app.get("/api/posts/user/:userId", async (req, res) => {
    try {
      const userPosts = await db
        .select()
        .from(posts)
        .where(eq(posts.userId, parseInt(req.params.userId)))
        .orderBy(posts.createdAt);
      res.json(userPosts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user posts" });
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
          userId: req.user.id,
          username: req.user.username,
          audioUrl: `/uploads/${req.file.filename}`,
          duration: parseInt(req.body.duration),
          likes: [],
          replies: [],
        })
        .returning();

      res.json(post);
    } catch (error) {
      res.status(500).json({ error: "Failed to create post" });
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
      res.status(500).json({ error: "Failed to update like" });
    }
  });
}
