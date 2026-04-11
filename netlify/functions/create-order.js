const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const SUPABASE_URL = 'https://pmtfqbefrsplvoriirru.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const body = JSON.parse(event.body);
    const {
      product_id, seller_id, buyer_email, shipping_name,
      shipping_address, shipping_city, shipping_state, shipping_zip,
      amount_usd, crypto_currency, product_name
    } = body;

    if (!product_id || !amount_usd || !crypto_currency) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Create order in Supabase
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        product_id, seller_id, buyer_email,
        shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip,
        amount_usd: parseFloat(amount_usd),
        crypto_currency, product_name,
        status: 'pending'
      })
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) throw new Error(orderData.message || 'Failed to create order');
    const order = Array.isArray(orderData) ? orderData[0] : orderData;

    // Create NOWPayments invoice
    const invoiceRes = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: parseFloat(amount_usd),
        price_currency: 'usd',
        pay_currency: crypto_currency,
        order_id: order.id,
        order_description: product_name || 'Silque Road Order',
        ipn_callback_url: 'https://silqueroad.com/.netlify/functions/nowpayments-webhook',
        success_url: `https://silqueroad.com/order-confirmation.html?order_id=${order.id}`,
        cancel_url: `https://silqueroad.com/?cancelled=true`
      })
    });

    const invoiceData = await invoiceRes.json();
    if (!invoiceRes.ok) throw new Error(invoiceData.message || 'Failed to create invoice');

    // Update order with payment ID
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nowpayments_payment_id: invoiceData.id })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        order_id: order.id,
        invoice_url: invoiceData.invoice_url,
        payment_id: invoiceData.id
      })
    };

  } catch (err) {
    console.error('create-order error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
