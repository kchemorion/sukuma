import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

export function useUser() {
  const { data, error, mutate } = useSWR<User>("/api/user", {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    revalidateOnReconnect: true,
    refreshInterval: 0,
    dedupingInterval: 60000, // 1 minute deduping interval
    errorRetryCount: 2,
    onError: (err) => {
      // Only log actual errors, not expected 401s for non-authenticated users
      if (err.status !== 401) {
        console.error('[Auth] Error fetching user:', err);
      }
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
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        console.warn('[Auth] Failed to parse JSON response:', e);
      }

      if (!response.ok) {
        console.warn('[Auth] Request failed:', { 
          status: response.status,
          url,
          data
        });

        // Special handling for 401s
        if (response.status === 401) {
          await mutate(undefined, { revalidate: false });
        }

        return { 
          ok: false, 
          message: data?.message || `Authentication failed: ${response.statusText}`
        };
      }

      return { ok: true, data };
    } catch (e: any) {
      console.error('[Auth] Request error:', e);
      return { 
        ok: false, 
        message: e.message || 'Network error occurred'
      };
    }
  };

  const login = async (user: InsertUser) => {
    const result = await handleAuthRequest("/login", "POST", user);
    if (result.ok) {
      await mutate();
    }
    return result;
  };

  const logout = async () => {
    const result = await handleAuthRequest("/logout", "POST");
    if (result.ok) {
      await mutate(undefined, { revalidate: false });
    }
    return result;
  };

  const register = async (user: InsertUser) => {
    const result = await handleAuthRequest("/register", "POST", user);
    if (result.ok) {
      await mutate();
    }
    return result;
  };

  return {
    user: data,
    isLoading: !error && !data,
    isError: error && error.status !== 401,
    error,
    login,
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
