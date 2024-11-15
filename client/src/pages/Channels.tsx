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
  DialogFooter,
  DialogDescription,
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
  Award,
  TrendingUp,
  Compass,
  Hash
} from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";

interface ChannelWithSubscription extends Omit<Channel, 'subscriber_count'> {
  isSubscribed?: boolean;
  isModerator?: boolean;
  subscriber_count?: number;
}

interface FormErrors {
  name?: string;
  description?: string;
  categories?: string;
}

export function Channels() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'trending' | 'recommended' | 'categories'>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Fetch channels with subscription status and better error handling
  const { data: allChannels, error: channelsError } = useSWR<ChannelWithSubscription[]>(
    '/api/channels',
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('You need to be logged in to access this feature');
        }
        throw new Error('Failed to fetch channels');
      }
      const channels = await response.json();
      
      if (user) {
        // Fetch user's subscriptions and moderator status
        const subscriptionsResponse = await fetch(`/api/users/${user.id}/subscriptions`);
        if (!subscriptionsResponse.ok) {
          throw new Error('Failed to fetch subscriptions');
        }
        const subscriptions = await subscriptionsResponse.json();
        
        return channels.map((channel: ChannelWithSubscription) => ({
          ...channel,
          isSubscribed: subscriptions.some((s: { channel_id: number }) => s.channel_id === channel.id),
          isModerator: channel.moderators?.includes(user.id)
        }));
      }
      
      return channels;
    }
  );

  // Fetch trending channels
  const { data: trendingChannels } = useSWR<ChannelWithSubscription[]>(
    '/api/channels/trending',
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch trending channels');
      return response.json();
    }
  );

  // Fetch recommended channels for logged-in users
  const { data: recommendedChannels } = useSWR<ChannelWithSubscription[]>(
    user ? '/api/channels/recommended' : null,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch recommended channels');
      return response.json();
    }
  );

  // Get unique categories from all channels
  const categories = Array.from(new Set(
    allChannels?.flatMap(channel => channel.categories || []) || []
  )).sort();

  // Filter channels based on view mode and category
  const displayedChannels = (() => {
    switch (viewMode) {
      case 'trending':
        return trendingChannels || [];
      case 'recommended':
        return recommendedChannels || [];
      case 'categories':
        return activeCategory
          ? (allChannels || []).filter(channel => 
              Array.isArray(channel.categories) && channel.categories.includes(activeCategory)
            )
          : [];
      default:
        return allChannels || [];
    }
  })();

  // Fetch channel posts
  const { data: channelPosts, error: postsError } = useSWR<Post[]>(
    selectedChannel ? `/api/channels/${selectedChannel}/posts` : null,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch posts');
      return response.json();
    }
  );

  const validateForm = (formData: FormData): boolean => {
    const errors: FormErrors = {};
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const categories = formData.get('categories') as string;

    if (!name?.trim()) {
      errors.name = 'Channel name is required';
    } else if (name.length < 3) {
      errors.name = 'Channel name must be at least 3 characters';
    }

    if (!description?.trim()) {
      errors.description = 'Description is required';
    } else if (description.length < 10) {
      errors.description = 'Description must be at least 10 characters';
    }

    if (categories) {
      const categoryArray = categories.split(',').map(cat => cat.trim());
      if (categoryArray.some(cat => cat.length < 2)) {
        errors.categories = 'Each category must be at least 2 characters';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const createChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to create a channel',
        variant: 'destructive',
      });
      return;
    }

    const formData = new FormData(event.currentTarget);
    
    if (!validateForm(formData)) {
      return;
    }

    setIsCreating(true);
    
    try {
      const categories = (formData.get('categories') as string || '')
        .split(',')
        .map(cat => cat.trim())
        .filter(Boolean);

      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.get('name'),
          description: formData.get('description'),
          rules: [],
          categories,
          is_private: formData.get('is_private') === 'true',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to create channel');
      }

      toast({
        title: 'Success',
        description: 'Channel created successfully',
      });

      formRef.current?.reset();
      setIsDialogOpen(false);
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
      const channel = allChannels?.find(c => c.id === channelId);
      const isSubscribed = channel?.isSubscribed;
      
      const response = await fetch(`/api/channels/${channelId}/subscribe`, {
        method: isSubscribed ? 'DELETE' : 'POST',
      });

      if (!response.ok) throw new Error('Failed to update subscription');

      toast({
        title: 'Success',
        description: `Successfully ${isSubscribed ? 'unsubscribed from' : 'subscribed to'} channel`,
      });

      mutate('/api/channels');
    } catch (error) {
      console.error('[Channels] Subscription error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update subscription',
        variant: 'destructive',
      });
    }
  };

  // Guest user helper components
  const GuestMessage = ({ action }: { action: string }) => (
    <div className="text-center p-4 bg-muted/50 rounded-lg">
      <h3 className="font-semibold mb-2">Join the Conversation!</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Sign up or log in to {action} and unlock all features.
      </p>
      <div className="flex justify-center gap-4">
        <Button variant="default" asChild>
          <Link to="/register">Sign Up</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/login">Log In</Link>
        </Button>
      </div>
    </div>
  );

  // Loading state with better UI
  if (!allChannels && !channelsError) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-4">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading channels...</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Error state with better error boundaries
  if (channelsError) {
    return (
      <Layout>
        <ErrorBoundary fallback={
          <div className="max-w-6xl mx-auto p-4">
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {channelsError.message}
              </AlertDescription>
            </Alert>
            {!user && <GuestMessage action="access all features" />}
          </div>
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
          <TooltipProvider>
            {user ? (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    New Community
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Community</DialogTitle>
                    <DialogDescription>
                      Create a new voice community. All fields marked with * are required.
                    </DialogDescription>
                  </DialogHeader>
                  <form ref={formRef} onSubmit={createChannel} className="space-y-4">
                    <div>
                      <Input
                        placeholder="Community Name *"
                        name="name"
                        required
                        minLength={3}
                        maxLength={50}
                        className={formErrors.name ? 'border-red-500' : ''}
                      />
                      {formErrors.name && (
                        <p className="text-sm text-red-500 mt-1">{formErrors.name}</p>
                      )}
                    </div>
                    <div>
                      <Textarea
                        placeholder="Community Description *"
                        name="description"
                        required
                        minLength={10}
                        maxLength={200}
                        className={formErrors.description ? 'border-red-500' : ''}
                      />
                      {formErrors.description && (
                        <p className="text-sm text-red-500 mt-1">{formErrors.description}</p>
                      )}
                    </div>
                    <div>
                      <Input
                        placeholder="Categories (comma-separated)"
                        name="categories"
                        className={formErrors.categories ? 'border-red-500' : ''}
                      />
                      {formErrors.categories && (
                        <p className="text-sm text-red-500 mt-1">{formErrors.categories}</p>
                      )}
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
                    <DialogFooter>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          'Create Community'
                        )}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" disabled>
                    <Plus className="h-4 w-4 mr-2" />
                    New Community
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sign in to create a new community</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>

        <Tabs value={viewMode} onValueChange={(value: 'all' | 'trending' | 'recommended' | 'categories') => setViewMode(value)}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              <Compass className="h-4 w-4 mr-2" />
              All
            </TabsTrigger>
            <TabsTrigger value="trending">
              <TrendingUp className="h-4 w-4 mr-2" />
              Trending
            </TabsTrigger>
            {user ? (
              <TabsTrigger value="recommended">
                <Award className="h-4 w-4 mr-2" />
                Recommended
              </TabsTrigger>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="recommended" disabled>
                    <Award className="h-4 w-4 mr-2" />
                    Recommended
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sign in to see personalized recommendations</p>
                </TooltipContent>
              </Tooltip>
            )}
            <TabsTrigger value="categories">
              <Hash className="h-4 w-4 mr-2" />
              Categories
            </TabsTrigger>
          </TabsList>

          {/* Show guest message when trying to access recommended tab */}
          {!user && viewMode === 'recommended' && (
            <GuestMessage action="get personalized recommendations" />
          )}

          <div className="grid md:grid-cols-[300px,1fr] gap-6">
            <div className="space-y-4">
              {viewMode === 'categories' && categories.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {categories.map((category: string) => (
                    <Badge
                      key={category}
                      variant={activeCategory === category ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => setActiveCategory(
                        activeCategory === category ? null : category
                      )}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
              )}

              {displayedChannels?.length ? (
                displayedChannels.map((channel) => (
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
                        {Array.isArray(channel.categories) && channel.categories.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {channel.categories.map((category: string) => (
                              <Badge key={category} variant="outline" className="text-xs">
                                {category}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {user ? (
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
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled
                            >
                              Join
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Sign in to join communities</p>
                          </TooltipContent>
                        </Tooltip>
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
                      {viewMode === 'trending' && (
                        <Badge variant="secondary">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                  </Card>
                ))
              ) : (
                <div className="text-center p-8 bg-muted/50 rounded-lg">
                  <AlertCircle className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-semibold mb-2">No Channels Found</h3>
                  <p className="text-sm text-muted-foreground">
                    {user ? 
                      "Be the first to create a community!" :
                      "Join us to create and discover voice communities!"
                    }
                  </p>
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
                          {Array.isArray(post.tags) && post.tags.length > 0 && (
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
        </Tabs>
      </div>
    </Layout>
  );
}