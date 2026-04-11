const crypto = require('crypto');

const SUPABASE_URL = 'https://pmtfqbefrsplvoriirru.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const body = JSON.parse(event.body);

    // Verify IPN signature
    if (IPN_SECRET) {
      const sig = event.headers['x-nowpayments-sig'];
      const sorted = JSON.stringify(body, Object.keys(body).sort());
      const hmac = crypto.createHmac('sha512', IPN_SECRET).update(sorted).digest('hex');
      if (sig !== hmac) {
        console.error('Invalid IPN signature');
        return { statusCode: 401, body: 'Invalid signature' };
      }
    }

    const { order_id, payment_status, actually_paid, pay_currency } = body;
    if (!order_id) return { statusCode: 400, body: 'Missing order_id' };

    const confirmedStatuses = ['confirmed', 'complete', 'finished'];
    if (!confirmedStatuses.includes(payment_status)) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Status noted, not confirmed yet' }) };
    }

    // Fetch order
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}&select=*`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const orders = await orderRes.json();
    if (!orders || orders.length === 0) return { statusCode: 404, body: 'Order not found' };
    const order = orders[0];

    // Update order status
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'confirmed', paid_at: new Date().toISOString(), amount_paid: actually_paid })
    });

    // Calculate payout
    const commission = parseFloat(order.amount_usd) * 0.10;
    const sellerPayout = parseFloat(order.amount_usd) * 0.90;

    // Create payout record
    if (order.seller_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/payouts`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id, seller_id: order.seller_id,
          amount_usd: sellerPayout, commission_usd: commission,
          status: 'pending', currency: pay_currency
        })
      });
    }

    // Fetch seller info
    let seller = null;
    if (order.seller_id) {
      const sellerRes = await fetch(`${SUPABASE_URL}/rest/v1/sellers?id=eq.${order.seller_id}&select=*`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const sellers = await sellerRes.json();
      if (sellers && sellers.length > 0) seller = sellers[0];
    }

    const orderRef = order_id.substring(0, 8).toUpperCase();

    // Email 1: Notify seller of new order
    if (seller && seller.email) {
      await sendEmail({
        to: seller.email,
        subject: `New Order — ${order.product_name || 'Silque Road'} [${orderRef}]`,
        html: `
          <div style="font-family:'Courier New',monospace;background:#100d05;color:#F0E6CC;padding:40px;max-width:560px;margin:0 auto">
            <div style="font-size:22px;font-weight:700;letter-spacing:3px;color:#C9A84C;text-transform:uppercase;margin-bottom:4px">SILQUE ROAD</div>
            <div style="font-size:9px;letter-spacing:3px;color:#8B6914;text-transform:uppercase;margin-bottom:32px">New Order</div>
            <div style="font-size:18px;color:#F0E6CC;margin-bottom:20px">You have a new order to fulfill.</div>
            <div style="background:#1a1208;border:1px solid rgba(201,168,76,0.3);padding:20px;margin-bottom:24px">
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Order Ref</span><span style="font-size:11px;color:#C9A84C;font-weight:700">${orderRef}</span></div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Product</span><span style="font-size:11px;color:#F0E6CC">${order.product_name || '—'}</span></div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Amount</span><span style="font-size:11px;color:#F0E6CC">$${parseFloat(order.amount_usd).toFixed(2)}</span></div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Your Payout</span><span style="font-size:13px;color:#C9A84C;font-weight:700">$${sellerPayout.toFixed(2)}</span></div>
              ${order.shipping_name ? `<div style="border-top:1px solid rgba(201,168,76,0.2);padding-top:12px;margin-top:12px"><div style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase;margin-bottom:6px">Ship To</div><div style="font-size:11px;color:#F0E6CC;line-height:1.6">${order.shipping_name}<br>${order.shipping_address || ''}<br>${order.shipping_city || ''}, ${order.shipping_state || ''} ${order.shipping_zip || ''}</div></div>` : '<div style="border-top:1px solid rgba(201,168,76,0.2);padding-top:12px;margin-top:12px;font-size:10px;color:rgba(240,230,204,0.5)">No shipping address provided — contact buyer if needed.</div>'}
            </div>
            <a href="https://silqueroad.com/seller-dashboard.html" style="display:block;background:#C9A84C;color:#100d05;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px;text-align:center;text-decoration:none;margin-bottom:20px">Go to Seller Dashboard &rarr;</a>
            <div style="font-size:9px;letter-spacing:1px;color:rgba(240,230,204,0.3);text-transform:uppercase;line-height:1.8">Fulfill this order promptly. Add tracking in your dashboard once shipped. Your payout will be processed in the next weekly cycle.</div>
          </div>`
      });
    }

    // Email 2: Buyer order confirmation
    if (order.buyer_email) {
      await sendEmail({
        to: order.buyer_email,
        subject: `Your Order is Confirmed — Silque Road [${orderRef}]`,
        html: `
          <div style="font-family:'Courier New',monospace;background:#100d05;color:#F0E6CC;padding:40px;max-width:560px;margin:0 auto">
            <div style="font-size:22px;font-weight:700;letter-spacing:3px;color:#C9A84C;text-transform:uppercase;margin-bottom:4px">SILQUE ROAD</div>
            <div style="font-size:9px;letter-spacing:3px;color:#8B6914;text-transform:uppercase;margin-bottom:32px">Order Confirmed</div>
            <div style="font-size:18px;color:#F0E6CC;margin-bottom:8px">Your payment has been received.</div>
            <div style="font-size:15px;font-style:italic;color:rgba(240,230,204,0.6);margin-bottom:24px">Your seller has been notified and will ship your order.</div>
            <div style="background:#1a1208;border:1px solid rgba(201,168,76,0.3);padding:20px;margin-bottom:24px">
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Order Ref</span><span style="font-size:11px;color:#C9A84C;font-weight:700">${orderRef}</span></div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Product</span><span style="font-size:11px;color:#F0E6CC">${order.product_name || '—'}</span></div>
              <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Amount Paid</span><span style="font-size:13px;color:#C9A84C;font-weight:700">$${parseFloat(order.amount_usd).toFixed(2)}</span></div>
              <div style="display:flex;justify-content:space-between"><span style="font-size:9px;letter-spacing:1px;color:#8B6914;text-transform:uppercase">Status</span><span style="font-size:11px;color:#3a8a3a">&#10003; Confirmed</span></div>
            </div>
            <a href="https://silqueroad.com/order-confirmation.html?order_id=${order_id}" style="display:block;background:#C9A84C;color:#100d05;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px;text-align:center;text-decoration:none;margin-bottom:20px">View Order Status &rarr;</a>
            <div style="font-size:9px;letter-spacing:1px;color:rgba(240,230,204,0.3);text-transform:uppercase;line-height:1.8">Save your order ref: ${orderRef}. You will receive another email when your order ships with tracking information. Questions? Email info@silqueroad.com with your order ref.</div>
          </div>`
      });
    }

    // Email 3: Admin notification
    await sendEmail({
      to: 'info@silqueroad.com',
      subject: `Payment Confirmed — Order ${orderRef}`,
      html: `
        <div style="font-family:'Courier New',monospace;background:#100d05;color:#F0E6CC;padding:32px;max-width:480px">
          <div style="font-size:16px;font-weight:700;letter-spacing:2px;color:#C9A84C;margin-bottom:16px">PAYMENT CONFIRMED</div>
          <div style="font-size:11px;line-height:1.8;color:rgba(240,230,204,0.7)">
            Order: ${orderRef}<br>
            Product: ${order.product_name || '—'}<br>
            Amount: $${parseFloat(order.amount_usd).toFixed(2)}<br>
            Commission: $${commission.toFixed(2)}<br>
            Seller Payout: $${sellerPayout.toFixed(2)}<br>
            Currency: ${pay_currency || '—'}<br>
            Buyer Email: ${order.buyer_email || 'Anonymous'}
          </div>
        </div>`
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendEmail({ to, subject, html }) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY || 're_DsYwW8r2_FM1jadYVqoEWzGofrRpNQ7H7'}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Silque Road <info@silqueroad.com>',
        to, subject, html
      })
    });
  } catch (err) {
    console.error('Email error:', err);
  }
}
