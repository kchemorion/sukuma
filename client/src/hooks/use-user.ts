import useSWR from "swr";
import type { User, InsertUser } from "db/schema";

export function useUser() {
  const { data, error, mutate } = useSWR<User>("/api/user", {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5000,
    onError: (err) => {
      if (err?.status === 401) {
        mutate(undefined, { revalidate: false });
      }
    }
  });

  const handleAuthRequest = async (
    url: string,
    method: string,
    body?: InsertUser
  ): Promise<RequestResult> => {
    try {
      console.log('[Auth] Making request:', { url, method });
      
      const response = await fetch(url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'Accept': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include'
      });

      const contentType = response.headers.get('content-type');
      let data = null;
      
      try {
        if (contentType?.includes('application/json')) {
          data = await response.json();
        }
      } catch (e) {
        console.warn('[Auth] Failed to parse JSON response:', e);
      }

      if (!response.ok) {
        console.warn('[Auth] Request failed:', { 
          status: response.status,
          url,
          data
        });
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
      // Force immediate revalidation after login
      await mutate();
    }
    return result;
  };

  const logout = async () => {
    const result = await handleAuthRequest("/logout", "POST");
    if (result.ok) {
      // Clear user data immediately on logout
      await mutate(undefined, { revalidate: false });
    }
    return result;
  };

  const register = async (user: InsertUser) => {
    const result = await handleAuthRequest("/register", "POST", user);
    if (result.ok) {
      // Force immediate revalidation after registration
      await mutate();
    }
    return result;
  };

  return {
    user: data,
    isLoading: !error && !data,
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
