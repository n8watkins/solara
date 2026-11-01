// The account page: plan and billing, the data download and account deletion.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('account', {
  loadingAccount: 'Loading your account...',
  backToSolara: 'Back to Solara',
  goToSignIn: 'Go to sign in',
  planBilling: 'Plan and billing',
  downloadData: 'Download your data',
  whatsIncluded: "What's included",
  deleteAccount: 'Delete account',
  whatsDeleted: "What's deleted, and what stays",
  deletedFromSolara: 'Deleted from Solara',
  outsideSolara: 'Outside Solara',
  typeDelete: 'Type DELETE to confirm',
  googleAsksAgain: 'Google then asks you to sign in again, to confirm it is you.',
  backArrow: '← Back to Solara',
  accountControls: 'Account controls',
  accountLead: 'Manage your plan, download your data or delete your account.',
  reviewThe: 'Review the',
  privacyPolicy: 'Privacy Policy',
  termsOfUse: 'Terms of Use',
  and: 'and',
  emailFallback: (email: string, days: number) =>
    `If it keeps failing, email ${email} and we will delete your account and all its data within ${days} days.`,
  signInToDownload: 'Sign in again to download your data.',
  exportFailed: 'The export could not be completed.',
  downloadFailed: (email: string) =>
    `Your data could not be downloaded. Check your connection and try again, or email ${email} for a copy.`,
  billingFailed: 'Billing management failed.',
  deletionCanceled:
    'Deletion was canceled because Google did not confirm your account. Nothing was deleted.',
  differentAccount:
    'That was a different Google account. Confirm with the account you are signed in with. Nothing was deleted.',
  notConfirmed: 'Google could not confirm your account, so nothing was deleted. Try again.',
  reauthNotConfigured: 'Google reauthentication is not configured.',
  deletionIncomplete: 'Deletion could not be completed.',
  deletionFailed: 'Deletion failed.',
  deletingData: 'Deleting your data. Keep this page open.',
  blocked: "Nothing was deleted: part of this account can only be removed by Solara's servers.",
  signInLeft: (fallback: string) =>
    `Your data was deleted, but your sign-in could not be removed. Try again. ${fallback}`,
  dataLeft: (fallback: string) =>
    `Not all of your data could be deleted, so your account is still here. Check your connection and try again; deletion picks up where it stopped. ${fallback}`,
  deletedTitle: 'Your account was deleted',
  pendingTitle: 'Your account deletion is in progress',
  signInRequired: 'Sign in required',
  deletedBody:
    'Your Solara account and its data have been removed, and nothing of it is left in this browser.',
  pendingBody:
    'You have been signed out while Solara finishes canceling billing and removing your account data.',
  signInRequiredBody: 'Return to Solara and sign in before using these controls.',
  billingNote:
    'Change plans, update your payment method, see invoices or cancel securely through Stripe.',
  loadingPlan: 'Loading your plan...',
  planLoadFailed: 'Your plan could not be loaded. Check your connection and reload.',
  opening: 'Opening...',
  manageSubscription: 'Manage subscription',
  preparing: 'Preparing...',
  downloadAccountData: 'Download account data',
  serversOnlyStart:
    "Part of this account can only be removed by Solara's servers, which are not running yet. To delete it, email",
  serversOnlyEnd: (days: number) =>
    `and we will delete your account and all its data within ${days} days.`,
  deleting: 'Deleting...',
  deletePermanently: 'Delete permanently',
  notWorkingStart: 'Something not working? Email',
  notWorkingEnd: (days: number) =>
    `and we will send you your data or delete your account within ${days} days.`,
  sectionAccount: 'your preferences (places, skin type, profiles and activities)',
  sectionBilling: 'a summary of your plan and billing dates',
  sectionScheduled: 'your scheduled activities',
  sectionImported: 'your imported events',
  sectionLinked: 'your linked calendars (their site and name, not their links)',
  sectionGoogle: 'the Google calendars you show events from',
  sectionOutlook: 'the Outlook calendars you show events from',
  sectionAlerts: 'the alerts sent in the last week',
  sectionHeadsUps: 'the Pro event heads-ups sent in the last week',
  sectionReminder: 'your sunscreen reminder waiting to be sent, if any',
  sectionDevices: 'device registration metadata',
  sectionBookkeeping:
    'when your sunscreen reminder was last set and how many were set and sent that day, and when a device was last registered',
  /** DELETED_DATA in order, joined by "|". */
  deletedItems:
    'your Solara preferences, profiles and activities|scheduled activities|imported events|linked calendars|your Google Calendar choices|your Outlook calendar choices|your calendar feed|notification devices|alert history|sunscreen reminders|your Solara sign-in',
  exportSummary: 'Get a copy of your Solara data as a JSON file.',
  exportExcluded:
    'Left out for security: capability tokens, such as your calendar feed address, and payment-provider identifiers.',
  deletionSummary:
    'Permanently deletes your account, its data and your Solara sign-in. This cannot be undone.',
  noteBilling:
    'A subscription is canceled at once, without a refund for the current period, and your billing details are deleted at Stripe.',
  noteGoogle:
    "Events already added to your Google Calendar stay there. To end Solara's access, remove Solara at myaccount.google.com/connections.",
  noteOutlook:
    "Events in your Outlook calendar stay there too, and Solara never kept a Microsoft token. To remove the permission you gave it, use your Microsoft account's app permissions.",
  noteTrial:
    'If you had the free trial, a hashed record of it is kept for 2 years, so the trial is once per person.',
  truncatedDevices: 'devices',
  truncatedScheduled: 'scheduled activities',
  truncatedImported: 'imported events',
  downloaded: 'Your account data was downloaded.',
  downloadedTruncated: (count: string, sections: string) =>
    `Your account data was downloaded. It holds the first ${count} records of ${sections}; the privacy policy says how to ask for the rest.`,
  servicesUnavailable: 'Account services are not available.',
  someDataLeft: 'Some account data could not be deleted.',
  documentsLeft: (n: number) => `${n} account documents are left.`,
  signInNotDeleted: 'The sign-in could not be deleted.',
})
