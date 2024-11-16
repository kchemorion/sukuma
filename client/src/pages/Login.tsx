import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "../hooks/use-user";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema } from "db/schema";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Loader2 } from "lucide-react";

export function Login() {
  const { toast } = useToast();
  const { login, guestLogin, isGuestLoginPending } = useUser();
  const [, setLocation] = useLocation();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(insertUserSchema),
  });

  const onSubmit = async (data: any) => {
    try {
      const result = await login(data);
      if (result.ok) {
        toast({
          title: "Success",
          description: "Logged in successfully!"
        });
        setLocation("/");
      } else {
        toast({
          title: "Error",
          description: result.message || "Failed to login",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  const handleGuestLogin = async () => {
    try {
      const result = await guestLogin();
      if (result.ok) {
        toast({
          title: "Success",
          description: "Logged in as guest successfully!"
        });
        setLocation("/");
      } else {
        console.error('[Auth] Guest login failed:', result);
        toast({
          title: "Error",
          description: result.message || "Failed to login as guest",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('[Auth] Guest login error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to login as guest",
        variant: "destructive",
      });
    }
  };

  return (
    <Layout>
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 space-y-6">
          <h1 className="text-2xl font-bold text-center">Login</h1>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Input 
                placeholder="Username" 
                {...register("username")} 
                disabled={isSubmitting}
              />
              {errors.username && (
                <p className="text-sm text-destructive mt-1">
                  {errors.username.message as string}
                </p>
              )}
            </div>
            <div>
              <Input
                type="password"
                placeholder="Password"
                {...register("password")}
                disabled={isSubmitting}
              />
              {errors.password && (
                <p className="text-sm text-destructive mt-1">
                  {errors.password.message as string}
                </p>
              )}
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Login
            </Button>
          </form>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGuestLogin}
            disabled={isGuestLoginPending}
          >
            {isGuestLoginPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Logging in as Guest...
              </>
            ) : (
              "Continue as Guest"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Button 
              variant="link" 
              className="p-0" 
              onClick={() => setLocation("/register")}
              disabled={isSubmitting || isGuestLoginPending}
            >
              Register
            </Button>
          </p>
        </Card>
      </div>
    </Layout>
  );
}
