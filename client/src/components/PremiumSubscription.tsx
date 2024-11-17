import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { loadStripe } from '@stripe/stripe-js';
import { Star, Check } from 'lucide-react';

// Use the globally defined variables from vite config
const stripePromise = loadStripe(window.__STRIPE_PUBLISHABLE_KEY__);
const API_URL = window.__API_URL__;

// Define subscription plans
const SUBSCRIPTION_PLANS = {
  MONTHLY: {
    name: 'Voice Premium Monthly',
    price: 4.99,
    interval: 'month',
    features: [
      'Ad-free experience',
      'Premium voice effects',
      'Exclusive channel access',
      'Monthly points bonus'
    ]
  },
  YEARLY: {
    name: 'Voice Premium Yearly',
    price: 49.99,
    interval: 'year',
    features: [
      'All monthly features',
      'Two months free',
      'Premium badge',
      'Increased points multiplier'
    ]
  }
};

export function PremiumSubscription() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState<'monthly' | 'yearly' | null>(null);

  const handleSubscribe = async (planType: 'monthly' | 'yearly') => {
    try {
      setIsLoading(planType);
      const stripe = await stripePromise;
      
      if (!stripe) {
        throw new Error('Stripe failed to load');
      }

      // Create subscription
      const response = await fetch(`${API_URL}/api/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planType,
          paymentMethodId: 'pm_card_visa', // Test payment method
        }),
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subscription');
      }

      // Confirm the subscription
      const { error: confirmError } = await stripe.confirmCardPayment(
        data.clientSecret
      );

      if (confirmError) {
        throw confirmError;
      }

      toast({
        title: 'Success',
        description: `Successfully subscribed to ${planType} plan!`,
      });

    } catch (error) {
      console.error('[Payment] Subscription error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to process subscription',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Monthly Plan */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{SUBSCRIPTION_PLANS.MONTHLY.name}</h3>
            <Star className="h-6 w-6 text-yellow-500" />
          </div>
          <div className="flex items-baseline">
            <span className="text-3xl font-bold">${SUBSCRIPTION_PLANS.MONTHLY.price}</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          <ul className="space-y-2">
            {SUBSCRIPTION_PLANS.MONTHLY.features.map((feature, index) => (
              <li key={index} className="flex items-center">
                <Check className="h-4 w-4 mr-2 text-green-500" />
                {feature}
              </li>
            ))}
          </ul>
          <Button 
            className="w-full" 
            onClick={() => handleSubscribe('monthly')}
            disabled={isLoading === 'monthly'}
          >
            {isLoading === 'monthly' ? 'Processing...' : 'Subscribe Monthly'}
          </Button>
        </div>
      </Card>

      {/* Yearly Plan */}
      <Card className="p-6 border-2 border-primary">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{SUBSCRIPTION_PLANS.YEARLY.name}</h3>
            <div className="flex items-center space-x-2">
              <Star className="h-6 w-6 text-yellow-500 fill-current" />
              <Star className="h-6 w-6 text-yellow-500 fill-current" />
            </div>
          </div>
          <div className="flex items-baseline">
            <span className="text-3xl font-bold">${SUBSCRIPTION_PLANS.YEARLY.price}</span>
            <span className="text-muted-foreground">/year</span>
          </div>
          <ul className="space-y-2">
            {SUBSCRIPTION_PLANS.YEARLY.features.map((feature, index) => (
              <li key={index} className="flex items-center">
                <Check className="h-4 w-4 mr-2 text-green-500" />
                {feature}
              </li>
            ))}
          </ul>
          <Button 
            className="w-full" 
            variant="default"
            onClick={() => handleSubscribe('yearly')}
            disabled={isLoading === 'yearly'}
          >
            {isLoading === 'yearly' ? 'Processing...' : 'Subscribe Yearly'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Save up to 17% with yearly subscription
          </p>
        </div>
      </Card>
    </div>
  );
}
