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

export function Login() {
  const { toast } = useToast();
  const { login } = useUser();
  const [, setLocation] = useLocation();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(insertUserSchema),
  });

  const onSubmit = async (data: any) => {
    const result = await login(data);
    if (result.ok) {
      setLocation("/");
    } else {
      toast({
        title: "Error",
        description: result.message,
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
              <Input placeholder="Username" {...register("username")} />
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
              />
              {errors.password && (
                <p className="text-sm text-destructive mt-1">
                  {errors.password.message as string}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Login
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Button variant="link" className="p-0" onClick={() => setLocation("/register")}>
              Register
            </Button>
          </p>
        </Card>
      </div>
    </Layout>
  );
}
