import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

interface ExtendedUser extends User {
  isGuest?: boolean;
}

interface GuestPreferences {
  [key: string]: any;
}

export function useUser() {
  const { data: user, error, mutate } = useSWR<ExtendedUser>("/api/user", {
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    revalidateOnReconnect: true,
    refreshInterval: 30000,
    dedupingInterval: 5000,
    onError: (err) => {
      console.error('[Auth] Error fetching user:', err);
      // Return guest user on error
      mutate({
        id: 0,
        username: 'Guest',
        points: 0,
        isGuest: true
      }, false);
    }
  });

  const { data: preferences, mutate: mutatePreferences } = useSWR<GuestPreferences>(
    user?.isGuest ? "/api/guest-preferences" : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const handleAuthRequest = async (
    url: string,
    method: string,
    body?: InsertUser
  ): Promise<RequestResult> => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          await mutate(undefined, { revalidate: false });
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
    if (!user?.isGuest) {
      return {
        ok: false,
        message: "Only guest users can update preferences"
      };
    }

    try {
      const response = await fetch("/api/guest-preferences", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
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
    return handleAuthRequest("/login", "POST", user);
  };

  const guestLogin = async () => {
    return handleAuthRequest("/guest-login", "POST");
  };

  const logout = async () => {
    try {
      // Clear user data before making logout request
      await mutate(undefined, { revalidate: false });
      
      const result = await handleAuthRequest("/logout", "POST");
      
      // If logout failed, revalidate to get current user state
      if (!result.ok) {
        await mutate(undefined, { revalidate: true });
      }
      
      return result;
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      // Revalidate on error to ensure correct state
      await mutate(undefined, { revalidate: true });
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Logout failed'
      };
    }
  };

  const register = async (user: InsertUser) => {
    return handleAuthRequest("/register", "POST", user);
  };

  return {
    user: user || { id: 0, username: 'Guest', points: 0, isGuest: true },
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