const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify the request is from NOWPayments using IPN secret
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  const receivedSig = event.headers['x-nowpayments-sig'];

  if (ipnSecret && receivedSig) {
    try {
      const payload = JSON.parse(event.body);
      const sortedPayload = JSON.stringify(
        Object.fromEntries(Object.entries(payload).sort())
      );
      const expectedSig = crypto
        .createHmac('sha512', ipnSecret)
        .update(sortedPayload)
        .digest('hex');

      if (receivedSig !== expectedSig) {
        console.log('IPN signature mismatch — rejecting request');
        return { statusCode: 401, body: 'Unauthorized' };
      }
    } catch {
      return { statusCode: 400, body: 'Invalid payload' };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only act on confirmed or finished payments
  const confirmedStatuses = ['confirmed', 'finished'];
  if (!confirmedStatuses.includes(payload.payment_status)) {
    console.log('Payment status not confirmed:', payload.payment_status);
    return { statusCode: 200, body: 'Ignored — payment not yet confirmed' };
  }

  const nowpaymentsId = String(payload.payment_id);
  const amountUsd = parseFloat(payload.price_amount) || 0;

  try {
    // Find the order by NOWPayments payment ID
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('nowpayments_payment_id', nowpaymentsId)
      .limit(1);

    if (orderError) throw orderError;

    if (!orders || orders.length === 0) {
      console.log('No order found for payment_id:', nowpaymentsId);
      return { statusCode: 200, body: 'No matching order found' };
    }

    const order = orders[0];

    // Skip if already processed
    if (order.payment_status === 'confirmed' || order.payment_status === 'finished') {
      return { statusCode: 200, body: 'Already processed' };
    }

    // Update order payment status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: payload.payment_status,
        amount_usd: amountUsd
      })
      .eq('id', order.id);

    if (updateError) throw updateError;

    // Get seller commission rate and wallet info
    const { data: sellers } = await supabase
      .from('sellers')
      .select('commission_rate, crypto_wallet, crypto_currency')
      .eq('id', order.seller_id)
      .limit(1);

    const commissionRate = (sellers && sellers[0]?.commission_rate)
      ? parseFloat(sellers[0].commission_rate)
      : 0.10;

    const commissionAmount = parseFloat((amountUsd * commissionRate).toFixed(2));
    const sellerAmount = parseFloat((amountUsd - commissionAmount).toFixed(2));
    const cryptoWallet = sellers?.[0]?.crypto_wallet || null;
    const cryptoCurrency = sellers?.[0]?.crypto_currency || payload.pay_currency || null;

    // Check if payout already exists for this order
    const { data: existingPayouts } = await supabase
      .from('payouts')
      .select('id')
      .eq('order_id', order.id)
      .limit(1);

    if (!existingPayouts || existingPayouts.length === 0) {
      const { error: payoutError } = await supabase
        .from('payouts')
        .insert({
          seller_id: order.seller_id,
          order_id: order.id,
          gross_amount: amountUsd,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
          seller_amount: sellerAmount,
          crypto_currency: cryptoCurrency,
          crypto_wallet: cryptoWallet,
          status: 'pending',
          notes: `Auto-created from NOWPayments webhook. Payment ID: ${nowpaymentsId}`
        });

      if (payoutError) throw payoutError;
    }

    console.log(`Processed: $${amountUsd} — seller $${sellerAmount} / platform $${commissionAmount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order_id: order.id,
        seller_amount: sellerAmount,
        commission_amount: commissionAmount
      })
    };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
