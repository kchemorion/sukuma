import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { setupAuth } from "./auth";
import session from "express-session";
import { Pool } from 'pg';
import connectPg from 'connect-pg-simple';
import passport from "passport";
import path from "path";
import fs from "fs";

console.log('[Server] Starting...');

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Environment configuration
const isProduction = process.env.NODE_ENV === "production";
const domain = isProduction 
  ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
  : 'localhost:5000';

// Configure PostgreSQL session store with proper error handling
const PostgresqlStore = connectPg(session);
const sessionPool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Verify database connection and initialize app
(async () => {
  try {
    console.log('[Server] Verifying database connection...');
    await sessionPool.query('SELECT NOW()');
    console.log('[Database] Connection verified');

    const app = express();
    const server = createServer(app);

    // Configure trust proxy for secure cookies
    app.set('trust proxy', 1);

    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // CORS configuration with proper credentials handling
    const corsOptions = {
      origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || !isProduction) {
          callback(null, true);
          return;
        }

        const allowedOrigins = [
          `https://${domain}`,
          `http://${domain}`,
          `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`,
          'https://replit.com'
        ];

        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn('[CORS] Blocked request from:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
      exposedHeaders: ['Set-Cookie'],
      maxAge: 86400 // 24 hours
    };

    // Apply CORS before session middleware
    app.use(cors(corsOptions));

    // Session store configuration with proper error handling
    const sessionStore = new PostgresqlStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 60,
      errorLog: (err) => {
        console.error('[Session Store] Error:', err);
      }
    });

    // Session middleware configuration
    const sessionMiddleware = session({
      store: sessionStore,
      secret: process.env.REPL_ID || "your-secret-key",
      name: 'sukuma.sid',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: "/"
      }
    });

    // Apply session and authentication middleware
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    // Debug middleware for session and authentication issues
    app.use((req, _res, next) => {
      if (req.url !== '/health') {
        console.debug('[Session Debug]', {
          url: req.url,
          method: req.method,
          sessionID: req.sessionID,
          authenticated: req.isAuthenticated(),
          session: req.session,
          cookies: req.headers.cookie,
          origin: req.headers.origin
        });
      }
      next();
    });

    // Initialize routes
    setupAuth(app);
    registerRoutes(app);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        session: {
          id: req.sessionID,
          active: !!req.session,
          authenticated: req.isAuthenticated()
        }
      });
    });

    // Error handling middleware
    app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      console.error('[Server Error]', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        sessionID: req.sessionID,
        authenticated: req.isAuthenticated()
      });

      res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });

    if (!isProduction) {
      await setupVite(app, server);
      console.log('[Vite] Development server initialized');
    } else {
      serveStatic(app);
      console.log('[Static] Production assets configured');
    }

    const PORT = Number(process.env.PORT) || 5000;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('[Server] Startup error:', error);
    process.exit(1);
  }
})();
