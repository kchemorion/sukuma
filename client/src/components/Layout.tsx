import { Link } from 'wouter';
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

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useUser();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      const result = await logout();
      if (result.ok) {
        toast({
          title: "Success",
          description: "Logged out successfully",
        });
        window.location.href = '/login'; // Use direct navigation
      } else {
        toast({
          title: "Error",
          description: result.message || "Failed to logout",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred during logout",
        variant: "destructive",
      });
    }
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
              <Link href="/channels">
                <Button variant="ghost" className="flex items-center space-x-2">
                  <Radio className="h-4 w-4" />
                  <span>Channels</span>
                </Button>
              </Link>
            </nav>
          </div>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
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
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="space-x-2">
              <Link href="/login">
                <Button variant="ghost">Login</Button>
              </Link>
              <Link href="/register">
                <Button>Register</Button>
              </Link>
            </div>
          )}
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
