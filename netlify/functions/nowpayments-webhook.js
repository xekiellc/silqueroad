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

  // Verify IPN signature
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
        console.log('IPN signature mismatch — rejecting');
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

  const confirmedStatuses = ['confirmed', 'finished'];
  if (!confirmedStatuses.includes(payload.payment_status)) {
    return { statusCode: 200, body: 'Ignored — not confirmed' };
  }

  const nowpaymentsId = String(payload.payment_id);
  const amountUsd = parseFloat(payload.price_amount) || 0;

  try {
    // Find the order
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('nowpayments_payment_id', nowpaymentsId)
      .limit(1);

    if (orderError) throw orderError;
    if (!orders || orders.length === 0) {
      return { statusCode: 200, body: 'No matching order' };
    }

    const order = orders[0];

    if (order.payment_status === 'confirmed' || order.payment_status === 'finished') {
      return { statusCode: 200, body: 'Already processed' };
    }

    // Update order
    await supabase
      .from('orders')
      .update({ payment_status: payload.payment_status, amount_usd: amountUsd })
      .eq('id', order.id);

    // Get seller info
    const { data: sellers } = await supabase
      .from('sellers')
      .select('commission_rate, crypto_wallet, crypto_currency, email')
      .eq('id', order.seller_id)
      .limit(1);

    const seller = sellers?.[0] || {};
    const commissionRate = parseFloat(seller.commission_rate) || 0.10;
    const commissionAmount = parseFloat((amountUsd * commissionRate).toFixed(2));
    const sellerAmount = parseFloat((amountUsd - commissionAmount).toFixed(2));
    const cryptoWallet = seller.crypto_wallet || null;
    const cryptoCurrency = seller.crypto_currency || payload.pay_currency || null;

    // Check for existing payout
    const { data: existingPayouts } = await supabase
      .from('payouts')
      .select('id')
      .eq('order_id', order.id)
      .limit(1);

    let payoutCreated = false;

    if (!existingPayouts || existingPayouts.length === 0) {
      await supabase.from('payouts').insert({
        seller_id: order.seller_id,
        order_id: order.id,
        gross_amount: amountUsd,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        seller_amount: sellerAmount,
        crypto_currency: cryptoCurrency,
        crypto_wallet: cryptoWallet,
        status: 'pending',
        notes: `Auto-created from NOWPayments. Payment ID: ${nowpaymentsId}`
      });
      payoutCreated = true;
    }

    // Get product name for notifications
    const { data: products } = await supabase
      .from('products')
      .select('name')
      .eq('id', order.product_id)
      .limit(1);

    const productName = products?.[0]?.name || 'Your product';

    // Fire seller new_order notification
    if (seller.email) {
      try {
        await fetch('https://silqueroad.com/.netlify/functions/send-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'new_order',
            data: {
              seller_email: seller.email,
              product_name: productName,
              amount_usd: amountUsd.toFixed(2),
              seller_amount: sellerAmount.toFixed(2),
              shipping_name: order.shipping_name,
              shipping_address: order.shipping_address,
              shipping_city: order.shipping_city,
              shipping_state: order.shipping_state,
              shipping_zip: order.shipping_zip
            }
          })
        });
      } catch (notifErr) {
        console.error('Order notification failed:', notifErr);
      }
    }

    // Fire seller payout_issued notification (only if payout was just created)
    if (seller.email && payoutCreated) {
      try {
        await fetch('https://silqueroad.com/.netlify/functions/send-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'payout_issued',
            data: {
              seller_email: seller.email,
              seller_amount: sellerAmount.toFixed(2),
              crypto_currency: cryptoCurrency,
              crypto_wallet: cryptoWallet
            }
          })
        });
      } catch (payoutNotifErr) {
        console.error('Payout notification failed:', payoutNotifErr);
      }
    }

    console.log(`Processed: $${amountUsd} — seller $${sellerAmount} / platform $${commissionAmount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, order_id: order.id, seller_amount: sellerAmount })
    };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
