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
import { 
  Plus, 
  Loader2, 
  AlertCircle,
  Users,
  Settings,
  Lock,
  Pin,
  Eye,
  Tag,
  Award
} from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Badge } from "@/components/ui/badge";

interface ChannelWithSubscription extends Channel {
  isSubscribed?: boolean;
  isModerator?: boolean;
}

export function Channels() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [channelSettings, setChannelSettings] = useState<{
    isOpen: boolean;
    channelId: number | null;
  }>({
    isOpen: false,
    channelId: null,
  });

  // Fetch channels with subscription status
  const { data: channels, error: channelsError } = useSWR<ChannelWithSubscription[]>(
    '/api/channels',
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch channels');
      const channels = await response.json();
      
      if (user) {
        // Fetch user's subscriptions and moderator status
        const subscriptionsResponse = await fetch(`/api/users/${user.id}/subscriptions`);
        const subscriptions = await subscriptionsResponse.json();
        
        return channels.map(channel => ({
          ...channel,
          isSubscribed: subscriptions.some((s: any) => s.channel_id === channel.id),
          isModerator: channel.moderators?.includes(user.id)
        }));
      }
      
      return channels;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const { data: channelPosts, error: postsError } = useSWR<Post[]>(
    selectedChannel ? `/api/channels/${selectedChannel}/posts` : null,
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch posts');
      return response.json();
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const handleSubscribe = async (channelId: number) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'Please login to subscribe to channels',
        variant: 'destructive',
      });
      return;
    }

    try {
      const channel = channels?.find(c => c.id === channelId);
      const isSubscribed = channel?.isSubscribed;
      
      const response = await fetch(`/api/channels/${channelId}/subscribe`, {
        method: isSubscribed ? 'DELETE' : 'POST',
      });

      if (!response.ok) throw new Error('Failed to update subscription');

      toast({
        title: 'Success',
        description: `Successfully ${isSubscribed ? 'unsubscribed from' : 'subscribed to'} channel`,
      });

      mutate('/api/channels'); // Refresh channels
    } catch (error) {
      console.error('[Channels] Subscription error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update subscription',
        variant: 'destructive',
      });
    }
  };

  const createChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    const formData = new FormData(event.currentTarget);
    
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.get('name'),
          description: formData.get('description'),
          rules: [],
          is_private: formData.get('is_private') === 'true',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create channel');
      }

      toast({
        title: 'Success',
        description: 'Channel created successfully',
      });

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
  if (!channels && !channelsError) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  // Error state
  if (channelsError) {
    return (
      <Layout>
        <ErrorBoundary fallback={
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load channels. Please try refreshing the page.
            </AlertDescription>
          </Alert>
        }>
          <div className="max-w-6xl mx-auto p-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {channelsError.message}
              </AlertDescription>
            </Alert>
          </div>
        </ErrorBoundary>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Voice Communities</h1>
          {user && (
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Community
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Community</DialogTitle>
                </DialogHeader>
                <form onSubmit={createChannel} className="space-y-4">
                  <div>
                    <Input
                      placeholder="Community Name"
                      name="name"
                      required
                      minLength={3}
                      maxLength={50}
                    />
                  </div>
                  <div>
                    <Textarea
                      placeholder="Community Description"
                      name="description"
                      required
                      minLength={10}
                      maxLength={200}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="is_private"
                      name="is_private"
                      value="true"
                    />
                    <label htmlFor="is_private">Private Community</label>
                  </div>
                  <Button type="submit" className="w-full" disabled={isCreating}>
                    {isCreating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Community'
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
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold">{channel.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {channel.description}
                      </p>
                    </div>
                    {user && (
                      <Button
                        variant={channel.isSubscribed ? "secondary" : "default"}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSubscribe(channel.id);
                        }}
                      >
                        {channel.isSubscribed ? 'Joined' : 'Join'}
                      </Button>
                    )}
                  </div>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-muted-foreground">
                    <div className="flex items-center">
                      <Users className="h-4 w-4 mr-1" />
                      {channel.subscriber_count || 0}
                    </div>
                    {channel.is_private && (
                      <div className="flex items-center">
                        <Lock className="h-4 w-4 mr-1" />
                        Private
                      </div>
                    )}
                    {channel.isModerator && (
                      <Badge variant="outline">Moderator</Badge>
                    )}
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center p-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">
                  No communities available
                </p>
                {user && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Create a new community to get started
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {selectedChannel ? (
              <>
                {channelPosts?.length ? (
                  channelPosts.map((post) => (
                    <Card key={post.id} className="p-4">
                      <div className="mb-2">
                        {post.flair && (
                          <Badge className="mr-2" variant="secondary">
                            {post.flair}
                          </Badge>
                        )}
                        {post.is_pinned && (
                          <Badge className="mr-2" variant="outline">
                            <Pin className="h-3 w-3 mr-1" />
                            Pinned
                          </Badge>
                        )}
                        <h3 className="text-lg font-semibold mt-1">
                          {post.title}
                        </h3>
                      </div>
                      <VoicePost post={post} />
                      <div className="mt-2 flex items-center space-x-4 text-sm text-muted-foreground">
                        <div className="flex items-center">
                          <Eye className="h-4 w-4 mr-1" />
                          {post.view_count || 0} views
                        </div>
                        {post.tags?.length > 0 && (
                          <div className="flex items-center">
                            <Tag className="h-4 w-4 mr-1" />
                            {post.tags.join(', ')}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))
                ) : (
                  <div className="text-center p-8 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">
                      No posts in this community yet
                    </p>
                    {user && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Be the first to post in this community
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center p-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">
                  Select a community to view posts
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
