import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

interface ExtendedUser extends User {
  isGuest?: boolean;
}

export function useUser() {
  const { data, error, mutate } = useSWR<ExtendedUser>("/api/user", {
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
          // Clear user data on authentication failure
          await mutate(undefined, { revalidate: false });
        }
        return { 
          ok: false, 
          message: data?.message || `Authentication failed: ${response.statusText}` 
        };
      }

      // Update local data after successful request
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

  const login = async (user: InsertUser) => {
    return handleAuthRequest("/login", "POST", user);
  };

  const guestLogin = async () => {
    return handleAuthRequest("/guest-login", "POST");
  };

  const logout = async () => {
    try {
      const result = await handleAuthRequest("/logout", "POST");
      if (result.ok) {
        // Ensure proper cleanup of user data
        await mutate(undefined, { 
          revalidate: false,
          rollbackOnError: true
        });
      }
      return result;
    } catch (error) {
      console.error('[Auth] Logout error:', error);
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
    user: data || { id: 0, username: 'Guest', points: 0, isGuest: true },
    isLoading: !error && !data,
    isError: error && error.status !== 401,
    error,
    login,
    guestLogin,
    logout,
    register,
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
