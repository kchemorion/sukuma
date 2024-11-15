import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { setupAuth } from "./auth";
import session from "express-session";
import pkg from 'pg';
const { Pool } = pkg;
import connectPg from 'connect-pg-simple';
import passport from "passport";
import path from "path";
import fs from "fs";

console.log('[Server] Starting with process ID:', process.pid);

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('[Server] Created uploads directory');
}

// Environment configuration with better validation
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const isProduction = process.env.NODE_ENV === "production";
const domain = isProduction 
  ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
  : 'localhost:5000';

// Configure PostgreSQL session store with enhanced connection handling
const PostgresqlStore = connectPg(session);
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  statement_timeout: 30000,
  query_timeout: 30000
});

// Enhanced connection pool error handling
sessionPool.on('error', (err) => {
  console.error('[Database] Pool error:', err);
});

sessionPool.on('connect', () => {
  console.log('[Database] New client connected');
});

// Verify database connection and initialize app
(async () => {
  try {
    console.log('[Server] Verifying database connection...');
    await sessionPool.query('SELECT NOW()');
    console.log('[Database] Connection verified successfully');

    const app = express();
    const server = createServer(app);

    // Configure trust proxy for secure cookies
    app.set('trust proxy', 1);

    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Enhanced CORS configuration
    const corsOptions = {
      origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        if (!origin) {
          callback(null, true);
          return;
        }

        const allowedOrigins = [
          `https://${domain}`,
          `http://${domain}`,
          'http://localhost:5000',
          'http://localhost:3000',
          `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        ];

        if (allowedOrigins.includes(origin) || !isProduction) {
          callback(null, true);
        } else {
          console.warn('[CORS] Blocked request from:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-Guest-Id'],
      exposedHeaders: ['Set-Cookie'],
      maxAge: 86400
    };

    app.use(cors(corsOptions));

    // Create session table if it doesn't exist
    await sessionPool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Enhanced session store configuration with improved error handling
    const sessionStore = new PostgresqlStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
      errorLog: (error: Error) => {
        console.error('[Session Store Error]', error);
      }
    });

    // Verify session store
    sessionStore.on('error', (error: Error) => {
      console.error('[Session Store] Connection error:', error);
    });

    // Enhanced session middleware configuration with proper cookie settings
    const sessionMiddleware = session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET!,
      name: 'sukuma.sid',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
        domain: isProduction ? `.${process.env.REPL_OWNER}.repl.co` : undefined
      }
    });

    // API middleware to ensure JSON responses
    app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Type', 'application/json');
      next();
    });

    // Session and passport middleware
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    // Enhanced session monitoring middleware
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (!req.session) {
        console.error('[Session] No session found for request:', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          headers: req.headers
        });
        return next(new Error('Session unavailable'));
      }
      next();
    });

    // Initialize routes
    setupAuth(app);
    registerRoutes(app);

    // API error handler to ensure JSON responses
    app.use('/api', (err: Error, _req: Request, res: Response, next: NextFunction) => {
      console.error('[API Error]', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
      });
    });

    // Health check endpoint with enhanced diagnostics
    app.get('/health', async (_req, res) => {
      try {
        await sessionPool.query('SELECT NOW()');
        res.json({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development',
          database: {
            connected: true,
            totalConnections: sessionPool.totalCount,
            idleConnections: sessionPool.idleCount,
            waitingCount: sessionPool.waitingCount
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: 'Database connection failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    if (!isProduction) {
      await setupVite(app, server);
      console.log('[Vite] Development server initialized');
    } else {
      serveStatic(app);
      console.log('[Static] Production assets configured');
    }

    const PORT = Number(process.env.PORT) || 5000;
    
    // Enhanced server error handling
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error('[Server] Failed to start:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use`);
      }
      process.exit(1);
    });

    // Listen with proper error handling
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
        console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`[Server] Session configuration:`, {
          secure: isProduction,
          sameSite: isProduction ? 'none' : 'lax',
          domain: isProduction ? `.${process.env.REPL_OWNER}.repl.co` : undefined
        });
        resolve();
      }).on('error', reject);
    });

  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
})();

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
