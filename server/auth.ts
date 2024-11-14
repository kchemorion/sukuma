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
        console.log('[Auth] Attempting authentication for user:', username);
        
        if (!username || !password) {
          console.warn('[Auth] Missing credentials');
          return done(null, false, { message: "Missing credentials" });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          console.warn('[Auth] User not found:', username);
          return done(null, false, { message: "Invalid credentials" });
        }

        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          console.warn('[Auth] Invalid password for user:', username);
          return done(null, false, { message: "Invalid credentials" });
        }

        console.log('[Auth] Authentication successful for user:', username);
        return done(null, user);
      } catch (err) {
        console.error('[Auth] Authentication error:', err);
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
        console.warn('[Auth] User not found during deserialization:', id);
        return done(null, false);
      }

      return done(null, user);
    } catch (err) {
      console.error('[Auth] Deserialization error:', err);
      return done(err);
    }
  });

  app.post("/register", async (req, res, next) => {
    try {
      console.log('[Auth] Registration attempt:', { username: req.body.username });
      
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        console.warn('[Auth] Invalid registration input:', result.error.flatten());
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
        console.warn('[Auth] Username already exists:', username);
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await crypto.hash(password);
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          points: 0,
        })
        .returning();

      req.login(newUser, (err) => {
        if (err) {
          console.error('[Auth] Login error after registration:', err);
          return next(err);
        }
        
        req.session.regenerate((err) => {
          if (err) {
            console.error('[Auth] Session regeneration error:', err);
            return next(err);
          }
          
          req.session.save((err) => {
            if (err) {
              console.error('[Auth] Session save error:', err);
              return next(err);
            }
            
            console.log('[Auth] Registration and login successful:', { userId: newUser.id });
            res.json({
              message: "Registration successful",
              user: { id: newUser.id, username: newUser.username },
            });
          });
        });
      });
    } catch (error) {
      console.error('[Auth] Registration error:', error);
      next(error);
    }
  });

  app.post("/login", (req, res, next) => {
    console.log('[Auth] Login attempt:', { username: req.body.username });
    
    if (!req.body.username || !req.body.password) {
      console.warn('[Auth] Missing login credentials');
      return res.status(400).json({ message: "Missing credentials" });
    }

    passport.authenticate("local", (err: any, user: Express.User, info: IVerifyOptions) => {
      if (err) {
        console.error('[Auth] Authentication error:', err);
        return next(err);
      }
      
      if (!user) {
        console.warn('[Auth] Authentication failed:', info.message);
        return res.status(401).json({ message: info.message ?? "Authentication failed" });
      }

      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Login error:', err);
          return next(err);
        }

        req.session.regenerate((err) => {
          if (err) {
            console.error('[Auth] Session regeneration error:', err);
            return next(err);
          }

          req.session.save((err) => {
            if (err) {
              console.error('[Auth] Session save error:', err);
              return next(err);
            }

            console.log('[Auth] Login successful:', { 
              userId: user.id,
              sessionID: req.sessionID
            });
            
            res.json({
              message: "Login successful",
              user: {
                id: user.id,
                username: user.username,
                points: user.points
              }
            });
          });
        });
      });
    })(req, res, next);
  });

  app.post("/logout", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not logged in" });
    }
    
    const sessionID = req.sessionID;
    console.log('[Auth] Logout initiated:', { 
      userId: req.user?.id,
      sessionID 
    });

    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return res.status(500).json({ message: "Logout failed" });
      }
      
      req.session.destroy((err) => {
        if (err) {
          console.error('[Auth] Session destruction error:', err);
          return res.status(500).json({ message: "Error clearing session" });
        }

        console.log('[Auth] Logout successful:', { sessionID });
        res.clearCookie('sukuma.sid', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax'
        });
        res.json({ message: "Logout successful" });
      });
    });
  });

  app.get("/api/user", (req, res) => {
    console.log('[Auth] User info request:', { 
      authenticated: req.isAuthenticated(),
      sessionID: req.sessionID,
      user: req.user ? { id: req.user.id, username: req.user.username } : null
    });
    
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Ensure session is properly saved and extended
    req.session.touch();
    req.session.save((err) => {
      if (err) {
        console.error('[Auth] Session save error:', err);
        return res.status(500).json({ message: "Session error" });
      }

      const { id, username, points } = req.user;
      res.json({ id, username, points });
    });
  });
}
