export type PassageCategory = 'FEATURE' | 'UI_UX' | 'CONTENT' | 'TECHNICAL' | 'SUPPORT';

export interface PassageTemplate {
  category: PassageCategory;
  kind: 'INCLUDED' | 'EXCLUDED';
  text: string; // {client} = a cég rövid neve, {a-b} = véletlen egész a és b között
}

const inc = (category: PassageCategory, text: string): PassageTemplate => ({
  category,
  kind: 'INCLUDED',
  text,
});
const exc = (category: PassageCategory, text: string): PassageTemplate => ({
  category,
  kind: 'EXCLUDED',
  text,
});

export const PASSAGES: Record<string, PassageTemplate[]> = {
  webshop: [
    inc('FEATURE', '{client} receives a redesigned checkout flow covering cart review, shipping details, payment, and order confirmation.'),
    inc('FEATURE', 'The agency integrates Stripe payments, including card payments and saved payment methods for returning customers.'),
    inc('FEATURE', 'The product catalog supports category browsing, filtering by price and attributes, and sorting.'),
    inc('FEATURE', 'User accounts support registration, login with Google or email, password reset, and an order history page.'),
    inc('FEATURE', 'Product search with autocomplete suggestions is included for up to {5000-20000} products.'),
    inc('UI_UX', 'The design covers {10-18} responsive screens for desktop, tablet, and mobile viewports.'),
    inc('UI_UX', 'Up to {2-4} rounds of design revisions per delivered screen are included in the fixed price.'),
    inc('CONTENT', 'Product data is migrated from the existing store, with images optimized for web delivery.'),
    inc('TECHNICAL', 'The frontend is built with Next.js and deployed to the hosting environment agreed with {client}.'),
    inc('TECHNICAL', 'Basic performance optimization is included, targeting a Lighthouse performance score above 85 on key pages.'),
    inc('SUPPORT', 'Defects in delivered features are fixed free of charge for {30-90} days after launch.'),
    inc('SUPPORT', 'A monthly retainer of change request hours covers small adjustments to delivered features.'),
    exc('FEATURE', 'Native mobile applications for iOS or Android are not part of this agreement.'),
    exc('FEATURE', 'Multi-currency pricing and international tax calculation are excluded and require a separate quote.'),
    exc('CONTENT', 'Writing product descriptions, photography, and translation of content are the responsibility of {client}.'),
    exc('TECHNICAL', 'Integration with third-party ERP or warehouse management systems is not included.'),
  ],
  'mobile-api': [
    inc('FEATURE', 'The agency develops REST endpoints for authentication, user profiles, and workout data as described in the API specification.'),
    inc('FEATURE', 'Authentication uses JWT access tokens with refresh token rotation and password reset by email.'),
    inc('FEATURE', 'Payment endpoints integrate Stripe Billing for subscriptions and one-time purchases.'),
    inc('FEATURE', 'Push notification delivery to iOS and Android devices is included for up to {3-6} notification types.'),
    inc('TECHNICAL', 'All endpoints are documented in an OpenAPI specification and published on an interactive documentation site.'),
    inc('TECHNICAL', 'Rate limiting and request validation are implemented on all public endpoints.'),
    inc('TECHNICAL', 'The database layer uses PostgreSQL, including schema migrations and seed data for the staging environment.'),
    inc('TECHNICAL', 'Automated tests cover at least {60-80} percent of the endpoint logic.'),
    inc('UI_UX', 'A simple admin console for managing users and reviewing API usage is included.'),
    inc('CONTENT', 'Email templates for account verification and password reset are provided in English.'),
    inc('SUPPORT', 'Defects in delivered endpoints are fixed free of charge for {30-90} days after release.'),
    inc('SUPPORT', 'A monthly retainer of change request hours covers small adjustments to delivered endpoints.'),
    exc('FEATURE', 'Development of the iOS and Android mobile applications themselves is not included.'),
    exc('FEATURE', 'Real-time features such as live chat or live workout streaming are excluded.'),
    exc('TECHNICAL', 'Load testing beyond {500-2000} concurrent users and infrastructure scaling are excluded.'),
    exc('TECHNICAL', 'Data migration from legacy systems is not part of this agreement.'),
  ],
  analytics: [
    inc('FEATURE', 'The agency builds a dashboard showing key metrics with configurable date ranges and filters.'),
    inc('FEATURE', 'Report pages support table and chart views, and export to CSV.'),
    inc('FEATURE', 'Data ingestion pipelines load data from up to {3-5} sources into the data warehouse on a daily schedule.'),
    inc('FEATURE', 'Subscription billing is implemented with Stripe, including plan upgrades, downgrades, and invoices.'),
    inc('FEATURE', 'Team management allows account owners to invite members and assign roles.'),
    inc('FEATURE', 'Single sign-on through Google Workspace is included.'),
    inc('UI_UX', 'The design covers {8-14} screens in the shared design system, with a dark and a light theme.'),
    inc('UI_UX', 'Up to {2-3} rounds of revisions per major screen are included.'),
    inc('TECHNICAL', 'Charts are implemented with a standard open source charting library chosen by the agency.'),
    inc('TECHNICAL', 'Role-based access control is applied to all reports and settings pages.'),
    inc('SUPPORT', 'Defects in delivered features are fixed free of charge for {30-90} days after launch.'),
    inc('SUPPORT', 'A monthly retainer of change request hours covers small adjustments to delivered features.'),
    exc('FEATURE', 'Custom report builders where users define their own queries are not included.'),
    exc('FEATURE', 'Machine learning features such as forecasting or anomaly detection are excluded.'),
    exc('TECHNICAL', 'Ingestion from additional data sources beyond the agreed list requires a separate quote.'),
    exc('TECHNICAL', 'Compliance certifications such as SOC 2 or ISO 27001 are not part of this agreement.'),
  ],
  booking: [
    inc('FEATURE', 'Customers can search providers by service, date, and location and book available time slots.'),
    inc('FEATURE', 'Providers manage their availability, working hours, and days off in a calendar view.'),
    inc('FEATURE', 'Online payment of a deposit or the full price is handled through Stripe Connect.'),
    inc('FEATURE', 'Automatic SMS and email reminders are sent before each appointment.'),
    inc('FEATURE', 'Two-way synchronization with Google Calendar is included for provider accounts.'),
    inc('FEATURE', 'Customers can cancel or reschedule a booking up to a time limit configured by each provider.'),
    inc('UI_UX', 'The design covers {10-16} responsive screens for customers and providers.'),
    inc('UI_UX', 'Up to {2-4} rounds of design revisions per delivered screen are included.'),
    inc('TECHNICAL', 'The booking logic prevents double bookings by checking availability at confirmation time.'),
    inc('CONTENT', 'Notification texts are provided in {1-3} languages agreed with {client}.'),
    inc('SUPPORT', 'Defects in delivered features are fixed free of charge for {30-90} days after launch.'),
    inc('SUPPORT', 'A monthly retainer of change request hours covers small adjustments to delivered features.'),
    exc('FEATURE', 'Native mobile applications are not included; the platform is delivered as a responsive web application.'),
    exc('FEATURE', 'Video consultations and live chat between customers and providers are excluded.'),
    exc('FEATURE', 'Loyalty programs, discount codes, and gift cards are not part of this agreement.'),
    exc('TECHNICAL', 'Integration with Outlook or Apple Calendar is excluded.'),
  ],
};