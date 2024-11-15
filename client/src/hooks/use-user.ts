import useSWR from "swr";
import type { User, InsertUser } from "db/schema";
import { useState, useEffect } from "react";

interface ExtendedUser {
  id: number;
  username: string;
  password: string;
  points: number;
  isGuest?: boolean;
  guestId?: string;
}

interface GuestPreferences {
  [key: string]: any;
}

const GUEST_ID_KEY = 'guest_user_id';
const RETRY_COUNT = 3;
const RETRY_INTERVAL = 2000;
const NETWORK_TIMEOUT = 10000; // 10 seconds timeout

export function useUser() {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const { data: user, error: userError, mutate } = useSWR<ExtendedUser>("/api/user", {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
    dedupingInterval: 5000,
    onError: async (err) => {
      console.error('[Auth] Error fetching user:', {
        error: err?.message || 'Unknown error',
        status: err?.status,
        timestamp: new Date().toISOString()
      });
      
      setLastError(err?.message || 'Authentication error occurred');
      
      if (retryCount < RETRY_COUNT) {
        setIsRetrying(true);
        console.log(`[Auth] Retry attempt ${retryCount + 1} of ${RETRY_COUNT}`);
        
        setTimeout(async () => {
          setRetryCount(prev => prev + 1);
          try {
            await mutate();
          } catch (retryError) {
            console.error('[Auth] Retry failed:', retryError);
          }
        }, RETRY_INTERVAL * (retryCount + 1)); // Exponential backoff
        return;
      }

      // After all retries failed, attempt guest login
      try {
        const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
        console.log('[Auth] Attempting guest login fallback');
        
        const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
        
        if (result.ok && result.data?.user) {
          console.log('[Auth] Guest login successful');
          if (result.data.guestId) {
            localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
          }
          await mutate(result.data.user, false);
        } else {
          console.warn('[Auth] Guest login failed, using default guest user');
          await mutate({
            id: 0,
            username: 'Guest',
            points: 0,
            isGuest: true,
            password: ''
          }, false);
        }
      } catch (e) {
        console.error('[Auth] Failed to restore guest session:', {
          error: e instanceof Error ? e.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
        await mutate({
          id: 0,
          username: 'Guest',
          points: 0,
          isGuest: true,
          password: ''
        }, false);
      } finally {
        setIsRetrying(false);
        setRetryCount(0);
      }
    }
  });

  const { data: preferences, error: preferencesError, mutate: mutatePreferences } = useSWR<GuestPreferences>(
    user?.isGuest && user.guestId ? "/api/guest-preferences" : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      headers: {
        'X-Guest-ID': user?.guestId || ''
      },
      onError: (err) => {
        if (!preferencesError || (err?.status !== 401 && err?.status !== 404)) {
          console.error('[Auth] Error fetching guest preferences:', {
            error: err?.message || 'Unknown error',
            status: err?.status,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  );

  useEffect(() => {
    return () => {
      setRetryCount(0);
      setIsRetrying(false);
      setLastError(null);
    };
  }, []);

  const handleAuthRequest = async (
    url: string,
    method: string,
    body?: InsertUser,
    guestId?: string | null
  ): Promise<RequestResult> => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      if (guestId) {
        headers['X-Guest-ID'] = guestId;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            console.warn('[Auth] Session expired or invalid');
            await mutate(undefined, { revalidate: false });
            localStorage.removeItem(GUEST_ID_KEY);
          }
          return { 
            ok: false, 
            message: data?.message || `Authentication failed: ${response.statusText}`,
            status: response.status 
          };
        }

        await mutate(data.user || undefined, { revalidate: true });
        return { ok: true, data };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      if (e instanceof Error) {
        const isTimeout = e.name === 'AbortError';
        console.error('[Auth] Network error:', {
          type: isTimeout ? 'timeout' : 'network',
          error: e.message,
          timestamp: new Date().toISOString()
        });
        return { 
          ok: false, 
          message: isTimeout ? 'Request timed out' : e.message,
          status: isTimeout ? 408 : 0
        };
      }
      return { 
        ok: false, 
        message: 'Network error occurred',
        status: 0
      };
    }
  };

  const updateGuestPreferences = async (newPreferences: GuestPreferences): Promise<RequestResult> => {
    if (!user?.isGuest || !user.guestId) {
      return {
        ok: false,
        message: "Only valid guest users can update preferences",
        status: 403
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);

      try {
        const response = await fetch("/api/guest-preferences", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
            'X-Guest-ID': user.guestId
          },
          body: JSON.stringify(newPreferences),
          credentials: 'include',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (!response.ok) {
          return {
            ok: false,
            message: data.error || "Failed to update preferences",
            status: response.status
          };
        }

        await mutatePreferences(data.preferences);
        return { ok: true, data };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('[Auth] Preferences update error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update preferences",
        status: 0
      };
    }
  };

  const login = async (user: InsertUser) => {
    localStorage.removeItem(GUEST_ID_KEY);
    setLastError(null);
    return handleAuthRequest("/login", "POST", user);
  };

  const guestLogin = async () => {
    try {
      const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
      setLastError(null);
      const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
      
      if (result.ok && result.data?.guestId) {
        localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
      }
      
      return result;
    } catch (error) {
      console.error('[Auth] Guest login error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Guest login failed",
        status: 0
      };
    }
  };

  const logout = async () => {
    try {
      localStorage.removeItem(GUEST_ID_KEY);
      setLastError(null);
      await mutate(undefined, { revalidate: false });
      await mutatePreferences(undefined, false);
      
      const result = await handleAuthRequest("/logout", "POST");
      
      if (!result.ok) {
        console.warn('[Auth] Logout failed, forcing client-side logout');
        await mutate(undefined, { revalidate: true });
      }
      
      return result;
    } catch (error) {
      console.error('[Auth] Logout error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      await mutate(undefined, { revalidate: true });
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Logout failed',
        status: 0
      };
    }
  };

  const register = async (user: InsertUser) => {
    localStorage.removeItem(GUEST_ID_KEY);
    setLastError(null);
    return handleAuthRequest("/register", "POST", user);
  };

  return {
    user: user || { id: 0, username: 'Guest', points: 0, isGuest: true, password: '' },
    preferences: preferences || {},
    isLoading: !userError && !user,
    isRetrying,
    isError: userError && userError.status !== 401,
    error: userError,
    lastError,
    preferencesError,
    login,
    guestLogin,
    logout,
    register,
    updateGuestPreferences,
  };
}

type RequestResult =
  | {
      ok: true;
      data?: any;
      status?: number;
    }
  | {
      ok: false;
      message: string;
      status: number;
    };
