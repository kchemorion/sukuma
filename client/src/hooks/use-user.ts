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

export function useUser() {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const { data: user, error: userError, mutate } = useSWR<ExtendedUser>("/api/user", {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
    dedupingInterval: 5000,
    onError: async (err) => {
      console.error('[Auth] Error fetching user:', err);
      
      if (retryCount < RETRY_COUNT) {
        setIsRetrying(true);
        setTimeout(async () => {
          setRetryCount(prev => prev + 1);
          await mutate();
        }, RETRY_INTERVAL);
        return;
      }

      try {
        const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
        const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
        
        if (result.ok && result.data?.user) {
          if (result.data.guestId) {
            localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
          }
          await mutate(result.data.user, false);
        } else {
          await mutate({
            id: 0,
            username: 'Guest',
            points: 0,
            isGuest: true,
            password: ''
          }, false);
        }
      } catch (e) {
        console.error('[Auth] Failed to restore guest session:', e);
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
          console.error('[Auth] Error fetching guest preferences:', err);
        }
      }
    }
  );

  // Reset retry count when component unmounts
  useEffect(() => {
    return () => {
      setRetryCount(0);
      setIsRetrying(false);
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

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
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
    } catch (e) {
      console.error('[Auth] Network error:', e);
      return { 
        ok: false, 
        message: e instanceof Error ? e.message : 'Network error occurred',
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
      const response = await fetch("/api/guest-preferences", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-Guest-ID': user.guestId
        },
        body: JSON.stringify(newPreferences),
        credentials: 'include'
      });

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
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update preferences",
        status: 0
      };
    }
  };

  const login = async (user: InsertUser) => {
    localStorage.removeItem(GUEST_ID_KEY);
    return handleAuthRequest("/login", "POST", user);
  };

  const guestLogin = async () => {
    try {
      const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
      const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
      
      if (result.ok && result.data?.guestId) {
        localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
      }
      
      return result;
    } catch (error) {
      console.error('[Auth] Guest login error:', error);
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
      await mutate(undefined, { revalidate: false });
      await mutatePreferences(undefined, false);
      
      const result = await handleAuthRequest("/logout", "POST");
      
      if (!result.ok) {
        await mutate(undefined, { revalidate: true });
      }
      
      return result;
    } catch (error) {
      console.error('[Auth] Logout error:', error);
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
    return handleAuthRequest("/register", "POST", user);
  };

  return {
    user: user || { id: 0, username: 'Guest', points: 0, isGuest: true, password: '' },
    preferences: preferences || {},
    isLoading: !userError && !user,
    isRetrying,
    isError: userError && userError.status !== 401,
    error: userError,
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
