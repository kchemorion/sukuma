import express from 'express';
import { PaymentService } from '../services/payment';
import { PointsService } from '../services/points';
import { POINTS_CONFIG } from '../services/points';

const router = express.Router();

router.post('/api/subscriptions', async (req: any, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { planType, paymentMethodId } = req.body;

    if (!planType || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create subscription
    const result = await PaymentService.createSubscription(
      req.user.id,
      planType,
      paymentMethodId
    );

    // Award bonus points based on subscription type
    if (planType === 'monthly') {
      await PointsService.awardPoints(
        req.user.id,
        POINTS_CONFIG.PREMIUM_MONTHLY_BONUS,
        'reward',
        'subscription_bonus',
        undefined,
        { subscription_type: 'monthly' }
      );
    } else {
      await PointsService.awardPoints(
        req.user.id,
        POINTS_CONFIG.PREMIUM_YEARLY_BONUS,
        'reward',
        'subscription_bonus',
        undefined,
        { subscription_type: 'yearly' }
      );
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Subscription creation error:', error);
    res.status(500).json({
      error: 'Failed to create subscription',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

router.delete('/api/subscriptions/:subscriptionId', async (req: any, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    await PaymentService.cancelSubscription(req.params.subscriptionId);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Subscription cancellation error:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

export default router;
