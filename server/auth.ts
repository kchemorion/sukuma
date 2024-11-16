import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type User as SelectUser, guest_preferences } from "db/schema";
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
    interface Session {
      guestUser?: {
        id: number;
        username: string;
        points: number;
        isGuest: boolean;
        guestId: string;
      };
    }
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

  app.post("/guest-login", async (req, res) => {
    console.log('[Auth] Guest login initiated');
    
    try {
      const existingGuestId = req.headers['x-guest-id'];
      let guestUsername: string;
      let guestId: string;
      
      // Improved guest session validation
      if (existingGuestId && typeof existingGuestId === 'string') {
        // Check for existing guest preferences using guest ID
        const [existingPrefs] = await db
          .select()
          .from(guest_preferences)
          .where(eq(guest_preferences.guest_id, existingGuestId))
          .limit(1);

        if (existingPrefs && existingPrefs.session_id) {
          // Validate session is still active
          if (existingPrefs.session_id === req.sessionID) {
            guestUsername = existingPrefs.guest_username;
            guestId = existingGuestId;
            console.log('[Auth] Found existing guest preferences:', { 
              guestId,
              username: guestUsername
            });
          } else {
            // Session mismatch - create new guest session
            guestId = Math.random().toString(36).substring(2, 15);
            guestUsername = `Guest_${guestId}`;
            console.log('[Auth] Session expired, creating new guest:', {
              guestId,
              username: guestUsername
            });
          }
        } else {
          // Generate new guest ID and username if existing ID not found
          guestId = Math.random().toString(36).substring(2, 15);
          guestUsername = `Guest_${guestId}`;
          console.log('[Auth] Existing guest ID not found, creating new:', {
            guestId,
            username: guestUsername
          });
        }
      } else {
        // Generate new guest ID and username
        guestId = Math.random().toString(36).substring(2, 15);
        guestUsername = `Guest_${guestId}`;
        console.log('[Auth] Creating new guest account:', {
          guestId,
          username: guestUsername
        });
      }

      // Create or update guest preferences with improved error handling
      try {
        await db.insert(guest_preferences)
          .values({
            guest_id: guestId,
            session_id: req.sessionID,
            guest_username: guestUsername,
            preferences: {},
            updated_at: new Date()
          })
          .onConflictDoUpdate({
            target: guest_preferences.guest_id,
            set: {
              session_id: req.sessionID,
              updated_at: new Date()
            }
          });
      } catch (dbError) {
        console.error('[Auth] Database error creating guest preferences:', dbError);
        throw new Error('Failed to create guest preferences');
      }

      const guestUser = {
        id: 0,
        username: guestUsername,
        points: 0,
        isGuest: true,
        guestId
      };

      // Set up guest session with proper error handling
      req.session.guestUser = guestUser;
      
      try {
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (sessionError) {
        console.error('[Auth] Session save error:', sessionError);
        throw new Error('Failed to save guest session');
      }

      console.log('[Auth] Guest login successful:', { 
        guestId,
        username: guestUsername,
        sessionID: req.sessionID 
      });
      
      res.json({
        message: "Guest login successful",
        user: guestUser,
        guestId
      });
    } catch (error) {
      console.error('[Auth] Guest login error:', error);
      res.status(500).json({ 
        error: "Failed to create guest session",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
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

  app.post("/logout", async (req, res) => {
    const sessionID = req.sessionID;
    const isGuest = !!req.session.guestUser;
    const guestId = req.session.guestUser?.guestId;
    
    console.log('[Auth] Logout initiated:', { 
      userId: req.user?.id || req.session.guestUser?.username,
      sessionID,
      isGuest,
      guestId 
    });

    try {
      // Handle guest session cleanup
      if (isGuest && guestId) {
        try {
          // Clean up guest preferences
          await db.delete(guest_preferences)
            .where(eq(guest_preferences.guest_id, guestId))
            .where(eq(guest_preferences.session_id, sessionID));
          
          console.log('[Auth] Cleaned up guest preferences:', { guestId, sessionID });
        } catch (error) {
          console.error('[Auth] Error cleaning guest preferences:', error);
          // Continue with logout even if preference cleanup fails
        }
        delete req.session.guestUser;
      }

      // Handle regular session cleanup
      if (req.isAuthenticated()) {
        await new Promise<void>((resolve, reject) => {
          req.logout((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // Destroy session with proper error handling
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log('[Auth] Logout successful:', { 
        sessionID,
        isGuest,
        guestId
      });

      res.clearCookie('sukuma.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax'
      });
      
      res.json({ 
        message: "Logout successful",
        success: true,
        wasGuest: isGuest
      });
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      res.status(500).json({ 
        message: "Logout failed", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/user", async (req, res) => {
    console.log('[Auth] User info request:', { 
      authenticated: req.isAuthenticated(),
      sessionID: req.sessionID,
      user: req.user ? { id: req.user.id, username: req.user.username } : 'guest'
    });

    try {
      // Check for guest session first
      if (req.session.guestUser) {
        // Verify guest preferences still exist
        const [prefs] = await db
          .select()
          .from(guest_preferences)
          .where(eq(guest_preferences.session_id, req.sessionID))
          .limit(1);

        if (prefs) {
          return res.json(req.session.guestUser);
        } else {
          // Clear invalid guest session
          delete req.session.guestUser;
        }
      }

      if (!req.isAuthenticated() || !req.user) {
        // Return default guest user object for unauthenticated users
        return res.json({
          id: 0,
          username: 'Guest',
          points: 0,
          isGuest: true,
          guestId: ''
        });
      }

      // Ensure session is properly saved and extended
      req.session.touch();
      await req.session.save();

      const { id, username, points } = req.user;
      res.json({ id, username, points, isGuest: false });
    } catch (error) {
      console.error('[Auth] Error fetching user info:', error);
      res.status(500).json({ 
        error: "Failed to fetch user info",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/guest-preferences", async (req, res) => {
    try {
      const guestId = req.headers['x-guest-id'];
      
      if (!req.session.guestUser?.guestId || !guestId) {
        return res.status(401).json({ 
          error: "Unauthorized",
          details: "Missing guest session"
        });
      }

      if (req.session.guestUser.guestId !== guestId) {
        return res.status(401).json({ 
          error: "Unauthorized",
          details: "Invalid guest session"
        });
      }

      const [preferences] = await db
        .select()
        .from(guest_preferences)
        .where(eq(guest_preferences.guest_id, guestId as string))
        .limit(1);

      if (!preferences) {
        return res.status(404).json({
          error: "Not Found",
          details: "Guest preferences not found"
        });
      }

      // Verify session is still valid
      if (preferences.session_id !== req.sessionID) {
        return res.status(401).json({
          error: "Unauthorized",
          details: "Session expired"
        });
      }

      res.json(preferences.preferences || {});
    } catch (error) {
      console.error('[Auth] Error fetching guest preferences:', error);
      res.status(500).json({ 
        error: "Failed to fetch guest preferences",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/guest-preferences", async (req, res) => {
    try {
      const guestId = req.headers['x-guest-id'];
      
      if (!req.session.guestUser?.guestId || !guestId || req.session.guestUser.guestId !== guestId) {
        return res.status(401).json({ 
          error: "Unauthorized",
          details: "Invalid guest session"
        });
      }

      await db.update(guest_preferences)
        .set({ 
          preferences: req.body,
          updated_at: new Date()
        })
        .where(eq(guest_preferences.guest_id, guestId as string));

      res.json({ 
        success: true, 
        preferences: req.body 
      });
    } catch (error) {
      console.error('[Auth] Error updating guest preferences:', error);
      res.status(500).json({ 
        error: "Failed to update guest preferences",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}