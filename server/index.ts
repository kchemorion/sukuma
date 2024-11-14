import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { createServer } from "http";
import { setupAuth } from "./auth";
import session from "express-session";
import createMemoryStore from "memorystore";
import passport from "passport";

const app = express();

// Configure CORS with proper credentials handling
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Set-Cookie']
};

// Setup session store
const MemoryStore = createMemoryStore(session);
const sessionSettings: session.SessionOptions = {
  secret: process.env.REPL_ID || "your-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: "lax",
    path: "/"
  },
  store: new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  })
};

// Configure session for production if needed
if (app.get("env") === "production") {
  app.set("trust proxy", 1);
  if (sessionSettings.cookie) {
    sessionSettings.cookie.secure = true;
  }
}

// Middleware setup in correct order
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionSettings));
app.use(passport.initialize());
app.use(passport.session());

(async () => {
  // Setup authentication first
  setupAuth(app);
  
  // Then register routes
  registerRoutes(app);
  
  const server = createServer(app);

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server] Error:', err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  if (process.env.NODE_ENV !== "production") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[express] Server started on port ${PORT}`);
  });
})();
