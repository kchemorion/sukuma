import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

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

export function useUser() {
  const { data: user, error, mutate } = useSWR<ExtendedUser>("/api/user", {
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
    dedupingInterval: 5000,
    onError: async (err) => {
      console.error('[Auth] Error fetching user:', err);
      try {
        // Check for existing guest ID in localStorage
        const existingGuestId = localStorage.getItem(GUEST_ID_KEY);
        
        // Attempt to restore guest session with existing ID
        const result = await handleAuthRequest("/guest-login", "POST", undefined, existingGuestId);
        if (result.ok && result.data?.user) {
          // Store new guest ID if provided
          if (result.data.guestId) {
            localStorage.setItem(GUEST_ID_KEY, result.data.guestId);
          }
          await mutate(result.data.user, false);
        } else {
          // Return default guest user on error
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
      }
    }
  });

  const { data: preferences, mutate: mutatePreferences } = useSWR<GuestPreferences>(
    user?.isGuest && user.guestId ? "/api/guest-preferences" : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      headers: {
        'X-Guest-ID': user?.guestId || ''
      },
      onError: (err) => {
        console.error('[Auth] Error fetching guest preferences:', err);
      }
    }
  );

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
          message: data?.message || `Authentication failed: ${response.statusText}` 
        };
      }

      await mutate(data.user || undefined, { revalidate: true });
      return { ok: true, data };
    } catch (e) {
      console.error('[Auth] Network error:', e);
      return { 
        ok: false, 
        message: e instanceof Error ? e.message : 'Network error occurred'
      };
    }
  };

  const updateGuestPreferences = async (newPreferences: GuestPreferences): Promise<RequestResult> => {
    if (!user?.isGuest || !user.guestId) {
      return {
        ok: false,
        message: "Only valid guest users can update preferences"
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
          message: data.error || "Failed to update preferences"
        };
      }

      await mutatePreferences(data.preferences);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to update preferences"
      };
    }
  };

  const login = async (user: InsertUser) => {
    // Clear guest ID on regular login
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
        message: error instanceof Error ? error.message : "Guest login failed"
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
        message: error instanceof Error ? error.message : 'Logout failed'
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
    isLoading: !error && !user,
    isError: error && error.status !== 401,
    error,
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
    }
  | {
      ok: false;
      message: string;
    };
