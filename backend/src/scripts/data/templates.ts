export type ModuleKind = 'UI' | 'SERVICE' | 'LIBRARY' | 'EXTERNAL';

export interface ProjectTemplate {
  key: string;
  title: string;
  description: string;
  modules: Partial<Record<ModuleKind, string[]>>;
  dependencies: string[]; // 'A>B' = A függ B-től
}

export const DEVELOPERS = [
  { name: 'Levy', email: 'levy@verto.example' },
  { name: 'John', email: 'john@verto.example' },
  { name: 'Anna Kovács', email: 'anna@verto.example' },
  { name: 'Dávid Szabó', email: 'david@verto.example' },
];

// [teljes név, rövid név]
export const COMPANIES: [string, string][] = [
  ['Acme Inc.', 'Acme'],
  ['FitLife LLC', 'FitLife'],
  ['Global Logistics', 'Global'],
  ['Northwind Traders', 'Northwind'],
  ['Bluebird Studios', 'Bluebird'],
  ['Helios Energy', 'Helios'],
  ['Pinecone Foods', 'Pinecone'],
  ['Orbit Labs', 'Orbit'],
  ['Maple & Co', 'Maple'],
  ['Redwood Health', 'Redwood'],
  ['Summit Outfitters', 'Summit'],
  ['Lumen Learning', 'Lumen'],
  ['Quartz Finance', 'Quartz'],
  ['Tidewater Marine', 'Tidewater'],
  ['Ironclad Security', 'Ironclad'],
  ['Sunrise Bakery', 'Sunrise'],
  ['Cobalt Robotics', 'Cobalt'],
  ['Evergreen Travel', 'Evergreen'],
  ['Vantage Realty', 'Vantage'],
  ['Zenith Pet Care', 'Zenith'],
];

export const TEMPLATES: ProjectTemplate[] = [
  {
    key: 'webshop',
    title: 'E-Commerce Redesign',
    description:
      'Modernizing core checkout flows and user OAuth. Integrated with Next.js, Stripe, and a headless catalog.',
    modules: {
      UI: ['ProductCatalog', 'CartPage', 'CheckoutFlow', 'AccountPage'],
      SERVICE: [
        'AuthService',
        'OrderService',
        'CatalogService',
        'InventoryService',
        'SearchService',
        'NotificationService',
      ],
      EXTERNAL: ['StripeGateway', 'EmailProvider'],
      LIBRARY: ['DesignSystem', 'Analytics'],
    },
    dependencies: [
      'ProductCatalog>CatalogService',
      'ProductCatalog>SearchService',
      'ProductCatalog>DesignSystem',
      'CartPage>OrderService',
      'CartPage>DesignSystem',
      'CheckoutFlow>OrderService',
      'CheckoutFlow>AuthService',
      'CheckoutFlow>StripeGateway',
      'CheckoutFlow>DesignSystem',
      'CheckoutFlow>Analytics',
      'AccountPage>AuthService',
      'AccountPage>OrderService',
      'AccountPage>DesignSystem',
      'OrderService>InventoryService',
      'OrderService>NotificationService',
      'OrderService>AuthService',
      'InventoryService>CatalogService',
      'NotificationService>EmailProvider',
      'SearchService>CatalogService',
    ],
  },
  {
    key: 'mobile-api',
    title: 'Mobile App API Integration',
    description:
      'Developing secure B2B endpoints, user profile management, and PostgreSQL database logic.',
    modules: {
      UI: ['AdminConsole', 'PublicDocs'],
      SERVICE: [
        'APIGateway',
        'AuthAPI',
        'ProfileAPI',
        'WorkoutAPI',
        'PaymentsAPI',
        'NotificationsAPI',
      ],
      LIBRARY: ['UserRepository', 'WorkoutRepository', 'RateLimiter'],
      EXTERNAL: ['PushProvider', 'StripeBilling'],
    },
    dependencies: [
      'AdminConsole>APIGateway',
      'PublicDocs>APIGateway',
      'APIGateway>AuthAPI',
      'APIGateway>ProfileAPI',
      'APIGateway>WorkoutAPI',
      'APIGateway>PaymentsAPI',
      'APIGateway>RateLimiter',
      'AuthAPI>UserRepository',
      'ProfileAPI>UserRepository',
      'ProfileAPI>AuthAPI',
      'WorkoutAPI>WorkoutRepository',
      'WorkoutAPI>AuthAPI',
      'WorkoutAPI>NotificationsAPI',
      'PaymentsAPI>StripeBilling',
      'PaymentsAPI>AuthAPI',
      'NotificationsAPI>PushProvider',
    ],
  },
  {
    key: 'analytics',
    title: 'Analytics Dashboard',
    description:
      'Building reporting dashboards, data ingestion pipelines, and subscription billing.',
    modules: {
      UI: ['Dashboard', 'ReportsPage', 'SettingsPage', 'BillingPage'],
      SERVICE: [
        'AuthService',
        'ReportService',
        'DataIngestion',
        'BillingService',
        'TeamService',
      ],
      EXTERNAL: ['DataWarehouse', 'StripeBilling', 'SSOProvider'],
      LIBRARY: ['ChartKit', 'DesignSystem'],
    },
    dependencies: [
      'Dashboard>ReportService',
      'Dashboard>ChartKit',
      'Dashboard>DesignSystem',
      'ReportsPage>ReportService',
      'ReportsPage>ChartKit',
      'ReportsPage>DesignSystem',
      'SettingsPage>TeamService',
      'SettingsPage>AuthService',
      'SettingsPage>DesignSystem',
      'BillingPage>BillingService',
      'BillingPage>DesignSystem',
      'ReportService>DataIngestion',
      'ReportService>AuthService',
      'DataIngestion>DataWarehouse',
      'BillingService>StripeBilling',
      'BillingService>TeamService',
      'TeamService>AuthService',
      'AuthService>SSOProvider',
    ],
  },
  {
    key: 'booking',
    title: 'Booking Platform',
    description:
      'Online appointment booking with provider calendars, payments, and SMS reminders.',
    modules: {
      UI: ['SearchPage', 'BookingFlow', 'ProviderPortal', 'CalendarView'],
      SERVICE: [
        'AuthService',
        'BookingService',
        'AvailabilityService',
        'ProviderService',
        'PaymentService',
        'ReminderService',
      ],
      EXTERNAL: ['StripeConnect', 'SmsProvider', 'GoogleCalendarSync'],
      LIBRARY: ['DesignSystem'],
    },
    dependencies: [
      'SearchPage>AvailabilityService',
      'SearchPage>ProviderService',
      'SearchPage>DesignSystem',
      'BookingFlow>BookingService',
      'BookingFlow>PaymentService',
      'BookingFlow>AuthService',
      'BookingFlow>DesignSystem',
      'ProviderPortal>ProviderService',
      'ProviderPortal>AvailabilityService',
      'ProviderPortal>AuthService',
      'ProviderPortal>DesignSystem',
      'CalendarView>AvailabilityService',
      'CalendarView>GoogleCalendarSync',
      'CalendarView>DesignSystem',
      'BookingService>AvailabilityService',
      'BookingService>ReminderService',
      'PaymentService>StripeConnect',
      'ReminderService>SmsProvider',
      'ProviderService>AuthService',
    ],
  },
];