import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '../hooks/use-user';
import { VoicePost } from '@/components/VoicePost';
import useSWR, { mutate } from 'swr';
import type { Channel, Post } from 'db/schema';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Constants for retry and timeout
const RETRY_COUNT = 3;
const FETCH_TIMEOUT = 15000; // 15 seconds
const RETRY_DELAY = 2000; // 2 seconds initial delay with exponential backoff

interface FetchState {
  isLoading: boolean;
  error: Error | null;
  retryCount: number;
}

export function Channels() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({
    isLoading: true,
    error: null,
    retryCount: 0
  });

  // Use refs to track mounted state and active requests
  const isMounted = useRef(true);
  const activeRequests = useRef(new Set<AbortController>());

  // Reset fetch state when component mounts and cleanup on unmount
  useEffect(() => {
    setFetchState({
      isLoading: true,
      error: null,
      retryCount: 0
    });

    return () => {
      isMounted.current = false;
      activeRequests.current.forEach(controller => controller.abort());
      activeRequests.current.clear();
    };
  }, []);

  // Safe state update function
  const safeSetFetchState = useCallback((updater: (prev: FetchState) => FetchState) => {
    if (isMounted.current) {
      setFetchState(updater);
    }
  }, []);

  const fetchWithRetry = useCallback(async (url: string, attempt: number = 0): Promise<any> => {
    const controller = new AbortController();
    activeRequests.current.add(controller);

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), FETCH_TIMEOUT);
      });

      const fetchPromise = fetch(url, { signal: controller.signal });
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (!isMounted.current) return null;

      if (attempt < RETRY_COUNT - 1) {
        const delay = RETRY_DELAY * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, attempt + 1);
      }

      throw error;
    } finally {
      activeRequests.current.delete(controller);
    }
  }, []);

  const { data: channels, error: channelsError } = useSWR<Channel[]>(
    '/api/channels',
    fetchWithRetry,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      shouldRetryOnError: false,
      onSuccess: () => {
        safeSetFetchState(prev => ({
          ...prev,
          isLoading: false,
          error: null
        }));
      },
      onError: (error) => {
        console.error('[Channels] Error:', error);
        safeSetFetchState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error : new Error('Failed to fetch channels')
        }));
      }
    }
  );

  const { data: channelPosts, error: postsError } = useSWR<Post[]>(
    selectedChannel ? `/api/channels/${selectedChannel}/posts` : null,
    fetchWithRetry,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      shouldRetryOnError: false,
      onError: (error) => {
        console.error('[Channels] Error loading posts:', error);
        toast({
          title: 'Error',
          description: 'Failed to load channel posts. Please try again later.',
          variant: 'destructive',
        });
      },
    }
  );

  const createChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    const formData = new FormData(event.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create channel');
      }

      toast({
        title: 'Success',
        description: 'Channel created successfully',
      });

      // Reset form and refresh channels
      (event.target as HTMLFormElement).reset();
      mutate('/api/channels');
    } catch (error) {
      console.error('[Channels] Error creating channel:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create channel',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Loading state
  if (!channels && !channelsError && fetchState.isLoading) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex flex-col items-center justify-center p-8 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm text-muted-foreground">
              Loading channels...
              {fetchState.retryCount > 0 && ` (Retry ${fetchState.retryCount}/${RETRY_COUNT})`}
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  // Error state
  if (channelsError || fetchState.error) {
    const error = channelsError || fetchState.error;
    return (
      <Layout>
        <ErrorBoundary
          fallback={
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load channels. Please try refreshing the page.
              </AlertDescription>
            </Alert>
          }
        >
          <div className="max-w-6xl mx-auto p-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Error loading channels: {error?.message}
                {fetchState.retryCount > 0 && ` (Retry attempt ${fetchState.retryCount}/${RETRY_COUNT})`}
              </AlertDescription>
            </Alert>
            <Button 
              className="mt-4"
              onClick={() => mutate('/api/channels')}
            >
              Retry
            </Button>
          </div>
        </ErrorBoundary>
      </Layout>
    );
  }

  return (
    <Layout>
      <ErrorBoundary
        fallback={
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load channels. Please try refreshing the page.
            </AlertDescription>
          </Alert>
        }
      >
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Voice Channels</h1>
            {user && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    New Channel
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Channel</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={createChannel} className="space-y-4">
                    <div>
                      <Input
                        placeholder="Channel Name"
                        name="name"
                        required
                        minLength={3}
                        maxLength={50}
                      />
                    </div>
                    <div>
                      <Textarea
                        placeholder="Channel Description"
                        name="description"
                        required
                        minLength={10}
                        maxLength={200}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={isCreating}>
                      {isCreating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Channel'
                      )}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="grid md:grid-cols-[300px,1fr] gap-6">
            <div className="space-y-4">
              {channels?.length ? (
                channels.map((channel) => (
                  <Card
                    key={channel.id}
                    className={`p-4 cursor-pointer transition-colors hover:bg-accent/50 ${
                      selectedChannel === channel.id ? 'bg-accent' : ''
                    }`}
                    onClick={() => setSelectedChannel(channel.id)}
                  >
                    <h3 className="font-semibold">{channel.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {channel.description}
                    </p>
                  </Card>
                ))
              ) : (
                <div className="text-center p-8 border-2 border-dashed rounded-lg">
                  <p className="text-muted-foreground">
                    No channels available
                  </p>
                  {user && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Create a new channel to get started
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {selectedChannel ? (
                postsError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Error loading posts: {postsError.message}
                    </AlertDescription>
                  </Alert>
                ) : channelPosts?.length ? (
                  channelPosts.map((post) => (
                    <Card key={post.id} className="p-4">
                      <VoicePost post={post} />
                    </Card>
                  ))
                ) : (
                  <div className="text-center p-8 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">
                      No posts in this channel yet
                    </p>
                    {user && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Be the first to post in this channel
                      </p>
                    )}
                  </div>
                )
              ) : (
                <div className="text-center p-8 border-2 border-dashed rounded-lg">
                  <p className="text-muted-foreground">
                    Select a channel to view posts
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
