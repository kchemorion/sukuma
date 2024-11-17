import Stripe from 'stripe';
import { db } from 'db';
import { subscriptions, transactions, users } from 'db/schema';
import { eq } from 'drizzle-orm';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

export const SUBSCRIPTION_PLANS = {
  MONTHLY: {
    id: 'voice_premium_monthly',
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
    id: 'voice_premium_yearly',
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

export class PaymentService {
  static async createCustomer(userId: number, email: string) {
    try {
      const customer = await stripe.customers.create({
        email,
        metadata: {
          userId: userId.toString()
        }
      });
      return customer;
    } catch (error) {
      console.error('[Payment] Create customer error:', error);
      throw error;
    }
  }

  static async createSubscription(userId: number, planType: 'monthly' | 'yearly', paymentMethodId: string) {
    try {
      // Get user and check if they already have an active subscription
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error('User not found');
      }

      const plan = planType === 'monthly' ? SUBSCRIPTION_PLANS.MONTHLY : SUBSCRIPTION_PLANS.YEARLY;
      
      // Create or retrieve customer
      let customer;
      if (user.stripe_customer_id) {
        customer = await stripe.customers.retrieve(user.stripe_customer_id);
      } else {
        throw new Error('Customer not found');
      }

      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer.id,
      });

      // Set as default payment method
      await stripe.customers.update(customer.id, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: plan.id }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });

      // Create subscription record in database
      const [dbSubscription] = await db.insert(subscriptions)
        .values({
          user_id: userId,
          plan_type: planType,
          amount: plan.price,
          status: subscription.status,
          started_at: new Date(subscription.current_period_start * 1000),
          expires_at: new Date(subscription.current_period_end * 1000),
          payment_provider: 'stripe',
          payment_id: subscription.id,
          auto_renew: true
        })
        .returning();

      // Create transaction record
      await db.insert(transactions)
        .values({
          user_id: userId,
          amount: plan.price,
          type: 'subscription',
          status: 'completed',
          payment_provider: 'stripe',
          payment_id: subscription.id,
          description: `${plan.name} subscription`,
          metadata: {
            subscription_id: dbSubscription.id,
            plan_type: planType
          }
        });

      return {
        subscriptionId: subscription.id,
        clientSecret: (subscription.latest_invoice as any).payment_intent.client_secret,
      };
    } catch (error) {
      console.error('[Payment] Create subscription error:', error);
      throw error;
    }
  }

  static async handleSubscriptionUpdated(subscriptionId: string, status: string) {
    try {
      const [subscription] = await db.select()
        .from(subscriptions)
        .where(eq(subscriptions.payment_id, subscriptionId))
        .limit(1);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      // Update subscription status
      await db.update(subscriptions)
        .set({ status })
        .where(eq(subscriptions.payment_id, subscriptionId));

      // Update user premium status
      if (status === 'active') {
        await db.update(users)
          .set({ 
            is_premium: true,
            premium_until: subscription.expires_at
          })
          .where(eq(users.id, subscription.user_id));
      } else if (status === 'canceled' || status === 'expired') {
        await db.update(users)
          .set({ 
            is_premium: false,
            premium_until: null
          })
          .where(eq(users.id, subscription.user_id));
      }
    } catch (error) {
      console.error('[Payment] Update subscription error:', error);
      throw error;
    }
  }

  static async cancelSubscription(subscriptionId: string) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
      
      const [subscription] = await db.select()
        .from(subscriptions)
        .where(eq(subscriptions.payment_id, subscriptionId))
        .limit(1);

      if (subscription) {
        await db.update(subscriptions)
          .set({ 
            status: 'cancelled',
            auto_renew: false
          })
          .where(eq(subscriptions.payment_id, subscriptionId));

        await db.update(users)
          .set({ 
            is_premium: false,
            premium_until: null
          })
          .where(eq(users.id, subscription.user_id));
      }
    } catch (error) {
      console.error('[Payment] Cancel subscription error:', error);
      throw error;
    }
  }
}
