// Lista das funções do site (as mesmas da pasta netlify/functions).
// Ao criar uma função nova, acrescente aqui também.
import fn_calculate_shipping from '../netlify/functions/calculate-shipping.js';
import fn_catalog from '../netlify/functions/catalog.js';
import fn_catalog_save from '../netlify/functions/catalog-save.js';
import fn_coupon_check from '../netlify/functions/coupon-check.js';
import fn_create_order from '../netlify/functions/create-order.js';
import fn_create_payment_link from '../netlify/functions/create-payment-link.js';
import fn_get_customers from '../netlify/functions/get-customers.js';
import fn_get_orders from '../netlify/functions/get-orders.js';
import fn_get_pending_reviews from '../netlify/functions/get-pending-reviews.js';
import fn_get_reviews from '../netlify/functions/get-reviews.js';
import fn_google_feed from '../netlify/functions/google-feed.js';
import fn_infinitepay_webhook from '../netlify/functions/infinitepay-webhook.js';
import fn_local_delivery_config from '../netlify/functions/local-delivery-config.js';
import fn_login from '../netlify/functions/login.js';
import fn_moderate_review from '../netlify/functions/moderate-review.js';
import fn_my_orders from '../netlify/functions/my-orders.js';
import fn_pix_config from '../netlify/functions/pix-config.js';
import fn_product_photo from '../netlify/functions/product-photo.js';
import fn_return_photo from '../netlify/functions/return-photo.js';
import fn_return_request from '../netlify/functions/return-request.js';
import fn_review_order from '../netlify/functions/review-order.js';
import fn_review_photo from '../netlify/functions/review-photo.js';
import fn_signup from '../netlify/functions/signup.js';
import fn_sitemap from '../netlify/functions/sitemap.js';
import fn_submit_review from '../netlify/functions/submit-review.js';
import fn_track_order from '../netlify/functions/track-order.js';
import fn_update_order_status from '../netlify/functions/update-order-status.js';
import fn_update_user from '../netlify/functions/update-user.js';

export const FUNCTIONS = {
  'calculate-shipping': fn_calculate_shipping,
  'catalog': fn_catalog,
  'catalog-save': fn_catalog_save,
  'coupon-check': fn_coupon_check,
  'create-order': fn_create_order,
  'create-payment-link': fn_create_payment_link,
  'get-customers': fn_get_customers,
  'get-orders': fn_get_orders,
  'get-pending-reviews': fn_get_pending_reviews,
  'get-reviews': fn_get_reviews,
  'google-feed': fn_google_feed,
  'infinitepay-webhook': fn_infinitepay_webhook,
  'local-delivery-config': fn_local_delivery_config,
  'login': fn_login,
  'moderate-review': fn_moderate_review,
  'my-orders': fn_my_orders,
  'pix-config': fn_pix_config,
  'product-photo': fn_product_photo,
  'return-photo': fn_return_photo,
  'return-request': fn_return_request,
  'review-order': fn_review_order,
  'review-photo': fn_review_photo,
  'signup': fn_signup,
  'sitemap': fn_sitemap,
  'submit-review': fn_submit_review,
  'track-order': fn_track_order,
  'update-order-status': fn_update_order_status,
  'update-user': fn_update_user
};
