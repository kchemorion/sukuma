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

  // Guest login with enhanced error handling
  app.post("/guest-login", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    console.log('[Auth] Guest login initiated');
    
    try {
      const existingGuestId = req.headers['x-guest-id'];
      let guestUsername: string;
      let guestId: string;
      
      if (existingGuestId && typeof existingGuestId === 'string') {
        const [existingPrefs] = await db
          .select()
          .from(guest_preferences)
          .where(eq(guest_preferences.guest_id, existingGuestId))
          .limit(1);

        if (existingPrefs?.session_id === req.sessionID) {
          guestUsername = existingPrefs.guest_username;
          guestId = existingGuestId;
          console.log('[Auth] Reusing existing guest session:', { guestId, username: guestUsername });
        } else {
          guestId = Math.random().toString(36).substring(2, 15);
          guestUsername = `Guest_${guestId}`;
          console.log('[Auth] Creating new guest session:', { guestId, username: guestUsername });
        }
      } else {
        guestId = Math.random().toString(36).substring(2, 15);
        guestUsername = `Guest_${guestId}`;
        console.log('[Auth] Creating new guest session:', { guestId, username: guestUsername });
      }

      // Update or create guest preferences with proper error handling
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
        console.error('[Auth] Database error during guest preferences update:', dbError);
        throw new Error('Failed to create guest session');
      }

      const guestUser = {
        id: 0,
        username: guestUsername,
        points: 0,
        isGuest: true,
        guestId
      };

      if (!req.session) {
        throw new Error('Session not initialized');
      }

      req.session.guestUser = guestUser;
      req.session.lastActivity = Date.now();

      // Save session with proper error handling
      await new Promise<void>((resolve, reject) => {
        if (!req.session) {
          reject(new Error('Session not initialized'));
          return;
        }
        req.session.save((err) => {
          if (err) {
            console.error('[Auth] Session save error:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });

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
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Enhanced logout with proper cleanup
  app.post("/logout", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    if (!req.session) {
      console.warn('[Auth] No session found during logout');
      return res.status(400).json({ 
        error: "No session found",
        timestamp: new Date().toISOString()
      });
    }

    const sessionID = req.sessionID;
    const isGuest = !!req.session.guestUser;
    const guestId = req.session.guestUser?.guestId;
    
    console.log('[Auth] Logout initiated:', { 
      sessionID,
      isGuest,
      guestId,
      timestamp: new Date().toISOString()
    });

    try {
      // Step 1: Handle guest cleanup if needed
      if (isGuest && guestId) {
        try {
          // Delete guest preferences
          await db.delete(guest_preferences)
            .where(eq(guest_preferences.guest_id, guestId));
          
          console.log('[Auth] Cleaned up guest preferences:', { 
            guestId, 
            sessionID,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('[Auth] Error cleaning guest preferences:', error);
          // Continue with logout even if guest cleanup fails
        }
      }

      // Step 2: Handle passport logout if authenticated
      if (req.isAuthenticated()) {
        await new Promise<void>((resolve, reject) => {
          req.logout((err) => {
            if (err) {
              console.error('[Auth] Passport logout error:', err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }

      // Step 3: Clear session data
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            console.error('[Auth] Session destruction error:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // Step 4: Clear session cookie
      const domain = req.hostname.includes('localhost') ? undefined : 
                    req.hostname.includes('.repl.co') ? '.repl.co' : 
                    req.hostname;

      res.clearCookie('sukuma.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" || !!process.env.REPL_ID,
        sameSite: (process.env.NODE_ENV === "production" || !!process.env.REPL_ID) ? 'none' : 'lax',
        domain
      });

      console.log('[Auth] Logout successful:', {
        sessionID,
        isGuest,
        guestId,
        timestamp: new Date().toISOString()
      });

      res.json({ 
        message: "Logout successful",
        success: true,
        wasGuest: isGuest,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      
      // Force cleanup on error
      try {
        if (req.session) {
          req.session.destroy(() => {});
        }
      } catch (cleanupError) {
        console.error('[Auth] Force cleanup error:', cleanupError);
      }

      res.status(500).json({ 
        error: "Logout failed",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Registration with enhanced validation
  app.post("/register", async (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    
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

  // Login with enhanced error handling
  app.post("/login", (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
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

  // User info endpoint with enhanced session handling
  app.get("/api/user", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    console.log('[Auth] User info request:', { 
      authenticated: req.isAuthenticated(),
      sessionID: req.sessionID,
      user: req.user ? { id: req.user.id, username: req.user.username } : 'guest'
    });

    try {
      if (!req.session) {
        throw new Error('Session not initialized');
      }

      // Check for guest session first
      if (req.session.guestUser) {
        const [prefs] = await db
          .select()
          .from(guest_preferences)
          .where(eq(guest_preferences.guest_id, req.session.guestUser.guestId))
          .limit(1);

        if (prefs && prefs.session_id === req.sessionID) {
          return res.json(req.session.guestUser);
        } else {
          // Clear invalid guest session
          delete req.session.guestUser;
          await req.session.save();
        }
      }

      if (!req.isAuthenticated() || !req.user) {
        return res.json({
          id: 0,
          username: 'Guest',
          points: 0,
          isGuest: true,
          guestId: ''
        });
      }

      // Ensure session is properly saved
      req.session.touch();
      await req.session.save();

      const { id, username, points } = req.user;
      res.json({ id, username, points, isGuest: false });
    } catch (error) {
      console.error('[Auth] Error fetching user info:', error);
      res.status(500).json({ 
        error: "Failed to fetch user info",
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });
}