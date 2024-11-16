import 'express-session';

declare module 'express-session' {
  interface SessionData {
    guestUser?: {
      id: number;
      username: string;
      points: number;
      isGuest: boolean;
      guestId: string;
    };
    lastActivity?: number;
    passport?: {
      user?: number;
    };
  }
}
