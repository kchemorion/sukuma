import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useUser } from '../hooks/use-user';
import { useToast } from '../hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Leaf, LogOut, User, Radio } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { useState } from 'react';

// Component for channel-related content
const ChannelNav = () => {
  return (
    <Link href="/channels">
      <Button variant="ghost" className="flex items-center space-x-2">
        <Radio className="h-4 w-4" />
        <span>Channels</span>
      </Button>
    </Link>
  );
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useUser();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isAuthPage = location === '/login' || location === '/register';

  const handleLogout = async () => {
    if (isLoggingOut) return; // Prevent multiple logout attempts

    try {
      setIsLoggingOut(true);
      console.log('[Auth] Initiating logout:', { 
        isGuest: user?.isGuest,
        username: user?.username 
      });

      const result = await logout();
      
      if (result.ok) {
        // Show appropriate message based on user type
        toast({
          title: "Success",
          description: user?.isGuest 
            ? "Guest session ended successfully" 
            : "Logged out successfully"
        });
        
        // Use clean navigation to login page
        window.location.replace('/login');
      } else {
        console.error('[Auth] Logout failed:', result);
        toast({
          title: "Error",
          description: result.message || "Failed to logout",
          variant: "destructive",
        });
        
        // Force navigation on error
        window.location.replace('/login');
      }
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred during logout",
        variant: "destructive",
      });
      
      // Force navigation on error
      window.location.replace('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleError = (error: Error) => {
    console.error('[Layout] Error in channel components:', error);
    toast({
      title: "Error",
      description: "Failed to load channel components. Please try refreshing the page.",
      variant: "destructive",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <Link href="/">
              <Button variant="ghost" className="flex items-center space-x-2">
                <Leaf className="h-6 w-6 text-green-600" />
                <span className="font-bold text-lg">Sukuma Wiki</span>
              </Button>
            </Link>
            <nav className="hidden md:flex items-center space-x-4">
              <ErrorBoundary onError={handleError}>
                <ChannelNav />
              </ErrorBoundary>
            </nav>
          </div>

          {!isAuthPage && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="relative h-8 w-8 rounded-full"
                  disabled={isLoggingOut}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
                    <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <Button variant="ghost" className="w-full justify-start">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Button>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {isLoggingOut ? 'Logging out...' : 'Logout'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : !isAuthPage ? (
            <div className="space-x-2">
              <Link href="/login">
                <Button variant="ghost">Login</Button>
              </Link>
              <Link href="/register">
                <Button>Register</Button>
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <ErrorBoundary onError={handleError}>
        <main>{children}</main>
      </ErrorBoundary>
    </div>
  );
}
