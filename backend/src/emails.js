// Emails transactionnels (Resend). Sans clé Resend, les emails sont écrits dans ./outbox (développement).
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

let resend = null;
if (config.resendApiKey) {
  const { Resend } = require('resend');
  resend = new Resend(config.resendApiKey);
}

const eur = c => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function send({ to, subject, html, attachments = [] }) {
  if (resend) {
    const { error } = await resend.emails.send({
      from: config.fromEmail, to, subject, html,
      attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
    });
    if (error) throw new Error(`[email] ${error.message || JSON.stringify(error)}`);
    return;
  }
  const dir = path.join(process.cwd(), 'outbox');
  await fs.mkdir(dir, { recursive: true });
  const stamp = `${Date.now()}-${subject.replace(/[^\w-]+/g, '_').slice(0, 60)}`;
  await fs.writeFile(path.join(dir, `${stamp}.html`), `<!-- to: ${to} -->\n${html}`);
  for (const a of attachments) await fs.writeFile(path.join(dir, `${stamp}-${a.filename}`), a.content);
  console.log(`[email] (dev) écrit dans outbox : ${subject} -> ${to}`);
}

const layout = (title, body) => `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Georgia,serif;color:#1f1a14">
<div style="max-width:620px;margin:0 auto;padding:32px 24px">
<div style="font-size:22px;letter-spacing:.08em;font-weight:bold">ARTALUZ</div>
<h1 style="font-size:20px;font-weight:normal;margin:24px 0 16px">${title}</h1>
<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55">${body}</div>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8a8175;margin-top:32px">${esc(config.merchant.name)} — ${esc(config.merchant.address)}, ${config.merchant.zip} ${esc(config.merchant.city)} — SIRET ${config.merchant.siret}</p>
</div></body></html>`;

/** Email atelier : bon de fabrication en pièce jointe + un lien HD signé par ligne. */
async function sendProductionEmail(order, lines, workOrderPdf) {
  const rows = lines.map(({ line, hd, url }, i) => `
    <tr><td style="padding:10px 8px;border-bottom:1px solid #e5ded3;vertical-align:top"><b>L${i + 1}</b></td>
    <td style="padding:10px 8px;border-bottom:1px solid #e5ded3">
      <b>${line.quantity} × ${esc(line.product.variant)}</b> — ${String(hd.size.w).replace('.', ',')} × ${String(hd.size.h).replace('.', ',')} cm<br>
      ${line.finishes.length ? 'Finitions : ' + esc(line.finishes.map(f => f.name).join(', ')) + '<br>' : ''}
      Visuel : ${esc(line.artwork.title)}<br>
      ${hd.effectiveDpi < hd.dpi * 0.7 ? `<span style="color:#b00020"><b>⚠ Résolution source ${hd.effectiveDpi} dpi : à vérifier</b></span><br>` : ''}
      <a href="${esc(url)}" style="color:#7a4b12">Télécharger le fichier HD</a> <span style="color:#8a8175">(${esc(hd.fileName)})</span>
    </td></tr>`).join('');
  const html = layout(`Nouvelle commande ${esc(order.order_number)}`, `
    <p>Payée le ${new Date(order.paid_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} — total ${eur(order.amount_total)} TTC.</p>
    <p><b>Livraison :</b> ${esc(order.customer_name)}, ${esc(order.ship_address_line1)} ${esc(order.ship_address_line2 || '')}, ${esc(order.ship_postal_code)} ${esc(order.ship_city)} (${esc(order.ship_country)})</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#8a8175">Les liens HD expirent dans ${config.hdLinkDays} jours. Le bon de fabrication est joint.</p>`);
  await send({
    to: config.productionEmail,
    subject: `[Artaluz] Commande ${order.order_number} — ${lines.length} ligne(s)`,
    html,
    attachments: [{ filename: `BDF-${order.order_number}.pdf`, content: workOrderPdf }],
  });
}

/** Confirmation client */
async function sendCustomerConfirmation(order, lines) {
  const rows = lines.map(({ line }) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5ded3">${esc(line.artwork.title)}<br>
      <span style="color:#8a8175">${line.quantity} × ${esc(line.product.variant)} ${esc(line.product.format_label)}${line.finishes.length ? ' — ' + esc(line.finishes.map(f => f.name).join(', ')) : ''}</span></td>
    <td style="padding:8px 0;border-bottom:1px solid #e5ded3;text-align:right">${eur(line.unitTtc * line.quantity)}</td></tr>`).join('');
  const html = layout('Merci pour votre commande', `
    <p>Votre commande <b>${esc(order.order_number)}</b> est confirmée. Nous l'imprimons dans notre atelier en France et vous prévenons dès son expédition.</p>
    <table style="width:100%;border-collapse:collapse">${rows}
      ${order.amount_discount ? `<tr><td style="padding:6px 0">Remise ${esc(order.promo_code || '')}</td><td style="text-align:right">−${eur(order.amount_discount)}</td></tr>` : ''}
      <tr><td style="padding:6px 0">Livraison</td><td style="text-align:right">${order.amount_shipping ? eur(order.amount_shipping) : 'offerte'}</td></tr>
      <tr><td style="padding:6px 0"><b>Total TTC</b></td><td style="text-align:right"><b>${eur(order.amount_total)}</b></td></tr>
    </table>
    <p>Facture n° ${esc(order.invoice_number)}.</p>`);
  await send({ to: order.customer_email, subject: `Votre commande Artaluz ${order.order_number}`, html });
}

module.exports = { send, sendProductionEmail, sendCustomerConfirmation, eur, esc };
