import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema } from "@db/schema";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const form = useForm({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  if (user) {
    return <Redirect to="/" />;
  }

  const onSubmit = (isLogin: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    form.handleSubmit((data) => {
      if (form.formState.isValid) {
        if (isLogin) {
          loginMutation.mutate(data);
        } else {
          registerMutation.mutate(data);
        }
      }
    })();
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Welcome to Social Agent Launcher</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-4">
                  <Button
                    type="submit"
                    className="flex-1"
                    onClick={onSubmit(true)}
                    disabled={isLoading || !form.formState.isValid}
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Login
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    className="flex-1"
                    onClick={onSubmit(false)}
                    disabled={isLoading || !form.formState.isValid}
                  >
                    Register
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
      <div className="hidden md:flex bg-muted items-center justify-center p-8">
        <div className="max-w-md space-y-4">
          <h1 className="text-4xl font-bold">Create Social Media Bots Without Code</h1>
          <p className="text-muted-foreground">
            Launch engaging social media bots in minutes with our easy-to-use wizard interface.
            Perfect for polls, Q&As, and giveaways.
          </p>
        </div>
      </div>
    </div>
  );
}