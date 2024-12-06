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
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Improved domain configuration
const getDomain = () => {
  if (isReplit) {
    return `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  }
  if (isProduction && process.env.APP_DOMAIN) {
    return process.env.APP_DOMAIN;
  }
  return '0.0.0.0';
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

// Initialize app with improved error handling
(async () => {
  try {
    console.log('[Server] Verifying database connection...');
    await sessionPool.query('SELECT NOW()');
    console.log('[Database] Connection verified successfully');

    const app = express();
    const server = createServer(app);

    // Configure trust proxy for secure cookies behind Replit proxy
    app.set('trust proxy', isReplit || isProduction ? 1 : 0);

    // Basic security middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      next();
    });

    // Enhanced CORS configuration
    const corsOptions = {
      origin: function(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
        const allowedDomains = [
          'http://localhost:5173',
          'http://localhost:3000',
          'http://0.0.0.0:5173',
          'http://0.0.0.0:3000',
          `https://${domain}`,
          '.repl.co'
        ];

        if (!origin || !isProduction) {
          callback(null, true);
          return;
        }

        const isAllowed = allowedDomains.some(d => 
          origin.includes(d) || 
          (d.startsWith('.') && origin.endsWith(d))
        );

        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn('[Server] Rejected CORS from origin:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Guest-ID'],
      exposedHeaders: ['Set-Cookie']
    };

    app.use(cors(corsOptions));

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
          console.error('[API] JSON parse error:', e);
          res.status(400).json({
            error: 'Invalid JSON',
            message: e instanceof Error ? e.message : 'Failed to parse request body'
          });
          throw new Error('Invalid JSON');
        }
      }
    }));

    // Enhanced session store configuration
    const sessionStore = new PostgresqlStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15
    });

    // Improved cookie settings
    const cookieSettings = {
      secure: isProduction || isReplit,
      httpOnly: true,
      sameSite: (isProduction || isReplit) ? 'none' as const : 'lax' as const,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      domain: isReplit ? '.repl.co' : undefined
    };

    // Enhanced session middleware
    app.use(session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET!,
      name: 'sukuma.sid',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: true,
      cookie: cookieSettings
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    // Initialize auth routes first
    setupAuth(app);
    
    // Serve static files
    app.use('/uploads', express.static('uploads'));

    // Initialize API routes
    registerRoutes(app);

    // Static file serving with proper configuration
    if (isProduction) {
      app.use(express.static(path.join(__dirname, 'public')));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
      });
    } else {
      await setupVite(app, server);
    }

    // Global error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[Server] Error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
      });
    });

    // Start server
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Running on Replit:`, process.env.REPL_SLUG || false);
      console.log(`[Server] Domain:`, domain);
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
