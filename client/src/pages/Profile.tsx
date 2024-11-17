import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useUser } from '../hooks/use-user';
import { VoicePost } from '@/components/VoicePost';
import { PointsStats } from '@/components/PointsStats';
import { LoadingState } from '@/components/LoadingState';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { PremiumSubscription } from '@/components/PremiumSubscription';
import useSWR from 'swr';
import type { Post } from 'db/schema';
import { Star, Crown } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function Profile() {
  const { user } = useUser();
  const { data: userPosts, error } = useSWR<Post[]>(
    user ? `/api/posts/user/${user.id}` : null
  );

  if (!user) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-4">
          <EmptyState 
            title="Not Logged In"
            description="Please log in to view your profile"
          />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-4">
          <EmptyState 
            title="Error Loading Profile"
            description="There was a problem loading your profile. Please try again later."
          />
        </div>
      </Layout>
    );
  }

  if (!userPosts) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto p-4 space-y-8">
          <Card className="p-6">
            <div className="flex items-center space-x-4">
              <Skeleton className="w-20 h-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </Card>
          <LoadingState />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 space-y-8">
        <Card className="p-6">
          <div className="flex items-center space-x-4">
            <Avatar className="w-20 h-20">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <h2 className="text-2xl font-bold">{user.username}</h2>
                {user.is_premium && (
                  <Crown className="h-5 w-5 text-yellow-500 fill-current" />
                )}
              </div>
              <div className="flex items-center space-x-4">
                <p className="text-muted-foreground">
                  {userPosts.length} voice posts
                </p>
                <div className="flex items-center text-yellow-500">
                  <Star className="h-4 w-4 mr-1 fill-current" />
                  <span>{user.points} Sukuma Points</span>
                </div>
              </div>
              {user.is_premium && (
                <p className="text-sm text-muted-foreground">
                  Premium member until {new Date(user.premium_until!).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Tabs defaultValue={user.is_premium ? "posts" : "premium"}>
          <TabsList>
            <TabsTrigger value="posts">Voice Posts</TabsTrigger>
            <TabsTrigger value="premium">Premium Features</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="space-y-4">
            <h3 className="text-xl font-semibold">Voice Posts</h3>
            {userPosts.length > 0 ? (
              userPosts.map((post) => (
                <Card key={post.id} className="p-4">
                  <VoicePost post={post} />
                </Card>
              ))
            ) : (
              <EmptyState 
                title="No Voice Posts Yet"
                description="Start sharing your voice with the community!"
              />
            )}
          </TabsContent>

          <TabsContent value="premium" className="space-y-4">
            <h3 className="text-xl font-semibold">Premium Subscription</h3>
            {user.is_premium ? (
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Crown className="h-6 w-6 text-yellow-500 fill-current" />
                    <h4 className="text-lg font-semibold">Active Premium Membership</h4>
                  </div>
                  <p>Enjoy your premium benefits including:</p>
                  <ul className="list-disc list-inside space-y-2">
                    <li>Ad-free experience</li>
                    <li>Premium voice effects</li>
                    <li>Exclusive channel access</li>
                    <li>Points multiplier</li>
                  </ul>
                </div>
              </Card>
            ) : (
              <PremiumSubscription />
            )}
          </TabsContent>
        </Tabs>

        <PointsStats points={user.points} postCount={userPosts.length} />
      </div>
    </Layout>
  );
}
