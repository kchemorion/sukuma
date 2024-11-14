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

// Environment configuration
const isProduction = process.env.NODE_ENV === "production";
const domain = isProduction 
  ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
  : 'localhost:5000';

// Configure PostgreSQL session store with proper error handling
const PostgresqlStore = connectPg(session);
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true
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
      maxAge: 86400
    };

    app.use(cors(corsOptions));

    // Session store configuration
    const sessionStore = new PostgresqlStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 60
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
        maxAge: 24 * 60 * 60 * 1000
      }
    });

    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());

    // Initialize routes
    setupAuth(app);
    registerRoutes(app);

    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Error handling middleware
    app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      console.error('[Server Error]', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
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
    
    // Create an error handler for the server
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error('[Server] Failed to start:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use`);
      }
      process.exit(1);
    });

    // Listen with a Promise to ensure we actually bind to the port
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Running at http://0.0.0.0:${PORT}`);
        console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
        resolve();
      }).on('error', reject);
    });

  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
})();

// Handle unexpected errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
