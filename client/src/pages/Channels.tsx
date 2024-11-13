import { useState, useEffect } from 'react';
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

// Constants for retry and timeout
const RETRY_COUNT = 3;
const FETCH_TIMEOUT = 10000; // 10 seconds

export function Channels() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Configure SWR with retry and timeout
  const { data: channels, error: channelsError, isLoading: isChannelsLoading, mutate: mutateChannels } = useSWR<Channel[]>(
    '/api/channels',
    async (url) => {
      console.log('[Channels] Fetching channels data');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to fetch channels');
        }
        const data = await response.json();
        console.log('[Channels] Successfully fetched channels:', data.length);
        setRetryCount(0); // Reset retry count on success
        return data;
      } catch (error) {
        console.error('[Channels] Error fetching channels:', error);
        if (retryCount < RETRY_COUNT) {
          setRetryCount(prev => prev + 1);
          throw error; // Let SWR retry
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      errorRetryCount: RETRY_COUNT,
    }
  );

  const { data: channelPosts, error: postsError, isLoading: isPostsLoading } = useSWR<Post[]>(
    selectedChannel ? `/api/channels/${selectedChannel}/posts` : null,
    async (url) => {
      console.log('[Channels] Fetching posts for channel:', selectedChannel);
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch posts');
      }
      const data = await response.json();
      console.log('[Channels] Successfully fetched posts:', data.length);
      return data;
    }
  );

  const createChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    const formData = new FormData(event.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    try {
      console.log('[Channels] Creating new channel:', name);
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

      console.log('[Channels] Channel created successfully');
      toast({
        title: 'Success',
        description: 'Channel created successfully',
      });

      mutateChannels();
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

  // Show error state
  if (channelsError) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Error loading channels: {channelsError.message}
              {retryCount > 0 && ` (Retry attempt ${retryCount}/${RETRY_COUNT})`}
            </AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
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
                    />
                  </div>
                  <div>
                    <Textarea
                      placeholder="Channel Description"
                      name="description"
                      required
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
            {isChannelsLoading ? (
              <div className="flex flex-col items-center justify-center p-8 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Loading channels...
                  {retryCount > 0 && ` (Retry ${retryCount}/${RETRY_COUNT})`}
                </p>
              </div>
            ) : channels?.length ? (
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
              isPostsLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : postsError ? (
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
    </Layout>
  );
}
