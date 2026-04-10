const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = 'info@silqueroad.com';
const FROM_NAME = 'Silque Road';
const ADMIN_EMAIL = 'info@silqueroad.com';

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  return res.ok;
}

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

  const { type, data } = body;

  try {
    switch (type) {

      // New seller application — notify admin
      case 'new_application': {
        await sendEmail(
          ADMIN_EMAIL,
          `New Seller Application — ${data.business_name}`,
          `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0a0806;color:#f0e6cc;padding:40px;">
            <h2 style="color:#c9a84c;letter-spacing:3px;text-transform:uppercase;font-size:18px">New Seller Application</h2>
            <p style="color:#9a907e;margin:16px 0 24px">A new seller has applied to join Silque Road.</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:120px">Business</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.business_name}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Contact</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.contact_name}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Email</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.email}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Category</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.category || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Volume</td><td style="padding:8px 0">${data.monthly_volume || '—'}</td></tr>
            </table>
            <a href="https://silqueroad.com/admin" style="display:inline-block;margin-top:28px;background:#c9a84c;color:#0a0806;font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;text-decoration:none">Review Application &rarr;</a>
            <p style="margin-top:32px;font-size:11px;color:rgba(154,144,126,0.4)">Silque Road &bull; silqueroad.com</p>
          </div>
          `
        );
        break;
      }

      // Seller approved — notify seller
      case 'seller_approved': {
        if (!data.email) break;
        await sendEmail(
          data.email,
          `You're approved — Welcome to Silque Road`,
          `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0a0806;color:#f0e6cc;padding:40px;">
            <h2 style="color:#c9a84c;letter-spacing:3px;text-transform:uppercase;font-size:18px">You're In.</h2>
            <p style="color:#9a907e;margin:16px 0 8px;font-style:italic;font-size:18px">Welcome to Silque Road, ${data.business_name}.</p>
            <p style="color:#9a907e;margin:0 0 24px;line-height:1.7">Your seller application has been approved. Log in to your seller dashboard to add products, manage orders, and track your payouts.</p>
            <a href="https://silqueroad.com/seller-dashboard" style="display:inline-block;margin-bottom:28px;background:#c9a84c;color:#0a0806;font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;text-decoration:none">Access Your Dashboard &rarr;</a>
            <p style="color:#9a907e;font-size:14px;line-height:1.7">Log in with: <strong style="color:#f0e6cc">${data.email}</strong></p>
            <hr style="border:none;border-top:1px solid rgba(201,168,76,0.2);margin:28px 0">
            <p style="font-size:13px;color:#9a907e;line-height:1.7">Questions? Email <a href="mailto:info@silqueroad.com" style="color:#c9a84c">info@silqueroad.com</a></p>
            <p style="margin-top:24px;font-size:11px;color:rgba(154,144,126,0.4)">Silque Road &bull; Legal &amp; Available &bull; silqueroad.com</p>
          </div>
          `
        );
        break;
      }

      // New order — notify seller
      case 'new_order': {
        if (!data.seller_email) break;
        await sendEmail(
          data.seller_email,
          `New Order — ${data.product_name || 'Silque Road'}`,
          `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0a0806;color:#f0e6cc;padding:40px;">
            <h2 style="color:#c9a84c;letter-spacing:3px;text-transform:uppercase;font-size:18px">New Order Received</h2>
            <p style="color:#9a907e;margin:16px 0 24px">You have a new order on Silque Road.</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:120px">Product</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.product_name || '—'}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Amount</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#c9a84c;font-weight:bold">$${data.amount_usd}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Your Cut (90%)</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#6fcf7f;font-weight:bold">$${data.seller_amount}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Ship To</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.shipping_name || 'Anonymous'}</td></tr>
              <tr><td style="padding:8px 0;color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Address</td><td style="padding:8px 0">${[data.shipping_address, data.shipping_city, data.shipping_state, data.shipping_zip].filter(Boolean).join(', ') || 'Not provided'}</td></tr>
            </table>
            <a href="https://silqueroad.com/seller-dashboard" style="display:inline-block;margin-top:28px;background:#c9a84c;color:#0a0806;font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;text-decoration:none">View Dashboard &rarr;</a>
            <p style="margin-top:32px;font-size:11px;color:rgba(154,144,126,0.4)">Silque Road &bull; silqueroad.com</p>
          </div>
          `
        );
        break;
      }

      // Payout issued — notify seller
      case 'payout_issued': {
        if (!data.seller_email) break;
        await sendEmail(
          data.seller_email,
          `Payout Issued — $${data.seller_amount} — Silque Road`,
          `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0a0806;color:#f0e6cc;padding:40px;">
            <h2 style="color:#c9a84c;letter-spacing:3px;text-transform:uppercase;font-size:18px">Payout Issued</h2>
            <p style="color:#9a907e;margin:16px 0 24px">Your payout has been processed.</p>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:120px">Amount</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#6fcf7f;font-size:20px;font-weight:bold">$${data.seller_amount}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2);color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Currency</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.2)">${data.crypto_currency || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#8a6e2a;font-size:12px;text-transform:uppercase;letter-spacing:1px">Wallet</td><td style="padding:8px 0;font-size:12px;word-break:break-all">${data.crypto_wallet || 'On file'}</td></tr>
            </table>
            <a href="https://silqueroad.com/seller-dashboard" style="display:inline-block;margin-top:28px;background:#c9a84c;color:#0a0806;font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;text-decoration:none">View Payouts &rarr;</a>
            <p style="margin-top:32px;font-size:11px;color:rgba(154,144,126,0.4)">Silque Road &bull; silqueroad.com</p>
          </div>
          `
        );
        break;
      }

      default:
        return { statusCode: 400, body: 'Unknown notification type' };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Notification error:', err);
    return { statusCode: 500, body: 'Failed to send notification' };
  }
};
