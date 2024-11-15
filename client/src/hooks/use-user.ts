import useSWR from "swr";
import type { User, InsertUser } from "db/schema";
import { useState, useEffect, useCallback } from "react";

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

// Enhanced configuration
const GUEST_ID_KEY = 'guest_user_id';
const MAX_RETRY_COUNT = 3;
const BASE_RETRY_INTERVAL = 2000; // 2 seconds
const NETWORK_TIMEOUT = 15000; // 15 seconds timeout
const ERROR_TYPES = {
  NETWORK: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT_ERROR',
  AUTH: 'AUTH_ERROR',
  SERVER: 'SERVER_ERROR',
  UNKNOWN: 'UNKNOWN_ERROR'
} as const;

export function useUser() {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<keyof typeof ERROR_TYPES | null>(null);

  // Enhanced error categorization
  const categorizeError = useCallback((error: any): keyof typeof ERROR_TYPES => {
    if (error?.name === 'AbortError') return 'TIMEOUT';
    if (error?.status === 401 || error?.status === 403) return 'AUTH';
    if (error?.status >= 500) return 'SERVER';
    if (!navigator.onLine || error?.message?.includes('network')) return 'NETWORK';
    return 'UNKNOWN';
  }, []);

  // Enhanced retry logic with exponential backoff
  const getRetryDelay = useCallback((attempt: number): number => {
    return Math.min(BASE_RETRY_INTERVAL * Math.pow(2, attempt), 10000);
  }, []);

  const { data: user, error: userError, mutate } = useSWR<ExtendedUser>("/api/user", {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
    dedupingInterval: 5000,
    onError: async (err) => {
      const errorCategory = categorizeError(err);
      setErrorType(errorCategory);
      
      console.error('[Auth] Error fetching user:', {
        type: errorCategory,
        error: err?.message || 'Unknown error',
        status: err?.status,
        retryCount,
        timestamp: new Date().toISOString()
      });
      
      setLastError(err?.message || 'Authentication error occurred');
      
      // Don't retry on certain error types
      if (errorCategory === 'AUTH') {
        console.log('[Auth] Not retrying due to authentication error');
        return;
      }
      
      if (retryCount < MAX_RETRY_COUNT) {
        setIsRetrying(true);
        console.log(`[Auth] Retry attempt ${retryCount + 1} of ${MAX_RETRY_COUNT}`, {
          delay: getRetryDelay(retryCount),
          errorType: errorCategory
        });
        
        setTimeout(async () => {
          setRetryCount(prev => prev + 1);
          try {
            await mutate();
          } catch (retryError) {
            console.error('[Auth] Retry failed:', {
              error: retryError,
              attempt: retryCount + 1
            });
          }
        }, getRetryDelay(retryCount));
        return;
      }

      // After all retries failed, attempt guest login
      try {
        const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
        console.log('[Auth] Attempting guest login fallback after retry failure');
        
        const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
        
        if (result.ok && result.data?.user) {
          console.log('[Auth] Guest login successful after retry failure');
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

  // Enhanced preferences fetching with error handling
  const { data: preferences, error: preferencesError, mutate: mutatePreferences } = useSWR<GuestPreferences>(
    user?.isGuest && user.guestId ? "/api/guest-preferences" : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      headers: {
        'X-Guest-ID': user?.guestId || ''
      },
      onError: (err) => {
        const errorCategory = categorizeError(err);
        if (!preferencesError || (err?.status !== 401 && err?.status !== 404)) {
          console.error('[Auth] Error fetching guest preferences:', {
            type: errorCategory,
            error: err?.message || 'Unknown error',
            status: err?.status,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  );

  // Reset state on unmount
  useEffect(() => {
    return () => {
      setRetryCount(0);
      setIsRetrying(false);
      setLastError(null);
      setErrorType(null);
    };
  }, []);

  // Enhanced request handler with better error handling and timeout
  const handleAuthRequest = async (
    url: string,
    method: string,
    body?: InsertUser,
    guestId?: string | null
  ): Promise<RequestResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      if (guestId) {
        headers['X-Guest-ID'] = guestId;
      }

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
        const errorCategory = categorizeError({ status: response.status });
        console.error('[Auth] Request failed:', {
          type: errorCategory,
          status: response.status,
          url,
          timestamp: new Date().toISOString()
        });

        if (response.status === 401) {
          console.warn('[Auth] Session expired or invalid');
          await mutate(undefined, { revalidate: false });
          localStorage.removeItem(GUEST_ID_KEY);
        }

        return { 
          ok: false, 
          message: data?.message || `Authentication failed: ${response.statusText}`,
          status: response.status,
          type: errorCategory
        };
      }

      await mutate(data.user || undefined, { revalidate: true });
      return { ok: true, data };
    } catch (e) {
      clearTimeout(timeoutId);
      const isTimeout = e instanceof Error && e.name === 'AbortError';
      const errorCategory = categorizeError(e);

      console.error('[Auth] Network error:', {
        type: errorCategory,
        error: e instanceof Error ? e.message : 'Unknown error',
        isTimeout,
        timestamp: new Date().toISOString()
      });

      return { 
        ok: false, 
        message: isTimeout ? 'Request timed out' : (e instanceof Error ? e.message : 'Network error occurred'),
        status: isTimeout ? 408 : 0,
        type: errorCategory
      };
    }
  };

  // Enhanced preference update with proper error handling
  const updateGuestPreferences = async (newPreferences: GuestPreferences): Promise<RequestResult> => {
    if (!user?.isGuest || !user.guestId) {
      return {
        ok: false,
        message: "Only valid guest users can update preferences",
        status: 403,
        type: 'AUTH'
      };
    }

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
        const errorCategory = categorizeError({ status: response.status });
        return {
          ok: false,
          message: data.error || "Failed to update preferences",
          status: response.status,
          type: errorCategory
        };
      }

      await mutatePreferences(data.preferences);
      return { ok: true, data };
    } catch (error) {
      clearTimeout(timeoutId);
      const errorCategory = categorizeError(error);
      
      console.error('[Auth] Preferences update error:', {
        type: errorCategory,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });

      return {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update preferences",
        status: 0,
        type: errorCategory
      };
    }
  };

  // Enhanced authentication methods with proper error handling
  const login = async (user: InsertUser) => {
    localStorage.removeItem(GUEST_ID_KEY);
    setLastError(null);
    setErrorType(null);
    return handleAuthRequest("/login", "POST", user);
  };

  const guestLogin = async () => {
    try {
      const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
      setLastError(null);
      setErrorType(null);
      const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
      
      if (result.ok && result.data?.guestId) {
        localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
      }
      
      return result;
    } catch (error) {
      const errorCategory = categorizeError(error);
      console.error('[Auth] Guest login error:', {
        type: errorCategory,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Guest login failed",
        status: 0,
        type: errorCategory
      };
    }
  };

  const logout = async () => {
    try {
      localStorage.removeItem(GUEST_ID_KEY);
      setLastError(null);
      setErrorType(null);
      await mutate(undefined, { revalidate: false });
      await mutatePreferences(undefined, false);
      
      const result = await handleAuthRequest("/logout", "POST");
      
      if (!result.ok) {
        console.warn('[Auth] Logout failed, forcing client-side logout');
        await mutate(undefined, { revalidate: true });
      }
      
      return result;
    } catch (error) {
      const errorCategory = categorizeError(error);
      console.error('[Auth] Logout error:', {
        type: errorCategory,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      await mutate(undefined, { revalidate: true });
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Logout failed',
        status: 0,
        type: errorCategory
      };
    }
  };

  const register = async (user: InsertUser) => {
    localStorage.removeItem(GUEST_ID_KEY);
    setLastError(null);
    setErrorType(null);
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
    errorType,
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
      type?: keyof typeof ERROR_TYPES;
    };
