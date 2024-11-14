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

const app = express();
const server = createServer(app);

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
});

// Monitor the connection pool
sessionPool.on('error', (err) => {
  console.error('[Database] Unexpected error on idle client', err);
});

// Session configuration
const sessionSettings: session.SessionOptions = {
  store: new PostgresqlStore({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60
  }),
  secret: process.env.REPL_ID || "your-secret-key",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: 'sukuma.sid',
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
    path: "/",
  }
};

// Configure for production
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
  sessionSettings.cookie!.secure = true;
  sessionSettings.cookie!.sameSite = 'none';
}

// CORS configuration with proper credentials handling
const corsOptions = {
  origin: process.env.NODE_ENV === "production" 
    ? [new RegExp(`^https://${process.env.REPL_SLUG}\\.${process.env.REPL_OWNER}\\.repl\\.co$`)]
    : "http://localhost:5000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['set-cookie']
};

// Apply middleware in correct order
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize session middleware before passport
app.use(session(sessionSettings));
app.use(passport.initialize());
app.use(passport.session());

// Session debugging middleware
app.use((req, _res, next) => {
  const sessionInfo = {
    id: req.sessionID,
    cookie: req.session?.cookie,
    user: req.user ? { id: req.user.id, username: req.user.username } : null,
    authenticated: req.isAuthenticated()
  };
  
  console.debug('[Session]', {
    url: req.url,
    method: req.method,
    session: sessionInfo,
    headers: {
      origin: req.headers.origin,
      cookie: req.headers.cookie ? '[present]' : '[absent]'
    }
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    session: {
      id: req.sessionID,
      active: !!req.session,
      authenticated: req.isAuthenticated(),
      user: req.user ? { id: req.user.id, username: req.user.username } : null
    }
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Server Error]', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    sessionID: req.sessionID
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Setup routes and start server
(async () => {
  try {
    // Setup authentication first
    setupAuth(app);
    
    // Register routes
    registerRoutes(app);

    // Handle static files and Vite setup
    if (process.env.NODE_ENV !== "production") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    const PORT = Number(process.env.PORT) || 5000;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Started on port ${PORT}`);
    });
  } catch (error) {
    console.error('[Server] Startup error:', error);
    process.exit(1);
  }
})();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Closing server...');
  sessionPool.end();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
