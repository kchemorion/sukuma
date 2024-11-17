import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser } from '../hooks/use-user';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import useSWR, { mutate } from 'swr';
import type { Channel } from 'db/schema';
import { Link } from 'wouter';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Tag,
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

type ViewMode = 'all' | 'categories';

interface ChannelWithSubscription extends Channel {
  isSubscribed?: boolean;
  isModerator?: boolean;
  subscriber_count: number;
  categories: string[];
}

export function Channels() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // Fetch channels with proper error handling
  const { data: allChannels, error: channelsError, isLoading } = useSWR<ChannelWithSubscription[]>(
    '/api/channels',
    async (url: string) => {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch channels');
      }
      const channels = await response.json();
      
      return channels.map((channel: ChannelWithSubscription) => ({
        ...channel,
        isSubscribed: false, // Will be updated when we implement subscriptions
        isModerator: channel.moderators?.includes(user?.id) || false,
        categories: channel.categories || [],
        subscriber_count: channel.subscriber_count || 0
      }));
    },
    {
      revalidateOnFocus: true,
      shouldRetryOnError: true,
      dedupingInterval: 5000
    }
  );

  // Get unique categories from all channels
  const categories = Array.from(new Set(
    allChannels?.flatMap(channel => channel.categories || []) || []
  )).sort();

  // Filter channels based on view mode and category
  const displayedChannels = (() => {
    let filteredChannels = allChannels || [];
    
    if (viewMode === 'categories' && activeCategory) {
      filteredChannels = filteredChannels.filter(channel => 
        channel.categories?.includes(activeCategory)
      );
    }

    return filteredChannels;
  })();

  const handleSubscribe = async (channelId: number) => {
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to subscribe to channels',
        variant: 'destructive',
      });
      return;
    }

    try {
      const channel = allChannels?.find(c => c.id === channelId);
      const isSubscribed = channel?.isSubscribed;
      
      const response = await fetch(`/api/channels/${channelId}/subscribe`, {
        method: isSubscribed ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update subscription');
      }

      toast({
        title: 'Success',
        description: `Successfully ${isSubscribed ? 'unsubscribed from' : 'subscribed to'} channel`,
      });

      mutate('/api/channels');
    } catch (error) {
      console.error('[Channels] Subscription error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update subscription',
        variant: 'destructive',
      });
    }
  };

  // Loading state
  if (isLoading) {
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

  // Error state
  if (channelsError) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {channelsError.message}
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
          <h1 className="text-2xl font-bold">Voice Communities</h1>
          <TooltipProvider>
            {user ? (
              <Dialog open={isRecorderOpen} onOpenChange={setIsRecorderOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    New Community
                  </Button>
                </DialogTrigger>
                <VoiceRecorder
                  open={isRecorderOpen}
                  onOpenChange={setIsRecorderOpen}
                  onSuccess={() => {
                    setIsRecorderOpen(false);
                    mutate('/api/channels');
                  }}
                />
              </Dialog>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/login">
                    <Button variant="secondary">
                      <Plus className="h-4 w-4 mr-2" />
                      New Community
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sign in to create a new community</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>

        <Tabs defaultValue="all" value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              <Compass className="h-4 w-4 mr-2" />
              All Communities
            </TabsTrigger>
            <TabsTrigger value="categories">
              <Hash className="h-4 w-4 mr-2" />
              Categories
            </TabsTrigger>
          </TabsList>

          <div className="grid md:grid-cols-[300px,1fr] gap-6">
            {viewMode === 'categories' && (
              <div className="space-y-2">
                <h3 className="font-semibold mb-3">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Badge
                      key={category}
                      variant={activeCategory === category ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => setActiveCategory(activeCategory === category ? null : category)}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {displayedChannels.length === 0 ? (
                <div className="text-center p-8 bg-muted/50 rounded-lg">
                  <p className="text-muted-foreground">
                    {viewMode === 'categories' && activeCategory 
                      ? `No channels found in category "${activeCategory}"`
                      : 'No channels available'}
                  </p>
                </div>
              ) : (
                <ErrorBoundary>
                  {displayedChannels.map((channel) => (
                    <Card key={channel.id} className="p-4 hover:bg-accent/50 transition-colors">
                      <div className="flex justify-between items-start">
                        <Link href={`/channels/${channel.id}`}>
                          <div>
                            <h3 className="font-semibold text-lg flex items-center gap-2">
                              {channel.name}
                              {channel.is_private && (
                                <Lock className="h-4 w-4 text-muted-foreground" />
                              )}
                            </h3>
                            <p className="text-sm text-muted-foreground">{channel.description}</p>
                            
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Users className="h-4 w-4" />
                                <span>{channel.subscriber_count}</span>
                              </div>
                              {channel.categories?.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <Tag className="h-4 w-4" />
                                  <span>{channel.categories.join(', ')}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </Link>

                        <div className="flex items-center gap-2">
                          {channel.isModerator && (
                            <Button variant="ghost" size="sm">
                              <Settings className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant={channel.isSubscribed ? "secondary" : "default"}
                            size="sm"
                            onClick={() => handleSubscribe(channel.id)}
                          >
                            {channel.isSubscribed ? 'Subscribed' : 'Subscribe'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </ErrorBoundary>
              )}
            </div>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
