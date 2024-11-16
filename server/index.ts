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
const isReplit = process.env.REPL_ID && process.env.REPL_OWNER && process.env.REPL_SLUG;

// Improved domain configuration
const getDomain = () => {
  if (isReplit) {
    return `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  }
  if (isProduction && process.env.APP_DOMAIN) {
    return process.env.APP_DOMAIN;
  }
  return 'localhost:3000';
};

const domain = getDomain();

// Configure PostgreSQL session store with enhanced connection handling
const PostgresqlStore = connectPg(session);
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: isProduction ? 20 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  ssl: isProduction || isReplit ? { rejectUnauthorized: false } : false,
  statement_timeout: 30000,
  query_timeout: 30000,
  application_name: 'sukuma_session_store'
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

    // Configure trust proxy for secure cookies behind Replit proxy
    app.set('trust proxy', isReplit || isProduction ? 1 : 0);

    // Basic middleware with enhanced error handling
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Set default content type for API routes
      if (req.path.startsWith('/api/') || req.path === '/login' || req.path === '/logout' || req.path === '/register') {
        res.type('application/json');
      }
      next();
    });

    // Enhanced JSON middleware with better error handling
    app.use(express.json({
      limit: '10mb',
      verify: (req: Request, res: Response, buf: Buffer) => {
        if (req.path === '/guest-login' || req.path === '/logout' || buf.length === 0) {
          return;
        }

        try {
          JSON.parse(buf.toString());
        } catch (e) {
          console.error('[API] JSON parse error:', {
            path: req.path,
            method: req.method,
            error: e instanceof Error ? e.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });

          res.status(400).json({
            error: 'Invalid JSON',
            message: e instanceof Error ? e.message : 'Failed to parse request body',
            timestamp: new Date().toISOString()
          });
          throw new Error('Invalid JSON');
        }
      }
    }));

    // Simplified and more secure CORS configuration
    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin && !isProduction) {
          callback(null, true);
          return;
        }

        const allowedDomains = [
          domain,
          'localhost',
          'localhost:3000'
        ];

        if (isReplit) {
          allowedDomains.push(
            '.repl.co',
            `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`,
            `${process.env.REPL_SLUG}--${process.env.REPL_OWNER}.repl.co`
          );
        }

        const isAllowed = origin && (
          allowedDomains.some(domain => 
            origin.includes(domain) || 
            (domain.startsWith('.') && origin.endsWith(domain))
          ) || !isProduction
        );

        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn('[CORS] Blocked request from:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'X-Requested-With',
        'X-Guest-Id',
        'Origin',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
      ],
      exposedHeaders: ['Set-Cookie'],
      maxAge: 86400,
      preflightContinue: false,
      optionsSuccessStatus: 204
    };

    app.use(cors(corsOptions));

    // Create session table with proper indices
    try {
      await sessionPool.query(`
        CREATE TABLE IF NOT EXISTS "session" (
          "sid" varchar NOT NULL COLLATE "default",
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL,
          CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
        );
        CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
      `);
      
      // Clean up expired sessions
      await sessionPool.query('DELETE FROM "session" WHERE expire < NOW()');
      console.log('[Database] Session table initialized and cleaned up');
    } catch (error) {
      console.error('[Database] Error initializing session table:', error);
      throw error;
    }

    // Enhanced session store configuration
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

    // Improved cookie settings for cross-origin access
    const cookieSettings = {
      secure: isProduction || isReplit ? true : false,
      httpOnly: true,
      sameSite: (isProduction || isReplit) ? 'none' as const : 'lax' as const,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
      domain: isReplit ? '.repl.co' : undefined
    };

    // Enhanced session middleware configuration
    const sessionMiddleware = session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET!,
      name: 'sukuma.sid',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: isProduction || isReplit ? true : false,
      cookie: cookieSettings
    });

    // Session and passport middleware
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    // Initialize routes
    setupAuth(app);
    registerRoutes(app);

    // Enhanced error handlers
    app.use('/api', (err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[API Error]', err);
      const statusCode = err.message.includes('Not allowed by CORS') ? 403 : 500;
      res.status(statusCode).json({
        error: statusCode === 403 ? 'Forbidden' : 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      });
    });

    if (!isProduction) {
      await setupVite(app, server);
      console.log('[Vite] Development server initialized');
    } else {
      serveStatic(app);
      console.log('[Static] Production assets configured');
    }

    const PORT = Number(process.env.PORT) || 3000;

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
        console.log(`[Server] Running on Replit:`, isReplit);
        console.log(`[Server] Domain:`, domain);
        console.log(`[Server] Cookie settings:`, cookieSettings);
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
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received. Starting graceful shutdown...');
  try {
    await sessionPool.end();
    console.log('[Server] Database connections closed');
    process.exit(0);
  } catch (error) {
    console.error('[Server] Error during shutdown:', error);
    process.exit(1);
  }
});
