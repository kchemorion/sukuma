import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type User as SelectUser } from "db/schema";
import { db } from "db";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      suppliedPassword,
      salt,
      64
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

export function setupAuth(app: Express) {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log('[Auth] Attempting login for user:', username);
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          console.log('[Auth] User not found:', username);
          return done(null, false, { message: "Incorrect username." });
        }

        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          console.log('[Auth] Invalid password for user:', username);
          return done(null, false, { message: "Incorrect password." });
        }

        console.log('[Auth] Login successful for user:', username);
        return done(null, user);
      } catch (err) {
        console.error('[Auth] Error during authentication:', err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    console.log('[Auth] Serializing user:', user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log('[Auth] Deserializing user:', id);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        console.log('[Auth] User not found during deserialization:', id);
        return done(null, false);
      }

      console.log('[Auth] User deserialized successfully:', id);
      done(null, user);
    } catch (err) {
      console.error('[Auth] Error during deserialization:', err);
      done(err);
    }
  });

  app.post("/register", async (req, res, next) => {
    try {
      console.log('[Auth] Registration attempt:', req.body.username);
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        console.log('[Auth] Invalid registration input:', result.error.flatten());
        return res
          .status(400)
          .json({ message: "Invalid input", errors: result.error.flatten() });
      }

      const { username, password } = result.data;

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        console.log('[Auth] Username already exists:', username);
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await crypto.hash(password);
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
        })
        .returning();

      console.log('[Auth] User registered successfully:', username);

      req.login(newUser, (err) => {
        if (err) {
          console.error('[Auth] Error logging in after registration:', err);
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username },
        });
      });
    } catch (error) {
      console.error('[Auth] Registration error:', error);
      next(error);
    }
  });

  app.post("/login", (req, res, next) => {
    console.log('[Auth] Login attempt:', req.body.username);
    passport.authenticate("local", (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        console.error('[Auth] Login error:', err);
        return next(err);
      }
      if (!user) {
        console.log('[Auth] Login failed:', info.message);
        return res.status(400).json({
          message: info.message ?? "Login failed",
        });
      }
      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Error during login:', err);
          return next(err);
        }
        console.log('[Auth] Login successful:', user.username);
        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username },
        });
      });
    })(req, res, next);
  });

  app.post("/logout", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const username = req.user?.username;
    console.log('[Auth] Logout attempt:', username);

    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return res.status(500).json({ message: "Logout failed" });
      }
      
      req.session.destroy((err) => {
        if (err) {
          console.error('[Auth] Error destroying session:', err);
          return res.status(500).json({ message: "Error clearing session" });
        }
        res.clearCookie('connect.sid', { path: '/' });
        console.log('[Auth] Logout successful:', username);
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      console.log('[Auth] Unauthorized access attempt');
      return res.status(401).json({ message: "Unauthorized" });
    }
    console.log('[Auth] User authenticated:', req.user.username);
    return res.json(req.user);
  });
}
