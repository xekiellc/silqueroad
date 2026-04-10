const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const NP_API_KEY = process.env.NOWPAYMENTS_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const {
    product_id,
    seller_id,
    buyer_email,
    shipping_name,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_zip,
    amount_usd,
    crypto_currency,
    product_name
  } = body;

  // Validate required fields
  if (!product_id || !seller_id || !amount_usd || !crypto_currency) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  try {
    // 1. Create order in Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        product_id,
        seller_id,
        buyer_email: buyer_email || null,
        shipping_name: shipping_name || null,
        shipping_address: shipping_address || null,
        shipping_city: shipping_city || null,
        shipping_state: shipping_state || null,
        shipping_zip: shipping_zip || null,
        amount_usd: parseFloat(amount_usd),
        crypto_currency,
        payment_status: 'pending',
        fulfillment_status: 'pending'
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // 2. Create NOWPayments invoice
    const npResponse = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': NP_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: parseFloat(amount_usd),
        price_currency: 'usd',
        pay_currency: crypto_currency,
        order_id: order.id,
        order_description: product_name
          ? `Silque Road: ${product_name}`
          : 'Silque Road Purchase',
        ipn_callback_url: 'https://silqueroad.com/.netlify/functions/nowpayments-webhook',
        success_url: 'https://silqueroad.com?order=success',
        cancel_url: 'https://silqueroad.com?order=cancelled'
      })
    });

    const npData = await npResponse.json();

    if (!npResponse.ok) {
      console.error('NOWPayments error:', npData);
      throw new Error(npData.message || 'NOWPayments invoice creation failed');
    }

    // 3. Update order with NOWPayments payment ID
    await supabase
      .from('orders')
      .update({ nowpayments_payment_id: String(npData.id) })
      .eq('id', order.id);

    // 4. Return the NOWPayments invoice URL
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order_id: order.id,
        invoice_url: npData.invoice_url,
        payment_id: npData.id
      })
    };

  } catch (err) {
    console.error('Create order error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    };
  }
};
