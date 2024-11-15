export class FetchError extends Error {
  info: any;
  status: number;
  constructor(message: string, info: any, status: number) {
    super(message);
    this.info = info;
    this.status = status;
  }
}

// Enhanced fetcher function with proper CORS and credentials handling
export const fetcher = async (url: string, init?: RequestInit) => {
  const isReplit = typeof window !== 'undefined' && window.location.hostname.includes('.repl.co');
  
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };

  // If running on Replit, add specific headers
  if (isReplit) {
    defaultOptions.headers = {
      ...defaultOptions.headers,
      'Origin': window.location.origin,
    };
  }

  const options = {
    ...defaultOptions,
    ...init,
    headers: {
      ...defaultOptions.headers,
      ...(init?.headers || {}),
    },
  };

  try {
    const res = await fetch(url, options);

    // Handle non-JSON responses
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!res.ok) {
        throw new FetchError(
          `Invalid response content-type: ${contentType}`,
          { contentType },
          res.status
        );
      }
      return res.text();
    }

    const data = await res.json();

    if (!res.ok) {
      throw new FetchError(
        data.message || `An error occurred while fetching the data.`,
        data,
        res.status
      );
    }

    return data;
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError(
      'Network error',
      { originalError: error },
      0
    );
  }
};
